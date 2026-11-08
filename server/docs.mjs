// Documents studio: a read-only CLI run writes one Markdown document about a repo, streamed to the
// board while it is written and kept in a per-repo library under DATA_DIR/docs when it finishes.
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { commandFor, runCli } from './stream.mjs'
import { DEPTHS, TEMPLATES, countWords, docBody, docPrompt } from '../shared/docs.js'

export function createDocs({ dir, broadcast, launch, command = commandFor, timeoutMs = 15 * 60_000 }) {
  const jobs = new Map() // repo path -> the document being written there
  const folder = (cwd) => path.join(dir, crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 16))
  const indexOf = (cwd) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(folder(cwd), 'index.json'), 'utf8'))
    } catch {
      return [] // nothing written for this repo yet
    }
  }
  const view = (j) => ({ id: j.id, cwd: j.cwd, doc: j.doc, title: j.title, agent: j.agent, depth: j.depth, startedAt: j.startedAt, step: j.step, text: j.text, status: j.status, error: j.error })
  const list = () => [...jobs.values()].map(view)
  // Text deltas come many per second; the board gets at most five updates a second.
  let soon = null
  const emit = () => (clearTimeout(soon), (soon = null), broadcast({ type: 'docs', docs: list() }))
  const emitSoon = () => (soon ??= setTimeout(emit, 200))

  // The library: what was written for this repo, newest first, and how long each depth took last.
  function library(cwd) {
    const docs = indexOf(cwd)
    const timed = Object.fromEntries(DEPTHS.map((d) => [d.id, docs.find((x) => x.depth === d.id)?.ms ?? null]))
    return { docs, timed }
  }

  function read(cwd, id) {
    if (!/^[\w-]{1,64}$/.test(id ?? '')) throw new Error('bad document id')
    const entry = indexOf(cwd).find((x) => x.id === id)
    if (!entry) throw new Error('no such document')
    return { ...entry, text: fs.readFileSync(path.join(folder(cwd), `${id}.md`), 'utf8') }
  }

  // `template` is a TEMPLATES id, or 'ask' with the user's own request in `ask`.
  function start(cwd, { template, ask, agent = 'claude', depth = 'balanced' }) {
    const t = TEMPLATES.find((x) => x.id === template)
    const d = DEPTHS.find((x) => x.id === depth) ?? DEPTHS[1]
    const request = t ? t.ask : String(ask ?? '').trim().slice(0, 2000)
    if (!request) throw new Error('say what the document should cover')
    const line = command(agent, docPrompt(request, d.words), d.model)
    if (!line) throw new Error(`${agent} cannot write documents yet`)
    if (jobs.get(cwd)?.status === 'running') throw new Error('a document is already being written for this repo')
    const job = {
      id: crypto.randomUUID(),
      cwd,
      doc: t ? t.id : `ask-${Date.now().toString(36)}`,
      title: t ? t.title : request.slice(0, 80),
      agent,
      depth: d.id,
      startedAt: Date.now(),
      step: 0,
      text: '',
      status: 'running',
      error: null,
    }
    jobs.set(cwd, job)
    job.run = runCli({
      command: line,
      claude: agent === 'claude',
      cwd,
      launch,
      timeoutMs,
      onStep: (step) => ((job.step = step), emitSoon()),
      onText: (text) => ((job.text = docBody(text)), emitSoon()),
      onEnd: ({ text, error, stopped }) => {
        delete job.run
        if (stopped) return
        job.text = docBody(text)
        job.step = 3
        if (!job.text || error) {
          job.status = 'failed'
          job.error = error || `${agent} wrote nothing`
          return emit()
        }
        const title = job.text.match(/^# (.+)$/m)?.[1].trim() || job.title
        const entry = { id: job.doc, template: t?.id ?? 'ask', ...(t ? {} : { ask: request }), title, agent, depth: d.id, createdAt: Date.now(), ms: Date.now() - job.startedAt, words: countWords(job.text) }
        try {
          fs.mkdirSync(folder(cwd), { recursive: true })
          fs.writeFileSync(path.join(folder(cwd), `${job.doc}.md`), job.text)
          fs.writeFileSync(path.join(folder(cwd), 'index.json'), JSON.stringify([entry, ...indexOf(cwd).filter((x) => x.id !== job.doc)], null, 2))
          job.status = 'done'
        } catch (e) {
          job.status = 'failed'
          job.error = `written but not saved: ${e.message}`
        }
        emit()
      },
    })
    emit()
    return view(job)
  }

  // Stop a document being written, or forget a finished run once the library has it.
  function clear(cwd) {
    const job = jobs.get(cwd)
    if (!job) return
    job.run?.stop()
    jobs.delete(cwd)
    emit()
  }

  return { list, library, read, start, clear }
}

// `node server/docs.mjs`: a whole run against a fake Claude, saved and read back from a temp library.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const assert = (await import('node:assert/strict')).default
  const os = await import('node:os')
  const q = (v) => `'${v.replace(/'/g, `'\\''`)}'`
  const ev = (o) => JSON.stringify(o)
  const delta = (t) => ev({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } } })
  const doc = '# Demo\n\n## What it is\n\nA tiny demo.'
  const stream = [ev({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] } }), delta('Let me look.\n'), delta(doc), ev({ type: 'result', is_error: false, result: '```markdown\n' + doc + '\n```' })]
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-docs-'))
  const seen = []
  const docs = createDocs({
    dir,
    broadcast: (m) => seen.push(m.docs[0]?.status),
    command: (agent, prompt, model) => (assert.equal(model, 'haiku'), { claude: `printf '%s\\n' ${stream.map(q).join(' ')}`, slow: 'sleep 30' }[agent]),
    launch: (cmd, cwd) => spawn('/bin/sh', ['-c', cmd], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }),
  })
  assert.throws(() => docs.start(process.cwd(), { template: 'ask', ask: ' ' }), /say what/)
  docs.start(process.cwd(), { template: 'overview', depth: 'quick' })
  assert.throws(() => docs.start(process.cwd(), { template: 'readme', depth: 'quick' }), /already being written/)
  await new Promise((r) => setTimeout(r, 1500))
  const done = docs.list()[0]
  assert.equal(done.status, 'done')
  assert.equal(done.text, doc) // the fence and the chatter before the title are gone
  const lib = docs.library(process.cwd())
  assert.deepEqual([lib.docs[0].id, lib.docs[0].title, lib.docs[0].words], ['overview', 'Demo', 7])
  assert.equal(typeof lib.timed.quick, 'number')
  assert.equal(lib.timed.balanced, null)
  assert.equal(docs.read(process.cwd(), 'overview').text, doc)
  assert.throws(() => docs.read(process.cwd(), '../index'), /bad document id/)
  assert.ok(seen.includes('running') && seen.at(-1) === 'done')

  docs.clear(process.cwd())
  docs.start('/tmp', { template: 'ask', ask: 'the build', agent: 'slow', depth: 'quick' })
  docs.clear('/tmp')
  assert.equal(docs.list().length, 0)
  fs.rmSync(dir, { recursive: true })
  console.log('docs runs ok')
}
