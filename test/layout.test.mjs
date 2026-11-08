// Group re-flow geometry (src/layout.ts runs as-is under Node's TypeScript type stripping).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { consoleUnder, gridLayout, tipSpot, wouldCycle } from '../src/layout.ts'

test('a drop lands on the console under the pointer, never on what is being dragged', () => {
  const at = (id, x, type = 'console') => ({ id, type, position: { x, y: 0 }, measured: { width: 100, height: 100 } })
  const nodes = [at('a', 0), at('b', 50), at('note', 300, 'note')]
  const abs = (n) => n.position
  assert.equal(consoleUnder(nodes, new Set(['b']), { x: 60, y: 50 }, abs).id, 'a')
  assert.equal(consoleUnder(nodes, new Set(['a']), { x: 60, y: 50 }, abs).id, 'b')
  assert.equal(consoleUnder(nodes, new Set(['a']), { x: 320, y: 50 }, abs), undefined) // only consoles
  assert.equal(consoleUnder(nodes, new Set(['a']), { x: 500, y: 50 }, abs), undefined)
})

test('a tooltip moves away from the window edge and stays inside', () => {
  const win = { width: 1000, height: 800 }
  const tip = { width: 100, height: 30 }
  const box = (left, top) => ({ left, top, right: left + 40, bottom: top + 40, width: 40, height: 40 })
  assert.deepEqual(tipSpot(box(20, 400), tip, win), { x: 68, y: 405 }) // left rail: to its right
  assert.deepEqual(tipSpot(box(940, 400), tip, win), { x: 832, y: 405 }) // right rail: to its left
  assert.deepEqual(tipSpot(box(500, 400), tip, win), { x: 470, y: 362 }) // anywhere else: above
  assert.deepEqual(tipSpot(box(500, 10), tip, win), { x: 470, y: 58 }) // top bar: below
  assert.deepEqual(tipSpot(box(860, 10), { width: 300, height: 30 }, win), { x: 692, y: 58 }) // clamped to the window
})

const W = 640
const H = 420
const PAD = 24
const HEAD = 44
const GAP = 60
const node = (id, x, y) => ({ id, position: { x, y }, data: {}, style: { width: W, height: H } })

test('a group grows to fit a newcomer and keeps reading order', () => {
  const two = gridLayout([node('a', 24, 68), node('b', 724, 68)])
  assert.deepEqual([two.width, two.height], [PAD + W + GAP + W + PAD, PAD + HEAD + H + PAD])

  // A third console dropped below the row: the frame grows to a 2x2 grid and it takes the next slot.
  const three = gridLayout([node('a', 24, 68), node('b', 724, 68), node('c', 300, 600)])
  assert.deepEqual([three.width, three.height], [PAD + W + GAP + W + PAD, PAD + HEAD + H + GAP + H + PAD])
  assert.deepEqual(three.slots.get('c'), { x: PAD, y: PAD + HEAD + H + GAP })

  // Dropped at the start of the row: it goes first and the others shift along.
  const first = gridLayout([node('a', 24, 68), node('b', 724, 68), node('n', 0, 80)])
  assert.deepEqual(first.slots.get('n'), { x: PAD, y: PAD + HEAD })
  assert.deepEqual(first.slots.get('a'), { x: PAD + W + GAP, y: PAD + HEAD })
})

test('a hand-off wire that would bounce work in a circle is spotted', () => {
  const chain = [
    { source: 'plan', target: 'build' },
    { source: 'build', target: 'review' },
  ]
  assert.equal(wouldCycle(chain, 'review', 'plan'), true) // review -> plan closes the loop
  assert.equal(wouldCycle(chain, 'build', 'plan'), true)
  assert.equal(wouldCycle(chain, 'plan', 'review'), false) // a shortcut is fine
  assert.equal(wouldCycle(chain, 'review', 'docs'), false)
})

test('an empty group keeps a drop target size', () => {
  const empty = gridLayout([])
  assert.deepEqual([empty.width, empty.height, empty.slots.size], [380, 220, 0])
})
