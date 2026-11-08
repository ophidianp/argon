import { useState } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, Position, useInternalNode, type Edge, type EdgeProps, type InternalNode } from '@xyflow/react'
import { ArrowRight, Check, Filter, Info, Repeat, SearchCheck, Trash2, Zap } from 'lucide-react'
import { LINK_MODE, useStore, type HandoffData, type LinkKind } from '../store'

// The wire leaves and enters on the sides facing each other, wherever the consoles are now
// (groups re-flow them), instead of always right -> left looping around the board.
export function facingSides(a: InternalNode, b: InternalNode) {
  const box = (n: InternalNode) => {
    const { x, y } = n.internals.positionAbsolute
    const w = n.measured.width ?? 0
    const h = n.measured.height ?? 0
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 }
  }
  const s = box(a)
  const t = box(b)
  const dx = t.cx - s.cx
  const dy = t.cy - s.cy
  if (Math.abs(dx) / (s.w + t.w) >= Math.abs(dy) / (s.h + t.h)) {
    return dx >= 0
      ? { sourceX: s.x + s.w, sourceY: s.cy, sourcePosition: Position.Right, targetX: t.x, targetY: t.cy, targetPosition: Position.Left }
      : { sourceX: s.x, sourceY: s.cy, sourcePosition: Position.Left, targetX: t.x + t.w, targetY: t.cy, targetPosition: Position.Right }
  }
  return dy >= 0
    ? { sourceX: s.cx, sourceY: s.y + s.h, sourcePosition: Position.Bottom, targetX: t.cx, targetY: t.y, targetPosition: Position.Top }
    : { sourceX: s.cx, sourceY: s.y, sourcePosition: Position.Top, targetX: t.cx, targetY: t.y + t.h, targetPosition: Position.Bottom }
}

// A lead's helper: a quiet dashed line back to the lead. No pill, there is nothing to set on it.
export function HelperEdge({ id, source, target, ...geo }: EdgeProps) {
  const a = useInternalNode(source)
  const b = useInternalNode(target)
  const [path] = getBezierPath(a && b ? facingSides(a, b) : geo)
  return <BaseEdge id={id} path={path} className="helper-edge" />
}

