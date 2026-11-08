import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  useViewport,
  type Node,
  type OnNodeDrag,
} from '@xyflow/react'
import {
  Eraser,
  FileText,
  FileType,
  Folder,
  Globe,
  Image,
  Layers,
  ListChecks,
  Shapes,
  Maximize2,
  Minus,
  Monitor,
  MousePointer2,
  PenTool,
  Plus,
  Repeat,
  RotateCcwClock,
  Orbit,
  Type,
  X,
  Check,
  CalendarDays,
  Columns3,
  Pipette,
  ChevronRight,
  LayoutGrid,
} from 'lucide-react'
import { api } from '../api'
import { addImage, addOrchestrator, insertCard, nid } from '../board'
import { absolute, consoles, useStore, workspace, type ConsoleData, type Tool } from '../store'
import { AGENTS } from '../../shared/agents.js'
import { ConsoleNode } from './ConsoleNode'
import { CommandEdge, HandoffEdge, HelperEdge, MemoryEdge } from './HandoffEdge'
import { OrchestratorNode } from './Orchestrator'
import { ContextMenu, type MenuAt } from './ContextMenu'
import { GroupNode, ImageNode, InkNode, NoteNode, TextNode } from './Nodes'
import { newWebData, WebTile } from './WebTile'
import { BoardNode, CalendarNode, ChecklistNode, NEW_BOARD } from './Planner'
import { ArrowEdge, newSticky, ShapeLayer, ShapeNode, ShapesMenu } from './Shapes'
import { DrawingBanner } from '../diagram'
import { Inspector } from './Inspector'
import { AgentIcon, ClaudeMark } from './icons'
import { TopBar } from './TopBar'
import { BottomBar } from './BottomBar'
import { GitPill } from './GitPanel'
import { MissionMap } from './MissionMap'
import { LoopsModal } from './LoopsModal'
import { MemoryCard, MemoryModal } from './MemoryModal'
import { SettingsModal } from './Panels'
import { themed } from '../theme'
import { consoleUnder } from '../layout'
import { UsagePanel } from './UsagePanel'

// A card from a studio shows a plain panel for the moment its code takes to arrive.
function lazyCard(load: () => Promise<{ default: React.ComponentType<any> }>) {
  const Card = lazy(load)
  return (props: any) => (
    <Suspense fallback={<div className="card-chunk-loading" />}>
      <Card {...props} />
    </Suspense>
  )
}
const CodeStudio = lazy(() => import('./CodeStudio').then((m) => ({ default: m.CodeStudio })))
const DocumentsStudio = lazy(() => import('./DocumentsStudio').then((m) => ({ default: m.DocumentsStudio })))
const MarkdownStudio = lazy(() => import('./MarkdownStudio').then((m) => ({ default: m.MarkdownStudio })))
const CodeNode = lazyCard(() => import('./CodeStudio').then((m) => ({ default: m.CodeNode })))
const DocumentNode = lazyCard(() => import('./DocumentsStudio').then((m) => ({ default: m.DocumentNode })))
const MarkdownNode = lazyCard(() => import('./MarkdownStudio').then((m) => ({ default: m.MarkdownNode })))

const nodeTypes = {
  console: ConsoleNode,
  group: GroupNode,
  note: NoteNode,
  text: TextNode,
  web: WebTile,
  kanban: BoardNode,
  calendar: CalendarNode,
  checklist: ChecklistNode,
  shape: ShapeNode,
  image: ImageNode,
  ink: InkNode,
  memory: MemoryCard,
  orchestrator: OrchestratorNode,
  code: CodeNode,
  document: DocumentNode,
  markdown: MarkdownNode,
}

const edgeTypes = { handoff: HandoffEdge, helper: HelperEdge, memory: MemoryEdge, command: CommandEdge, arrow: ArrowEdge }


// Moved nodes go last, followed by their own children (an image's ink): parents before children.
const reorder = (nodes: Node[], moves: Map<string, Node>) => {
  const kids = nodes.filter((n) => n.parentId && moves.has(n.parentId) && !moves.has(n.id))
  return [...nodes.filter((n) => !moves.has(n.id) && !kids.includes(n)), ...moves.values(), ...kids]
}

