// Thin client for the local server (server/index.mjs).
const wsBase = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const READ_RETRIES = 2

// Reads retry a dropped connection on their own. Writes never do: the server may have acted already.
async function reach(url: string, init: RequestInit) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, init)
    } catch {
      if (init.method !== 'GET' || attempt >= READ_RETRIES) throw new Error('vibeboard is not responding')
      await wait(300 * 2 ** attempt)
    }
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await reach(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res
      .json()
      .then((b: { error?: string }) => b.error)
      .catch(() => undefined)
    throw new Error(detail || `${method} ${url} → ${res.status}`)
  }
  return res.json() as Promise<T>
}

export type Subagent = { id: string; type: string; task: string; status: 'running' | 'done'; startedAt: number; endedAt?: number }
// A question read off the agent's screen (shared/prompts.js).
export type Ask = { id: string; question: string; options: { label: string; hint: string }[]; selected: number }
export type ConversationItem = { kind: 'user' | 'agent' | 'step' | 'note'; text: string; failed?: boolean; pending?: boolean }
export type LiveSession = { id: string; agent: string; status: Status; statusAt?: number; cwd: string; paused: boolean; subagents?: Subagent[]; ask?: Ask | null; activity?: string | null; started?: boolean; tick?: number }
export type Status = 'idle' | 'working' | 'needs' | 'done'
// What fills a Claude session's memory (shared/context.js).
export type ContextReport = { used: number; window: number; model: string; parts: { label: string; tokens: number }[]; biggest: { label: string; tokens: number }[] }

// A project folder as the Studios see it (server/files.mjs).
export type FileEntry = { name: string; path: string; dir?: boolean; children?: FileEntry[] }
// What a wire sends: see shared/links.js.
export type LinkMode = 'brief' | 'reply' | 'review' | 'feedback' | 'context'
export type GitInfo = {
  branch: string
  changes: number
  files: { code: string; path: string; orig?: string; add: number; del: number }[]
  upstream: boolean
  ahead: number
  behind: number
  remote: string | null
  commits: { hash: string; subject: string; author: string; when: string }[]
}
// Tokens per local day as [input, output, cache reads + writes], from one agent's session logs.
export type AgentUsage = { days: Record<string, [number, number, number]>; models: Record<string, number>; sessions: number; longestMs: number; first: string | null }
export type Usage = { claude: AgentUsage; codex: AgentUsage; scannedAt: number }
// What the CLI's own /usage screen shows: limits like "Current session 37% · Resets 1:49am".
export type Limits = { at: number; limits: { title: string; pct: number; resets: string | null }[]; insights: { pct: number; text: string }[] }

// A repo scan in progress or waiting for review. step: 0 launch, 1 read the repo, 2 write facts, 3 wrap up.
export type Fact = { kind: string; title: string; text: string }
// A document being written by the Documents studio, and one kept in the repo's library.
export type DocJob = { id: string; cwd: string; doc: string; title: string; agent: string; depth: Depth; startedAt: number; step: number; text: string; status: 'running' | 'done' | 'failed'; error: string | null }
export type DocEntry = { id: string; template: string; ask?: string; title: string; agent: string; depth: Depth; createdAt: number; ms: number; words: number }
export type Depth = 'quick' | 'balanced' | 'thorough'
// A repo diagram laid out by the server (shared/diagram.js), in board units from its top-left corner.
type Box = { x: number; y: number; w: number; h: number }
export type DiagramLayout = {
  title: { text: string; x: number; y: number }
  frames: (Box & { id: string; label: string })[]
  shapes: (Box & { id: string; label: string; sub: string; shape: 'box' | 'ellipse' | 'diamond'; group: string | null })[]
  edges: { from: string; to: string; label: string }[]
  width: number
  height: number
}
export type DiagramJob = { id: string; cwd: string; agent: string; startedAt: number; step: number; status: 'running' | 'done' | 'failed'; error: string | null; diagram: DiagramLayout | null }
export type Scan = { id: string; cwd: string; agent: string; startedAt: number; step: number; facts: Fact[]; status: 'running' | 'done' | 'failed'; error: string | null }

