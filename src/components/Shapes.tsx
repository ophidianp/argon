import { memo, useRef, useState } from 'react'
import { BaseEdge, EdgeLabelRenderer, Handle, NodeResizer, Position, useInternalNode, useReactFlow, type Edge, type EdgeProps, type InternalNode, type Node, type NodeProps } from '@xyflow/react'
import { ArrowRight, Circle, Diamond, Minus, Square, StickyNote } from 'lucide-react'
import { useStore, type ShapeData, type ShapeKind } from '../store'
import { PAPER } from './Nodes'
import { THEME_INK, themed } from '../theme'

export const SHAPE_DEFAULTS: Omit<ShapeData, 'kind'> = { stroke: THEME_INK, fill: 'none', strokeWidth: 2, dash: 'solid', round: true, opacity: 1, text: '' }
const isLine = (k: ShapeKind) => k === 'line' || k === 'arrow'
const nid = (p: string) => `${p}-${crypto.randomUUID().slice(0, 8)}`

function ShapeNodeImpl({ id, data, selected, width = 160, height = 100 }: NodeProps<Node<ShapeData>>) {
  const [editing, setEditing] = useState(false)
  const sw = data.strokeWidth
  const dash = data.dash === 'dashed' ? `${sw * 4} ${sw * 3}` : data.dash === 'dotted' ? `0 ${sw * 2.6}` : undefined
  const paint = {
    stroke: themed(data.stroke),
    strokeWidth: sw,
    strokeDasharray: dash,
    strokeLinecap: 'round' as const,
    strokeLinejoin: (data.round ? 'round' : 'miter') as 'round' | 'miter',
    fill: data.fill,
  }
  const w = width
  const h = height
  const i = sw / 2
  let shape: React.ReactNode
  if (data.kind === 'rect') shape = <rect x={i} y={i} width={Math.max(0, w - sw)} height={Math.max(0, h - sw)} rx={data.round ? Math.min(16, w / 5, h / 5) : 0} {...paint} />
  else if (data.kind === 'ellipse') shape = <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - i)} ry={Math.max(0, h / 2 - i)} {...paint} />
  else if (data.kind === 'diamond') shape = <polygon points={`${w / 2},${i} ${w - i},${h / 2} ${w / 2},${h - i} ${i},${h / 2}`} {...paint} />
  else {
    const [a, b, c, d] = data.points ?? [0, 0.5, 1, 0.5]
    const [x1, y1, x2, y2] = [a * w, b * h, c * w, d * h]
    const ang = Math.atan2(y2 - y1, x2 - x1)
    const len = 10 + sw * 2
    const head = (s: number) => `${x2 - len * Math.cos(ang + s)},${y2 - len * Math.sin(ang + s)}`
    shape = (
      <>
        <line x1={x1} y1={y1} x2={x2} y2={y2} {...paint} fill="none" />
        {data.kind === 'arrow' && <polyline points={`${head(-0.45)} ${x2},${y2} ${head(0.45)}`} {...paint} strokeDasharray={undefined} fill="none" />}
      </>
    )
  }
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={isLine(data.kind) ? 8 : 30} minHeight={isLine(data.kind) ? 8 : 30} />
      <div className="shape-node" style={{ opacity: data.opacity, fontSize: data.fontSize }} onDoubleClick={() => !isLine(data.kind) && setEditing(true)}>
        <svg width={w} height={h}>{shape}</svg>
        {/* arrows between shapes (diagrams) attach here; ArrowEdge draws them outline to outline */}
        <Handle type="target" position={Position.Top} className="cmd-handle" isConnectable={false} />
        <Handle type="source" position={Position.Bottom} className="cmd-handle" isConnectable={false} />
        {!isLine(data.kind) &&
          (editing ? (
            <textarea
              className="nodrag nowheel label"
              autoFocus
              defaultValue={data.text}
              style={{ color: themed(data.stroke) }}
              onBlur={(e) => {
                useStore.getState().updateData(id, { text: e.target.value })
                setEditing(false)
              }}
              onKeyDown={(e) => e.key === 'Escape' && (e.target as HTMLTextAreaElement).blur()}
            />
          ) : (
            (data.text || data.sub) && (
              <div className="label" style={{ color: themed(data.stroke) }}>
                <span>
                  {data.text}
                  {data.sub && <small>{data.sub}</small>}
                </span>
              </div>
            )
          ))}
      </div>
    </>
  )
}
export const ShapeNode = memo(ShapeNodeImpl)

