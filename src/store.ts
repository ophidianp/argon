import { create } from 'zustand'
import {
  applyEdgeChanges,
  applyNodeChanges,
  MarkerType,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react'
import { api, connectEvents, type LiveSession, type Loop, type LinkMode, type DiagramJob, type DocJob, type Scan, type ServerEvent, type Status } from './api'
import { agentById } from '../shared/agents.js'
import { CONSOLE_SIZE, GROUP_HEAD, GROUP_PAD, freeSpot, gridLayout, sizeOf, wouldCycle } from './layout'
import type { TeamTemplate } from './teams'
import type { ThemeMode } from './theme'

export { CONSOLE_SIZE, freeSpot }

export type ConsoleData = {
  agent: string
  name: string
  dot: string
  cwd: string
  yolo?: boolean
  sessionId?: string
  resumable?: string // last session that received a prompt: the one worth offering back
  lastSessionId?: string
  resumeOffer?: boolean
  resumeNext?: boolean
  role?: string // what this agent is for; travels with every hand-off it receives
  lead?: boolean // a Claude that can bring in helper consoles (server/helpers.mjs)
  profile?: string // account profile id: runs the CLI on that profile's own sign-in
  view?: 'simple' | 'terminal' // what the console shows; a console saved before this existed is a terminal
  epoch: number
}
export type LinkKind = 'handoff' | 'review' | 'forward' | 'condition' | 'context'
// A wire between two consoles (shared/links.js says what each kind sends). `reviewing`: the reviewer is on it.
export type HandoffData = { auto: boolean; kind?: LinkKind; pattern?: string; rounds?: number; maxRounds?: number; reviewing?: boolean }
export type GroupData = { label: string; color: string }
export type NoteData = { text: string; color: string }
export type TextData = { text: string; color?: string; font?: string; size?: 'S' | 'M' | 'L' | 'XL'; align?: 'left' | 'center' | 'right'; opacity?: number }
export type WebTab = { id: string; url: string; back: string[]; fwd: string[] }
// Tiles saved before tabs existed hold just `url`; WebTile.tsx reads both.
export type WebData = { url?: string; tabs?: WebTab[]; active?: string; viewport?: string }
export type GitCardData = { cwd: string }
export type Priority = 'none' | 'low' | 'med' | 'high'
export type KanbanCard = { id: string; title: string; notes?: string; due?: string; priority: Priority; done?: boolean }
// Boards saved before cards had fields hold plain strings; Planner.tsx reads both.
export type KanbanData = { columns: { id?: string; title: string; cards: (KanbanCard | string)[] }[] }
export type CalEvent = { id: string; title: string; date: string; allDay: boolean; start?: string; end?: string; color: string; notes?: string }
export type CalendarData = { events: CalEvent[]; month?: string }
export type ChecklistData = { items: { id: string; text: string; done: boolean }[] }
export type ShapeKind = 'rect' | 'ellipse' | 'diamond' | 'line' | 'arrow'
// points: a line's two ends as fractions of the node box, so resizing scales it.
// `sub` is a smaller second line under the text; `fontSize` overrides the label's size (diagrams use smaller boxes).
export type ShapeData = { kind: ShapeKind; stroke: string; fill: string; strokeWidth: number; dash: 'solid' | 'dashed' | 'dotted'; round: boolean; opacity: number; text: string; sub?: string; fontSize?: number; points?: [number, number, number, number] }
export type InkData = { paths: string[]; color: string; width?: number }

export type Memory = { id: string; title: string; kind: string; text: string; enabled: boolean; scanned?: boolean }
export type Workspace = { id: string; name: string; nodes: Node[]; edges: Edge[]; viewport?: Viewport }
// `folders`: folders outside the project connected to it (a second brain): agents and Studios reach them.
export type Project = { path: string; name: string; workspaces: Workspace[]; activeWs: string; memories: Memory[]; folders?: string[]; openedAt: number }
export type Preset = { id: string; name: string; agents: string[]; label?: string }

export type Tool = 'select' | 'spawn' | 'note' | 'text' | 'web' | 'ink' | 'eraser' | 'image' | 'kanban' | 'shape'
export type Modal = null | 'mission' | 'loops' | 'memory' | 'usage' | 'composer' | 'presets' | 'settings' | 'code' | 'documents' | 'markdown'
// A second sign-in of a CLI (its own config folder on disk), so two accounts can run side by side.
export type Profile = { id: string; name: string; agent: string }
// `active`: the profile each CLI's new consoles start on (none: the CLI's own default sign-in).
export type Settings = { theme?: ThemeMode; simpleView?: boolean; yolo: boolean; fontSize: number; defaultAgent: string; speak?: boolean; notify?: boolean; profiles?: Profile[]; active?: Record<string, string> }
export type UsageView = 'usage' | 'tokens' | 'accounts'

// Stable fallback so selectors never return a fresh [] (that re-renders forever).
export const EMPTY: Node[] = []

// How each console was last launched, keyed `${id}:${epoch}`. Valid only while that process
// lives: dropped on exit and when the server comes back without it.
export const launchCache = new Map<string, Record<string, string>>()
const forgetLaunch = (keep: (id: string) => boolean) => {
  for (const key of [...launchCache.keys()]) if (!keep(key.slice(0, key.lastIndexOf(':')))) launchCache.delete(key)
}

export const NAMES = ['Maya', 'Otto', 'Iris', 'Kai', 'Mila', 'Ren', 'Juno', 'Ada', 'Bex', 'Cy', 'Pip', 'Dax', 'Rafa', 'Lumi', 'Noor', 'Taro', 'Vera', 'Zed', 'Sol', 'Wren']
export const DOTS = ['#5b8cff', '#ff5a4e', '#a477ff', '#3ecf8e', '#f5b83d', '#ff7ac6', '#4fd1d9']
export const GROUP_COLORS = ['#e8643c', '#3ecf8e', '#5b8cff', '#a477ff', '#f5b83d']

const uid = () => crypto.randomUUID().slice(0, 8)

const DEFAULT_PRESETS: Preset[] = [
  { id: 'duo', name: 'Pair', agents: ['claude', 'claude'] },
  { id: 'quad', name: 'Four Claudes', agents: ['claude', 'claude', 'claude', 'claude'] },
  { id: 'mixed', name: 'Claude + Codex + Gemini', agents: ['claude', 'codex', 'gemini'] },
  { id: 'review', name: 'Reviewers', agents: ['claude', 'claude', 'claude'], label: 'Reviewers' },
]

type S = {
  ready: boolean
  loaded: boolean
  liveReady: boolean
  projects: Project[]
  active: string | null
  live: Record<string, LiveSession>
  pendingPrompt: Record<string, string> // sent from the simple view, not in the transcript yet
  linkDown: boolean // the page has lost the server and is trying to get it back
  exits: Record<string, number> // how each console's process last ended
  installed: string[]
  loops: Loop[]
  scans: Scan[]
  docJobs: DocJob[]
  diagramJobs: DiagramJob[]
  tool: Tool
  spawnAgent: string
  shapeKind: ShapeKind
  connecting: string | null // the orchestrator whose Connect mode is on
  modal: Modal
  studioPath: string | null // the note the Markdown studio opens on
  studioRoot: string | null // the connected folder it opens on, when not the project
  toast: string | null
  settings: Settings
  presets: Preset[]
  flow: ReactFlowInstance | null
  inkColor: string
  inkWidth: number
  usageView: UsageView
  usageAgent: string
  handing: Record<string, boolean> // `${from}>${to}` while a hand-off is being summarised

  init: () => void
  set: (patch: Partial<S>) => void
  notify: (msg: string, action?: { label: string; run: () => void }) => void
  toastAction: { label: string; run: () => void } | null
  confirming: { title: string; detail: string; yes: string; answer: (ok: boolean) => void } | null
  openProject: (path: string) => void
  goHome: () => void
  forgetProject: (path: string) => void
  closeProject: () => Promise<void>
  addWorkspace: () => void
  switchWorkspace: (id: string) => void
  closeWorkspace: (id: string) => Promise<void>
  renameWorkspace: (id: string, name: string) => void
  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  setViewport: (vp: Viewport) => void
  addNode: (node: Node) => void
  reveal: (id: string) => void
  duplicateNode: (id: string) => void
  reorderNode: (id: string, to: 'front' | 'back') => void
  updateData: (id: string, patch: Record<string, unknown>) => void
  removeNode: (id: string) => Promise<void>
  deleteSelected: () => Promise<void>
  undoDelete: () => Promise<void>
  addConsole: (agent: string, center: { x: number; y: number }, extra?: Partial<ConsoleData>, parentId?: string, reveal?: boolean) => string
  restartConsole: (id: string, fresh?: boolean) => Promise<void>
  resumeConsole: (id: string) => Promise<void>
  duplicateConsole: (id: string) => void
  spawnMany: (agents: string[], label?: string, extras?: Partial<ConsoleData>[], at?: { x: number; y: number }) => string[]
  spawnTeam: (team: TeamTemplate) => void
  groupSelected: (label?: string) => void
  groupNodes: (ids: string[], label?: string) => string | null
  resizeNode: (id: string, width: number, height: number) => void
  connectFolder: (path: string) => void
  disconnectFolder: (path: string) => void
  fitGroup: (id: string) => void
  ungroup: (id: string) => void
  moveToGroup: (id: string, gid: string | null) => void
  pauseAll: () => void
  resumeAll: () => void
  sendTo: (ids: string[], text: string) => number
  frame: (ids: string[]) => void
  jumpTo: (id: string) => void
  connectConsoles: (source: string, target: string) => boolean
  toggleWire: (orch: string, target: string) => void
  handoff: (from: string, to: string, mode?: LinkMode, pattern?: string) => Promise<{ sent?: boolean; approved?: boolean } | undefined>
  setEdgeData: (id: string, patch: Partial<HandoffData>) => void
  addEdge: (edge: Edge) => void
  removeEdge: (id: string) => void
  viewCenter: () => { x: number; y: number }
  savePreset: (preset: Omit<Preset, 'id'>) => void
  addMemory: (m: Omit<Memory, 'id'>) => void
  updateMemory: (id: string, patch: Partial<Memory>) => void
  removeMemory: (id: string) => void
}

export const project = (s: Pick<S, 'projects' | 'active'>) => s.projects.find((p) => p.path === s.active) ?? null
export const workspace = (s: Pick<S, 'projects' | 'active'>) => {
  const p = project(s)
  return p?.workspaces.find((w) => w.id === p.activeWs) ?? null
}
export const consoles = (nodes: Node[]) => nodes.filter((n) => n.type === 'console') as Node<ConsoleData>[]

const newWorkspace = (name: string): Workspace => ({ id: uid(), name, nodes: [], edges: [] })

// Absolute position, walking up group parents.
export function absolute(nodes: Node[], n: Node) {
  let { x, y } = n.position
  let parent = n.parentId ? nodes.find((p) => p.id === n.parentId) : undefined
  while (parent) {
    x += parent.position.x
    y += parent.position.y
    parent = parent.parentId ? nodes.find((p) => p.id === parent!.parentId) : undefined
  }
  return { x, y }
}

export function findConsole(s: Pick<S, 'projects'>, id: string) {
  for (const project of s.projects)
    for (const ws of project.workspaces) {
      const node = ws.nodes.find((n) => n.id === id && n.type === 'console') as Node<ConsoleData> | undefined
      if (node) return { project, ws, node }
    }
  return null
}

// Tell the user when an agent needs them or has finished. In the window: a toast for "needs you"
// only (finishing is visible on the board). Elsewhere: a system notification that jumps back to it.
function announce(id: string, status: Status) {
  if (status !== 'needs' && status !== 'done') return
  const s = useStore.getState()
  const hit = findConsole(s, id)
  if (!hit) return
  const text = status === 'needs' ? `${hit.node.data.name} needs you` : `${hit.node.data.name} finished`
  if (document.hasFocus()) {
    if (status === 'needs') s.notify(text)
    return
  }
  if (s.settings.notify === false || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const n = new Notification(text, { body: hit.project.name, tag: id })
  n.onclick = () => {
    window.focus()
    useStore.getState().jumpTo(id)
    n.close()
  }
}

// A plain shell would run each line of a hand-off brief as a command (one could say `rm …`),
// so work only ever goes to agent consoles.
function refuseShell(id: string) {
  const d = findConsole(useStore.getState(), id)?.node.data
  if (d?.agent !== 'shell') return false
  useStore.getState().notify(`${d.name} is a plain shell and would run that text as commands. Pick an agent console.`)
  return true
}

// A console just finished: every automatic wire leaving it hands its work on.
// A reviewer's verdict decides the next round: approved ends it, fixes go back to the author, and after
// `maxRounds` the loop stops and hands over to you.
// ponytail: wire state is patched on the open workspace only; a review running on a tab you are not
// looking at keeps its round count until you open it.
function autoHandoff(id: string) {
  const s = useStore.getState()
  const hit = findConsole(s, id)
  if (!hit) return
  const name = (cid: string) => findConsole(useStore.getState(), cid)?.node.data.name ?? 'The agent'
  for (const e of hit.ws.edges) {
    if (e.type !== 'handoff') continue
    const d = (e.data ?? { auto: true }) as HandoffData
    const kind = d.kind ?? 'handoff'
    if (e.source === id && d.auto && kind !== 'context') {
      if (kind === 'review') s.setEdgeData(e.id, { reviewing: true })
      s.handoff(id, e.target, LINK_MODE[kind], kind === 'condition' ? d.pattern : undefined)
    }
    if (e.target === id && kind === 'review' && d.reviewing) {
      s.setEdgeData(e.id, { reviewing: false })
      const rounds = (d.rounds ?? 0) + 1
      void s.handoff(id, e.source, 'feedback').then((r) => {
        if (r?.approved) {
          s.setEdgeData(e.id, { rounds: 0 })
          s.notify(`${name(id)} approved ${name(e.source)}'s work`)
        } else if (r?.sent && rounds >= (d.maxRounds ?? 3)) {
          s.setEdgeData(e.id, { rounds: 0, auto: false })
          s.notify(`Review stopped after ${rounds} rounds: ${name(e.source)} has the last fixes, the rest is yours`)
        } else if (r?.sent) s.setEdgeData(e.id, { rounds })
      })
    }
  }
}

// What a wire sends when its source finishes (or when you press Send now).
export const LINK_MODE: Record<LinkKind, LinkMode> = { handoff: 'brief', review: 'review', forward: 'reply', condition: 'brief', context: 'context' }

// Ask once, from a click (browsers only show the prompt after a user gesture).
export function askNotifyPermission() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission().catch(() => {})
}

// A group always wraps its members: re-lay them in reading order and size the frame to fit.
// ponytail: a growing group can overlap its neighbours; push them aside if that bites.
function fitted(nodes: Node[], gid: string) {
  if (!nodes.some((n) => n.id === gid && n.type === 'group')) return nodes
  const { slots, width, height } = gridLayout(nodes.filter((n) => n.parentId === gid))
  return nodes.map((n) =>
    n.id === gid ? { ...n, width, height, style: { ...n.style, width, height } } : slots.has(n.id) ? { ...n, position: slots.get(n.id)! } : n,
  )
}

// A lead brought in a helper (server/helpers.mjs), which the server already runs: it joins the
// lead's group (last in reading order) or sits beside the lead, with a dashed line back to it.
// Any workspace, not just the open one: the lead may be working while you look elsewhere.
// The browser's own confirm() freezes the page, terminals included, until it is answered.
const askToConfirm = (title: string, detail: string, yes: string) =>
  new Promise<boolean>((resolve) =>
    useStore.setState({
      confirming: {
        title,
        detail,
        yes,
        answer: (ok) => {
          useStore.setState({ confirming: null })
          resolve(ok)
        },
      },
    }),
  )

// ponytail: one level of undo, and it restores the board as it was, so it expires before much else has moved.
const UNDO_TOAST_MS = 7000
const UNDO_WINDOW_MS = 60_000
let lastDeleted: { wsId: string; nodes: Node[]; edges: Edge[]; consoleIds: string[]; at: number } | null = null

// New agents open on the real terminal, where the person has full control; Settings can make it the simple view.
const consoleView = (agent: string): ConsoleData['view'] => (agent !== 'shell' && useStore.getState().settings.simpleView === true ? 'simple' : 'terminal')

function addHelper(e: Extract<ServerEvent, { type: 'helper' }>) {
  const s = useStore.getState()
  const hit = findConsole(s, e.parent)
  if (!hit || findConsole(s, e.id)) return // a second tab, or an event seen twice
  const lead = hit.node
  const pos = absolute(hit.ws.nodes, lead)
  const position = lead.parentId
    ? { x: 0, y: 1e6 } // fitted() puts it in the group's last slot
    : freeSpot(hit.ws.nodes, { x: pos.x + sizeOf(lead).width + 60, y: pos.y, ...CONSOLE_SIZE })
  const node: Node<ConsoleData> = {
    id: e.id,
    type: 'console',
    position,
    style: { ...CONSOLE_SIZE },
    dragHandle: '.console-head',
    ...(lead.parentId ? { parentId: lead.parentId } : {}),
    data: { agent: e.agent, name: e.name, dot: lead.data.dot, cwd: e.cwd, yolo: e.yolo, role: e.role || undefined, view: consoleView(e.agent), epoch: 0 },
  }
  const edge: Edge = { id: `k-${e.id}`, source: lead.id, target: e.id, type: 'helper' }
  glide()
  useStore.setState((st) => ({
    projects: st.projects.map((p) => ({
      ...p,
      workspaces: p.workspaces.map((w) => {
        if (w.id !== hit.ws.id) return w
        const nodes = [...w.nodes, node]
        return { ...w, nodes: lead.parentId ? fitted(nodes, lead.parentId) : nodes, edges: [...w.edges, edge] }
      }),
    })),
  }))
  s.notify(`${lead.data.name} brought in ${e.name}`)
}

// Nodes glide to their new place instead of jumping (see `.relayout` in styles.css).
const glide = () => {
  document.body.classList.add('relayout')
  setTimeout(() => document.body.classList.remove('relayout'), 350)
}

// Resolves true once the process is gone. The server escalates to SIGKILL at 4s, so 5s is enough.
function waitGone(id: string, ms = 5000) {
  return new Promise<boolean>((resolve) => {
    const t0 = Date.now()
    const tick = () => (!useStore.getState().live[id] ? resolve(true) : Date.now() - t0 > ms ? resolve(false) : setTimeout(tick, 50))
    tick()
  })
}

export const useStore = create<S>((set, get) => {
  const updateWs = (fn: (ws: Workspace) => Workspace) =>
    set((s) => ({
      projects: s.projects.map((p) => (p.path !== s.active ? p : { ...p, workspaces: p.workspaces.map((w) => (w.id === p.activeWs ? fn(w) : w)) })),
    }))
  const updateProject = (fn: (p: Project) => Project) => set((s) => ({ projects: s.projects.map((p) => (p.path === s.active ? fn(p) : p)) }))

  const usedNames = () => new Set(project(get())?.workspaces.flatMap((w) => consoles(w.nodes).map((n) => n.data.name)) ?? [])
  const allocateName = () => {
    const used = usedNames()
    for (let round = 1; ; round++)
      for (const n of NAMES) {
        const name = round === 1 ? n : `${n} ${round}`
        if (!used.has(name)) return name
      }
  }

  return {
    ready: false,
    loaded: false,
    liveReady: false,
    projects: [],
    active: null,
    live: {},
    installed: ['claude', 'shell'],
    pendingPrompt: {},
    linkDown: false,
    exits: {},
    loops: [],
    scans: [],
    docJobs: [],
    diagramJobs: [],
    tool: 'select',
    spawnAgent: 'claude',
    shapeKind: 'rect',
    connecting: null,
    modal: null,
    studioPath: null,
    studioRoot: null,
    toast: null,
    settings: { yolo: false, fontSize: 13, defaultAgent: 'claude' },
    presets: DEFAULT_PRESETS,
    flow: null,
    inkColor: '#f0553a',
    inkWidth: 3,
    usageView: 'usage',
    usageAgent: 'claude',
    handing: {},

    init: () => {
      // Retried: under `node --watch` the page can load while the server is restarting.
      const load = () =>
        api
          .getState()
          .then((saved) => {
            const { recovered, ...state } = saved as Partial<S> & { recovered?: string }
            set({ ...state, loaded: true })
            set((s) => ({ ready: s.liveReady }))
            if (recovered === 'backup') get().notify('Your board file was damaged. It is back as it was at the last backup.')
            if (recovered === 'empty') get().notify('Your board file was damaged, so this is a fresh board. The old file is kept in ~/.vibeboard.')
          })
          .catch(() => setTimeout(load, 1000))
      load()
      api.agents().then((installed) => set({ installed })).catch((e) => console.error('agent detection failed', e))
      connectEvents((e) => {
        if (e.type === 'sessions') {
          const live = Object.fromEntries(e.sessions.map((x) => [x.id, x]))
          forgetLaunch((id) => !!live[id])
          set({ live, liveReady: true })
          set((s) => ({ ready: s.loaded }))
        } else if (e.type === 'spawn') set((s) => ({ live: { ...s.live, [e.session.id]: e.session } }))
        else if (e.type === 'status' || e.type === 'paused') {
          const before = get().live[e.id]?.status
          set((s) => {
            const cur = s.live[e.id]
            if (!cur) return {}
            const next = e.type === 'status' ? { ...cur, status: e.status, statusAt: e.at } : { ...cur, paused: e.paused }
            return { live: { ...s.live, [e.id]: next } }
          })
          if (e.type === 'status' && before && before !== e.status) {
            announce(e.id, e.status)
            if (e.status === 'done') autoHandoff(e.id)
          }
        } else if (e.type === 'exit') {
          set((s) => ({ exits: { ...s.exits, [e.id]: e.code } }))
          forgetLaunch((id) => id !== e.id)
          set((s) => {
            const live = { ...s.live }
            delete live[e.id]
            return { live }
          })
        } else if (e.type === 'session-id') {
          // Claude rotates the session id on /clear; keep the newest so resume picks the right chat.
          // This fires on every tool call, so an unchanged node returns the same state (no re-render, no save).
          set((s) => {
            const d = s.projects.flatMap((p) => p.workspaces.flatMap((w) => w.nodes)).find((n) => n.id === e.id)?.data as ConsoleData | undefined
            if (!d || (d.sessionId === e.sessionId && (!e.prompted || (d.resumable === e.sessionId && !d.resumeOffer)))) return s
            // A prompt reached the new conversation (keyboard, command bar, loop...): the old one is no longer on offer.
            const patch = { sessionId: e.sessionId, ...(e.prompted ? { resumable: e.sessionId, resumeOffer: false } : {}) }
            return {
              projects: s.projects.map((p) => ({
                ...p,
                workspaces: p.workspaces.map((w) =>
                  w.nodes.some((n) => n.id === e.id) ? { ...w, nodes: w.nodes.map((n) => (n.id === e.id ? { ...n, data: { ...n.data, ...patch } } : n)) } : w,
                ),
              })),
            }
          })
        } else if (e.type === 'loops') set({ loops: e.loops })
        else if (e.type === 'scans') set({ scans: e.scans })
        else if (e.type === 'docs') set({ docJobs: e.docs })
        else if (e.type === 'diagrams') set({ diagramJobs: e.diagrams })
        else if (e.type === 'handoff')
          set((s) => {
            const handing = { ...s.handing }
            if (e.state === 'summarizing') handing[`${e.from}>${e.to}`] = true
            else delete handing[`${e.from}>${e.to}`]
            return { handing }
          })
        else if (e.type === 'ask' || e.type === 'activity' || e.type === 'conversation')
          set((s) => {
            const cur = s.live[e.id]
            if (!cur) return {}
            const next =
              e.type === 'ask' ? { ...cur, ask: e.ask } : e.type === 'activity' ? { ...cur, activity: e.text } : { ...cur, tick: (cur.tick ?? 0) + 1, started: cur.started || e.started }
            return { live: { ...s.live, [e.id]: next } }
          })
        else if (e.type === 'subagents')
          set((s) => (s.live[e.id] ? { live: { ...s.live, [e.id]: { ...s.live[e.id], subagents: e.subagents } } } : {}))
        else if (e.type === 'helper') addHelper(e)
      }, (up) => set({ linkDown: !up }))
    },

    set: (patch) => set(patch),
    toastAction: null,
    confirming: null,
    notify: (msg, action) => {
      set({ toast: msg, toastAction: action ?? null })
      setTimeout(() => get().toast === msg && set({ toast: null, toastAction: null }), action ? UNDO_TOAST_MS : 2600)
    },

    openProject: (path) =>
      set((s) => {
        const exists = s.projects.some((p) => p.path === path)
        const name = path.split('/').filter(Boolean).pop() || path
        const ws = newWorkspace('Workspace 1')
        const projects = exists
          ? s.projects.map((p) => (p.path === path ? { ...p, openedAt: Date.now() } : p))
          : [...s.projects, { path, name, workspaces: [ws], activeWs: ws.id, memories: [], openedAt: Date.now() }]
        return { projects, active: path, modal: null, tool: 'select' }
      }),

    goHome: () => set({ active: null, modal: null }),

    // Drops a project from Recent (its board too). Refused while any of its consoles runs.
    forgetProject: (path) => {
      const p = get().projects.find((x) => x.path === path)
      if (!p) return
      if (p.workspaces.some((w) => consoles(w.nodes).some((n) => get().live[n.id]))) return get().notify('Close its running consoles first')
      set((s) => ({ projects: s.projects.filter((x) => x.path !== path), active: s.active === path ? null : s.active }))
    },

    closeProject: async () => {
      const p = project(get())
      if (!p) return
      const ids = p.workspaces.flatMap((w) => consoles(w.nodes).map((n) => n.id)).filter((id) => get().live[id])
      if (ids.length && !(await askToConfirm(`Close ${p.name}?`, `${ids.length} running agent${ids.length > 1 ? 's' : ''} will stop. The board is kept.`, 'Close project'))) return
      await Promise.all(ids.map((id) => api.kill(id).catch(() => {})))
      set({ active: null, modal: null })
    },

    addWorkspace: () =>
      updateProject((p) => {
        const ws = newWorkspace(`Workspace ${p.workspaces.length + 1}`)
        return { ...p, workspaces: [...p.workspaces, ws], activeWs: ws.id }
      }),

    switchWorkspace: (id) => updateProject((p) => ({ ...p, activeWs: id })),

    closeWorkspace: async (id) => {
      const p = project(get())
      if (!p || p.workspaces.length === 1) return get().notify('A project keeps at least one workspace')
      const ws = p.workspaces.find((w) => w.id === id)!
      const ids = consoles(ws.nodes).map((n) => n.id).filter((cid) => get().live[cid])
      if (ids.length && !(await askToConfirm(`Close ${ws.name}?`, `${ids.length} running agent${ids.length > 1 ? 's' : ''} will stop.`, 'Close workspace'))) return
      await Promise.all(ids.map((cid) => api.kill(cid).catch(() => {})))
      updateProject((pr) => {
        const workspaces = pr.workspaces.filter((w) => w.id !== id)
        return { ...pr, workspaces, activeWs: pr.activeWs === id ? workspaces[0].id : pr.activeWs }
      })
    },

    renameWorkspace: (id, name) => updateProject((p) => ({ ...p, workspaces: p.workspaces.map((w) => (w.id === id ? { ...w, name } : w)) })),

    onNodesChange: (changes) => updateWs((w) => ({ ...w, nodes: applyNodeChanges(changes, w.nodes) })),
    onEdgesChange: (changes) => updateWs((w) => ({ ...w, edges: applyEdgeChanges(changes, w.edges) })),
    setViewport: (viewport) => updateWs((w) => ({ ...w, viewport })),
    addNode: (node) => updateWs((w) => ({ ...w, nodes: [...w.nodes.map((n) => ({ ...n, selected: false })), { ...node, selected: true }] })),
    // Auto-placement may land off screen: pan (same zoom) so the new node is in view.
    reveal: (id) =>
      setTimeout(() => {
        const flow = get().flow
        const n = flow?.getInternalNode(id)
        if (!flow || !n) return
        const { x, y } = n.internals.positionAbsolute
        const w = n.measured.width ?? CONSOLE_SIZE.width
        const h = n.measured.height ?? CONSOLE_SIZE.height
        const tl = flow.flowToScreenPosition({ x, y })
        const br = flow.flowToScreenPosition({ x: x + w, y: y + h })
        if (tl.x < 0 || tl.y < 0 || br.x > innerWidth || br.y > innerHeight) flow.setCenter(x + w / 2, y + h / 2, { zoom: flow.getZoom(), duration: 350 })
      }, 60),
    duplicateNode: (id) => {
      const n = workspace(get())?.nodes.find((x) => x.id === id)
      if (!n || n.type === 'console' || n.type === 'group') return
      get().addNode({ ...n, id: `${n.type}-${uid()}`, position: { x: n.position.x + 24, y: n.position.y + 24 }, data: structuredClone(n.data) })
    },
    // Stacking follows array order; the node's own children (an image's ink) move with it and a
    // child never goes before its parent.
    reorderNode: (id, to) =>
      updateWs((w) => {
        const n = w.nodes.find((x) => x.id === id)
        if (!n) return w
        const kids = w.nodes.filter((x) => x.parentId === id)
        const rest = w.nodes.filter((x) => x.id !== id && x.parentId !== id)
        const at = to === 'front' ? rest.length : n.parentId ? rest.findIndex((x) => x.id === n.parentId) + 1 : 0
        return { ...w, nodes: [...rest.slice(0, at), n, ...kids, ...rest.slice(at)] }
      }),
    updateData: (id, patch) => updateWs((w) => ({ ...w, nodes: w.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)) })),

    removeNode: async (id) => {
      const ws = workspace(get())
      const node = ws?.nodes.find((n) => n.id === id)
      if (!node) return
      if (node.type === 'console' && get().live[id]) await api.kill(id).catch(() => {})
      updateWs((w) => ({
        ...w,
        // Removing a group frees its members instead of deleting them.
        nodes: w.nodes
          .filter((n) => n.id !== id && !(node.type === 'image' && n.parentId === id)) // an image takes its ink notes along
          .map((n) => (n.parentId === id ? { ...n, parentId: undefined, extent: undefined, position: absolute(w.nodes, n) } : n)),
        edges: w.edges.filter((e) => e.source !== id && e.target !== id),
      }))
      if (node.parentId) get().fitGroup(node.parentId)
    },

    // The Delete key. Quick on purpose, so it has a way back: the board returns as it was, and Claude
    // consoles pick their conversation up again. A shell's running program cannot come back.
    deleteSelected: async () => {
      const ws = workspace(get())
      const chosen = ws?.nodes.filter((n) => n.selected) ?? []
      if (!ws || !chosen.length) return
      const consoleIds = chosen.filter((n) => n.type === 'console').map((n) => n.id)
      lastDeleted = { wsId: ws.id, nodes: ws.nodes, edges: ws.edges, consoleIds, at: Date.now() }
      await Promise.all(chosen.map((n) => get().removeNode(n.id)))
      const agents = consoleIds.length
      const others = chosen.length - agents
      const words = [agents && `${agents} agent${agents > 1 ? 's' : ''} closed`, others && `${others} item${others > 1 ? 's' : ''} deleted`].filter(Boolean).join(', ')
      get().notify(words.charAt(0).toUpperCase() + words.slice(1), { label: 'Undo', run: () => void get().undoDelete() })
    },

    undoDelete: async () => {
      const last = lastDeleted
      if (!last || Date.now() - last.at > UNDO_WINDOW_MS || workspace(get())?.id !== last.wsId) return
      lastDeleted = null
      set({ toast: null, toastAction: null })
      await Promise.all(last.consoleIds.map(waitGone))
      const restored = last.nodes.map((n) => {
        if (!last.consoleIds.includes(n.id)) return n
        const d = n.data as ConsoleData
        const resume = d.resumable ?? d.lastSessionId
        return { ...n, selected: false, data: { ...d, epoch: d.epoch + 1, sessionId: undefined, resumeOffer: false, lastSessionId: resume, resumeNext: !!resume } }
      })
      const nodeIds = new Set(restored.map((n) => n.id))
      const edgeIds = new Set(last.edges.map((e) => e.id))
      updateWs((w) => ({ ...w, nodes: [...restored, ...w.nodes.filter((n) => !nodeIds.has(n.id))], edges: [...last.edges, ...w.edges.filter((e) => !edgeIds.has(e.id))] }))
    },

    addConsole: (agent, center, extra, parentId, reveal = true) => {
      const id = `c-${uid()}`
      const p = project(get())!
      // Connect mode covers every console with a target: a new agent must open ready to be typed in.
      if (get().connecting) set({ connecting: null })
      // The account picked with "Use" in the accounts panel, while it still exists.
      const { active, profiles } = get().settings
      const account = active?.[agent] && profiles?.some((x) => x.id === active[agent]) ? active[agent] : undefined
      const node: Node<ConsoleData> = {
        id,
        type: 'console',
        position: { x: center.x - CONSOLE_SIZE.width / 2, y: center.y - CONSOLE_SIZE.height / 2 },
        style: { ...CONSOLE_SIZE },
        dragHandle: '.console-head',
        ...(parentId ? { parentId } : {}),
        data: {
          agent,
          name: allocateName(),
          dot: DOTS[Math.floor(Math.random() * DOTS.length)],
          cwd: p.path,
          yolo: get().settings.yolo,
          view: consoleView(agent),
          epoch: 0,
          ...(account ? { profile: account } : {}),
          ...extra,
        },
      }
      get().addNode(node)
      // The first console is the natural moment to ask: from here on there is something to be told about.
      if (get().settings.notify !== false) askNotifyPermission()
      if (reveal) get().reveal(id)
      return id
    },

    // fresh: an explicit restart starts clean; Relaunch after an exit keeps the conversation on offer.
    restartConsole: async (id, fresh = true) => {
      if (get().live[id]) await api.kill(id).catch(() => {})
      if (!(await waitGone(id))) return get().notify('Still stopping, try again in a moment')
      const n = workspace(get())?.nodes.find((x) => x.id === id) as Node<ConsoleData> | undefined
      if (n)
        get().updateData(id, { epoch: n.data.epoch + 1, sessionId: undefined, resumeOffer: false, resumeNext: false, ...(fresh ? { resumable: undefined } : {}) })
    },

    // Relaunch the console on its previous conversation (the CLI's own --resume).
    resumeConsole: async (id) => {
      if (get().live[id]) await api.kill(id).catch(() => {})
      if (!(await waitGone(id))) return get().notify('Still stopping, try again in a moment')
      const n = workspace(get())?.nodes.find((x) => x.id === id) as Node<ConsoleData> | undefined
      if (n?.data.lastSessionId) get().updateData(id, { epoch: n.data.epoch + 1, resumeNext: true, resumeOffer: false })
    },

    duplicateConsole: (id) => {
      const ws = workspace(get())
      const n = ws?.nodes.find((x) => x.id === id) as Node<ConsoleData> | undefined
      if (!n) return
      const pos = absolute(ws!.nodes, n)
      const { width } = sizeOf(n)
      const spot = freeSpot(ws!.nodes, { x: pos.x + width + 40, y: pos.y, width: CONSOLE_SIZE.width, height: CONSOLE_SIZE.height })
      get().addConsole(n.data.agent, { x: spot.x + CONSOLE_SIZE.width / 2, y: spot.y + CONSOLE_SIZE.height / 2 }, { yolo: n.data.yolo, cwd: n.data.cwd, profile: n.data.profile })
    },

    // Centre of the view, nudged to free space for a console-sized node.
    viewCenter: () => {
      const flow = get().flow
      const c = flow ? flow.screenToFlowPosition({ x: innerWidth / 2, y: innerHeight / 2 - 40 }) : { x: 0, y: 0 }
      const { width, height } = CONSOLE_SIZE
      const spot = freeSpot(workspace(get())?.nodes ?? [], { x: c.x - width / 2, y: c.y - height / 2, width, height })
      return { x: spot.x + width / 2, y: spot.y + height / 2 }
    },

    spawnMany: (agents, label, extras, at) => {
      if (!agents.length) return []
      const cols = agents.length <= 4 ? Math.min(2, agents.length) : agents.length <= 9 ? 3 : 4
      const rows = Math.ceil(agents.length / cols)
      const gap = 60 // same as a group's re-flow (layout.ts), so the first drop doesn't reshuffle it
      const { width, height } = CONSOLE_SIZE
      const center = at ?? get().viewCenter()
      const pad = 24
      const head = label ? 44 : 0
      const totalW = cols * width + (cols - 1) * gap
      const totalH = rows * height + (rows - 1) * gap
      const nodes = workspace(get())?.nodes ?? []
      const spot = freeSpot(nodes, { x: center.x - totalW / 2 - pad, y: center.y - totalH / 2 - pad - head, width: totalW + pad * 2, height: totalH + pad * 2 + head })
      const origin = { x: spot.x + pad, y: spot.y + pad + head }
      let gid: string | undefined
      if (label) {
        gid = `g-${uid()}`
        const color = GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)]
        get().addNode({
          id: gid,
          type: 'group',
          position: { x: origin.x - pad, y: origin.y - pad - head },
          style: { width: totalW + pad * 2, height: totalH + pad * 2 + head },
          data: { label, color } satisfies GroupData,
        })
      }
      const ids = agents.map((agent, i) => {
        const cx = (i % cols) * (width + gap) + width / 2
        const cy = Math.floor(i / cols) * (height + gap) + height / 2
        // spawnMany frames the whole batch itself, so no per-console reveal.
        return gid
          ? get().addConsole(agent, { x: pad + cx, y: pad + head + cy }, extras?.[i], gid, false)
          : get().addConsole(agent, { x: origin.x + cx, y: origin.y + cy }, extras?.[i], undefined, false)
      })
      setTimeout(() => get().frame(gid ? [gid] : ids), 60)
      return ids
    },

    // A ready-made team: one group, each member named after its role, wires already in place.
    spawnTeam: (team) => {
      const used = usedNames()
      const unique = (base: string) => {
        let name = base
        for (let n = 2; used.has(name); n++) name = `${base} ${n}`
        used.add(name)
        return name
      }
      // Hand-offs never go to a plain shell, so a team always runs a real agent; a lead's team
      // tools exist only for Claude.
      const preferred = get().settings.defaultAgent
      const agent = preferred && preferred !== 'shell' ? preferred : 'claude'
      const ids = get().spawnMany(
        team.members.map((m) => (m.lead ? 'claude' : agent)),
        team.name,
        team.members.map((m) => ({ name: unique(m.name), role: m.role, ...(m.lead ? { lead: true } : {}) })),
      )
      for (const [a, b] of team.wires) get().connectConsoles(ids[a], ids[b])
      get().notify(`${team.name}: give ${team.members[0].name} the task, the rest follows`)
    },

    groupSelected: (label) => {
      const ids = workspace(get())?.nodes.filter((n) => n.selected && n.type !== 'group' && !n.parentId).map((n) => n.id) ?? []
      if (!ids.length) return get().notify('Select consoles on the board first')
      const gid = get().groupNodes(ids, label)
      if (gid) setTimeout(() => get().frame([gid]), 60)
    },

    groupNodes: (list, label) => {
      const ws = workspace(get())
      if (!ws) return null
      const ids = new Set(list)
      // A member may be leaving another group, where its position is relative to that group.
      const picked = ws.nodes.filter((n) => ids.has(n.id) && n.type !== 'group').map((n) => ({ ...n, position: absolute(ws.nodes, n) }))
      if (!picked.length) return null
      // Members are re-laid in a compact grid (reading order), so the frame never swallows
      // a console that is not part of the group.
      const { slots: slot, width, height } = gridLayout(picked)
      const origin = freeSpot(
        ws.nodes.filter((n) => !ids.has(n.id)),
        { x: Math.min(...picked.map((n) => n.position.x)) - GROUP_PAD, y: Math.min(...picked.map((n) => n.position.y)) - GROUP_PAD - GROUP_HEAD, width, height },
      )
      const gid = `g-${uid()}`
      const groupCount = ws.nodes.filter((n) => n.type === 'group').length
      const group: Node<GroupData> = {
        id: gid,
        type: 'group',
        position: origin,
        style: { width, height },
        data: { label: label || `Group ${groupCount + 1}`, color: GROUP_COLORS[groupCount % GROUP_COLORS.length] },
      }
      const left = new Set(ws.nodes.filter((n) => ids.has(n.id) && n.parentId).map((n) => n.parentId!))
      glide()
      updateWs((w) => {
        // Parents must come before children in React Flow's node array.
        let nodes: Node[] = [group, ...w.nodes.map((n) => (ids.has(n.id) ? { ...n, parentId: gid, extent: undefined, selected: false, position: slot.get(n.id)! } : n))]
        for (const g of left) nodes = fitted(nodes, g)
        return { ...w, nodes }
      })
      return gid
    },

    // An exact size for a console or a web tile. It glides there, and the view follows if it no longer fits.
    resizeNode: (id, width, height) => {
      glide()
      updateWs((w) => {
        const n = w.nodes.find((x) => x.id === id)
        if (!n) return w
        const nodes = w.nodes.map((x) => (x.id === id ? { ...x, width, height, measured: { width, height }, style: { ...x.style, width, height } } : x))
        return { ...w, nodes: n.parentId ? fitted(nodes, n.parentId) : nodes }
      })
      setTimeout(() => {
        const flow = get().flow
        const target = flow?.getNode(id)?.parentId ?? id // in a group, the whole group has to stay in view
        const box = flow?.getNodesBounds([target])
        if (!flow || !box) return
        const tl = flow.flowToScreenPosition(box)
        const br = flow.flowToScreenPosition({ x: box.x + box.width, y: box.y + box.height })
        if (tl.x < 0 || tl.y < 0 || br.x > innerWidth || br.y > innerHeight) get().frame([target])
      }, 360)
    },

    connectFolder: (path) => updateProject((p) => (p.folders?.includes(path) || p.path === path ? p : { ...p, folders: [...(p.folders ?? []), path] })),
    disconnectFolder: (path) => updateProject((p) => ({ ...p, folders: p.folders?.filter((f) => f !== path) })),

    fitGroup: (id) => {
      glide()
      updateWs((w) => {
        const nodes = fitted(w.nodes, id)
        return nodes === w.nodes ? w : { ...w, nodes }
      })
    },

    ungroup: (id) => get().removeNode(id),

    // Put a console in a group (or take it out with null); both groups re-flow.
    moveToGroup: (id, gid) => {
      glide()
      updateWs((w) => {
        const n = w.nodes.find((x) => x.id === id)
        const g = gid ? w.nodes.find((x) => x.id === gid && x.type === 'group') : undefined
        if (!n || (gid && !g) || n.parentId === (gid ?? undefined)) return w
        const abs = absolute(w.nodes, n)
        const moved = g ? { ...n, parentId: g.id, position: { x: abs.x - g.position.x, y: abs.y - g.position.y } } : { ...n, parentId: undefined, extent: undefined, position: abs }
        let nodes = [...w.nodes.filter((x) => x.id !== id), moved] // parents before children
        for (const touched of [n.parentId, gid]) if (touched) nodes = fitted(nodes, touched)
        return { ...w, nodes }
      })
    },

    pauseAll: () => {
      const ws = workspace(get())
      const ids = consoles(ws?.nodes ?? []).map((n) => n.id).filter((id) => get().live[id] && !get().live[id].paused)
      ids.forEach((id) => api.signal(id, 'SIGSTOP').catch(() => {}))
      get().notify(ids.length ? `Paused ${ids.length} console${ids.length > 1 ? 's' : ''}` : 'Nothing running to pause')
    },

    resumeAll: () => {
      const ws = workspace(get())
      const ids = consoles(ws?.nodes ?? []).map((n) => n.id).filter((id) => get().live[id]?.paused)
      ids.forEach((id) => api.signal(id, 'SIGCONT').catch(() => {}))
      get().notify(ids.length ? `Resumed ${ids.length} console${ids.length > 1 ? 's' : ''}` : 'Nothing paused')
    },

    // Returns how many consoles were actually running, so callers report the real count.
    sendTo: (ids, text) => {
      const live = ids.filter((id) => get().live[id])
      live.forEach((id) => api.prompt(id, text).catch((e) => get().notify(`Send failed: ${e.message}`)))
      return live.length
    },

    // Padding per side keeps the framed nodes clear of the top bar, the side toolbars and the command bar.
    frame: (ids) =>
      get().flow?.fitView({ nodes: ids.map((id) => ({ id })), padding: { top: '80px', right: '90px', bottom: '180px', left: '100px' }, duration: 450, maxZoom: 1 }),

    // A wire between two consoles: when the source finishes, its work is handed to the target.
    connectConsoles: (source, target) => {
      const ws = workspace(get())
      if (!ws || source === target) return false
      const isConsole = (id: string) => ws.nodes.some((n) => n.id === id && n.type === 'console')
      // A memory card feeds consoles: its wire only marks where Push delivers.
      if (ws.nodes.some((n) => n.id === source && n.type === 'memory')) {
        if (!isConsole(target) || refuseShell(target) || ws.edges.some((e) => e.source === source && e.target === target)) return false
        updateWs((w) => ({ ...w, edges: [...w.edges, { id: `m-${uid()}`, source, target, type: 'memory' }] }))
        return true
      }
      if (!isConsole(source) || !isConsole(target)) return false
      if (refuseShell(target)) return false
      const wires = ws.edges.filter((e) => e.type === 'handoff') // a helper line carries no work
      if (wires.some((e) => e.source === source && e.target === target)) return false
      if (wouldCycle(wires, source, target)) {
        get().notify('That would pass work around in a circle. Use a loop for repeating work.')
        return false
      }
      const edge: Edge<HandoffData> = {
        id: `h-${uid()}`,
        source,
        target,
        type: 'handoff',
        data: { auto: true },
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
      }
      updateWs((w) => ({ ...w, edges: [...w.edges, edge] }))
      return true
    },

    handoff: async (from, to, mode = 'brief', pattern) => {
      const name = (id: string) => findConsole(get(), id)?.node.data
      const a = name(from)
      const b = name(to)
      if (!a || !b || refuseShell(to)) return
      if (!get().live[to]) {
        get().notify(`${b.name} is not running`)
        return
      }
      try {
        const r = await api.handoff({ from, to, fromName: a.name, toName: b.name, role: b.role, mode, pattern })
        const said: Record<LinkMode, string> = {
          brief: `${a.name} handed off to ${b.name}`,
          reply: `${a.name}'s reply went to ${b.name}`,
          review: `${b.name} is reviewing ${a.name}'s work`,
          feedback: `${a.name}'s review went back to ${b.name}`,
          context: `${b.name} now has ${a.name}'s context`,
        }
        if (r.sent) get().notify(said[mode])
        return r
      } catch (e) {
        get().notify(`Hand-off failed: ${(e as Error).message}`)
      }
    },

    setEdgeData: (id, patch) => updateWs((w) => ({ ...w, edges: w.edges.map((e) => (e.id === id ? { ...e, data: { ...e.data, ...patch } } : e)) })),
    addEdge: (edge) => updateWs((w) => ({ ...w, edges: [...w.edges, edge] })),
    removeEdge: (id) => updateWs((w) => ({ ...w, edges: w.edges.filter((e) => e.id !== id) })),

    // An orchestrator commands what it is wired to: a command wire per group or console, toggled from Connect.
    toggleWire: (orch, target) =>
      updateWs((w) => {
        const on = w.edges.some((e) => e.type === 'command' && e.source === orch && e.target === target)
        if (on) return { ...w, edges: w.edges.filter((e) => !(e.type === 'command' && e.source === orch && e.target === target)) }
        if (!w.nodes.some((n) => n.id === target && (n.type === 'console' || n.type === 'group'))) return w
        return { ...w, edges: [...w.edges, { id: `o-${uid()}`, source: orch, target, type: 'command' }] }
      }),

    // Open whichever project and workspace hold this console, then centre it.
    jumpTo: (id) => {
      const hit = findConsole(get(), id)
      if (!hit) return
      set((s) => ({
        active: hit.project.path,
        modal: null,
        projects: s.projects.map((p) => (p.path === hit.project.path ? { ...p, activeWs: hit.ws.id } : p)),
      }))
      setTimeout(() => get().frame([id]), 120)
    },

    savePreset: (preset) => set((s) => ({ presets: [...s.presets, { ...preset, id: uid() }] })),

    addMemory: (m) => updateProject((p) => ({ ...p, memories: [...p.memories, { ...m, id: uid() }] })),
    updateMemory: (id, patch) => updateProject((p) => ({ ...p, memories: p.memories.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
    removeMemory: (id) => updateProject((p) => ({ ...p, memories: p.memories.filter((m) => m.id !== id) })),
  }
})

