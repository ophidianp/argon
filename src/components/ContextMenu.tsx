import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Node } from '@xyflow/react'
import {
  ArrowRight,
  BringToFront,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardPaste,
  Columns3,
  Copy,
  Crosshair,
  Diamond,
  Globe,
  Image,
  LayoutGrid,
  Link2,
  ListChecks,
  Maximize2,
  Workflow,
  Minus,
  Monitor,
  MoreHorizontal,
  Orbit,
  Pause,
  Pencil,
  Play,
  Plug,
  Plus,
  RotateCw,
  SendToBack,
  Shapes,
  Sparkles,
  Square,
  StickyNote,
  Trash2,
  Type,
  Users,
  X,
} from 'lucide-react'
import { api } from '../api'
import { addImage, addOrchestrator, insertCard, nid } from '../board'
import { startDiagram } from '../diagram'
import { consoles, GROUP_COLORS, useStore, workspace, type ConsoleData, type GroupData, type LinkKind, type ShapeKind } from '../store'
import { agentById } from '../../shared/agents.js'
import { AgentIcon } from './icons'
import { Composer } from './BottomBar'
import { NEW_BOARD } from './Planner'
import { newSticky, SHAPE_DEFAULTS } from './Shapes'
import { newWebData } from './WebTile'

type Point = { x: number; y: number }
// Where the menu opened: on screen (for the menu) and on the board (for what it places).
export type MenuAt = { x: number; y: number; flow: Point; node?: Node }

export function ContextMenu({ at, onClose }: { at: MenuAt; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [onClose])
  return (
    <div className="ctx-layer" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onContextMenu={(e) => (e.preventDefault(), onClose())}>
      {at.node ? <NodeMenu at={at} node={at.node} onClose={onClose} /> : <RadialMenu at={at} onClose={onClose} />}
    </div>
  )
}

// A panel opened from the menu stays on screen whatever corner the click was in.
function usePanelPos(at: MenuAt, width: number, height: number) {
  return {
    left: Math.max(8, Math.min(at.x - 24, innerWidth - width - 8)),
    top: Math.max(8, Math.min(at.y - 40, innerHeight - height - 8)),
  }
}

// ---------- the board: a ring of the usual things around the pointer ----------
type View = 'ring' | 'agents' | 'shapes' | 'group' | 'more'
const PETALS: { key: string; label: string; hint: string; angle: number; icon: React.ReactNode }[] = [
  { key: 'agents', label: 'New agent', hint: 'Start a coding agent here', angle: -90, icon: <Sparkles size={18} /> },
  { key: 'image', label: 'Image', hint: 'Pick a picture from your Mac', angle: -30, icon: <Image size={18} /> },
  { key: 'web', label: 'Web page', hint: 'Open a website on the board', angle: 30, icon: <Globe size={18} /> },
  { key: 'paste', label: 'Paste', hint: 'Put what you copied here', angle: 90, icon: <ClipboardPaste size={18} /> },
  { key: 'shapes', label: 'Shapes', hint: 'Boxes, arrows and sticky notes', angle: 150, icon: <Shapes size={18} /> },
  { key: 'group', label: 'Group of agents', hint: 'Start several agents together', angle: 210, icon: <Users size={18} /> },
]
const MORE = { label: 'More', hint: 'Notes, to-dos, orchestrator, diagrams', angle: -90 }
type Petal = { label: string; hint: string; angle: number }
const RADIUS = 84
const LABEL_REACH = RADIUS + 40 // from the middle of the ring to the label

// Says what the petal under the pointer does: outside the ring, on that petal's side, inside the window.
function PetalLabel({ at, petal }: { at: Point; petal: Petal }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current!
    const { width, height } = el.getBoundingClientRect()
    const a = (petal.angle * Math.PI) / 180
    const px = at.x + Math.cos(a) * LABEL_REACH
    const py = at.y + Math.sin(a) * LABEL_REACH
    const side = Math.cos(a)
    const x = side > 0.2 ? px : side < -0.2 ? px - width : px - width / 2
    const y = Math.abs(side) > 0.2 ? py - height / 2 : py > at.y ? py : py - height
    el.style.left = `${Math.max(8, Math.min(x, innerWidth - width - 8))}px`
    el.style.top = `${Math.max(8, Math.min(y, innerHeight - height - 8))}px`
  }, [at.x, at.y, petal])
  return (
    <div ref={ref} className="petal-label" role="status">
      <b>{petal.label}</b>
      <span>{petal.hint}</span>
    </div>
  )
}

