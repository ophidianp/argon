// The command bar planner: plain speech in, board actions out (via `claude -p` on the server).
// The action set has no way to stop or delete a console: that stays a confirmed, manual act.
import { api } from './api'
import { consoles, useStore, workspace } from './store'
import { startDiagram } from './diagram'

export type PlanAction =
  | { type: 'send'; to: string[]; text: string }
  | { type: 'spawn'; agent: string; count: number; group?: string }
  | { type: 'group'; names: string[]; label: string }
  | { type: 'frame'; names: string[] }
  | { type: 'handoff'; from: string; to: string }
  | { type: 'diagram'; focus?: string }
  | { type: 'pause' }
  | { type: 'resume' }

// What a composer may touch: the whole board, or only what an orchestrator is wired to. New consoles
// it spawns are handed to `onSpawn` so the orchestrator can wire them.
export type Scope = { consoles: string[]; groups: string[]; onSpawn?: (ids: string[]) => void }

const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string')

// The model's output is untrusted shape-wise: drop anything malformed instead of throwing mid-plan.
function valid(a: PlanAction): boolean {
  const x = a as Record<string, unknown>
  if (a.type === 'send') return strings(x.to) && typeof x.text === 'string'
  if (a.type === 'spawn') return typeof x.agent === 'string'
  if (a.type === 'group') return strings(x.names) && typeof x.label === 'string'
  if (a.type === 'frame') return strings(x.names)
  if (a.type === 'handoff') return typeof x.from === 'string' && typeof x.to === 'string'
  return a.type === 'pause' || a.type === 'resume' || a.type === 'diagram'
}

function scoped(scope?: Scope) {
  const ws = workspace(useStore.getState())!
  const all = consoles(ws.nodes).filter((n) => !scope || scope.consoles.includes(n.id))
  const groups = ws.nodes.filter((n) => n.type === 'group' && (!scope || scope.groups.includes(n.id)))
  return { all, groups }
}

// Who "@name" can reach from a composer: consoles, groups and "all", inside the scope.
export function mentionTargets(scope?: Scope) {
  const { all, groups } = scoped(scope)
  return [
    ...all.map((n) => ({ name: n.data.name, ids: [n.id], agent: n.data.agent })),
    ...groups.map((g) => ({ name: String(g.data.label), ids: all.filter((n) => n.parentId === g.id).map((n) => n.id), agent: '' })),
    { name: 'all', ids: all.map((n) => n.id), agent: '' },
  ]
}

// One instruction from a composer: "@name text" goes straight to those consoles, anything else is planned.
export async function command(raw: string, scope?: Scope): Promise<string> {
  // Longest names first so "@Maya 2" wins over "@Maya".
  const sorted = mentionTargets(scope).sort((a, b) => b.name.length - a.name.length)
  let rest = raw
  const ids = new Set<string>()
  for (const t of sorted) {
    // Unicode-aware end of name: `\b` fails after "Niccolò", "Team (A)" or "C++".
    const re = new RegExp(`@${t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'giu')
    if (re.test(rest)) {
      t.ids.forEach((id) => ids.add(id))
      rest = rest.replace(re, '').trim()
    }
  }
  if (!ids.size) return runPlanner(raw, scope)
  const sent = useStore.getState().sendTo([...ids], rest)
  return sent ? `Sent to ${sent} console${sent > 1 ? 's' : ''}` : 'None of those consoles is running'
}

export async function runPlanner(command: string, scope?: Scope): Promise<string> {
  const s = useStore.getState()
  const ws = workspace(s)
  if (!ws) return 'Open a board first'
  const where = { active: s.active, ws: ws.id }
  const { all, groups: inScope } = scoped(scope)
  const board = {
    consoles: all.map((n) => ({
      name: n.data.name,
      agent: n.data.agent,
      status: s.live[n.id] ? (s.live[n.id].paused ? 'paused' : s.live[n.id].status) : 'stopped',
      group: ws.nodes.find((g) => g.type === 'group' && g.id === n.parentId)?.data.label,
      selected: !!n.selected,
    })),
    groups: inScope.map((g) => g.data.label),
    agents: s.installed,
  }
  const plan = await api.plan(command, board)
  // Planning takes seconds: acting on whatever board is open by then would hit the wrong consoles.
  const now = useStore.getState()
  if (now.active !== where.active || workspace(now)?.id !== where.ws) return 'The board changed while planning, so nothing was done'
  const { groups } = scoped(scope)
  const byName = (names: string[]) => {
    const { all } = scoped(scope)
    const ids = new Set<string>()
    for (const raw of names) {
      const name = raw.toLowerCase()
      if (name === 'all') all.forEach((n) => ids.add(n.id))
      const g = groups.find((x) => String(x.data.label).toLowerCase() === name)
      if (g) all.filter((n) => n.parentId === g.id).forEach((n) => ids.add(n.id))
      all.filter((n) => n.data.name.toLowerCase() === name).forEach((n) => ids.add(n.id))
    }
    return [...ids]
  }
  // Pausing from an orchestrator stops only what it commands, not the whole board.
  const signalScope = (signal: 'SIGSTOP' | 'SIGCONT') =>
    scoped(scope).all.forEach((n) => {
      const live = useStore.getState().live[n.id]
      if (live && live.paused !== (signal === 'SIGSTOP')) api.signal(n.id, signal).catch(() => {})
    })
  for (const a of (plan.actions ?? []).filter(valid)) {
    const st = useStore.getState()
    if (a.type === 'send') st.sendTo(byName(a.to), a.text)
    else if (a.type === 'spawn') {
      const ids = st.spawnMany(Array(Math.max(1, Math.min(12, a.count || 1))).fill(a.agent), a.group)
      scope?.onSpawn?.(ids)
    } else if (a.type === 'frame') st.frame([...byName(a.names), ...groups.filter((g) => a.names.includes(String(g.data.label))).map((g) => g.id)])
    else if (a.type === 'handoff') {
      const [from] = byName([a.from])
      const [to] = byName([a.to])
      if (from && to) await st.handoff(from, to)
    } else if (a.type === 'diagram') await startDiagram(typeof a.focus === 'string' ? a.focus : '')
    else if (a.type === 'pause') (scope ? signalScope('SIGSTOP') : st.pauseAll())
    else if (a.type === 'resume') (scope ? signalScope('SIGCONT') : st.resumeAll())
    else if (a.type === 'group') {
      const ids = new Set(byName(a.names))
      st.onNodesChange(workspace(st)!.nodes.map((n) => ({ type: 'select', id: n.id, selected: ids.has(n.id) })))
      st.groupSelected(a.label)
    }
  }
  return plan.reply || 'Done'
}
