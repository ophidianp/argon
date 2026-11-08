import { memo, useState } from 'react'
import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react'
import { ArrowUp, Check, ChevronUp, LayoutGrid, Mic, Plus, Plug, RotateCw, Square, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { command } from '../planner'
import { consoles, EMPTY, useStore, workspace, type ConsoleData, type GroupData } from '../store'
import { agentById } from '../../shared/agents.js'
import { AgentIcon } from './icons'
import { useDictation } from './BottomBar'
import { Ring } from './MissionMap'

// The pill an agent shows in the orchestrator: shorter words than the Mission Map uses.
const PILL: Record<string, string> = { idle: 'idle', working: 'running', needs: 'needs you', done: 'done', stopped: 'stopped', paused: 'paused' }

// Everything one orchestrator drives: the consoles wired one by one and the groups wired whole.
export function useWired(id: string) {
  const targets = useStore(useShallow((s) => workspace(s)?.edges.filter((e) => e.type === 'command' && e.source === id).map((e) => e.target) ?? []))
  const nodes = useStore((s) => workspace(s)?.nodes ?? EMPTY)
  const groups = nodes.filter((n) => n.type === 'group' && targets.includes(n.id)) as Node<GroupData>[]
  const all = consoles(nodes)
  const singles = all.filter((n) => targets.includes(n.id) && !groups.some((g) => g.id === n.parentId))
  const teams = groups.map((g) => ({ group: g, members: all.filter((n) => n.parentId === g.id) }))
  return { targets, nodes, groups, singles, teams, agents: [...singles, ...teams.flatMap((t) => t.members)] }
}

function OrchestratorNodeImpl({ id, selected, positionAbsoluteX, positionAbsoluteY, width }: NodeProps<Node>) {
  const { targets, nodes, singles, teams, agents } = useWired(id)
  const live = useStore((s) => s.live)
  const connecting = useStore((s) => s.connecting === id)
  const installed = useStore((s) => s.installed)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [spawnMenu, setSpawnMenu] = useState(false)
  const { listening, start, stop } = useDictation(text, setText)
  const statusOf = (cid: string) => (live[cid] ? (live[cid].paused ? 'paused' : live[cid].status) : 'stopped')
  const done = (list: Node<ConsoleData>[]) => list.filter((n) => statusOf(n.id) === 'done').length
  const s = useStore.getState()

  // New consoles join the orchestrator: a fresh group is wired whole, a lone console by itself.
  const wire = (ids: string[]) => {
    const ws = workspace(useStore.getState())!
    const seen = new Set<string>()
    for (const cid of ids) {
      const parent = ws.nodes.find((n) => n.id === cid)?.parentId
      const target = parent && !targets.includes(parent) ? parent : cid
      if (!seen.has(target) && !targets.includes(target)) useStore.getState().toggleWire(id, target)
      seen.add(target)
    }
  }
  const spawn = (agent: string) => {
    setSpawnMenu(false)
    const x = positionAbsoluteX + (width ?? 380) + 420
    const y = positionAbsoluteY + 220 + singles.length * 60
    const cid = s.addConsole(agent, { x, y }, undefined, undefined, false)
    s.toggleWire(id, cid)
  }
  const submit = async () => {
    const raw = text.trim()
    if (!raw || busy) return
    setHistory((h) => [raw, ...h.filter((x) => x !== raw)].slice(0, 20))
    setText('')
    setBusy(true)
    try {
      const scope = { consoles: agents.map((n) => n.id), groups: teams.map((t) => t.group.id), onSpawn: wire }
      const msg = await command(raw, scope)
      setReply(msg)
      setTimeout(() => setReply((r) => (r === msg ? null : r)), 6000)
    } catch (e) {
      setReply(`Planner failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const row = (n: Node<ConsoleData>) => (
    <div key={n.id} className="orch-agent" onDoubleClick={() => s.jumpTo(n.id)}>
      <AgentIcon id={n.data.agent} size={26} />
      <span className="who">
        <b>{n.data.name}</b>
        <small>{[n.data.role, agentById(n.data.agent)?.name ?? n.data.agent].filter(Boolean).join(' · ')}</small>
      </span>
      <span className={`pill-state ${statusOf(n.id)}`}>{PILL[statusOf(n.id)]}</span>
    </div>
  )
  const groupsOnBoard = nodes.filter((n) => n.type === 'group') as Node<GroupData>[]
  const loose = consoles(nodes).filter((n) => !n.parentId || !groupsOnBoard.some((g) => g.id === n.parentId))

  return (
    <>
      <NodeResizer isVisible={selected} minWidth={320} minHeight={300} />
      <Handle type="source" position={Position.Right} className="cmd-handle" isConnectable={false} />
      <div className={`orch ${connecting ? 'connecting' : ''}`}>
        <div className="orch-head">
          <span className="orb sm" />
          <b>Orchestrator</b>
          <span className="spacer" />
          {agents.length > 0 && (
            <span className="ring-n">
              <Ring part={done(agents)} of={agents.length} />
              {done(agents)}/{agents.length}
            </span>
          )}
          <button className="icon-btn sm nodrag" title="Remove orchestrator" onClick={() => s.removeNode(id)}>
            <X size={13} />
          </button>
        </div>
        <div className="orch-sub nodrag">
          <span>
            {agents.length ? `${agents.length} agent${agents.length === 1 ? '' : 's'} · ${teams.length} group${teams.length === 1 ? '' : 's'}` : 'No consoles connected'}
          </span>
          <span className="spacer" />
          <span style={{ position: 'relative' }}>
            <button className="icon-btn sm" title="New agent for this orchestrator" onClick={() => setSpawnMenu((v) => !v)}>
              <Plus size={14} />
            </button>
            {spawnMenu && (
              <div className="orch-menu" onMouseLeave={() => setSpawnMenu(false)}>
                {installed.map((a) => (
                  <button key={a} onClick={() => spawn(a)}>
                    <AgentIcon id={a} size={22} /> {agentById(a)?.name ?? a}
                  </button>
                ))}
              </div>
            )}
          </span>
          <button className={`orch-connect ${connecting ? 'on' : ''}`} onClick={() => s.set({ connecting: connecting ? null : id })}>
            {connecting ? (
              <>
                <Check size={13} /> Done
              </>
            ) : (
              <>
                <Plug size={13} /> Connect
              </>
            )}
          </button>
        </div>

        <div className="orch-body nodrag nowheel">
          {connecting ? (
            <>
              <p className="orch-hint">Click consoles or groups on the board, or connect them here. Tap Done when finished.</p>
              {groupsOnBoard.length > 0 && <div className="orch-label">Groups</div>}
              {groupsOnBoard.map((g) => (
                <button key={g.id} className={`orch-pick ${targets.includes(g.id) ? 'on' : ''}`} onClick={() => s.toggleWire(id, g.id)}>
                  <LayoutGrid size={13} /> {g.data.label} <small>{consoles(nodes).filter((n) => n.parentId === g.id).length}</small>
                  <span className="spacer" />
                  <span className="tick">{targets.includes(g.id) && <Check size={10} strokeWidth={3.5} />}</span>
                </button>
              ))}
              {loose.length > 0 && <div className="orch-label">Consoles</div>}
              {loose.map((n) => (
                <button key={n.id} className={`orch-pick ${targets.includes(n.id) ? 'on' : ''}`} onClick={() => s.toggleWire(id, n.id)}>
                  <AgentIcon id={n.data.agent} size={18} /> {n.data.name}
                  <span className="spacer" />
                  <span className="tick">{targets.includes(n.id) && <Check size={10} strokeWidth={3.5} />}</span>
                </button>
              ))}
              {!nodes.some((n) => n.type === 'console') && <p className="orch-hint">There are no consoles on this board yet.</p>}
            </>
          ) : !agents.length ? (
            <div className="orch-empty">
              <span className="orb lg" />
              <b>No agents wired</b>
              <span>Start a new agent below, or tap Connect and pick consoles or groups on the board.</span>
              <button className="pill-btn btn ghost" onClick={() => setSpawnMenu(true)}>
                <Plus size={14} /> Spawn agent
              </button>
            </div>
          ) : (
            <>
              {singles.map(row)}
              {teams.map((t) => (
                <div key={t.group.id} className="orch-team">
                  <div className="orch-team-head">
                    <i style={{ background: t.group.data.color }} />
                    {t.group.data.label}
                    <span className="spacer" />
                    {done(t.members)}/{t.members.length}
                  </div>
                  {t.members.map(row)}
                  {!t.members.length && <p className="orch-hint">This group is empty.</p>}
                </div>
              ))}
            </>
          )}
        </div>

        <div className="orch-foot nodrag">
          {reply && <div className="orch-reply">{reply}</div>}
          {showHistory && history.length > 0 && (
            <div className="orch-menu up">
              {history.map((h) => (
                <button key={h} onClick={() => (setText(h), setShowHistory(false))}>
                  {h}
                </button>
              ))}
            </div>
          )}
          <input
            value={text}
            placeholder={busy ? 'Planning…' : agents.length ? `Command ${agents.length} agent${agents.length === 1 ? '' : 's'} · @ to direct…` : 'Try "spawn two reviewers"…'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          {busy && <RotateCw size={14} color="var(--muted)" className="spin" />}
          <button className="round-btn sm" title="Recent commands" onClick={() => setShowHistory((v) => !v)}>
            <ChevronUp size={15} />
          </button>
          <button className={`round-btn sm ${text.trim() ? 'go' : ''}`} title="Send" onClick={submit}>
            <ArrowUp size={14} />
          </button>
          <button className={`round-btn sm ${listening ? 'hot' : ''}`} title="Dictate" onClick={() => (listening ? stop() : start())}>
            {listening ? <Square size={11} fill="currentColor" /> : <Mic size={14} />}
          </button>
        </div>
      </div>
    </>
  )
}
export const OrchestratorNode = memo(OrchestratorNodeImpl)