// ---------- persistence ----------
const snapshot = () => {
  const { projects, active, settings, presets } = useStore.getState()
  const clean = projects.map((p) => ({
    ...p,
    workspaces: p.workspaces.map((w) => ({ ...w, nodes: w.nodes.map(({ selected: _s, dragging: _d, ...n }) => n) })),
  }))
  return { projects: clean, active, settings, presets }
}

// One PUT in flight at a time: two racing uploads could land an older state last.
let saveTimer: ReturnType<typeof setTimeout> | undefined
let saving = false
let dirty = false
let saveFailures = 0
const MAX_SAVE_RETRY_MS = 30_000
const SAVE_FAILURES_BEFORE_TELLING = 3
async function save() {
  saveTimer = undefined
  if (saving) return void (dirty = true)
  saving = true
  try {
    await api.putState(snapshot())
    saveFailures = 0
  } catch (e) {
    // Nothing is lost while the page stays open: the board goes on trying, and says so only if it lasts.
    saveFailures++
    if (saveFailures === SAVE_FAILURES_BEFORE_TELLING) useStore.getState().notify(`Your board could not be saved: ${(e as Error).message}. Still trying.`)
    saveTimer = setTimeout(save, Math.min(MAX_SAVE_RETRY_MS, 1000 * 2 ** saveFailures))
  } finally {
    saving = false
    if (dirty) {
      dirty = false
      save()
    }
  }
}

useStore.subscribe((s, prev) => {
  if (!s.loaded) return
  if (s.projects === prev.projects && s.active === prev.active && s.settings === prev.settings && s.presets === prev.presets) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(save, 400)
})

// The window title counts the agents waiting for you, so it shows in the Dock and the tab bar.
useStore.subscribe((s, prev) => {
  if (s.live === prev.live) return
  const waiting = Object.values(s.live).filter((l) => l.status === 'needs' && !l.paused).length
  document.title = waiting ? `(${waiting}) vibeboard` : 'vibeboard'
})

// Edits from the last 400ms before the window goes away. Leaving the page is the reliable moment to
// save, because a request made while it unloads is capped at 64KB and a board with pictures is larger.
addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden' || !saveTimer) return
  clearTimeout(saveTimer)
  save()
})
const KEEPALIVE_LIMIT = 60_000
addEventListener('pagehide', () => {
  if (!saveTimer) return
  clearTimeout(saveTimer)
  const body = JSON.stringify(snapshot())
  fetch('/api/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body, keepalive: body.length < KEEPALIVE_LIMIT }).catch((e) => console.error('last save failed', e))
})

export const agentColor = (id: string) => agentById(id)?.color ?? '#9a948c'
