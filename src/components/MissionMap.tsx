import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowUpRight, ChevronRight, CircleX, Command, Crosshair, Network, Pause, Play, Search, Users, X } from 'lucide-react'
import type { Node } from '@xyflow/react'
import { api } from '../api'
import { consoles, useStore, workspace, type ConsoleData, type GroupData } from '../store'
import { agentById } from '../../shared/agents.js'
import { AgentGlyph } from './icons'
import { useNow } from './LoopsModal'

type Filter = 'all' | 'working' | 'needs' | 'idle' | 'done'
type Team = { id: string; label: string; color: string; members: Node<ConsoleData>[] }
// A commander and what it drives: an orchestrator node, or the Command center for everything unwired.
type Section = { id: string; kind: 'orch' | 'center'; label: string; singles: Node<ConsoleData>[]; teams: Team[] }
type Sel = { kind: 'console' | 'team' | 'section'; id: string } | null

export const STATUS_TEXT: Record<string, string> = { idle: 'At the prompt', working: 'Working', needs: 'Needs you', done: 'Done', stopped: 'Stopped', paused: 'Paused' }
export const STATUS_COLOR: Record<string, string> = { idle: 'var(--idle)', working: 'var(--working)', needs: 'var(--needs)', done: 'var(--done)', stopped: 'var(--faint)', paused: '#9db4ff' }

const ROW = 57
const CARD_H = 44
const GAP = 24 // between two commanders' blocks
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const agentsOf = (sec: Section) => [...sec.singles, ...sec.teams.flatMap((t) => t.members)]

// Who commands what, read from the board: command wires decide; a group wired whole brings its members.
function sectionsOf(nodes: Node[], edges: { type?: string; source: string; target: string }[]) {
  const all = consoles(nodes)
  const groups = nodes.filter((n) => n.type === 'group') as Node<GroupData>[]
  const claimed = new Set<string>()
  const team = (g: Node<GroupData>): Team => {
    const t = { id: g.id, label: g.data.label, color: g.data.color, members: all.filter((n) => n.parentId === g.id && !claimed.has(n.id)) }
    claimed.add(g.id)
    t.members.forEach((m) => claimed.add(m.id))
    return t
  }
  const orchs = nodes.filter((n) => n.type === 'orchestrator')
  const sections: Section[] = orchs.map((o, i) => {
    const targets = edges.filter((e) => e.type === 'command' && e.source === o.id).map((e) => e.target)
    const teams = groups.filter((g) => targets.includes(g.id) && !claimed.has(g.id)).map(team)
    const singles = all.filter((n) => targets.includes(n.id) && !claimed.has(n.id))
    singles.forEach((n) => claimed.add(n.id))
    return { id: o.id, kind: 'orch', label: orchs.length > 1 ? `Orchestrator ${i + 1}` : 'Orchestrator', singles, teams }
  })
  const teams = groups.filter((g) => !claimed.has(g.id)).map(team)
  const singles = all.filter((n) => !claimed.has(n.id))
  if (teams.length || singles.length) sections.push({ id: '__center', kind: 'center', label: 'Command center', singles, teams })
  return { sections, all, groups, orchestrators: orchs.length }
}