export function BoardScreen() {
  const modal = useStore((s) => s.modal)
  return (
    <ReactFlowProvider>
      <div style={{ position: 'absolute', inset: 0 }}>
        <Board />
        <InkLayer />
        <ShapeLayer />
        <Inspector />
        <TopBar />
        <LeftToolbar />
        <RightToolbar />
        <BottomBar />
        <div className="corner left">
          <GitPill />
        </div>
        <div className="corner right">
          <Zoom />
        </div>
        <ResumeAllToast />
        <NoAgentToast />
        <DrawingBanner />
        <ConnectBanner />
        <ReportVisible />
        {modal === 'mission' && <MissionMap />}
        {modal === 'loops' && <LoopsModal />}
        {modal === 'memory' && <MemoryModal />}
        {modal === 'settings' && <SettingsModal />}
        {modal === 'usage' && <UsagePanel />}
        <Suspense fallback={null}>
          {modal === 'code' && <CodeStudio />}
          {modal === 'documents' && <DocumentsStudio />}
          {modal === 'markdown' && <MarkdownStudio />}
        </Suspense>
      </div>
    </ReactFlowProvider>
  )
}

function Board() {
  const ws = useStore(workspace)!
  const tool = useStore((s) => s.tool)
  // Keys must reach the board once the person has moved on from typing in a terminal.
  const leaveTyping = () => (document.activeElement as HTMLElement | null)?.blur?.()
  const flow = useReactFlow()
  const { onNodesChange, onEdgesChange, setViewport, set } = useStore.getState()
  const [wiring, setWiring] = useState(false) // a wire is being dragged: every console becomes a drop target
  const [menu, setMenu] = useState<MenuAt | null>(null)

  useEffect(() => set({ flow }), [flow])

  // Backspace closes whatever is selected, consoles included; ⌘Z or the Undo button brings it back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const s = useStore.getState()
      if (e.key === 'Escape' && !t.closest('.xterm')) s.set({ tool: 'select', modal: null, connecting: null })
      if (t.closest('input, textarea, [contenteditable], .xterm')) return
      if (e.key === 'Backspace' || e.key === 'Delete') s.deleteSelected()
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault()
        s.undoDelete()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        e.preventDefault()
        flow.fitView({ padding: 0.12, duration: 400 })
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [flow])

  const place = (e: React.MouseEvent) => {
    const s = useStore.getState()
    if (s.connecting) s.set({ connecting: null }) // clicking away ends Connect
    const pos = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    if (s.tool === 'spawn') s.addConsole(s.spawnAgent, pos)
    else if (s.tool === 'note')
      s.addNode(newSticky(pos))
    else if (s.tool === 'text') s.addNode({ id: nid('t'), type: 'text', position: { x: pos.x, y: pos.y - 18 }, data: { text: '' } })
    else if (s.tool === 'web')
      s.addNode({ id: nid('w'), type: 'web', position: { x: pos.x - 360, y: pos.y - 240 }, style: { width: 720, height: 480 }, data: newWebData() })
    else return
    set({ tool: 'select' })
  }

  // Dropping a node inside a group adopts it; dragging it out releases it. With a multi-selection
  // every dragged node is judged on its own position, not only the one under the pointer.
  // Every group touched re-flows afterwards: it grows to take a newcomer, shrinks when one
  // leaves, and a drag inside a group reorders it.
  // A terminal dropped on another terminal makes a group of the two (or joins the one it is in).
  const dropOn = (e: Parameters<OnNodeDrag>[0], dragged: Node[]) => {
    const at = 'clientX' in e ? e : e.changedTouches[0]
    if (!at || !dragged.every((n) => n.type === 'console')) return undefined
    const nodes = workspace(useStore.getState())!.nodes
    const over = consoleUnder(nodes, new Set(dragged.map((n) => n.id)), flow.screenToFlowPosition({ x: at.clientX, y: at.clientY }), (n) => absolute(nodes, n))
    return over && dragged.every((n) => n.parentId === over.parentId) && over.parentId ? undefined : over // a sibling: that only reorders the group
  }
  const marked = useRef<string | null>(null)
  // On the DOM directly: this runs on every pointer move, and a re-render of the board would not be free.
  const mark = (over: Node | null) => {
    const id = over?.id ?? null
    if (id === marked.current) return
    const node = (x: string | null) => (x ? document.querySelector(`.react-flow__node[data-id="${x}"]`) : null)
    node(marked.current)?.classList.remove('drop-target', 'in-group')
    node(id)?.classList.add('drop-target')
    if (over?.parentId) node(id)?.classList.add('in-group')
    marked.current = id
  }
  const onDrag: OnNodeDrag = (e, _node, dragged) => mark(dropOn(e, dragged) ?? null)

  const onDragStop: OnNodeDrag = (e, _node, dragged) => {
    mark(null)
    const nodes = workspace(useStore.getState())!.nodes
    const over = dropOn(e, dragged)
    if (over && !over.parentId) {
      useStore.getState().groupNodes([over.id, ...dragged.map((n) => n.id)])
      return
    }
    const moves = new Map<string, Node>()
    const touched = new Set<string>()
    for (const node of dragged) {
      if (node.type === 'group' || node.type === 'ink') continue // ink stays where it was drawn, never joins a group
      const abs = absolute(nodes, node)
      const cx = abs.x + (node.measured?.width ?? 0) / 2
      const cy = abs.y + (node.measured?.height ?? 0) / 2
      const host =
        nodes.find((g) => g.id === over?.parentId) ??
        nodes.find(
          (g) => g.type === 'group' && g.id !== node.id && cx > g.position.x && cx < g.position.x + (g.measured?.width ?? 0) && cy > g.position.y && cy < g.position.y + (g.measured?.height ?? 0),
        )
      if (node.parentId) touched.add(node.parentId)
      if (host) touched.add(host.id)
      if (host?.id === node.parentId) continue
      const moved = { ...nodes.find((n) => n.id === node.id)!, parentId: host?.id, position: host ? { x: abs.x - host.position.x, y: abs.y - host.position.y } : abs }
      if (!host) delete moved.parentId
      moves.set(node.id, moved)
    }
    const refit = () => touched.forEach((g) => useStore.getState().fitGroup(g))
    if (!moves.size) return refit()
    // Moved to the end of the array: React Flow needs parents before children.
    useStore.setState((st) => ({
      projects: st.projects.map((p) =>
        p.path !== st.active
          ? p
          : {
              ...p,
              workspaces: p.workspaces.map((wsp) =>
                wsp.id !== p.activeWs ? wsp : { ...wsp, nodes: reorder(wsp.nodes, moves) },
              ),
            },
      ),
    }))
    refit()
  }

  return (
    <div
      className={wiring ? 'wiring' : undefined}
      style={{ position: 'absolute', inset: 0 }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const at = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
        ;[...e.dataTransfer.files].forEach((f) => addImage(f, at))
      }}
    >
      <ReactFlow
        key={ws.id}
        nodes={ws.nodes}
        edges={ws.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnectStart={() => setWiring(true)}
        onConnectEnd={() => setWiring(false)}
        onConnect={(c) => {
          const s = useStore.getState()
          if (!s.connectConsoles(c.source, c.target)) return
          const fromCard = ws.nodes.some((n) => n.id === c.source && n.type === 'memory')
          s.notify(fromCard ? 'Connected: Push on the card types the memory into this console' : 'Linked: work passes along whenever the first one finishes')
        }}
        isValidConnection={(c) => c.source !== c.target}
        defaultViewport={ws.viewport ?? { x: 120, y: 80, zoom: 0.9 }}
        onMoveEnd={(_, vp) => setViewport(vp)}
        onPaneClick={place}
        onNodeDrag={onDrag}
        onNodeDragStop={onDragStop}
        onSelectionStart={leaveTyping}
        onNodeClick={(e, n) => {
          const s = useStore.getState()
          if (!(e.target as HTMLElement).closest('.console-body, input, textarea')) leaveTyping()
          if (s.tool === 'eraser' && n.type !== 'console' && n.type !== 'group') s.removeNode(n.id)
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, flow: flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }) })
        }}
        onNodeContextMenu={(e, node) => {
          // Inside a terminal the right click stays the terminal's (copy, paste).
          if ((e.target as HTMLElement).closest('.xterm, input, textarea')) return
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, flow: flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }), node })
        }}
        minZoom={0.08}
        maxZoom={2.5}
        panOnScroll
        zoomOnPinch
        zoomOnScroll={false}
        selectionOnDrag={tool === 'select'}
        selectionMode={SelectionMode.Partial}
        panOnDrag={[1, 2]}
        deleteKeyCode={null}
        multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        selectionKeyCode={null}
        panActivationKeyCode={null} // space is push-to-talk; pan with two fingers or the middle button
        className={tool !== 'select' ? 'placing' : ''}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={34} size={1.3} color="var(--grid)" />
      </ReactFlow>
      {menu && <ContextMenu at={menu} onClose={() => setMenu(null)} />}
      {!ws.nodes.length && <EmptyBoard />}
    </div>
  )
}

