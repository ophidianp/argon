// Pure board geometry: no store, no DOM, so it runs under plain `node --test` too.
import type { Node } from '@xyflow/react'

export const CONSOLE_SIZE = { width: 640, height: 420 }
export const MIN_CONSOLE = { width: 380, height: 220 }
export const GROUP_PAD = 24
export const GROUP_HEAD = 44
const GROUP_GAP = 60 // room for a console's sub-agent cards above the next row
const EMPTY_GROUP = { width: 380, height: 220 }

type Size = { width: number; height: number }
type Box = Size & { left: number; top: number; right: number; bottom: number }

// Where a tooltip goes: away from the window edge its control sits on, and always fully inside.
export function tipSpot(anchor: Box, tip: Size, win: Size, gap = 8, margin = 8) {
  const cx = anchor.left + anchor.width / 2 - tip.width / 2
  const cy = anchor.top + anchor.height / 2 - tip.height / 2
  let x = cx
  let y = anchor.top - tip.height - gap
  if (anchor.right < 120) [x, y] = [anchor.right + gap, cy]
  else if (anchor.left > win.width - 120) [x, y] = [anchor.left - tip.width - gap, cy]
  else if (y < margin) y = anchor.bottom + gap
  return {
    x: Math.round(Math.max(margin, Math.min(x, win.width - tip.width - margin))),
    y: Math.round(Math.max(margin, Math.min(y, win.height - tip.height - margin))),
  }
}

export const sizeOf = (n: Node) => ({
  width: n.measured?.width ?? n.width ?? (n.style?.width as number) ?? CONSOLE_SIZE.width,
  height: n.measured?.height ?? n.height ?? (n.style?.height as number) ?? CONSOLE_SIZE.height,
})

// Slide a rect right past whatever top-level node it would cover, so auto-placed nodes never overlap.
export function freeSpot(nodes: Node[], rect: { x: number; y: number; width: number; height: number }) {
  const boxes = nodes.filter((n) => !n.parentId).map((n) => ({ ...n.position, ...sizeOf(n) }))
  let { x } = rect
  for (let guard = 0; guard < 200; guard++) {
    const hit = boxes.find((b) => x < b.x + b.width + 32 && x + rect.width + 32 > b.x && rect.y < b.y + b.height + 32 && rect.y + rect.height + 32 > b.y)
    if (!hit) break
    x = hit.x + hit.width + 40
  }
  return { x, y: rect.y }
}

// The console under the pointer while others are being dragged: what a drop would group them with.
// Nodes inside a group hold relative positions, so `abs` says where each one really is.
export function consoleUnder(nodes: Node[], dragged: Set<string>, at: { x: number; y: number }, abs: (n: Node) => { x: number; y: number }) {
  return nodes.find((n) => {
    if (n.type !== 'console' || dragged.has(n.id)) return false
    const p = abs(n)
    const { width, height } = sizeOf(n)
    return at.x > p.x && at.x < p.x + width && at.y > p.y && at.y < p.y + height
  })
}

// Would a wire source -> target close a loop of hand-offs (A -> B -> A would bounce work forever)?
export function wouldCycle(edges: { source: string; target: string }[], source: string, target: string) {
  const seen = new Set<string>()
  const todo = [target]
  while (todo.length) {
    const at = todo.pop()!
    if (at === source) return true
    if (seen.has(at)) continue
    seen.add(at)
    for (const e of edges) if (e.source === at) todo.push(e.target)
  }
  return false
}

// Members in reading order (a row is anything within 120px vertically), laid out in a near-square
// grid inside the group frame. Positions are relative to the group; returns the frame size too.
export function gridLayout(members: Node[]) {
  if (!members.length) return { slots: new Map<string, { x: number; y: number }>(), ...EMPTY_GROUP }
  const sorted = [...members].sort((a, b) => (Math.abs(a.position.y - b.position.y) > 120 ? a.position.y - b.position.y : a.position.x - b.position.x))
  const cols = Math.ceil(Math.sqrt(sorted.length))
  const rows = Math.ceil(sorted.length / cols)
  const sizes = sorted.map(sizeOf)
  const colW = Array.from({ length: cols }, (_, c) => Math.max(...sizes.filter((_, i) => i % cols === c).map((s) => s.width)))
  const rowH = Array.from({ length: rows }, (_, r) => Math.max(...sizes.filter((_, i) => Math.floor(i / cols) === r).map((s) => s.height)))
  const offsetX = (c: number) => GROUP_PAD + colW.slice(0, c).reduce((a, b) => a + b + GROUP_GAP, 0)
  const offsetY = (r: number) => GROUP_PAD + GROUP_HEAD + rowH.slice(0, r).reduce((a, b) => a + b + GROUP_GAP, 0)
  return {
    slots: new Map(sorted.map((n, i) => [n.id, { x: offsetX(i % cols), y: offsetY(Math.floor(i / cols)) }])),
    width: offsetX(cols) - GROUP_GAP + GROUP_PAD,
    height: offsetY(rows) - GROUP_GAP + GROUP_PAD,
  }
}
