import test from 'node:test'
import assert from 'node:assert/strict'
import { contextReport, contextAdvice } from '../shared/context.js'

const line = (o) => JSON.stringify(o)
const reply = (usage, content = [{ type: 'text', text: 'ok' }]) => line({ type: 'assistant', message: { model: 'claude-x', usage, content } })

test('no reply yet: nothing to report', () => {
  assert.equal(contextReport(line({ type: 'user', message: { content: 'hello' } })), null)
})

test('the total is Claude’s own count, the rest is its instructions', () => {
  const r = contextReport(
    [
      line({ type: 'user', message: { content: 'a'.repeat(400) } }),
      reply({ input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 90, output_tokens: 100 }, [
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a/b/c.ts' } },
      ]),
      line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(2000) }] } }),
    ].join('\n'),
  )
  assert.equal(r.used, 1200)
  assert.equal(r.window, 200_000)
  assert.ok(r.parts.find((p) => p.label === 'Files read').tokens >= 500)
  assert.equal(r.parts.reduce((n, p) => n + p.tokens, 0), 1200)
  assert.deepEqual(r.biggest[0].label, 'b/c.ts')
})

test('compacting forgets what came before; helpers do not count', () => {
  const r = contextReport(
    [
      line({ type: 'user', message: { content: 'a'.repeat(4000) } }),
      reply({ input_tokens: 5000 }),
      line({ type: 'system', subtype: 'compact_boundary' }),
      line({ type: 'user', isSidechain: true, message: { content: 'b'.repeat(4000) } }),
      reply({ input_tokens: 700 }),
    ].join('\n'),
  )
  assert.equal(r.used, 700)
  assert.equal(r.parts.find((p) => p.label === 'Your messages'), undefined)
})

test('past 200k it must be the large window', () => {
  assert.equal(contextReport(reply({ input_tokens: 300_000 })).window, 1_000_000)
})

test('the advice follows how full it is', () => {
  assert.match(contextAdvice(0.1), /Plenty/)
  assert.match(contextAdvice(0.9), /Compact/)
})