// Connect covers the terminals with targets, so the way out stays in plain sight.
function ConnectBanner() {
  const connecting = useStore((s) => !!s.connecting)
  if (!connecting) return null
  return (
    <div className="connect-banner">
      Click the agents this orchestrator should command
      <button className="btn primary" onClick={() => useStore.getState().set({ connecting: null })}>
        Done
      </button>
    </div>
  )
}

const INSTALL_CLAUDE = 'curl -fsSL https://claude.ai/install.sh | bash'

// No coding agent on this Mac yet: offer to set up Claude Code. The command is typed into a real
// terminal and left there, so that the person is the one who runs it.
function NoAgentToast() {
  const missing = useStore((s) => !s.installed.some((a) => a !== 'shell'))
  if (!missing) return null
  const install = async () => {
    const s = useStore.getState()
    const id = s.addConsole('shell', s.viewCenter())
    for (let i = 0; i < 40 && !useStore.getState().live[id]; i++) await new Promise((r) => setTimeout(r, 150))
    await new Promise((r) => setTimeout(r, 800)) // the shell's first prompt
    await api.input(id, INSTALL_CLAUDE)
    s.notify('The install command is ready in the terminal. Press Return to run it.')
  }
  const check = async () => {
    const s = useStore.getState()
    try {
      const installed = await api.agents(true)
      s.set({ installed })
      if (!installed.some((a) => a !== 'shell')) s.notify('Still no coding agent found. Finish the install, then check again.')
    } catch (e) {
      s.notify(`Could not check: ${(e as Error).message}`)
    }
  }
  return (
    <div className="board-toast">
      <span>
        <div className="t">No coding agent found</div>
        <div className="s">vibeboard runs the agents installed on your Mac. Claude Code takes a minute to set up.</div>
      </span>
      <button className="btn primary" onClick={install}>
        Install Claude Code
      </button>
      <button className="btn" onClick={check}>
        Check again
      </button>
    </div>
  )
}