type Outline = { cx: number; cy: number; hw: number; hh: number; kind: ShapeKind }
const outline = (n: InternalNode): Outline => {
  const { x, y } = n.internals.positionAbsolute
  const hw = (n.measured.width ?? 0) / 2
  const hh = (n.measured.height ?? 0) / 2
  return { cx: x + hw, cy: y + hh, hw, hh, kind: (n.data as ShapeData).kind }
}
// Where the line from the shape's centre towards (tx, ty) crosses its outline, `gap` further out.
function exit(o: Outline, tx: number, ty: number, gap: number) {
  const dx = tx - o.cx
  const dy = ty - o.cy
  const len = Math.hypot(dx, dy) || 1
  const ax = Math.abs(dx) / (o.hw || 1)
  const ay = Math.abs(dy) / (o.hh || 1)
  const t = o.kind === 'ellipse' ? 1 / Math.hypot(ax, ay) : o.kind === 'diamond' ? 1 / (ax + ay) : 1 / Math.max(ax, ay)
  return { x: o.cx + dx * (Number.isFinite(t) ? t : 0) + (dx / len) * gap, y: o.cy + dy * (Number.isFinite(t) ? t : 0) + (dy / len) * gap }
}

// An arrow between two shapes that follows them when they move, from outline to outline.
function ArrowEdgeImpl({ id, source, target, data }: EdgeProps<Edge<{ label?: string }>>) {
  const a = useInternalNode(source)
  const b = useInternalNode(target)
  if (!a || !b) return null
  const from = outline(a)
  const to = outline(b)
  const p1 = exit(from, to.cx, to.cy, 4)
  const p2 = exit(to, from.cx, from.cy, 5)
  const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x)
  const head = (side: number) => `${p2.x - 11 * Math.cos(ang + side)},${p2.y - 11 * Math.sin(ang + side)}`
  return (
    <>
      <BaseEdge id={id} path={`M${p1.x},${p1.y} L${p2.x},${p2.y}`} className="arrow-edge" />
      <path d={`M${head(-0.45)} L${p2.x},${p2.y} L${head(0.45)}`} className="arrow-edge arrow-head" />
      {data?.label && (
        <EdgeLabelRenderer>
          <div className="arrow-label" style={{ transform: `translate(-50%, -50%) translate(${(p1.x + p2.x) / 2}px, ${(p1.y + p2.y) / 2}px)` }}>
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
export const ArrowEdge = memo(ArrowEdgeImpl)

// While the Shapes tool is on: drag to draw the picked shape, or click to drop one at its default size.
export function ShapeLayer() {
  const tool = useStore((s) => s.tool)
  const kind = useStore((s) => s.shapeKind)
  const flow = useReactFlow()
  const start = useRef<{ x: number; y: number } | null>(null)
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  if (tool !== 'shape') return null
  const finish = (x: number, y: number) => {
    const s = start.current
    start.current = null
    setBox(null)
    if (!s) return
    const a = flow.screenToFlowPosition(s)
    const b = flow.screenToFlowPosition({ x, y })
    const store = useStore.getState()
    const dragged = Math.hypot(b.x - a.x, b.y - a.y) > 8
    if (isLine(kind)) {
      // A click lays a default horizontal line; a drag goes from where it started to where it ended.
      const [p, q] = dragged ? [a, b] : [{ x: a.x - 80, y: a.y }, { x: a.x + 80, y: a.y }]
      const pad = 12
      const x0 = Math.min(p.x, q.x) - pad
      const y0 = Math.min(p.y, q.y) - pad
      const w = Math.abs(q.x - p.x) + pad * 2
      const h = Math.abs(q.y - p.y) + pad * 2
      store.addNode({
        id: nid('s'),
        type: 'shape',
        position: { x: x0, y: y0 },
        width: w,
        height: h,
        data: { ...SHAPE_DEFAULTS, kind, points: [(p.x - x0) / w, (p.y - y0) / h, (q.x - x0) / w, (q.y - y0) / h] },
      })
    } else {
      const w = dragged ? Math.max(30, Math.abs(b.x - a.x)) : 160
      const h = dragged ? Math.max(30, Math.abs(b.y - a.y)) : 100
      const at = dragged ? { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) } : { x: a.x - w / 2, y: a.y - h / 2 }
      store.addNode({ id: nid('s'), type: 'shape', position: at, width: w, height: h, data: { ...SHAPE_DEFAULTS, kind } })
    }
    store.set({ tool: 'select' })
  }
  return (
    <svg
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 15, cursor: 'crosshair' }}
      onPointerDown={(e) => {
        ;(e.target as Element).setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, y: e.clientY }
      }}
      onPointerMove={(e) => start.current && setBox({ x0: start.current.x, y0: start.current.y, x1: e.clientX, y1: e.clientY })}
      onPointerUp={(e) => finish(e.clientX, e.clientY)}
    >
      {box &&
        (isLine(kind) ? (
          <line x1={box.x0} y1={box.y0} x2={box.x1} y2={box.y1} stroke="var(--accent)" strokeWidth={2} strokeDasharray="6 5" />
        ) : (
          <rect
            x={Math.min(box.x0, box.x1)}
            y={Math.min(box.y0, box.y1)}
            width={Math.abs(box.x1 - box.x0)}
            height={Math.abs(box.y1 - box.y0)}
            rx={kind === 'ellipse' ? 999 : 8}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            strokeDasharray="6 5"
          />
        ))}
    </svg>
  )
}

