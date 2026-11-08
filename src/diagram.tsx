import { useEffect, useRef } from 'react'
import type { Node } from '@xyflow/react'
import { X } from 'lucide-react'
import { api, type DiagramLayout } from './api'
import { nid } from './board'
import { freeSpot } from './layout'
import { project, useStore, workspace, type ShapeData } from './store'
import { agentById } from '../shared/agents.js'
import { AgentGlyph } from './components/icons'
import { SHAPE_DEFAULTS } from './components/Shapes'
import { useNow } from './components/LoopsModal'

const DRAWERS = ['claude', 'codex', 'gemini', 'grok', 'opencode']
const KIND = { box: 'rect', ellipse: 'ellipse', diamond: 'diamond' } as const
const FAINT = '#8f887f'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Ask the first installed CLI (Claude when there) to draw the open project's repo.
export async function startDiagram(focus = '') {
  const s = useStore.getState()
  const p = project(s)
  if (!p) return
  const agent = DRAWERS.find((a) => s.installed.includes(a)) ?? 'claude'
  try {
    await api.diagram(p.path, agent, focus)
  } catch (e) {
    s.notify(`Diagram: ${(e as Error).message}`)
  }
}

// Puts a laid-out diagram on the board in a free spot: areas and title, then the boxes one by one
// (empty), then the arrows, then the words. Everything stays plain shapes, text and arrows to edit.
export async function drawDiagram(d: DiagramLayout) {
  const s = useStore.getState()
  const c = s.flow?.screenToFlowPosition({ x: innerWidth / 2, y: innerHeight / 2 }) ?? { x: 0, y: 0 }
  const o = freeSpot(workspace(s)?.nodes ?? [], { x: c.x - d.width / 2, y: c.y - d.height / 2, width: d.width, height: d.height })
  const at = (b: { x: number; y: number }) => ({ x: o.x + b.x, y: o.y + b.y })
  const placed: string[] = []
  const add = (n: Node) => (s.addNode(n), placed.push(n.id), n.id)
  const shape = (data: Partial<ShapeData>) => ({ ...SHAPE_DEFAULTS, kind: 'rect', ...data }) as ShapeData

  s.flow?.fitBounds({ x: o.x, y: o.y, width: d.width, height: d.height }, { padding: 0.2, duration: 500 })
  add({ id: nid('t'), type: 'text', position: at(d.title), data: { text: d.title.text, font: 'Hand', size: 'M' } })
  for (const f of d.frames) {
    add({ id: nid('s'), type: 'shape', position: at(f), width: f.w, height: f.h, data: shape({ stroke: FAINT, strokeWidth: 1.5, dash: 'dashed' }) })
    add({ id: nid('t'), type: 'text', position: at({ x: f.x + 14, y: f.y + 6 }), data: { text: f.label.toUpperCase(), font: 'Mono', size: 'S', color: FAINT } })
  }
  const ids = new Map<string, string>()
  for (const b of d.shapes) {
    ids.set(b.id, add({ id: nid('s'), type: 'shape', position: at(b), width: b.w, height: b.h, data: shape({ kind: KIND[b.shape], fontSize: 17 }) }))
    await wait(80)
  }
  for (const e of d.edges) {
    s.addEdge({ id: nid('a'), type: 'arrow', source: ids.get(e.from)!, target: ids.get(e.to)!, data: { label: e.label } })
    await wait(40)
  }
  await wait(250)
  for (const b of d.shapes) {
    s.updateData(ids.get(b.id)!, { text: b.label, sub: b.sub })
    await wait(40)
  }
  s.onNodesChange(placed.map((id) => ({ type: 'select', id, selected: false })))
}

// "Claude is drawing · 12s ×" while the CLI reads the repo; draws the answer when it arrives.
export function DrawingBanner() {
  const p = useStore(project)
  const job = useStore((s) => s.diagramJobs.find((j) => j.cwd === p?.path))
  const now = useNow()
  const drawn = useRef<string | null>(null)
  const name = agentById(job?.agent ?? 'claude')?.name ?? job?.agent
  useEffect(() => {
    if (!job || !p) return
    if (job.status === 'done' && job.diagram && drawn.current !== job.id) {
      drawn.current = job.id
      drawDiagram(job.diagram).finally(() => api.clearDiagram(p.path))
    } else if (job.status === 'failed') {
      useStore.getState().notify(`${name} could not draw the diagram: ${job.error}`)
      api.clearDiagram(p.path)
    }
  }, [job?.status])
  if (!p || job?.status !== 'running') return null
  return (
    <div className="drawing-banner">
      <AgentGlyph id={job.agent} size={13} />
      <span>
        {name} is drawing · {Math.max(0, Math.floor((now - job.startedAt) / 1000))}s
      </span>
      <button title="Stop drawing" onClick={() => api.clearDiagram(p.path)}>
        <X size={12} />
      </button>
    </div>
  )
}