function EmptyBoard() {
  const s = useStore.getState()
  const missing = useStore((st) => !st.installed.some((a) => a !== 'shell'))
  if (missing) return null
  return (
    <div className="empty-board">
      <div>
        <h2>Start with an agent</h2>
        <p>Give it a job and watch it work. Right-click anywhere on the board for more.</p>
        <div className="row">
          <button className="btn primary" onClick={() => s.addConsole(s.settings.defaultAgent, s.viewCenter())}>
            New agent
          </button>
          <button className="btn" onClick={() => s.set({ modal: 'presets' })}>
            Ready-made team
          </button>
        </div>
      </div>
    </div>
  )
}

const TOOLS: { tool: Tool; icon: React.ReactNode; tip: string }[] = [
  { tool: 'select', icon: <MousePointer2 size={19} fill="currentColor" />, tip: 'Select and move things' },
  { tool: 'spawn', icon: <ClaudeMark size={20} />, tip: 'New agent: pick one, then click the board' },
  { tool: 'shape', icon: <Shapes size={19} />, tip: 'Shapes and sticky notes' },
]
const TOOLS_2: { tool: Tool; icon: React.ReactNode; tip: string }[] = [
  { tool: 'text', icon: <Type size={19} />, tip: 'Text: click the board to write' },
  { tool: 'ink', icon: <PenTool size={18} />, tip: 'Draw freehand' },
  { tool: 'eraser', icon: <Eraser size={18} />, tip: 'Eraser: click what to remove' },
  { tool: 'web', icon: <Globe size={19} />, tip: 'Web page: click the board to place it' },
]