function RadialMenu({ at, onClose }: { at: MenuAt; onClose: () => void }) {
  const [view, setView] = useState<View>('ring')
  const [hover, setHover] = useState<Petal | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const s = useStore.getState()
  const done = (fn: () => void) => () => (fn(), onClose())

  const paste = async () => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'))
        if (type) return addImage(new File([await item.getType(type)], 'pasted', { type }), at.flow)
      }
      const text = await navigator.clipboard.readText()
      if (text.trim()) s.addNode({ id: nid('t'), type: 'text', position: at.flow, data: { text } })
      else s.notify('The clipboard is empty')
    } catch {
      s.notify('The browser did not let vibeboard read the clipboard')
    }
  }
  const pick = (key: string) => {
    if (key === 'image') return fileRef.current?.click()
    if (key === 'web') return done(() => s.addNode({ id: nid('w'), type: 'web', position: { x: at.flow.x - 360, y: at.flow.y - 240 }, style: { width: 720, height: 480 }, data: newWebData() }))()
    if (key === 'paste') return done(() => void paste())()
    setView(key as View)
  }

  // The whole ring fits on screen wherever the click was.
  const ring = { x: Math.max(RADIUS + 34, Math.min(at.x, innerWidth - RADIUS - 34)), y: Math.max(RADIUS + 34, Math.min(at.y, innerHeight - RADIUS - 34)) }

  if (view === 'group') return <GroupPanel at={at} onClose={onClose} onBack={() => setView('ring')} />
  if (view !== 'ring')
    return (
      <Panel at={at} title={view === 'agents' ? 'New agent' : view === 'shapes' ? 'Shapes' : 'Add to the board'} onBack={() => setView('ring')}>
        {view === 'agents' && <AgentList onPick={(a) => done(() => s.addConsole(a, at.flow))()} />}
        {view === 'shapes' && <ShapeList at={at.flow} onDone={onClose} />}
        {view === 'more' && <MoreList at={at.flow} onDone={onClose} />}
      </Panel>
    )
  return (
    <div className="radial" style={{ left: ring.x, top: ring.y }}>
      {PETALS.map((p, i) => (
        <button
          key={p.key}
          className="petal"
          aria-label={`${p.label}. ${p.hint}`}
          onPointerEnter={() => setHover(p)}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(p)}
          onBlur={() => setHover(null)}
          style={{
            left: Math.cos((p.angle * Math.PI) / 180) * RADIUS,
            top: Math.sin((p.angle * Math.PI) / 180) * RADIUS,
            animationDelay: `${i * 18}ms`,
          }}
          onClick={() => pick(p.key)}
        >
          {p.icon}
        </button>
      ))}
      <button
        className="petal center"
        aria-label={`${MORE.label}. ${MORE.hint}`}
        onPointerEnter={() => setHover(MORE)}
        onPointerLeave={() => setHover(null)}
        onFocus={() => setHover(MORE)}
        onBlur={() => setHover(null)}
        onClick={() => setView('more')}
      >
        <MoreHorizontal size={16} />
        <small>More</small>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          ;[...(e.target.files ?? [])].forEach((f) => addImage(f, at.flow))
          onClose()
        }}
      />
      {hover && <PetalLabel at={ring} petal={hover} />}
    </div>
  )
}

function Panel({ at, title, onBack, children, width = 280 }: { at: MenuAt; title: string; onBack?: () => void; children: React.ReactNode; width?: number }) {
  const pos = usePanelPos(at, width, 440)
  return (
    <div className="ctx-panel nowheel" style={{ ...pos, width }}>
      <div className="ctx-head">
        {onBack && (
          <button className="icon-btn sm" onClick={onBack} title="Back">
            <ChevronLeft size={15} />
          </button>
        )}
        <b>{title}</b>
      </div>
      {children}
    </div>
  )
}

function GroupPanel({ at, onClose, onBack }: { at: MenuAt; onClose: () => void; onBack: () => void }) {
  const pos = usePanelPos(at, 500, 520)
  return (
    <div className="ctx-composer" style={pos}>
      <Composer at={at.flow} onClose={onClose} onBack={onBack} />
    </div>
  )
}

function AgentList({ onPick }: { onPick: (agent: string) => void }) {
  const installed = useStore((s) => s.installed)
  return (
    <div className="ctx-list">
      {installed.map((a) => (
        <button key={a} onClick={() => onPick(a)}>
          <AgentIcon id={a} size={24} /> {agentById(a)?.name ?? a}
          <small>{agentById(a)?.sub}</small>
        </button>
      ))}
    </div>
  )
}

