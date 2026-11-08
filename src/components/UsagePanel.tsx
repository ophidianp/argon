import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { ChartColumn, ChevronLeft, CircleUserRound, KeyRound, Pencil, Plus, RotateCw, SquareTerminal, X } from 'lucide-react'
import { api, type AgentUsage, type Limits, type Usage } from '../api'
import { useStore, type Profile, type UsageView } from '../store'
import { AGENTS, agentById } from '../../shared/agents.js'
import { AgentGlyph, ClaudeMark } from './icons'

// ---------- data shared by the top-bar pill and the panel ----------
type Data = {
  limits: Limits | null
  limitsError: string | null
  limitsBusy: boolean
  tokens: Usage | null
  tokensBusy: boolean
}
export const useUsage = create<Data>(() => ({ limits: null, limitsError: null, limitsBusy: false, tokens: null, tokensBusy: false }))

// The limits follow the account new Claude consoles start on.
export function loadLimits(fresh = false) {
  const { settings, installed } = useStore.getState()
  if (!installed.includes('claude') || useUsage.getState().limitsBusy) return
  useUsage.setState({ limitsBusy: true })
  api
    .limits(settings.active?.claude, fresh)
    .then((limits) => useUsage.setState({ limits, limitsError: null }))
    .catch((e) => useUsage.setState({ limitsError: (e as Error).message }))
    .finally(() => useUsage.setState({ limitsBusy: false }))
}
export function loadTokens() {
  if (useUsage.getState().tokensBusy) return
  useUsage.setState({ tokensBusy: true })
  api
    .usage()
    .then((tokens) => useUsage.setState({ tokens }))
    .catch((e) => useStore.getState().notify(`Usage: ${(e as Error).message}`))
    .finally(() => useUsage.setState({ tokensBusy: false }))
}