function LeftToolbar() {
  const tool = useStore((s) => s.tool)
  const set = useStore((s) => s.set)
  const flow = useReactFlow()
  const fileRef = useRef<HTMLInputElement>(null)
  const [menu, setMenu] = useState<'spawn' | 'shape' | null>(null)
  const isOn = (t: Tool) => tool === t || (t === 'shape' && tool === 'note') // a sticky is picked from the Shapes menu

  const pick = (t: Tool) => {
    set({ tool: isOn(t) && t !== 'select' ? 'select' : t })
    setMenu((t === 'spawn' || t === 'shape') && !isOn(t) ? t : null)
  }

  return (
    <>
      <div className="toolbar">
        {TOOLS.map((t) => (
          <span key={t.tool} style={{ position: 'relative', display: 'grid' }}>
            <button className={`tool-btn ${isOn(t.tool) ? 'active' : ''}`} title={menu === t.tool ? undefined : t.tip} onClick={() => pick(t.tool)}>
              {t.tool === 'spawn' && tool === 'spawn' ? <ClaudeMark size={20} color="#fff" /> : t.icon}
            </button>
            {t.tool === 'shape' && menu === 'shape' && <ShapesMenu onClose={() => setMenu(null)} />}
          </span>
        ))}
        <button
          className="tool-btn"
          title="Shell console: a plain terminal"
          onClick={() => {
            const s = useStore.getState()
            s.addConsole('shell', s.viewCenter())
          }}
        >
          <Monitor size={19} />
        </button>
        {TOOLS_2.map((t) => (
          <span key={t.tool} style={{ position: 'relative', display: 'grid' }}>
            <button className={`tool-btn ${tool === t.tool ? 'active' : ''}`} title={tool === t.tool && t.tool === 'ink' ? undefined : t.tip} onClick={() => pick(t.tool)}>
              {t.icon}
            </button>
            {t.tool === 'ink' && tool === 'ink' && <InkPanel />}
          </span>
        ))}
        <button className="tool-btn" title="Image: pick a picture from your Mac" onClick={() => fileRef.current?.click()}>
          <Image size={19} />
        </button>
        <div className="sep" />
        <button className="tool-btn" title="Fit the board (⌘0)" onClick={() => flow.fitView({ padding: 0.12, duration: 400 })}>
          <Maximize2 size={18} />
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          ;[...(e.target.files ?? [])].forEach((f) => addImage(f, useStore.getState().viewCenter()))
          e.target.value = ''
        }}
      />
      {menu === 'spawn' && tool === 'spawn' && <SpawnMenu onClose={() => setMenu(null)} />}
    </>
  )
}

const INK_COLORS = ['#ece8e2', '#f0553a', '#5fae6a', '#c9a64e', '#ef4444', '#6fd6ee', '#a98bfa', '#5d6a86']
const INK_WIDTHS = [2, 3, 5, 8, 12]

function InkPanel() {
  const color = useStore((s) => s.inkColor)
  const width = useStore((s) => s.inkWidth)
  const set = useStore((s) => s.set)
  const custom = !INK_COLORS.includes(color)
  return (
    <div className="ink-panel">
      <div className="section-label">Color</div>
      <div className="row">
        {INK_COLORS.map((c) => (
          <button key={c} className={`swatch ${color === c ? 'on' : ''}`} style={{ background: themed(c) }} title={c} onClick={() => set({ inkColor: c })} />
        ))}
        <label className={`swatch custom ${custom ? 'on' : ''}`} style={custom ? { background: color } : undefined} title="Custom color">
          <Pipette size={11} />
          <input type="color" value={color} onChange={(e) => set({ inkColor: e.target.value })} />
        </label>
      </div>
      <div className="section-label">Width</div>
      <div className="row">
        {INK_WIDTHS.map((w) => (
          <button key={w} className={`width ${width === w ? 'on' : ''}`} title={`${w}px`} onClick={() => set({ inkWidth: w })}>
            <i style={{ width: Math.max(4, w * 1.2), height: Math.max(4, w * 1.2) }} />
          </button>
        ))}
      </div>
    </div>
  )
}

const FEATURED = ['claude', 'aider', 'cursor', 'qwen', 'codex', 'shell']