const KINDS: { kind: ShapeKind | 'sticky'; label: string; icon: React.ReactNode }[] = [
  { kind: 'rect', label: 'Rectangle', icon: <Square size={17} /> },
  { kind: 'ellipse', label: 'Ellipse', icon: <Circle size={17} /> },
  { kind: 'diamond', label: 'Diamond', icon: <Diamond size={17} /> },
  { kind: 'line', label: 'Line', icon: <Minus size={17} style={{ transform: 'rotate(-45deg)' }} /> },
  { kind: 'arrow', label: 'Arrow', icon: <ArrowRight size={17} style={{ transform: 'rotate(-45deg)' }} /> },
  { kind: 'sticky', label: 'Sticky', icon: <StickyNote size={17} /> },
]

export function ShapesMenu({ onClose }: { onClose: () => void }) {
  const set = useStore((s) => s.set)
  const tool = useStore((s) => s.tool)
  const kind = useStore((s) => s.shapeKind)
  return (
    <div className="shapes-menu" onMouseLeave={onClose}>
      <div className="section-label">Shapes</div>
      <div className="grid">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            className={(k.kind === 'sticky' ? tool === 'note' : tool === 'shape' && kind === k.kind) ? 'on' : ''}
            onClick={() => {
              if (k.kind === 'sticky') set({ tool: 'note' })
              else set({ tool: 'shape', shapeKind: k.kind })
              onClose()
            }}
          >
            {k.icon}
            {k.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export const newSticky = (at: { x: number; y: number }) => ({
  id: nid('n'),
  type: 'note',
  position: { x: at.x - 90, y: at.y - 75 },
  style: { width: 180, height: 150 },
  data: { text: '', color: PAPER[0] },
})