// ---------- formatting ----------
export const fmtTokens = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : String(n)
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const shortDate = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const duration = (ms: number) => {
  const m = Math.round(ms / 60000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d ? `${d}d ${h}h ${m % 60}m` : h ? `${h}h ${m % 60}m` : `${m}m`
}
const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000)
  return s < 30 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`
}
const sum = (d: [number, number, number] | undefined) => (d ? d[0] + d[1] + d[2] : 0)

const USAGE_AGENTS = ['claude', 'codex', 'gemini', 'grok', 'opencode']

// ---------- panel ----------
export function UsagePanel() {
  const view = useStore((s) => s.usageView)
  const close = () => useStore.getState().set({ modal: null, usageView: 'usage' })
  useEffect(() => {
    loadTokens()
    loadLimits()
  }, [])
  return (
    <div className="backdrop" style={{ background: 'transparent', placeItems: 'start end' }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="menu usage nowheel">
        {view === 'tokens' ? <TokensView close={close} /> : view === 'accounts' ? <AccountsView close={close} /> : <UsageView close={close} />}
      </div>
    </div>
  )
}

const go = (usageView: UsageView) => useStore.getState().set({ usageView })

function Head({ title, back, close, children, right }: { title: string; back?: boolean; close: () => void; children?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="usage-head">
      {back && (
        <button className="icon-btn sm" title="Back" onClick={() => go('usage')}>
          <ChevronLeft size={17} />
        </button>
      )}
      <span className="title">{title}</span>
      {children}
      <span className="spacer" />
      {right}
      <button className="icon-btn sm" title="Close" onClick={close}>
        <X size={16} />
      </button>
    </div>
  )
}

function AgentTabs({ ids, value, onPick }: { ids: string[]; value: string; onPick: (id: string) => void }) {
  return (
    <span className="usage-tabs">
      {ids.map((id) => (
        <button key={id} className={value === id ? 'on' : ''} title={agentById(id)?.name} onClick={() => onPick(id)}>
          <AgentGlyph id={id} size={16} />
        </button>
      ))}
    </span>
  )
}

// A Claude console that runs /usage itself, for the full screen with its own controls.
function openUsageConsole() {
  const s = useStore.getState()
  const id = s.addConsole('claude', s.viewCenter())
  s.set({ modal: null, usageView: 'usage' })
  const t0 = Date.now()
  const tick = () => {
    const live = useStore.getState().live[id]
    if (live?.status === 'idle') api.prompt(id, '/usage').catch(() => {})
    else if (Date.now() - t0 < 30_000) setTimeout(tick, 400)
  }
  tick()
}

function UsageView({ close }: { close: () => void }) {
  const installed = useStore((s) => s.installed)
  const agent = useStore((s) => s.usageAgent)
  const { limits, limitsError, limitsBusy, tokens, tokensBusy } = useUsage()
  const tabs = USAGE_AGENTS.filter((a) => installed.includes(a) || (tokens?.[a as keyof Usage] as AgentUsage | undefined)?.sessions)
  const shown = tabs.includes(agent) ? agent : tabs[0] ?? 'claude'
  const data = (tokens?.[shown as 'claude' | 'codex'] as AgentUsage | undefined) ?? null
  const busy = limitsBusy || tokensBusy
  const color = agentById(shown)?.color ?? 'var(--accent)'
  return (
    <>
      <Head
        title="usage"
        close={close}
        right={
          <>
            {shown === 'claude' && installed.includes('claude') && (
              <button className="icon-btn sm" title="Open /usage in a Claude console" onClick={openUsageConsole}>
                <SquareTerminal size={16} />
              </button>
            )}
            <button className="icon-btn sm" title="Tokens per agent" onClick={() => go('tokens')}>
              <ChartColumn size={16} />
            </button>
            <button className="icon-btn sm" title="Accounts" onClick={() => go('accounts')}>
              <CircleUserRound size={16} />
            </button>
            <button
              className="icon-btn sm"
              title="Refresh"
              onClick={() => {
                loadLimits(true)
                loadTokens()
              }}
            >
              <RotateCw size={14} className={busy ? 'spin' : ''} />
            </button>
          </>
        }
      >
        <AgentTabs ids={tabs} value={shown} onPick={(usageAgent) => useStore.getState().set({ usageAgent })} />
      </Head>
      <div className="usage-body">
        {shown === 'claude' && <PlanLimits limits={limits} error={limitsError} busy={limitsBusy} />}
        {data && data.sessions > 0 ? (
          <>
            <Activity days={data.days} color={color} />
            <AgentStats id={shown} data={data} />
          </>
        ) : (
          !tokensBusy && (
            <div className="usage-empty">
              {shown === 'claude' || shown === 'codex'
                ? `No ${agentById(shown)?.name} sessions in the local logs yet.`
                : `${agentById(shown)?.name} doesn't record token counts in its local logs, so there is nothing to show here.`}
            </div>
          )
        )}
        {shown === 'claude' && limits && limits.insights.length > 0 && <Insights items={limits.insights} />}
      </div>
      <div className="usage-foot">
        <AgentGlyph id={shown} size={13} />
        <span className="mono">
          <b>{shown}</b> <span className="faint">›</span> {shown === 'claude' ? '/usage' : 'local session logs'}
        </span>
        <span className="spacer" />
        <span className="faint">{shown === 'claude' ? `your subscription · ${limitsBusy ? 'refreshing' : limits ? `updated ${ago(limits.at)}` : 'not read yet'}` : tokensBusy ? 'scanning' : 'scanned just now'}</span>
      </div>
    </>
  )
}

function PlanLimits({ limits, error, busy }: { limits: Limits | null; error: string | null; busy: boolean }) {
  if (!limits)
    return (
      <div className="usage-session">
        <Ring pct={0} />
        <span>
          <div className="t">Current session</div>
          <div className="s">{busy ? 'Reading /usage from Claude…' : error ? `Plan limits unavailable: ${error}` : '—'}</div>
        </span>
      </div>
    )
  const [first, ...rest] = limits.limits
  return (
    <>
      <div className="usage-session">
        <Ring pct={first.pct} />
        <span>
          <div className="t">{first.title}</div>
          {first.resets && <div className="s">Resets {first.resets}</div>}
        </span>
      </div>
      {rest.map((l) => (
        <div className="usage-limit" key={l.title}>
          <div className="row">
            <span>{l.title}</span>
            <span>{Math.round(l.pct)}%</span>
          </div>
          <div className="bar">
            <i style={{ width: `${Math.min(100, l.pct)}%` }} />
          </div>
          {l.resets && <div className="s">Resets {l.resets}</div>}
        </div>
      ))}
    </>
  )
}