const SHAPES: { kind: ShapeKind | 'sticky'; label: string; icon: React.ReactNode }[] = [
  { kind: 'rect', label: 'Rectangle', icon: <Square size={15} /> },
  { kind: 'ellipse', label: 'Ellipse', icon: <Circle size={15} /> },
  { kind: 'diamond', label: 'Diamond', icon: <Diamond size={15} /> },
  { kind: 'line', label: 'Line', icon: <Minus size={15} /> },
  { kind: 'arrow', label: 'Arrow', icon: <ArrowRight size={15} /> },
  { kind: 'sticky', label: 'Sticky', icon: <StickyNote size={15} /> },
]

function ShapeList({ at, onDone }: { at: Point; onDone: () => void }) {
  const place = (kind: ShapeKind | 'sticky') => {
    const s = useStore.getState()
    if (kind === 'sticky') s.addNode(newSticky(at))
    else if (kind === 'line' || kind === 'arrow')
      s.addNode({ id: nid('s'), type: 'shape', position: { x: at.x - 90, y: at.y - 12 }, width: 180, height: 24, data: { ...SHAPE_DEFAULTS, kind, points: [0.04, 0.5, 0.96, 0.5] } })
    else s.addNode({ id: nid('s'), type: 'shape', position: { x: at.x - 80, y: at.y - 50 }, width: 160, height: 100, data: { ...SHAPE_DEFAULTS, kind } })
    onDone()
  }
  return (
    <div className="ctx-grid">
      {SHAPES.map((k) => (
        <button key={k.kind} onClick={() => place(k.kind)}>
          {k.icon}
          {k.label}
        </button>
      ))}
    </div>
  )
}

function MoreList({ at, onDone }: { at: Point; onDone: () => void }) {
  const s = useStore.getState()
  const items: [string, React.ReactNode, () => void, string][] = [
    ['Orchestrator', <Orbit size={15} />, () => addOrchestrator(at), 'Give orders to several agents from one place'],
    ['Shell console', <Monitor size={15} />, () => s.addConsole('shell', at), 'A plain terminal, with no agent in it'],
    ['Text', <Type size={15} />, () => s.addNode({ id: nid('t'), type: 'text', position: at, data: { text: '' } }), 'Write a label on the board'],
    ['Sticky note', <StickyNote size={15} />, () => s.addNode(newSticky(at)), 'A note you can move around'],
    ['Checklist', <ListChecks size={15} />, () => insertCard('checklist', 300, 340, { items: [] }, at), 'A list of things to tick off'],
    ['Board (kanban)', <Columns3 size={15} />, () => insertCard('kanban', 1060, 440, structuredClone(NEW_BOARD), at), 'Tasks in columns, from to-do to done'],
    ['Calendar', <CalendarDays size={15} />, () => insertCard('calendar', 600, 500, { events: [] }, at), 'A month of dates and events'],
    ['Memory card', <StickyNote size={15} />, () => s.addNode({ id: nid('m'), type: 'memory', position: { x: at.x - 160, y: at.y - 120 }, style: { width: 320 }, data: {} }), 'Notes about this project to give to your agents'],
    ['Draw a diagram of this repo', <Workflow size={15} />, () => startDiagram(), 'Your agent reads the code and draws how it fits together'],
    ['Fit the board', <Maximize2 size={15} />, () => s.flow?.fitView({ padding: 0.12, duration: 400 }), 'Zoom so that everything is in view'],
  ]
  return (
    <div className="ctx-list">
      {items.map(([label, icon, run, hint]) => (
        <button key={label} title={hint} onClick={() => (run(), onDone())}>
          {icon} {label}
        </button>
      ))}
    </div>
  )
}

const LINKS: [LinkKind, string, string][] = [
  ['handoff', 'Pass the work on', 'When it finishes, the other one picks up'],
  ['review', 'Reviewer', 'The other one reviews until it says APPROVED'],
  ['forward', 'Forward every reply', 'Each reply goes across word for word'],
  ['condition', 'Only if…', 'Pass it on only when the reply contains a text (set it on the wire)'],
  ['context', 'Share context', 'A summary for context, sent by hand from the wire'],
]

