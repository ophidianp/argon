// Diagrams studio: the CLI describes the repo as boxes, areas and arrows in JSON; this turns that
// answer into board geometry (dagre lays it out top to bottom, each area framing its boxes).
import dagre from '@dagrejs/dagre'

export const DIAGRAM_PROMPT =
  "Draw a diagram of this repository's architecture for a whiteboard. Read the README, the file tree and the key source files first. " +
  'Reply with ONLY one JSON object, no prose and no code fence: ' +
  '{"title": "<Project> Component Map", "groups": [{"id": "runtime", "label": "Runtime"}], ' +
  '"nodes": [{"id": "server", "label": "Next.js Server", "sub": "App Router, RSC", "shape": "box", "group": "runtime"}], ' +
  '"edges": [{"from": "browser", "to": "server", "label": "requests"}]}. ' +
  'Use 6 to 16 nodes and at most 5 groups (areas such as client, runtime, app, data, external services); a node outside every area has "group": null. ' +
  'A label is a real file, module or service name; "sub" is 1 to 4 words on its role; an edge label is one or two words. ' +
  'Shapes: "ellipse" for people and outside actors, "diamond" for decisions, "box" for everything else.'

const SHAPES = new Set(['box', 'ellipse', 'diamond'])
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : [])

/** The diagram in a CLI's answer, cleaned: unknown shapes become boxes, dangling arrows and empty areas go. */
export function parseDiagram(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('the answer has no diagram in it')
  let raw
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new Error('the diagram in the answer is not valid JSON')
  }
  const groupIds = new Set()
  const groups = []
  for (const g of list(raw.groups, 8)) {
    const id = str(g?.id, 60)
    if (!id || groupIds.has(id)) continue
    groupIds.add(id)
    groups.push({ id, label: str(g.label, 40) || id })
  }
  const ids = new Set()
  const nodes = []
  for (const n of list(raw.nodes, 40)) {
    const id = str(n?.id, 60)
    const label = str(n?.label, 48) || id
    if (!id || ids.has(id)) continue
    ids.add(id)
    nodes.push({ id, label, sub: str(n.sub, 48), shape: SHAPES.has(n.shape) ? n.shape : 'box', group: groupIds.has(n.group) ? n.group : null })
  }
  if (!nodes.length) throw new Error('the diagram has no boxes')
  const pairs = new Set()
  const edges = []
  for (const e of list(raw.edges, 80)) {
    const from = str(e?.from, 60)
    const to = str(e?.to, 60)
    if (!ids.has(from) || !ids.has(to) || from === to || pairs.has(`${from}>${to}`)) continue
    pairs.add(`${from}>${to}`)
    edges.push({ from, to, label: str(e.label, 32) })
  }
  return { title: str(raw.title, 80) || 'Repository map', groups: groups.filter((g) => nodes.some((n) => n.group === g.id)), nodes, edges }
}

const PAD = 22 // an area's frame around its boxes
const HEAD = 22 // room for the area's name above its boxes

/** Board geometry: top-left corners from 0,0, a title above everything, a frame per area. */
export function layoutDiagram(d) {
  const g = new dagre.graphlib.Graph({ compound: true })
  g.setGraph({ rankdir: 'TB', nodesep: 70, ranksep: 90, edgesep: 30 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const area of d.groups) g.setNode(`area:${area.id}`, {})
  for (const n of d.nodes) {
    const width = Math.max(n.shape === 'box' ? 170 : 150, Math.max(n.label.length * 10, n.sub.length * 7) + 44)
    const height = n.shape === 'diamond' ? 96 : n.sub ? 70 : 54
    g.setNode(n.id, { width, height })
    if (n.group) g.setParent(n.id, `area:${n.group}`)
  }
  for (const e of d.edges) g.setEdge(e.from, e.to, { label: e.label, width: e.label.length * 7, height: 16 })
  dagre.layout(g)

  const shapes = d.nodes.map((n) => {
    const p = g.node(n.id)
    return { ...n, x: p.x - p.width / 2, y: p.y - p.height / 2, w: p.width, h: p.height }
  })
  // An area frames exactly its own boxes (dagre's cluster box can be looser than that).
  const frames = d.groups.map((area) => {
    const own = shapes.filter((s) => s.group === area.id)
    const x0 = Math.min(...own.map((s) => s.x)) - PAD
    const y0 = Math.min(...own.map((s) => s.y)) - PAD - HEAD
    const x1 = Math.max(...own.map((s) => s.x + s.w)) + PAD
    const y1 = Math.max(...own.map((s) => s.y + s.h)) + PAD
    return { id: area.id, label: area.label, x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  })
  const all = [...shapes, ...frames]
  const left = Math.min(...all.map((b) => b.x))
  const top = Math.min(...all.map((b) => b.y)) - 64
  const shift = (b) => ({ ...b, x: b.x - left, y: b.y - top })
  return {
    title: { text: d.title, x: 0, y: 0 },
    frames: frames.map(shift),
    shapes: shapes.map(shift),
    edges: d.edges,
    width: Math.max(...all.map((b) => b.x + b.w)) - left,
    height: Math.max(...all.map((b) => b.y + b.h)) - top,
  }
}
