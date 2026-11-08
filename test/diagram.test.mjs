import test from 'node:test'
import assert from 'node:assert/strict'
import { layoutDiagram, parseDiagram } from '../shared/diagram.js'

const answer = `Here is the map:
\`\`\`json
${JSON.stringify({
  title: 'Demo Component Map',
  groups: [
    { id: 'client', label: 'Client' },
    { id: 'runtime', label: 'Runtime' },
    { id: 'empty', label: 'Nobody here' },
  ],
  nodes: [
    { id: 'browser', label: 'Browser', sub: 'visitor', shape: 'ellipse', group: 'client' },
    { id: 'server', label: 'Next.js Server', sub: 'App Router, RSC', shape: 'box', group: 'runtime' },
    { id: 'config', label: 'next.config.ts', sub: 'build config', shape: 'hexagon', group: 'runtime' },
    { id: 'db', label: 'Postgres', sub: 'data', group: 'nowhere' },
    { id: 'server', label: 'duplicate id' },
  ],
  edges: [
    { from: 'browser', to: 'server', label: 'requests' },
    { from: 'config', to: 'server', label: 'configures' },
    { from: 'server', to: 'db', label: 'queries' },
    { from: 'server', to: 'ghost', label: 'dangling' },
    { from: 'server', to: 'server', label: 'self' },
    { from: 'browser', to: 'server', label: 'twice' },
  ],
})}
\`\`\`
Hope it helps.`

test('a diagram answer is parsed and cleaned', () => {
  const d = parseDiagram(answer)
  assert.equal(d.title, 'Demo Component Map')
  assert.deepEqual(d.groups.map((g) => g.id), ['client', 'runtime'])
  assert.deepEqual(d.nodes.map((n) => [n.id, n.shape, n.group]), [
    ['browser', 'ellipse', 'client'],
    ['server', 'box', 'runtime'],
    ['config', 'box', 'runtime'],
    ['db', 'box', null],
  ])
  assert.deepEqual(d.edges.map((e) => e.label), ['requests', 'configures', 'queries'])
  assert.throws(() => parseDiagram('I could not read the repo.'), /no diagram/)
  assert.throws(() => parseDiagram('{"nodes": []}'), /no boxes/)
})

test('the layout frames each area around its boxes without overlaps', () => {
  const l = layoutDiagram(parseDiagram(answer))
  const inside = (s, f) => s.x >= f.x && s.y >= f.y && s.x + s.w <= f.x + f.w && s.y + s.h <= f.y + f.h
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  for (const s of l.shapes) {
    if (s.group) assert.ok(inside(s, l.frames.find((f) => f.id === s.group)), `${s.id} is inside its area`)
    for (const f of l.frames) if (f.id !== s.group) assert.ok(!overlap(s, f), `${s.id} stays out of ${f.id}`)
    for (const t of l.shapes) if (t !== s) assert.ok(!overlap(s, t), `${s.id} and ${t.id} do not overlap`)
    assert.ok(s.y > l.title.y + 40 && s.x >= 0, 'everything sits below the title, from 0,0')
  }
  assert.ok(l.width > 0 && l.height > 0)
  // dagre ranks top to bottom: the browser sits above the server it calls
  const at = Object.fromEntries(l.shapes.map((s) => [s.id, s]))
  assert.ok(at.browser.y < at.server.y && at.server.y < at.db.y)
})