function SpawnMenu({ onClose }: { onClose: () => void }) {
  const spawnAgent = useStore((s) => s.spawnAgent)
  const installed = useStore((s) => s.installed)
  const set = useStore((s) => s.set)
  const [all, setAll] = useState(false)
  const list = all ? AGENTS : AGENTS.filter((a) => FEATURED.includes(a.id))
  return (
    <div className="menu spawn-menu nowheel" style={{ top: 'calc(50% - 250px)' }}>
      <div className="menu-title">New agent</div>
      {list.map((a) => (
        <button
          key={a.id}
          className="menu-item"
          onClick={() => {
            set({ spawnAgent: a.id })
            onClose()
          }}
        >
          <AgentIcon id={a.id} />
          <span style={{ flex: 1 }}>
            <div className="title">{a.name}</div>
            <div className="sub">{installed.includes(a.id) ? a.sub : 'not installed'}</div>
          </span>
          {spawnAgent === a.id && <Check size={17} color="var(--accent)" />}
        </button>
      ))}
      {!all && (
        <button className="menu-item" onClick={() => setAll(true)}>
          <LayoutGrid size={17} color="var(--muted)" style={{ margin: '0 8px' }} />
          <span style={{ flex: 1, fontWeight: 500 }}>All agents</span>
          <span style={{ color: 'var(--faint)', fontSize: 13 }}>{AGENTS.length}</span>
          <ChevronRight size={15} color="var(--faint)" />
        </button>
      )}
      <div className="menu-hint">then click the canvas to drop it</div>
    </div>
  )
}

// Tells the server which consoles are on screen, for loops that pause behind other tabs.
function ReportVisible() {
  const ids = useStore((s) => consoles(workspace(s)?.nodes ?? []).map((n) => n.id).join(','))
  useEffect(() => {
    const send = () => api.visible(ids ? ids.split(',') : []).catch(() => {})
    send()
    const t = setInterval(send, 20_000)
    return () => {
      clearInterval(t)
      api.visible([]).catch(() => {})
    }
  }, [ids])
  return null
}

function RightToolbar() {
  const s = useStore.getState()
  const running = useStore((st) => st.loops.filter((l) => l.active && (!l.scope || l.scope === st.active)).length)
  const [todo, setTodo] = useState(false)
  const items = [
    { icon: <Layers size={18} />, tip: 'Mission map: all your agents at a glance', run: () => s.set({ modal: 'mission' }) },
    { icon: <ListChecks size={18} />, tip: 'To-do: checklist, board or calendar', run: () => setTodo((v) => !v) },
    { icon: <Orbit size={18} />, tip: 'Orchestrator: give orders to several agents', run: () => addOrchestrator() },
    { icon: <Folder size={18} />, tip: 'Code: browse and edit the files of this project', run: () => s.set({ modal: 'code' }) },
    { icon: <FileText size={18} />, tip: 'Documents: have your agent write docs about this project', run: () => s.set({ modal: 'documents' }) },
    { icon: <FileType size={18} />, tip: 'Markdown: read and edit the notes of this project', run: () => s.set({ modal: 'markdown' }) },
    { icon: <Repeat size={18} />, tip: 'Loops: repeat an instruction automatically', run: () => s.set({ modal: 'loops' }) },
  ]
  return (
    <div className="toolbar right">
      {items.map((i) => (
        <span key={i.tip} style={{ position: 'relative', display: 'grid' }}>
          <button className={`tool-btn ${i.tip.startsWith('To-do') && todo ? 'on' : ''}`} title={i.tip.startsWith('To-do') && todo ? undefined : i.tip} onClick={i.run}>
            {i.icon}
            {i.tip.startsWith('Loops') && running > 0 && <span className="tool-badge">{running}</span>}
          </button>
          {i.tip.startsWith('To-do') && todo && <TodoMenu onClose={() => setTodo(false)} />}
        </span>
      ))}
    </div>
  )
}

// Drops a fresh checklist, board or calendar in the middle of the view.
function TodoMenu({ onClose }: { onClose: () => void }) {
  const insert = (type: string, width: number, height: number, data: Record<string, unknown>) => {
    insertCard(type, width, height, data)
    onClose()
  }
  return (
    <div className="todo-menu" onMouseLeave={onClose}>
      <div className="section-label">Insert to-do</div>
      <button onClick={() => insert('checklist', 300, 340, { items: [] })}>
        <ListChecks size={15} /> Checklist
      </button>
      <button onClick={() => insert('kanban', 1060, 440, structuredClone(NEW_BOARD))}>
        <Columns3 size={15} /> Board (kanban)
      </button>
      <button onClick={() => insert('calendar', 600, 500, { events: [] })}>
        <CalendarDays size={15} /> Calendar
      </button>
    </div>
  )
}