export function MissionMap() {
  const ws = useStore(workspace)!
  const live = useStore((s) => s.live)
  const activeLoops = useStore((s) => s.loops.filter((l) => l.active && (!l.scope || l.scope === s.active)).length)
  const close = () => useStore.getState().set({ modal: null })
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Sel>(null)
  const graphRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)

  useLayoutEffect(() => {
    const el = graphRef.current!
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { sections, all, groups, orchestrators } = sectionsOf(ws.nodes, ws.edges)
  const statusOf = (id: string) => (live[id] ? (live[id].paused ? 'paused' : live[id].status) : 'stopped')
  const counts = {
    all: all.length,
    working: all.filter((n) => statusOf(n.id) === 'working').length,
    needs: all.filter((n) => statusOf(n.id) === 'needs').length,
    idle: all.filter((n) => ['idle', 'stopped', 'paused'].includes(statusOf(n.id))).length,
    done: all.filter((n) => statusOf(n.id) === 'done').length,
  }
  const matches = (n: Node<ConsoleData>) => {
    const st = statusOf(n.id)
    const okFilter = filter === 'all' || (filter === 'idle' ? ['idle', 'stopped', 'paused'].includes(st) : st === filter)
    return okFilter && (!q || n.data.name.toLowerCase().includes(q.toLowerCase()))
  }
  const doneIn = (list: Node<ConsoleData>[]) => list.filter((m) => statusOf(m.id) === 'done').length
  const workingIn = (list: Node<ConsoleData>[]) => list.filter((m) => statusOf(m.id) === 'working').length

  // Layout: commander → teams → consoles, one console per row; a commander's lone consoles hang off it directly.
  const cardW = 200
  const teamW = 170
  const headW = 180
  const xConsole = Math.max(teamW + headW + 160, width - cardW - 4)
  const xTeam = Math.round((headW + xConsole - teamW) / 2 + 20)
  let y = 8
  const layout = sections.map((sec, si) => {
    if (si) y += GAP
    const start = y
    const singleY = sec.singles.map(() => (y += ROW) - ROW)
    const teamRows = sec.teams.map((t) => (t.members.length ? t.members.map(() => (y += ROW) - ROW) : [(y += ROW) - ROW]))
    const teamY = teamRows.map((ys) => (ys[0] + ys[ys.length - 1]) / 2)
    const end = y - ROW
    // The Command center sits at the top of its block, like a list header; an orchestrator in the middle.
    const headY = sec.kind === 'center' ? start : (start + end) / 2
    return { sec, singleY, teamRows, teamY, headY }
  })
  const height = Math.max(460, y + 12)
  const curve = (x1: number, y1: number, x2: number, y2: number) => {
    const mx = (x1 + x2) / 2
    return `M${x1} ${y1} C${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
  }
  const wire = (key: string, d: string, dashed: boolean, faded = false) => (
    <path key={key} d={d} stroke={dashed ? 'var(--muted)' : 'var(--edge)'} strokeDasharray={dashed ? '4 4' : undefined} strokeWidth={1.3} fill="none" opacity={faded ? 0.18 : dashed ? 0.7 : 0.85} />
  )

  const jump = (ids: string[]) => {
    close()
    setTimeout(() => useStore.getState().frame(ids), 30)
  }
  const isSel = (kind: string, id: string) => sel?.kind === kind && sel.id === id
  const consoleCard = (m: Node<ConsoleData>, top: number) => {
    const st = statusOf(m.id)
    return (
      <button
        key={m.id}
        className={`mm-card ${matches(m) ? '' : 'faded'} ${isSel('console', m.id) ? 'sel' : ''}`}
        style={{ left: xConsole, top, width: cardW }}
        onClick={() => setSel({ kind: 'console', id: m.id })}
        onDoubleClick={() => jump([m.id])}
      >
        <AgentGlyph id={m.data.agent} size={15} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <div className="t">{m.data.name}</div>
          <div className="s">{STATUS_TEXT[st]}</div>
        </span>
        <span className="dot" style={{ background: STATUS_COLOR[st], width: 6, height: 6 }} />
      </button>
    )
  }

  const teamById = (id: string) => sections.flatMap((s) => s.teams.map((t) => ({ t, s }))).find((x) => x.t.id === id)
  const sectionOf = (cid: string) =>
    sections.find((s) => s.singles.some((n) => n.id === cid) || s.teams.some((t) => t.members.some((n) => n.id === cid)))
  const pickedTeam = sel?.kind === 'team' ? teamById(sel.id) : undefined
  const picked = sel?.kind === 'console' ? all.find((n) => n.id === sel.id) : undefined
  const pickedSection = sel?.kind === 'section' ? sections.find((s) => s.id === sel.id) : undefined
  const center = sections.find((s) => s.kind === 'center')

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal">
        <div className="modal-head">
          <span className="ico">
            <Network size={20} />
          </span>
          <div style={{ flex: 1 }}>
            <h2>Mission Map</h2>
            <div className="sub">
              {plural(orchestrators, 'orchestrator')} · {plural(groups.length, 'team')} · {plural(all.length, 'console')} · {counts.working} working
            </div>
          </div>
          <button className="icon-btn" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <div className="mm">
          <div className="mm-main">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="seg">
                {(
                  [
                    ['all', 'All', null],
                    ['working', 'Working', 'var(--working)'],
                    ['needs', 'Needs you', 'var(--needs)'],
                    ['idle', 'Idle', 'var(--idle)'],
                    ['done', 'Done', 'var(--done)'],
                  ] as const
                ).map(([k, label, color]) => (
                  <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
                    {color && <span className="dot" style={{ background: filter === k ? '#fff' : color, width: 6, height: 6 }} />}
                    {label} <span className="n">{counts[k]}</span>
                  </button>
                ))}
              </div>
              <span className="spacer" />
              <div className="search">
                <Search size={14} />
                <input placeholder="Find a console or team" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>

            <div className="nowheel" style={{ overflow: 'auto', flex: 1, maxHeight: 'calc(100vh - 380px)' }}>
              <div className="mm-graph" ref={graphRef} style={{ height }} onClick={(e) => e.target === e.currentTarget && setSel(null)}>
                <svg>
                  {layout.flatMap(({ sec, singleY, teamRows, teamY, headY }) => {
                    const dashed = sec.kind === 'center'
                    const hy = headY + CARD_H / 2
                    return [
                      ...sec.singles.map((m, i) => wire(`${sec.id}-${m.id}`, curve(headW, hy, xConsole, singleY[i] + CARD_H / 2), dashed, !matches(m))),
                      ...sec.teams.map((t, ti) => wire(`${sec.id}-${t.id}`, curve(headW, hy, xTeam, teamY[ti] + CARD_H / 2), dashed)),
                      ...sec.teams.flatMap((t, ti) =>
                        t.members.map((m, mi) => wire(`${t.id}-${m.id}`, curve(xTeam + teamW, teamY[ti] + CARD_H / 2, xConsole, teamRows[ti][mi] + CARD_H / 2), dashed, !matches(m))),
                      ),
                    ]
                  })}
                </svg>

                {layout.map(({ sec, headY }) => {
                  const agents = agentsOf(sec)
                  return (
                    <button
                      key={sec.id}
                      className={`mm-card ${isSel('section', sec.id) ? 'sel' : ''}`}
                      style={{ left: 0, top: headY, width: headW }}
                      onClick={() => setSel({ kind: 'section', id: sec.id })}
                      onDoubleClick={() => jump(sec.kind === 'orch' ? [sec.id] : agents.map((m) => m.id))}
                    >
                      {sec.kind === 'orch' ? <span className="orb sm" /> : <Command size={14} color="var(--muted)" />}
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <div className="t">{sec.label}</div>
                        <div className="s ellipsis">
                          {sec.kind === 'orch'
                            ? `${plural(agents.length, 'agent')} · ${sec.teams.length === 1 ? 'Team' : plural(sec.teams.length, 'team')}`
                            : `${agents.length} only reachable from the command bar`}
                        </div>
                      </span>
                      {sec.kind === 'orch' && agents.length > 0 && (
                        <span className="s ring-n">
                          <Ring part={doneIn(agents)} of={agents.length} />
                          {doneIn(agents)}/{agents.length}
                        </span>
                      )}
                    </button>
                  )
                })}

                {layout.flatMap(({ sec, teamY }) =>
                  sec.teams.map((t, ti) => {
                    const busy = workingIn(t.members)
                    return (
                      <button
                        key={t.id}
                        className={`mm-card team ${isSel('team', t.id) ? 'sel' : ''}`}
                        style={{ left: xTeam, top: teamY[ti], width: teamW }}
                        onClick={() => setSel({ kind: 'team', id: t.id })}
                        onDoubleClick={() => jump([t.id])}
                      >
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <div className="t">
                            <span className="dot" style={{ background: t.color, width: 6, height: 6 }} /> {t.label}
                          </div>
                          <div className="s">{busy ? `${busy} working` : `${t.members.length} idle`}</div>
                          <div className="bar">
                            <i style={{ width: `${t.members.length ? (busy / t.members.length) * 100 : 0}%` }} />
                          </div>
                        </span>
                        <span className="s">{t.members.length}</span>
                        <Users size={12} color="var(--faint)" />
                      </button>
                    )
                  }),
                )}

                {layout.flatMap(({ sec, singleY, teamRows }) => [
                  ...sec.singles.map((m, i) => consoleCard(m, singleY[i])),
                  ...sec.teams.flatMap((t, ti) => t.members.map((m, mi) => consoleCard(m, teamRows[ti][mi]))),
                ])}
                {!all.length && <div className="menu-hint" style={{ position: 'absolute', left: xTeam, top: 20 }}>No consoles on this workspace yet</div>}
              </div>
            </div>

            <div className="mm-legend">
              {(['working', 'needs', 'idle', 'done'] as const).map((k) => (
                <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span className="dot" style={{ background: STATUS_COLOR[k], width: 6, height: 6 }} /> {k === 'needs' ? 'Needs you' : k[0].toUpperCase() + k.slice(1)}
                </span>
              ))}
              <span>- - - Command bar only</span>
              <span className="spacer" />
              <span style={{ color: 'var(--faint)' }}>Click to inspect · Double-click to jump there</span>
            </div>
          </div>

          <div className="mm-side">
            {picked ? (
              <ConsoleDetail
                node={picked}
                status={statusOf(picked.id)}
                team={pickedTeamOf(picked, sections)}
                section={sectionOf(picked.id)}
                onTeam={(id) => setSel({ kind: 'team', id })}
                onSection={(id) => setSel({ kind: 'section', id })}
                onJump={() => jump([picked.id])}
              />
            ) : pickedTeam ? (
              <>
                <SideHead icon={<Users size={21} />} title={pickedTeam.t.label} sub={plural(pickedTeam.t.members.length, 'console')} tint="green" />
                <button className="btn primary wide" onClick={() => jump([pickedTeam.t.id])}>
                  <Crosshair size={15} /> Frame the team on the board
                </button>
                <div className="section-label">Members</div>
                <MemberList members={pickedTeam.t.members} statusOf={statusOf} onPick={(id) => setSel({ kind: 'console', id })} />
                <div className="section-label">Commanded by</div>
                <div className="list-box">
                  <SectionRow section={pickedTeam.s} onPick={() => setSel({ kind: 'section', id: pickedTeam.s.id })} />
                </div>
              </>
            ) : pickedSection ? (
              <>
                <SideHead
                  icon={pickedSection.kind === 'orch' ? <span className="orb" style={{ width: 26, height: 26 }} /> : <Command size={20} />}
                  title={pickedSection.label}
                  sub={pickedSection.kind === 'orch' ? `${plural(agentsOf(pickedSection).length, 'agent')} · ${plural(pickedSection.teams.length, 'team')}` : plural(agentsOf(pickedSection).length, 'console')}
                  tint={pickedSection.kind === 'orch' ? 'accent' : undefined}
                />
                <button className="btn primary wide" onClick={() => jump(pickedSection.kind === 'orch' ? [pickedSection.id] : agentsOf(pickedSection).map((m) => m.id))}>
                  <Crosshair size={15} /> {pickedSection.kind === 'orch' ? 'Go to the orchestrator' : 'Frame them on the board'}
                </button>
                {pickedSection.teams.length > 0 && <div className="section-label">Teams</div>}
                {pickedSection.teams.length > 0 && (
                  <div className="list-box">
                    {pickedSection.teams.map((t) => (
                      <button key={t.id} className="member" onClick={() => setSel({ kind: 'team', id: t.id })}>
                        <span className="dot" style={{ background: t.color, width: 7, height: 7 }} />
                        <span style={{ flex: 1 }}>
                          <div className="t">{t.label}</div>
                          <div className="s">
                            {plural(t.members.length, 'console')} · {workingIn(t.members)} working
                          </div>
                        </span>
                        <ChevronRight size={15} color="var(--faint)" />
                      </button>
                    ))}
                  </div>
                )}
                {pickedSection.singles.length > 0 && <div className="section-label">Consoles</div>}
                {pickedSection.singles.length > 0 && <MemberList members={pickedSection.singles} statusOf={statusOf} onPick={(id) => setSel({ kind: 'console', id })} />}
                <div className="mm-hint">
                  {pickedSection.kind === 'orch'
                    ? "Command these agents from the orchestrator's own composer, or wire more with Connect."
                    : 'Not connected to any orchestrator: the command bar reaches them one by one. Connect them to an orchestrator to command them together.'}
                </div>
              </>
            ) : (
              <>
                <div className="section-label plain">Fleet</div>
                <div className="list-box stats">
                  {(['working', 'needs', 'idle', 'done'] as const).map((k) => (
                    <div key={k} className={counts[k] ? '' : 'zero'}>
                      <span className="dot" style={{ background: STATUS_COLOR[k], width: 6, height: 6 }} />
                      {k === 'needs' ? 'Needs you' : k[0].toUpperCase() + k.slice(1)}
                      <b>{counts[k]}</b>
                    </div>
                  ))}
                </div>
                <div className="section-label plain">Structure</div>
                <div className="list-box stats">
                  {(
                    [
                      ['Orchestrators', orchestrators],
                      ['Teams', groups.length],
                      ['Consoles', all.length],
                      ['Active loops', activeLoops],
                    ] as const
                  ).map(([label, n]) => (
                    <div key={label} className={n ? '' : 'zero'}>
                      {label}
                      <b>{n}</b>
                    </div>
                  ))}
                </div>
                <div className="mm-hint">
                  Select a console, a team or a commander to see what it is doing and act on it.
                  {center && !orchestrators ? ' Add an orchestrator from the right toolbar to command teams together.' : ''}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const pickedTeamOf = (n: Node<ConsoleData>, sections: Section[]) => sections.flatMap((s) => s.teams).find((t) => t.members.some((m) => m.id === n.id))

function SectionRow({ section, note, onPick }: { section: Section; note?: string; onPick: () => void }) {
  return (
    <button className="member" onClick={onPick}>
      {section.kind === 'orch' ? <span className="orb sm" /> : <Command size={15} color="var(--muted)" />}
      <span style={{ flex: 1 }}>
        <div className="t">{section.label}</div>
        <div className="s">{note ?? (section.kind === 'orch' ? plural(agentsOf(section).length, 'agent') : 'Not connected to any orchestrator')}</div>
      </span>
      <ChevronRight size={15} color="var(--faint)" />
    </button>
  )
}

export function Ring({ part, of }: { part: number; of: number }) {
  const c = 2 * Math.PI * 5
  return (
    <svg width="13" height="13" viewBox="0 0 13 13">
      <circle cx="6.5" cy="6.5" r="5" fill="none" stroke="var(--line-2)" strokeWidth="1.6" />
      {part > 0 && <circle cx="6.5" cy="6.5" r="5" fill="none" stroke="var(--working)" strokeWidth="1.6" strokeDasharray={`${(part / of) * c} ${c}`} transform="rotate(-90 6.5 6.5)" />}
    </svg>
  )
}

function SideHead({ icon, title, sub, tint }: { icon: React.ReactNode; title: string; sub: string; tint?: 'green' | 'accent' }) {
  const colors = tint === 'green' ? ['rgba(62,207,142,.1)', '#7fcf9a'] : tint === 'accent' ? ['var(--accent-soft)', 'var(--accent)'] : ['var(--panel-3)', 'var(--text-2)']
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <span className="agent-icon" style={{ width: 44, height: 44, background: colors[0], color: colors[1] }}>
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 18 }}>{title}</div>
        <div style={{ color: 'var(--muted)' }}>{sub}</div>
      </div>
    </div>
  )
}

function MemberList({ members, statusOf, onPick }: { members: Node<ConsoleData>[]; statusOf: (id: string) => string; onPick: (id: string) => void }) {
  return (
    <div className="list-box">
      {members.map((m) => (
        <button key={m.id} className="member" onClick={() => onPick(m.id)}>
          <AgentGlyph id={m.data.agent} size={16} />
          <span style={{ flex: 1 }}>
            <div className="t">{m.data.name}</div>
            <div className="s">{STATUS_TEXT[statusOf(m.id)]}</div>
          </span>
          <span className="dot" style={{ background: STATUS_COLOR[statusOf(m.id)], width: 6, height: 6 }} />
        </button>
      ))}
    </div>
  )
}

const since = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`
}

function ConsoleDetail(props: {
  node: Node<ConsoleData>
  status: string
  team?: Team
  section?: Section
  onTeam: (id: string) => void
  onSection: (id: string) => void
  onJump: () => void
}) {
  const { node, status, team, section } = props
  const session = useStore((s) => s.live[node.id])
  const now = useNow()
  return (
    <>
      <SideHead icon={<AgentGlyph id={node.data.agent} size={22} />} title={node.data.name} sub={agentById(node.data.agent)?.name ?? node.data.agent} />
      <button className="btn primary wide" onClick={props.onJump}>
        <ArrowUpRight size={15} /> Go to the console
      </button>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <button className="btn wide" disabled={!session} onClick={() => api.signal(node.id, session?.paused ? 'SIGCONT' : 'SIGSTOP')}>
          {session?.paused ? <Play size={14} /> : <Pause size={14} />} {session?.paused ? 'Resume' : 'Pause'}
        </button>
        <button className="btn wide danger" disabled={!session} onClick={() => api.kill(node.id)}>
          <CircleX size={14} /> Kill
        </button>
      </div>
      <div className="section-label plain">Now</div>
      <div className="list-box stats">
        <div>
          <span className="dot" style={{ background: STATUS_COLOR[status], width: 6, height: 6 }} />
          Status
          <b style={{ color: status === 'working' ? 'var(--working)' : undefined, fontFamily: 'inherit' }}>{STATUS_TEXT[status]}</b>
        </div>
        <div>
          For
          <b>{session?.statusAt ? since(now - session.statusAt) : '—'}</b>
        </div>
      </div>
      <div className="section-label plain">Belongs to</div>
      <div className="list-box">
        {team && (
          <button className="member" onClick={() => props.onTeam(team.id)}>
            <span className="dot" style={{ background: team.color, width: 7, height: 7 }} />
            <span style={{ flex: 1 }}>
              <div className="t">{team.label}</div>
              <div className="s">{plural(team.members.length, 'console')}</div>
            </span>
            <ChevronRight size={15} color="var(--faint)" />
          </button>
        )}
        {section && (
          <SectionRow
            section={section}
            note={section.kind === 'orch' ? (team ? 'Through the team' : 'Connected directly') : undefined}
            onPick={() => props.onSection(section.id)}
          />
        )}
      </div>
    </>
  )
}
