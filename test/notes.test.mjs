import test from 'node:test'
import assert from 'node:assert/strict'
import { layoutGraph, noteLinks, resolveLink } from '../shared/notes.js'

test('note links resolve relative paths, root paths and wiki names', () => {
  const paths = ['README.md', 'docs/a.md', 'docs/sub/b.md', 'docs/My Note.md']
  assert.equal(resolveLink('docs/sub/b.md', '../a.md'), 'docs/a.md')
  assert.equal(resolveLink('docs/a.md', '/README.md'), 'README.md')
  assert.equal(resolveLink('README.md', '../out.md'), null)
  const text = [
    'See [a](./a.md#intro), [b](sub/b.md "title") and [home](/README.md).',
    'Not notes: [site](https://x.dev/page.md), [img](pic.png), [gone](missing.md), [self](a.md).',
    'Wiki: [[My Note]] and [[b|the b note]] and [[nobody]]. Escaped: [m](My%20Note.md)',
  ].join('\n')
  assert.deepEqual(noteLinks('docs/a.md', text, paths).sort(), ['README.md', 'docs/My Note.md', 'docs/sub/b.md'])
})

test('the link graph keeps linked notes closer and fits the box', () => {
  const ids = Array.from({ length: 30 }, (_, i) => `n${i}`)
  const links = [
    ['n0', 'n1'],
    ['n1', 'n2'],
    ['n0', 'n2'],
  ]
  const at = layoutGraph(ids, links, { width: 800, height: 600 })
  for (const p of Object.values(at)) assert.ok(p.x >= 0 && p.x <= 800 && p.y >= 0 && p.y <= 600)
  const d = (a, b) => Math.hypot(at[a].x - at[b].x, at[a].y - at[b].y)
  const all = []
  for (const a of ids) for (const b of ids) if (a < b) all.push(d(a, b))
  const mean = all.reduce((s, x) => s + x, 0) / all.length
  assert.ok(d('n0', 'n1') < mean / 2 && d('n1', 'n2') < mean / 2)
  assert.deepEqual(layoutGraph(ids, links), layoutGraph(ids, links)) // same repo, same picture
})