function Zoom() {
  const { zoom } = useViewport()
  const flow = useReactFlow()
  return (
    <div className="pill zoom">
      <button className="icon-btn sm" title="Zoom out" onClick={() => flow.zoomOut({ duration: 200 })}>
        <Minus size={14} />
      </button>
      <span title="Double-click for 100%" onDoubleClick={() => flow.zoomTo(1, { duration: 250 })}>{Math.round(zoom * 100)}%</span>
      <button className="icon-btn sm" title="Zoom in" onClick={() => flow.zoomIn({ duration: 200 })}>
        <Plus size={14} />
      </button>
    </div>
  )
}

function InkLayer() {
  const tool = useStore((s) => s.tool)
  const color = useStore((s) => s.inkColor)
  const width = useStore((s) => s.inkWidth)
  const flow = useReactFlow()
  // The stroke lives in a ref: pointer events can arrive faster than React re-renders.
  const stroke = useRef<{ x: number; y: number }[] | null>(null)
  const [pts, setPts] = useState<{ x: number; y: number }[] | null>(null)
  if (tool !== 'ink') return null
  const toD = (p: { x: number; y: number }[]) => p.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(' ')
  return (
    <svg
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 15, cursor: 'crosshair' }}
      onPointerDown={(e) => {
        ;(e.target as Element).setPointerCapture(e.pointerId)
        stroke.current = [{ x: e.clientX, y: e.clientY }]
        setPts(stroke.current)
      }}
      onPointerMove={(e) => {
        if (!stroke.current) return
        stroke.current = [...stroke.current, { x: e.clientX, y: e.clientY }]
        setPts(stroke.current)
      }}
      onPointerUp={() => {
        const pts = stroke.current
        stroke.current = null
        if (pts && pts.length > 1) {
          const f = pts.map((p) => flow.screenToFlowPosition(p))
          const pad = width / 2 + 2
          const x0 = Math.min(...f.map((p) => p.x)) - pad
          const y0 = Math.min(...f.map((p) => p.y)) - pad
          const x1 = Math.max(...f.map((p) => p.x)) + pad
          const y1 = Math.max(...f.map((p) => p.y)) + pad
          // A stroke that starts on an image annotates it: it rides along when the image moves.
          const nodes = workspace(useStore.getState())!.nodes
          const image = [...nodes].reverse().find((n) => {
            if (n.type !== 'image') return false
            const a = absolute(nodes, n)
            return f[0].x >= a.x && f[0].y >= a.y && f[0].x <= a.x + (n.measured?.width ?? 0) && f[0].y <= a.y + (n.measured?.height ?? 0)
          })
          const at = image ? absolute(nodes, image) : { x: 0, y: 0 }
          useStore.getState().addNode({
            id: nid('ink'),
            type: 'ink',
            position: { x: x0 - at.x, y: y0 - at.y },
            ...(image ? { parentId: image.id } : {}),
            zIndex: 10, // above images and cards
            width: x1 - x0,
            height: y1 - y0,
            data: { paths: [toD(f.map((p) => ({ x: p.x - x0, y: p.y - y0 })))], color, width },
          })
        }
        setPts(null)
      }}
    >
      {pts && <path d={toD(pts)} fill="none" stroke={themed(color)} strokeWidth={width * flow.getZoom()} strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  )
}

function ResumeAllToast() {
  const offers = useStore((s) => consoles(workspace(s)?.nodes ?? []).filter((n) => n.data.resumeOffer && n.data.lastSessionId).length)
  const [hidden, setHidden] = useState(false)
  if (!offers || hidden) return null
  const resumeAll = async () => {
    const s = useStore.getState()
    const list = consoles(workspace(s)!.nodes).filter((n) => n.data.resumeOffer && n.data.lastSessionId) as Node<ConsoleData>[]
    for (const n of list) {
      const { exists } = await api.claudeSession(n.data.lastSessionId!)
      if (exists) s.resumeConsole(n.id)
      else s.updateData(n.id, { resumeOffer: false })
    }
    setHidden(true)
  }
  return (
    <div className="board-toast">
      <RotateCcwClock size={18} color="var(--accent)" />
      <span>
        <div className="t">Resume all conversations?</div>
        <div className="s">
          {offers} console{offers > 1 ? 's' : ''} can pick up their last chat
        </div>
      </span>
      <button className="btn primary" onClick={resumeAll}>
        Yes
      </button>
      <button className="icon-btn sm" onClick={() => setHidden(true)}>
        <X size={14} />
      </button>
    </div>
  )
}