// A hand-off wire: work flows from the source console to the target. The pill in the middle says
// when that happens and opens the few things you can do with a wire.
export function HandoffEdge({ id, source, target, data, markerEnd, ...geo }: EdgeProps<Edge<HandoffData>>) {
  const a = useInternalNode(source)
  const b = useInternalNode(target)
  const [path, x, y] = getBezierPath(a && b ? facingSides(a, b) : geo)
  const busy = useStore((s) => !!s.handing[`${source}>${target}`])
  const [menu, setMenu] = useState<null | "up" | "down">(null) // opens toward the free half of the screen
  const auto = data?.auto ?? true
  const kind = data?.kind ?? 'handoff'
  const s = useStore.getState()
  const label =
    kind === 'review'
      ? `Review${data?.rounds ? ` ${data.rounds}/${data.maxRounds ?? 3}` : ''}`
      : kind === 'forward'
        ? 'Every reply'
        : kind === 'condition'
          ? `If “${data?.pattern || '…'}”`
          : kind === 'context'
            ? 'Context'
            : auto
              ? 'When done'
              : 'On demand'

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className={`handoff-edge kind-${kind} ${busy ? 'busy' : ''} ${auto || kind === 'context' ? '' : 'manual'}`} />
      <EdgeLabelRenderer>
        <div className="handoff-label nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}>
          <button className={`handoff-pill kind-${kind} ${busy ? 'busy' : ''}`} onClick={(e) => {
              const up = e.currentTarget.getBoundingClientRect().top > innerHeight / 2
              setMenu((v) => (v ? null : up ? "up" : "down"))
            }} title="What this link does">
            {busy ? (
              <>
                <span className="sa-dot" /> {kind === 'review' ? 'Reviewing…' : 'Handing off…'}
              </>
            ) : (
              <>
                {KINDS.find((k) => k.kind === kind)?.icon} {label}
              </>
            )}
          </button>
          {menu && (
            <div className={`menu handoff-menu link-menu ${menu}`} onMouseLeave={() => setMenu(null)}>
              <div className="menu-title">What this link does</div>
              {KINDS.map((k) => (
                <button key={k.kind} className={`menu-item kind ${kind === k.kind ? 'on' : ''}`} onClick={() => s.setEdgeData(id, { kind: k.kind, rounds: 0, reviewing: false })}>
                  <span className="ico">{k.icon}</span>
                  <span>
                    <b>{k.title}</b>
                    <small>{k.sub}</small>
                  </span>
                </button>
              ))}
              {kind === 'condition' && (
                <label className="link-field">
                  Pass it on when the reply contains
                  <input defaultValue={data?.pattern ?? ''} placeholder="e.g. tests pass" onChange={(e) => s.setEdgeData(id, { pattern: e.target.value })} />
                </label>
              )}
              {kind === 'review' && (
                <label className="link-field row">
                  Rounds before it stops
                  <input type="number" min={1} max={6} defaultValue={data?.maxRounds ?? 3} onChange={(e) => s.setEdgeData(id, { maxRounds: Math.max(1, Math.min(6, Number(e.target.value) || 3)) })} />
                </label>
              )}
              <div className="menu-sep" />
              <button
                className="menu-item"
                onClick={() => {
                  setMenu(null)
                  if (kind === 'review') s.setEdgeData(id, { reviewing: true })
                  s.handoff(source, target, LINK_MODE[kind])
                }}
              >
                <Zap size={15} /> Send now
              </button>
              {kind !== 'context' && (
                <button className="menu-item" onClick={() => s.setEdgeData(id, { auto: !auto })}>
                  <span style={{ width: 15, display: 'inline-flex' }}>{auto && <Check size={15} />}</span> Automatically when it finishes
                </button>
              )}
              <button className="menu-item danger" onClick={() => s.removeEdge(id)}>
                <Trash2 size={15} /> Remove link
              </button>
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

const KINDS: { kind: LinkKind; title: string; sub: string; icon: React.ReactNode }[] = [
  { kind: 'handoff', title: 'Pass the work on', sub: 'A summary of what it did, then the next one picks up', icon: <ArrowRight size={13} /> },
  { kind: 'review', title: 'Reviewer', sub: 'The next one reviews; fixes go back until it says APPROVED', icon: <SearchCheck size={13} /> },
  { kind: 'forward', title: 'Forward every reply', sub: 'Each reply goes across word for word, as it comes', icon: <Repeat size={13} /> },
  { kind: 'condition', title: 'Only if…', sub: 'Pass the work on only when the reply contains some text', icon: <Filter size={13} /> },
  { kind: 'context', title: 'Share context', sub: 'Send a summary for context, no task attached (by hand)', icon: <Info size={13} /> },
]

// A memory card's wire to a console it feeds; nothing flows until Push.
export function MemoryEdge({ id, source, target, ...geo }: EdgeProps) {
  const a = useInternalNode(source)
  const b = useInternalNode(target)
  const [path] = getBezierPath(a && b ? facingSides(a, b) : geo)
  return <BaseEdge id={id} path={path} className="memory-edge" />
}

// An orchestrator's command wire: a warm curve with a pulse running toward the agents it drives.
export function CommandEdge({ id, source, target, ...geo }: EdgeProps) {
  const a = useInternalNode(source)
  const b = useInternalNode(target)
  const [path] = getBezierPath(a && b ? facingSides(a, b) : geo)
  return (
    <>
      <BaseEdge id={id} path={path} className="command-edge" />
      <circle r={3.5} className="command-pulse">
        <animateMotion dur="2.8s" repeatCount="indefinite" path={path} />
      </circle>
    </>
  )
}