// ---------- a node: what you can do to that one thing ----------
function NodeMenu({ at, node, onClose }: { at: MenuAt; node: Node; onClose: () => void }) {
  const [sub, setSub] = useState<'groups' | 'orchs' | 'agents' | 'rename' | 'close' | 'colour' | 'link' | null>(null)
  const [linkTo, setLinkTo] = useState<string | null>(null)
  const s = useStore.getState()
  const ws = workspace(s)!
  const live = useStore((st) => st.live[node.id])
  const groups = ws.nodes.filter((n) => n.type === 'group') as Node<GroupData>[]
  const orchs = ws.nodes.filter((n) => n.type === 'orchestrator')
  const wiredTo = (oid: string) => ws.edges.some((e) => e.type === 'command' && e.source === oid && e.target === node.id)
  const run = (fn: () => void) => () => (fn(), onClose())
  const label = node.type === 'console' ? (node.data as ConsoleData).name : node.type === 'group' ? (node.data as GroupData).label : node.type === 'orchestrator' ? 'Orchestrator' : node.type ?? ''

  if (sub === 'rename')
    return (
      <Panel at={at} title={`Rename ${label}`} onBack={() => setSub(null)}>
        <form
          className="ctx-rename"
          onSubmit={(e) => {
            e.preventDefault()
            const v = String(new FormData(e.currentTarget).get('name') ?? '').trim()
            if (v) s.updateData(node.id, node.type === 'group' ? { label: v } : { name: v })
            onClose()
          }}
        >
          <input name="name" autoFocus defaultValue={label} onFocus={(e) => e.target.select()} />
          <button className="btn primary sm">Save</button>
        </form>
      </Panel>
    )
  if (sub === 'link' && linkTo)
    return (
      <Panel at={at} title="How should they work together?" onBack={() => setLinkTo(null)} width={300}>
        <div className="ctx-list">
          {LINKS.map(([kind, title, sub2]) => (
            <button
              key={kind}
              className="tall"
              onClick={run(() => {
                if (!s.connectConsoles(node.id, linkTo)) return
                const edge = workspace(useStore.getState())!.edges.find((e) => e.type === 'handoff' && e.source === node.id && e.target === linkTo)
                if (edge) s.setEdgeData(edge.id, { kind })
                s.notify(`Linked: ${title.toLowerCase()}`)
              })}
            >
              <span>
                <b>{title}</b>
                <small>{sub2}</small>
              </span>
            </button>
          ))}
        </div>
      </Panel>
    )
  if (sub === 'link')
    return (
      <Panel at={at} title={`Link ${label} to…`} onBack={() => setSub(null)}>
        <div className="ctx-list">
          {consoles(ws.nodes)
            .filter((n) => n.id !== node.id && n.data.agent !== 'shell')
            .map((n) => (
              <button key={n.id} onClick={() => setLinkTo(n.id)}>
                <AgentIcon id={n.data.agent} size={22} /> {n.data.name}
              </button>
            ))}
          {!consoles(ws.nodes).some((n) => n.id !== node.id && n.data.agent !== 'shell') && <p className="ctx-hint">Link to another agent console: there is none yet.</p>}
        </div>
      </Panel>
    )
  if (sub === 'groups')
    return (
      <Panel at={at} title="Add to group" onBack={() => setSub(null)}>
        <div className="ctx-list">
          {groups.map((g) => (
            <button key={g.id} disabled={node.parentId === g.id} onClick={run(() => s.moveToGroup(node.id, g.id))}>
              <LayoutGrid size={15} color={g.data.color} /> {g.data.label}
              <small>{consoles(ws.nodes).filter((n) => n.parentId === g.id).length}</small>
            </button>
          ))}
          {node.parentId && (
            <button onClick={run(() => s.moveToGroup(node.id, null))}>
              <X size={15} /> Take it out of its group
            </button>
          )}
          {!groups.length && <p className="ctx-hint">There are no groups on this board yet.</p>}
        </div>
      </Panel>
    )
  if (sub === 'orchs')
    return (
      <Panel at={at} title="Connect to an orchestrator" onBack={() => setSub(null)}>
        <div className="ctx-list">
          {orchs.map((o, i) => (
            <button key={o.id} onClick={run(() => s.toggleWire(o.id, node.id))}>
              <span className="orb sm" /> {orchs.length > 1 ? `Orchestrator ${i + 1}` : 'Orchestrator'}
              <small>{wiredTo(o.id) ? 'connected · disconnect' : 'connect'}</small>
            </button>
          ))}
          <button onClick={run(() => addOrchestrator({ x: at.flow.x - 460, y: at.flow.y }))}>
            <Plus size={15} /> New orchestrator
          </button>
        </div>
      </Panel>
    )
  if (sub === 'agents')
    return (
      <Panel at={at} title={`Add an agent to ${label}`} onBack={() => setSub(null)}>
        <AgentList onPick={(a) => run(() => (s.addConsole(a, { x: 0, y: 0 }, undefined, node.id, false), s.fitGroup(node.id)))()} />
      </Panel>
    )
  if (sub === 'colour')
    return (
      <Panel at={at} title="Colour" onBack={() => setSub(null)} width={240}>
        <div className="ctx-swatches">
          {GROUP_COLORS.map((c) => (
            <button key={c} style={{ background: c }} onClick={run(() => s.updateData(node.id, { color: c }))} />
          ))}
        </div>
      </Panel>
    )
  if (sub === 'close')
    return (
      <Panel at={at} title={`Close ${label}?`} onBack={() => setSub(null)}>
        <p className="ctx-hint">Its session stops and the console leaves the board.</p>
        <div className="ctx-row">
          <button className="btn ghost-plain sm" onClick={() => setSub(null)}>
            Cancel
          </button>
          <button className="btn primary sm" onClick={run(() => s.removeNode(node.id))}>
            Close it
          </button>
        </div>
      </Panel>
    )

  const items: ([string, React.ReactNode, () => void, boolean?, string?] | null)[] =
    node.type === 'console'
      ? [
          ['Rename', <Pencil size={15} />, () => setSub('rename'), true],
          ['Duplicate', <Copy size={15} />, run(() => s.duplicateConsole(node.id))],
          ['Restart', <RotateCw size={15} />, run(() => s.restartConsole(node.id)), false, 'Stop it and start it again'],
          live ? [live.paused ? 'Resume' : 'Pause', live.paused ? <Play size={15} /> : <Pause size={15} />, run(() => api.signal(node.id, live.paused ? 'SIGCONT' : 'SIGSTOP'))] : null,
          ['Focus', <Crosshair size={15} />, run(() => s.jumpTo(node.id)), false, 'Zoom the board onto it'],
          ['Link to…', <Link2 size={15} />, () => setSub('link'), true, 'Let its work pass to another agent'],
          ['Add to group', <LayoutGrid size={15} />, () => setSub('groups'), true, 'Keep it together with other agents'],
          ['Connect to an orchestrator', <Orbit size={15} />, () => setSub('orchs'), true, 'Let an orchestrator give it orders'],
          ['Close…', <Trash2 size={15} />, () => setSub('close'), true, 'Stop it and remove it from the board'],
        ]
      : node.type === 'group'
        ? [
            ['Rename', <Pencil size={15} />, () => setSub('rename'), true],
            ['Colour', <span className="ctx-dot" style={{ background: (node.data as GroupData).color }} />, () => setSub('colour'), true],
            ['Add an agent', <Plus size={15} />, () => setSub('agents'), true],
            ['Frame it', <Crosshair size={15} />, run(() => s.frame([node.id])), false, 'Zoom the board onto this group'],
            ['Connect to an orchestrator', <Orbit size={15} />, () => setSub('orchs'), true, 'Let an orchestrator give this group orders'],
            ['Ungroup', <X size={15} />, run(() => s.ungroup(node.id)), false, 'Remove the group and keep its agents'],
          ]
        : node.type === 'orchestrator'
          ? [
              ['Connect consoles', <Plug size={15} />, run(() => s.set({ connecting: node.id })), false, 'Then click the agents it should give orders to'],
              ['Remove', <Trash2 size={15} />, run(() => s.removeNode(node.id))],
            ]
          : [
              ['Duplicate', <Copy size={15} />, run(() => s.duplicateNode(node.id))],
              ['Bring to front', <BringToFront size={15} />, run(() => s.reorderNode(node.id, 'front'))],
              ['Send to back', <SendToBack size={15} />, run(() => s.reorderNode(node.id, 'back'))],
              ['Delete', <Trash2 size={15} />, run(() => s.removeNode(node.id))],
            ]
  const pos = usePanelPos(at, 240, items.length * 36 + 50)
  return (
    <div className="ctx-panel nowheel" style={{ ...pos, width: 240 }}>
      <div className="ctx-head">
        <b>{label}</b>
      </div>
      <div className="ctx-list">
        {items.filter((x) => x !== null).map(([text, icon, fn, more, hint]) => (
          <button key={text} title={hint} onClick={fn}>
            {icon} {text}
            {more && <ChevronRight size={14} className="more" />}
          </button>
        ))}
      </div>
    </div>
  )
}