export type Loop = {
  id: string
  name: string
  instruction: string
  trigger: { type: 'schedule'; everyMs: number } | { type: 'idle' } | { type: 'output'; pattern: string }
  target?: { ids?: string[] }
  scope?: string
  stop: { runs?: number; timeMs?: number; goal?: { type: 'command'; command: string } | { type: 'judge'; text: string } }
  runs: number
  startedAt: number
  active: boolean
  finishedReason?: string
  background?: boolean // false: pauses while its consoles are on a workspace tab out of view
  nextAt?: number // next scheduled round
}

export const api = {
  getState: () => call<Record<string, unknown>>('GET', '/api/state'),
  putState: (s: unknown) => call('PUT', '/api/state', s),
  agents: (refresh = false) => call<string[]>('GET', `/api/agents${refresh ? '?refresh=1' : ''}`),
  conversation: (id: string) => call<{ items: ConversationItem[] }>('GET', `/api/pty/${id}/conversation`),
  context: (id: string) => call<{ report: ContextReport | null }>('GET', `/api/pty/${id}/context`),
  stop: (id: string) => call('POST', `/api/pty/${id}/stop`),
  choose: (id: string, askId: string, index: number) => call('POST', `/api/pty/${id}/choose`, { askId, index }),
  sessions: () => call<LiveSession[]>('GET', '/api/sessions'),
  kill: (id: string) => call('DELETE', `/api/pty/${id}`),
  input: (id: string, data: string) => call('POST', `/api/pty/${id}/input`, { data }),
  prompt: (id: string, prompt: string) => call('POST', `/api/pty/${id}/input`, { prompt }),
  signal: (id: string, signal: 'SIGSTOP' | 'SIGCONT') => call('POST', `/api/pty/${id}/signal`, { signal }),
  tail: (id: string, chars = 8000) => call<{ text: string }>('POST', `/api/pty/${id}/tail`, { chars }),
  ls: (path?: string) =>
    call<{ path: string; parent: string; home: string; dirs: string[]; isRepo: boolean }>('GET', `/api/ls${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  git: (cwd: string) => call<GitInfo | null>('GET', `/api/git?cwd=${encodeURIComponent(cwd)}`),
  gitAction: (action: 'commit' | 'push' | 'pull' | 'message' | 'discard' | 'init', cwd: string, message?: string, files?: string[]) =>
    call<{ ok?: boolean; message?: string }>('POST', `/api/git/${action}`, { cwd, message, files }),
  gitBranch: (cwd: string, name: string, create: boolean) => call<{ ok: boolean }>('POST', '/api/git/branch', { cwd, branch: { name, create } }),
  gitDiff: (cwd: string, path: string) =>
    call<{ path: string; text: string; note?: string; cut?: boolean }>('GET', `/api/git/diff?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`),
  gitShow: (cwd: string, hash: string) =>
    call<{ hash: string; subject: string; author: string; when: string; body: string; text: string; cut?: boolean }>('GET', `/api/git/show?cwd=${encodeURIComponent(cwd)}&hash=${hash}`),
  gitBranches: (cwd: string) => call<{ branches: string[] }>('GET', `/api/git/branches?cwd=${encodeURIComponent(cwd)}`),
  usage: () => call<Usage>('GET', '/api/usage'),
  limits: (profile?: string, fresh?: boolean) => call<Limits>('GET', `/api/usage/limits?profile=${encodeURIComponent(profile ?? '')}${fresh ? '&fresh=1' : ''}`),
  claudeSession: (sid: string) => call<{ exists: boolean }>('GET', `/api/claude-session/${sid}`),
  reveal: (cwd: string) => call('POST', '/api/reveal', { cwd }),
  scan: (cwd: string, agent: string) => call<Scan>('POST', '/api/scan', { cwd, agent }),
  clearScan: (cwd: string) => call('DELETE', `/api/scan?cwd=${encodeURIComponent(cwd)}`),
  docs: (cwd: string) => call<{ docs: DocEntry[]; timed: Record<Depth, number | null> }>('GET', `/api/docs?cwd=${encodeURIComponent(cwd)}`),
  readDoc: (cwd: string, id: string) => call<DocEntry & { text: string }>('GET', `/api/docs/read?cwd=${encodeURIComponent(cwd)}&id=${encodeURIComponent(id)}`),
  writeDoc: (cwd: string, o: { template: string; ask?: string; agent: string; depth: Depth }) => call<DocJob>('POST', '/api/docs', { cwd, ...o }),
  clearDoc: (cwd: string) => call('DELETE', `/api/docs?cwd=${encodeURIComponent(cwd)}`),
  diagram: (cwd: string, agent: string, focus = '') => call<DiagramJob>('POST', '/api/diagram', { cwd, agent, focus }),
  clearDiagram: (cwd: string) => call('DELETE', `/api/diagram?cwd=${encodeURIComponent(cwd)}`),
  plan: (command: string, board: unknown) => call<{ reply: string; actions: import('./planner').PlanAction[] }>('POST', '/api/plan', { command, board }),
  handoff: (body: { from: string; to: string; fromName: string; toName: string; role?: string; mode?: LinkMode; pattern?: string }) =>
    call<{ ok: boolean; duplicate?: boolean; sent?: boolean; approved?: boolean }>('POST', '/api/handoff', body),
  addLoop: (loop: Partial<Loop>) => call<Loop>('POST', '/api/loops', loop),
  updateLoop: (id: string, loop: Partial<Loop>) => call<Loop>('PUT', `/api/loops/${id}`, loop),
  runLoop: (id: string) => call<{ ok: boolean; consoles: number }>('POST', `/api/loops/${id}/run`, {}),
  setLoopActive: (id: string, on: boolean) => call<Loop>('POST', `/api/loops/${id}/active`, { on }),
  removeLoop: (id: string) => call('DELETE', `/api/loops/${id}`),
  visible: (ids: string[]) => call('POST', '/api/visible', { ids }),
  ports: () => call<{ port: number; live: boolean }[]>('GET', '/api/ports'),
  tree: (root: string, only?: 'md') => call<{ entries: FileEntry[]; truncated: boolean }>('GET', `/api/files/tree?root=${encodeURIComponent(root)}${only ? '&only=md' : ''}`),
  readFile: (root: string, path: string) => call<{ path: string; text: string; size: number }>('GET', `/api/files/read?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`),
  noteLinks: (root: string) => call<{ notes: string[]; links: [string, string][] }>('GET', `/api/files/links?root=${encodeURIComponent(root)}`),
  writeFile: (root: string, path: string, text: string, create = false) => call<{ path: string; size: number }>('POST', '/api/files/write', { root, path, text, create }),
  pageTitle: (url: string) => call<{ title: string }>('GET', `/api/page-title?url=${encodeURIComponent(url)}`),
}

export const ptyUrl = (params: Record<string, string>) => `${wsBase()}/ws/pty?${new URLSearchParams(params)}`

export type ServerEvent =
  | { type: 'sessions'; sessions: LiveSession[] }
  | { type: 'spawn'; session: LiveSession }
  | { type: 'status'; id: string; status: Status; at?: number }
  | { type: 'exit'; id: string; code: number }
  | { type: 'paused'; id: string; paused: boolean }
  | { type: 'session-id'; id: string; sessionId: string; prompted: boolean }
  | { type: 'loops'; loops: Loop[] }
  | { type: 'scans'; scans: Scan[] }
  | { type: 'docs'; docs: DocJob[] }
  | { type: 'diagrams'; diagrams: DiagramJob[] }
  | { type: 'subagents'; id: string; subagents: Subagent[] }
  | { type: 'ask'; id: string; ask: Ask | null }
  | { type: 'activity'; id: string; text: string | null }
  | { type: 'conversation'; id: string; started: boolean }
  | { type: 'handoff'; from: string; to: string; state: 'summarizing' | 'sent' | 'failed' }
  | { type: 'helper'; parent: string; id: string; name: string; agent: string; role: string; cwd: string; yolo: boolean }

// Reconnects forever: the server restarts under `node --watch` during development.
const MAX_RETRY_MS = 5000

export function connectEvents(onEvent: (e: ServerEvent) => void, onLink: (up: boolean) => void) {
  let delay = 300
  const open = () => {
    const ws = new WebSocket(`${wsBase()}/ws/events`)
    ws.onopen = () => {
      delay = 300
      onLink(true)
    }
    ws.onmessage = (m) => onEvent(JSON.parse(m.data))
    ws.onclose = () => {
      onLink(false)
      setTimeout(open, delay)
      delay = Math.min(delay * 2, MAX_RETRY_MS)
    }
  }
  open()
}