function Ring({ pct }: { pct: number }) {
  const R = 36
  const C = 2 * Math.PI * R
  return (
    <svg className="ring" viewBox="0 0 86 86">
      <circle cx="43" cy="43" r={R} fill="none" stroke="var(--panel-3)" strokeWidth="6" />
      {pct > 0 && <circle cx="43" cy="43" r={R} fill="none" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(C * Math.min(100, pct)) / 100} ${C}`} transform="rotate(-90 43 43)" />}
      <text x="43" y="45" textAnchor="middle" fill="var(--text)" fontSize="17" fontWeight="600">
        {Math.round(pct)}%
      </text>
      <text x="43" y="59" textAnchor="middle" fill="var(--muted)" fontSize="9">
        used
      </text>
    </svg>
  )
}

// 53 weeks ending this week, Monday-first rows, GitHub-style.
function Activity({ days, color }: { days: AgentUsage['days']; color: string }) {
  const today = new Date()
  const start = new Date(today)
  start.setDate(start.getDate() - 364 - ((today.getDay() + 6) % 7))
  const cells: { day: string; n: number }[] = []
  for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) cells.push({ day: dayKey(d), n: sum(days[dayKey(d)]) })
  const peak = Math.max(1, ...cells.map((c) => c.n))
  const level = (n: number) => (n === 0 ? 0 : n < peak * 0.25 ? 1 : n < peak * 0.5 ? 2 : n < peak * 0.75 ? 3 : 4)
  const months: { col: number; label: string }[] = []
  for (let col = 0; col * 7 < cells.length; col++) {
    const d = new Date(`${cells[col * 7].day}T12:00:00`)
    const label = d.toLocaleDateString('en-US', { month: 'short' })
    if (!months.length || months[months.length - 1].label !== label) months.push({ col, label })
  }
  return (
    <div className="usage-activity" style={{ ['--a' as string]: color }}>
      <div className="row">
        <span className="section-label">Activity</span>
        <span className="faint">Last 12 months</span>
      </div>
      <div className="heat-wrap">
        <div className="heat-days">
          <span />
          <span>Mon</span>
          <span />
          <span>Wed</span>
          <span />
          <span>Fri</span>
          <span />
        </div>
        <div>
          <div className="heat-months">
            {months.slice(months[0]?.col === 0 && months[1]?.col < 3 ? 1 : 0).map((m) => (
              <span key={m.col} style={{ gridColumn: m.col + 1 }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="heat">
            {cells.map((c) => (
              <i key={c.day} title={`${shortDate(c.day)}: ${fmtTokens(c.n)} tokens`} className={`l${level(c.n)}`} />
            ))}
          </div>
        </div>
      </div>
      <div className="heat-legend">
        Less
        {[0, 1, 2, 3, 4].map((l) => (
          <i key={l} className={`l${l}`} />
        ))}
        More
      </div>
    </div>
  )
}

function streaks(days: AgentUsage['days']) {
  const active = new Set(Object.keys(days).filter((d) => sum(days[d]) > 0))
  let best = 0
  let run = 0
  const first = [...active].sort()[0]
  if (!first) return { best: 0, current: 0, active: 0, span: 0 }
  const d = new Date(`${first}T12:00:00`)
  const today = dayKey(new Date())
  let span = 0
  for (; dayKey(d) <= today; d.setDate(d.getDate() + 1)) {
    span++
    run = active.has(dayKey(d)) ? run + 1 : 0
    best = Math.max(best, run)
  }
  // Today not used yet does not break the streak until the day is over.
  let current = 0
  const c = new Date()
  if (!active.has(dayKey(c))) c.setDate(c.getDate() - 1)
  while (active.has(dayKey(c))) {
    current++
    c.setDate(c.getDate() - 1)
  }
  return { best, current, active: active.size, span }
}

function AgentStats({ id, data }: { id: string; data: AgentUsage }) {
  const total = Object.values(data.days).reduce((n, d) => n + sum(d), 0)
  const st = streaks(data.days)
  const busiest = Object.entries(data.days).sort((a, b) => sum(b[1]) - sum(a[1]))[0]
  const favorite = Object.entries(data.models).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
  const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`
  const stats: [string, string][] =
    id === 'claude'
      ? [
          ['Favorite model', favorite],
          ['Total tokens', fmtTokens(total)],
          ['Sessions', String(data.sessions)],
          ['Active days', `${st.active}/${st.span}`],
          ['Most active day', busiest ? shortDate(busiest[0]) : '—'],
          ['Longest session', duration(data.longestMs)],
          ['Longest streak', plural(st.best)],
          ['Current streak', plural(st.current)],
        ]
      : [
          ['Lifetime', fmtTokens(total)],
          ['Peak', busiest ? fmtTokens(sum(busiest[1])) : '0'],
          ['Streak', `${st.current}d (best ${st.best}d)`],
          ['Longest task', duration(data.longestMs)],
        ]
  return (
    <div className="usage-stats">
      {stats.map(([k, v]) => (
        <div key={k}>
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
    </div>
  )
}

function Insights({ items }: { items: Limits['insights'] }) {
  return (
    <div className="usage-insights">
      <div className="section-label">Last 24h</div>
      <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>
        these are independent characteristics of your usage, not a breakdown
      </div>
      {items.map((it) => {
        const [title, ...tip] = it.text.split(' · ')
        return (
          <div className="usage-limit" key={it.text}>
            <div className="row">
              <span>{title}</span>
              <span className="warm">{it.pct}%</span>
            </div>
            <div className="bar">
              <i style={{ width: `${it.pct}%` }} />
            </div>
            {tip.length > 0 && <div className="s">{tip.join(' · ')}</div>}
          </div>
        )
      })}
    </div>
  )
}

// ---------- tokens ----------
type Mode = 'all' | 'io' | 'out'
const pick = (d: [number, number, number] | undefined, mode: Mode) => (!d ? 0 : mode === 'all' ? d[0] + d[1] + d[2] : mode === 'io' ? d[0] + d[1] : d[1])

function TokensView({ close }: { close: () => void }) {
  const { tokens, tokensBusy } = useUsage()
  const [mode, setMode] = useState<Mode>('all')
  const [range, setRange] = useState<'30' | 'all'>('30')
  const agents = (['claude', 'codex'] as const).filter((a) => tokens && tokens[a].sessions > 0)
  const last30 = Array.from({ length: 30 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - 29 + i)
    return dayKey(d)
  })
  const inRange = (day: string) => range === 'all' || day >= last30[0]
  const totals = agents.map((a) => {
    const t = [0, 0, 0]
    for (const [day, d] of Object.entries(tokens![a].days))
      if (inRange(day)) {
        t[0] += d[0]
        t[1] += d[1]
        t[2] += d[2]
      }
    return { a, in: t[0], out: t[1], cache: t[2], total: t[0] + t[1] + t[2] }
  })
  const grand = totals.reduce((n, t) => n + t.total, 0) || 1
  const perDay = last30.map((day) => ({ day, parts: agents.map((a) => pick(tokens![a].days[day], mode)) }))
  const max = Math.max(1, ...perDay.map((p) => p.parts.reduce((n, x) => n + x, 0)))
  const sum30 = last30.reduce((n, day) => n + agents.reduce((m, a) => m + sum(tokens![a].days[day]), 0), 0)
  const busiest = [...last30].sort((x, y) => agents.reduce((m, a) => m + sum(tokens![a].days[y]), 0) - agents.reduce((m, a) => m + sum(tokens![a].days[x]), 0))[0]
  const top30 = agents.map((a) => ({ a, n: last30.reduce((m, day) => m + sum(tokens![a].days[day]), 0) })).sort((x, y) => y.n - x.n)[0]
  const NOTES: Record<Mode, string> = {
    all: 'Everything the model processed — cache reads and writes included.',
    io: 'New input and output only — what was not served from the cache.',
    out: 'Only what the models wrote.',
  }
  return (
    <>
      <Head
        title="tokens"
        back
        close={close}
        right={
          <button className="icon-btn sm" title="Scan again" onClick={loadTokens}>
            <RotateCw size={14} className={tokensBusy ? 'spin' : ''} />
          </button>
        }
      />
      <div className="usage-body">
        {!tokens ? (
          <div className="usage-loading">
            <ClaudeMark size={20} color="#8a847c" />
            <div className="t">Reading local session logs</div>
            <div className="s">Counting tokens straight from each agent's own transcripts on this Mac — nothing leaves your machine.</div>
          </div>
        ) : (
          <>
            <div className="usage-summary">
              <div>
                <span>Last 30 days</span>
                <b>{fmtTokens(sum30)}</b>
              </div>
              <div>
                <span>Busiest day</span>
                <b>{busiest && sum30 ? shortDate(busiest) : '—'}</b>
              </div>
              <div>
                <span>Top agent</span>
                <b>{top30?.n ? `${agentById(top30.a)?.name} · ${Math.round((top30.n / (sum30 || 1)) * 100)}%` : '—'}</b>
              </div>
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              <span className="section-label">Last 30 days</span>
              <span className="faint">Tokens per day by agent</span>
            </div>
            <div className="mini-seg">
              {(
                [
                  ['all', 'All tokens'],
                  ['io', 'In + out'],
                  ['out', 'Output'],
                ] as const
              ).map(([k, label]) => (
                <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="tok-chart">
              <div className="tok-bars">
                {perDay.map((p) => (
                  <div key={p.day} className="tok-col" title={`${shortDate(p.day)}: ${fmtTokens(p.parts.reduce((n, x) => n + x, 0))}`}>
                    {p.parts.map((n, i) => (
                      <i key={agents[i]} style={{ height: `${(n / max) * 100}%`, background: agentById(agents[i])?.color }} />
                    ))}
                  </div>
                ))}
              </div>
              <div className="axis">
                <span>{fmtTokens(max)}</span>
                <span>{fmtTokens(max / 2)}</span>
                <span>0</span>
              </div>
              <div className="labels">
                {last30.map((day, i) => (
                  <span key={day}>{i % 7 === 0 ? shortDate(day) : ''}</span>
                ))}
              </div>
            </div>
            <div className="tok-legend">
              {agents.map((a) => (
                <span key={a}>
                  <i style={{ background: agentById(a)?.color }} /> {agentById(a)?.name}
                </span>
              ))}
            </div>
            <div className="faint" style={{ fontSize: 12.5 }}>
              {NOTES[mode]}
            </div>
            <div className="row" style={{ marginTop: 14 }}>
              <span className="section-label">By agent</span>
              <span className="mini-seg">
                <button className={range === '30' ? 'on' : ''} onClick={() => setRange('30')}>
                  Last 30 days
                </button>
                <button className={range === 'all' ? 'on' : ''} onClick={() => setRange('all')}>
                  All time
                </button>
              </span>
            </div>
            {totals.map((t) => (
              <div className="usage-limit" key={t.a}>
                <div className="row">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <AgentGlyph id={t.a} size={15} /> {agentById(t.a)?.name}
                  </span>
                  <span>
                    {fmtTokens(t.total)} <span className="faint">{t.total / grand < 0.01 ? '<1%' : `${Math.round((t.total / grand) * 100)}%`}</span>
                  </span>
                </div>
                <div className="bar">
                  <i style={{ width: `${(t.total / grand) * 100}%`, background: agentById(t.a)?.color }} />
                </div>
                <div className="s">
                  in {fmtTokens(t.in)} · out {fmtTokens(t.out)} · cache {fmtTokens(t.cache)}
                </div>
              </div>
            ))}
            {!agents.length && <div className="usage-empty">No token counts in the local logs yet.</div>}
            <div className="faint" style={{ fontSize: 12.5, marginTop: 8 }}>
              Read from each agent's local session logs. Claude and Codex record per-session token counts; Gemini, Grok and OpenCode don't, so they can't appear here.
            </div>
          </>
        )}
      </div>
      <div className="usage-foot">
        <SquareTerminal size={13} color="var(--faint)" />
        <span className="mono">
          <b>local session logs</b>
        </span>
        <span className="spacer" />
        <span className="faint">{tokensBusy ? 'scanning' : tokens ? `scanned ${ago(tokens.scannedAt)}` : ''}</span>
      </div>
    </>
  )
}

// ---------- accounts ----------
export const initials = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase()
}

function AccountsView({ close }: { close: () => void }) {
  const settings = useStore((s) => s.settings)
  const installed = useStore((s) => s.installed)
  const choices = AGENTS.filter((a) => a.configEnv && installed.includes(a.id)).map((a) => a.id)
  const [agent, setAgent] = useState(choices[0] ?? 'claude')
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const profiles = (settings.profiles ?? []).filter((p) => p.agent === agent)
  const active = settings.active?.[agent]
  const label = agentById(agent)?.name ?? agent
  const s = useStore.getState()
  const patch = (p: Partial<typeof settings>) => s.set({ settings: { ...useStore.getState().settings, ...p } })
  const use = (id?: string) => {
    const next = { ...settings.active }
    if (id) next[agent] = id
    else delete next[agent]
    patch({ active: next })
    if (agent === 'claude') {
      useUsage.setState({ limits: null, limitsError: null })
      loadLimits()
    }
    s.notify(`New ${label} consoles start on ${id ? profiles.find((p) => p.id === id)?.name : 'your sign-in'}`)
  }
  const openConsole = (p: Profile) => {
    s.addConsole(agent, s.viewCenter(), { profile: p.id })
    close()
  }
  const connect = () => {
    const n = name.trim().slice(0, 40)
    if (!n) return
    const p: Profile = { id: crypto.randomUUID().slice(0, 8), name: n, agent }
    patch({ profiles: [...(settings.profiles ?? []), p] })
    setName('')
    s.addConsole(agent, s.viewCenter(), { profile: p.id })
    s.notify(`Sign in to ${n} in the new console`)
    close()
  }
  const remove = (p: Profile) => {
    const next = { ...settings.active }
    if (next[agent] === p.id) delete next[agent]
    patch({ profiles: (settings.profiles ?? []).filter((x) => x.id !== p.id), active: next })
  }
  if (!choices.length)
    return (
      <>
        <Head title="accounts" back close={close} />
        <div className="usage-empty" style={{ padding: 24 }}>
          None of the installed CLIs can keep a second sign-in yet (Claude and Codex can).
        </div>
      </>
    )
  return (
    <>
      <Head title="accounts" back close={close}>
        {choices.length > 1 && <AgentTabs ids={choices} value={agent} onPick={setAgent} />}
      </Head>
      <div className="usage-body accounts">
        {agent === 'claude' && (
          <div className="acct-warn">
            <KeyRound size={14} color="var(--needs)" />
            <span>On this Mac, Claude may keep sign-ins in the system Keychain, which profiles can't fully isolate yet. After switching, verify the account with /status inside the console.</span>
          </div>
        )}
        <div className={`acct-row ${active ? '' : 'on'}`}>
          <span className="acct-av plain">
            <CircleUserRound size={18} />
          </span>
          <span className="who">
            <div className="t">Your sign-in</div>
            <div className="s">{active ? `${label}'s own default login` : `Powering new ${label} consoles`}</div>
          </span>
          {active ? (
            <button className="use" onClick={() => use(undefined)}>
              Use
            </button>
          ) : (
            <span className="active-tag">● Active</span>
          )}
        </div>
        {profiles.map((p) => (
          <div key={p.id} className={`acct-row ${active === p.id ? 'on' : ''}`}>
            <span className="acct-av">{initials(p.name)}</span>
            <span className="who">
              {renaming === p.id ? (
                <input
                  className="field"
                  autoFocus
                  defaultValue={p.name}
                  onBlur={(e) => {
                    const n = e.target.value.trim().slice(0, 40)
                    if (n) patch({ profiles: (settings.profiles ?? []).map((x) => (x.id === p.id ? { ...x, name: n } : x)) })
                    setRenaming(null)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              ) : (
                <>
                  <div className="t">{p.name}</div>
                  <div className="s">{active === p.id ? `Powering new ${label} consoles` : 'Ready when you need it'}</div>
                </>
              )}
            </span>
            {active === p.id ? (
              <span className="active-tag">● Active</span>
            ) : (
              <button className="use" onClick={() => use(p.id)}>
                Use
              </button>
            )}
            <button className="icon-btn sm" title="Open a console on this account" onClick={() => openConsole(p)}>
              <SquareTerminal size={14} />
            </button>
            <button className="icon-btn sm" title="Rename" onClick={() => setRenaming(p.id)}>
              <Pencil size={13} />
            </button>
            <button className="icon-btn sm" title="Remove from the list (its sign-in folder stays on disk)" onClick={() => remove(p)}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className="acct-connect">
        <div className="section-label">Connect another account</div>
        <div className="line">
          <input className="field" placeholder="e.g. Personal Max" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && connect()} />
          <button className="connect" disabled={!name.trim()} onClick={connect}>
            <Plus size={15} /> Connect
          </button>
        </div>
        <div className="faint" style={{ fontSize: 12.5 }}>
          Drops a {label} console on the board; its own sign-in flow runs right in the terminal.
        </div>
      </div>
    </>
  )
}
