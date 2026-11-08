import { memo, useState } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { Brain, Check, Info, Maximize2, PanelTop, Pencil, Pin, Plus, ScanSearch, Send, Trash2, X } from 'lucide-react'
import { api, type Fact, type Scan } from '../api'
import { useShallow } from 'zustand/react/shallow'
import { project, useStore, workspace, type Memory } from '../store'
import { agentById } from '../../shared/agents.js'
import { AgentIcon } from './icons'
import { useNow } from './LoopsModal'
import { AgentsTab, FoldersTab } from './ContextPanel'

const KINDS = ['Context', 'Architecture', 'Structure', 'Commands', 'Conventions', 'Gotchas']
const KIND_COLORS: Record<string, string> = {
  Context: '#6ea8fe',
  Architecture: '#a78bfa',
  Structure: '#34d399',
  Commands: '#f59e0b',
  Conventions: '#f472b6',
  Gotchas: '#f87171',
}
const SCANNERS = ['claude', 'codex', 'gemini', 'grok', 'opencode']
const STEPS = ['Launch', 'Read the repo', 'Write facts', 'Wrap up']
const agentName = (id: string) => agentById(id)?.name ?? id
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`

// Memories never reach a console on their own: they are typed in only when pushed from a card.
const asPrompt = (list: Memory[]) => `Project memory, keep this in mind:\n${list.map((m) => `- [${m.kind}] ${m.title}: ${m.text}`).join('\n')}`

export function MemoryModal() {
  const p = useStore(project)!
  const projects = useStore((s) => s.projects)
  const scan = useStore((s) => s.scans.find((x) => x.cwd === p.path))
  const [section, setSection] = useState<'agents' | 'memory' | 'folders'>(scan ? 'memory' : 'agents')
  const [tab, setTab] = useState<'repo' | 'all'>('repo')
  const [editing, setEditing] = useState<Memory | 'new' | null>(null)
  const [picking, setPicking] = useState(false)
  const [kind, setKind] = useState<string | null>(null)
  const s = useStore.getState()
  const close = () => s.set({ modal: null })
  const all = tab === 'repo' ? p.memories : projects.flatMap((x) => x.memories)
  const list = kind ? all.filter((m) => m.kind === kind) : all
  const kinds = KINDS.filter((k) => all.some((m) => m.kind === k))
  const active = p.memories.filter((m) => m.enabled)
  const listing = section === 'memory' && !scan && !picking
  const inMemory = section === 'memory'

  const start = async (agent: string) => {
    try {
      await api.scan(p.path, agent)
      setPicking(false)
    } catch (e) {
      s.notify(`Scan failed: ${(e as Error).message}`)
    }
  }
  const placeCard = () => {
    const c = s.viewCenter()
    s.addNode({ id: `m-${crypto.randomUUID().slice(0, 8)}`, type: 'memory', position: { x: c.x - 160, y: c.y - 120 }, style: { width: 320 }, data: {} })
    close()
    s.notify('Memory card placed — drag its dot onto the consoles it should feed')
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal narrow memory-modal">
        <div className="modal-head">
          <span className="ico">
            <Brain size={20} />
          </span>
          <div style={{ flex: 1 }}>
            <h2>Context</h2>
            <div className="sub">What your agents have in mind, what they should know, and what they can reach.</div>
          </div>
          {listing && list.length > 0 && tab === 'repo' && (
            <>
              <button className="btn ghost" onClick={() => setPicking(true)}>
                <ScanSearch size={15} /> Scan repo
              </button>
              <button className="btn primary" onClick={() => setEditing('new')}>
                <Plus size={15} /> New memory
              </button>
            </>
          )}
          <button className="icon-btn" onClick={close}>
            <X size={18} />
          </button>
        </div>

        <div className="context-tabs">
          <div className="seg">
            <button className={section === 'agents' ? 'on' : ''} onClick={() => setSection('agents')}>
              Agents
            </button>
            <button className={section === 'memory' ? 'on' : ''} onClick={() => setSection('memory')}>
              Memory <span className="n">{p.memories.length}</span>
            </button>
            <button className={section === 'folders' ? 'on' : ''} onClick={() => setSection('folders')}>
              Folders <span className="n">{p.folders?.length ?? 0}</span>
            </button>
          </div>
        </div>

        {section === 'agents' && <AgentsTab />}
        {section === 'folders' && <FoldersTab />}

        {inMemory && picking && !scan && <ScanPicker onCancel={() => setPicking(false)} onStart={start} />}
        {inMemory && scan?.status === 'running' && <ScanProgress scan={scan} />}
        {inMemory && scan?.status === 'done' && <Review key={scan.id} scan={scan} />}
        {inMemory && scan?.status === 'failed' && <ScanFailed scan={scan} onRetry={() => api.clearScan(p.path).then(() => start(scan.agent))} />}

        {listing && (
          <>
            <div className="memory-filters">
              <button className={`mem-filter ${tab === 'repo' ? 'on' : ''}`} onClick={() => setTab('repo')}>
                {p.name} <span>{p.memories.length}</span>
              </button>
              <button className={`mem-filter ${tab === 'all' ? 'on' : ''}`} onClick={() => setTab('all')}>
                All repos <span>{projects.reduce((n, x) => n + x.memories.length, 0)}</span>
              </button>
              {kinds.length > 1 && <i className="sep" />}
              {kinds.length > 1 &&
                kinds.map((k) => (
                  <button key={k} className={`mem-filter ${kind === k ? 'on' : ''}`} onClick={() => setKind(kind === k ? null : k)}>
                    <i style={{ background: KIND_COLORS[k] }} /> {k}
                  </button>
                ))}
            </div>
            <div className="modal-body nowheel">
              {!list.length && !editing ? (
                <div className="memory-empty">
                  <Brain size={30} strokeWidth={1.6} />
                  <b>No memory yet</b>
                  <span>Scan the repo with a CLI, or write the first fact yourself.</span>
                  {tab === 'repo' && (
                    <div className="row">
                      <button className="btn primary" onClick={() => setPicking(true)}>
                        <ScanSearch size={15} /> Scan repo
                      </button>
                      <button className="btn ghost" onClick={() => setEditing('new')}>
                        <Plus size={15} /> Write memory
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="memory-list">
                  {editing === 'new' && <MemoryEditor initial={null} onDone={() => setEditing(null)} />}
                  {list.map((m) =>
                    editing !== 'new' && editing?.id === m.id ? (
                      <MemoryEditor key={m.id} initial={m} onDone={() => setEditing(null)} />
                    ) : (
                      <div className={`memory ${m.enabled ? '' : 'off'}`} key={m.id}>
                        <FactHead kind={m.kind} title={m.title} scanned={m.scanned} />
                        <div className="body">{m.text}</div>
                        {tab === 'repo' && (
                          <div className="acts">
                            <button className="icon-btn sm hover-only" title="Edit" onClick={() => setEditing(m)}>
                              <Pencil size={13} />
                            </button>
                            <button className="icon-btn sm hover-only" title="Delete" onClick={() => s.removeMemory(m.id)}>
                              <Trash2 size={13} />
                            </button>
                            <button className={`check ${m.enabled ? 'on' : ''}`} title={m.enabled ? 'Active: pushed from memory cards' : 'Inactive'} onClick={() => s.updateMemory(m.id, { enabled: !m.enabled })}>
                              <Check size={13} strokeWidth={3} />
                            </button>
                          </div>
                        )}
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>
            <div className="memory-foot">
              <Pin size={13} />
              {active.length} active entr{active.length === 1 ? 'y' : 'ies'} — consoles launch clean; Push from a wired memory card to deliver.
              <span className="spacer" />
              <button className="btn" onClick={placeCard}>
                <PanelTop size={14} /> Place card on board
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function FactHead({ kind, title, scanned }: { kind: string; title: string; scanned?: boolean }) {
  return (
    <div className="head">
      <span className="kind">
        <i style={{ background: KIND_COLORS[kind] ?? 'var(--muted)' }} />
        {kind}
      </span>
      {scanned && <span className="scanned">scanned</span>}
      <span className="t">{title}</span>
    </div>
  )
}

function ScanPicker({ onCancel, onStart }: { onCancel: () => void; onStart: (agent: string) => void }) {
  const installed = useStore((s) => s.installed)
  const [agent, setAgent] = useState(installed.includes('claude') ? 'claude' : (SCANNERS.find((a) => installed.includes(a)) ?? 'claude'))
  return (
    <>
      <div className="modal-body nowheel scan-pick">
        <div className="section-label">Scan this repository</div>
        <p>
          A one-off {agentName(agent)} session looks at what it can see of the project — the file tree, the README, the docs and any context file — and proposes memory
          entries. Nothing is saved until you accept them.
        </p>
        <div className="tpl-chips">
          {SCANNERS.map((a) => (
            <button key={a} className={agent === a ? 'on' : ''} disabled={!installed.includes(a)} title={installed.includes(a) ? undefined : `${agentName(a)} is not installed`} onClick={() => setAgent(a)}>
              <AgentIcon id={a} size={16} /> {agentName(a)}
            </button>
          ))}
        </div>
      </div>
      <div className="loop-foot">
        <span className="spacer" />
        <button className="btn ghost-plain" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => onStart(agent)}>
          Scan with {agentName(agent)}
        </button>
      </div>
    </>
  )
}

function ScanProgress({ scan }: { scan: Scan }) {
  const now = useNow()
  const name = agentName(scan.agent)
  return (
    <>
      <div className="scan-run">
        <span className="pulse">
          <AgentIcon id={scan.agent} size={26} />
        </span>
        <div style={{ flex: 1 }}>
          <div className="t">
            Scanning with {name} <span className="time">{clock(now - scan.startedAt)}</span>
          </div>
          <div className="s">{scan.step === 0 ? `Starting a one-off ${name} session in the repo folder.` : `Facts land here as ${name} writes them.`}</div>
          <div className="hint">Usually under two minutes.</div>
        </div>
        {scan.facts.length > 0 && <span className="facts-n">{scan.facts.length} facts</span>}
        <button className="btn" onClick={() => api.clearScan(scan.cwd)}>
          Cancel
        </button>
      </div>
      <div className="scan-steps">
        {STEPS.map((label, i) => (
          <span key={label} className={i < scan.step ? 'done' : i === scan.step ? 'now' : ''}>
            {i > 0 && <i className="dash" />}
            <span className="mark">{i < scan.step && <Check size={10} strokeWidth={3.5} />}</span>
            {label}
          </span>
        ))}
      </div>
      <div className="modal-body nowheel">
        <div className="memory-list">
          {scan.facts.map((f, i) => (
            <div className="memory landed" key={i}>
              <FactHead kind={f.kind} title={f.title} />
              <div className="body">{f.text}</div>
            </div>
          ))}
          {!scan.facts.length && [0, 1, 2, 3, 4].map((i) => <div className="memory ghost" key={i} />)}
        </div>
      </div>
      <div className="memory-foot">
        <Info size={13} />
        {scan.facts.length ? 'You can close this panel. The scan keeps running and the results wait here.' : 'Nothing is saved until you accept the proposals.'}
      </div>
    </>
  )
}

function Review({ scan }: { scan: Scan }) {
  const [facts, setFacts] = useState<Fact[]>(scan.facts)
  const [picked, setPicked] = useState(() => new Set(scan.facts.map((_, i) => i)))
  const [editing, setEditing] = useState<number | null>(null)
  const toggle = (i: number) =>
    setPicked((cur) => {
      const next = new Set(cur)
      if (!next.delete(i)) next.add(i)
      return next
    })
  const accept = () => {
    const s = useStore.getState()
    facts.forEach((f, i) => picked.has(i) && s.addMemory({ ...f, enabled: true, scanned: true }))
    s.notify(`Added ${picked.size} memor${picked.size === 1 ? 'y' : 'ies'}`)
    api.clearScan(scan.cwd)
  }
  return (
    <>
      <div className="review-head">
        <div>
          <span className="section-label">Review proposals</span>
          <span className="of">
            {picked.size} of {facts.length} selected
          </span>
        </div>
        <div className="s">Keep what’s true — accepted entries join this repo’s memory.</div>
      </div>
      <div className="modal-body nowheel">
        <div className="memory-list">
          {facts.map((f, i) =>
            editing === i ? (
              <MemoryEditor
                key={i}
                initial={f}
                onDone={(next) => {
                  if (next) setFacts((cur) => cur.map((x, j) => (j === i ? next : x)))
                  setEditing(null)
                }}
              />
            ) : (
              <div className={`memory pick ${picked.has(i) ? '' : 'off'}`} key={i}>
                <button className={`check ${picked.has(i) ? 'on' : ''}`} onClick={() => toggle(i)}>
                  <Check size={13} strokeWidth={3} />
                </button>
                <FactHead kind={f.kind} title={f.title} />
                <div className="body">{f.text}</div>
                <div className="acts">
                  <button className="icon-btn sm" title="Edit" onClick={() => setEditing(i)}>
                    <Pencil size={13} />
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      </div>
      <div className="loop-foot">
        <span className="spacer" />
        <button className="btn ghost-plain" onClick={() => api.clearScan(scan.cwd)}>
          Discard
        </button>
        <button className="btn primary" disabled={!picked.size} onClick={accept}>
          Add {picked.size} to memory
        </button>
      </div>
    </>
  )
}

function ScanFailed({ scan, onRetry }: { scan: Scan; onRetry: () => void }) {
  return (
    <>
      <div className="modal-body scan-pick">
        <div className="section-label">Scan failed</div>
        <p className="error-text">{scan.error}</p>
      </div>
      <div className="loop-foot">
        <span className="spacer" />
        <button className="btn ghost-plain" onClick={() => api.clearScan(scan.cwd)}>
          Discard
        </button>
        <button className="btn primary" onClick={onRetry}>
          Try again
        </button>
      </div>
    </>
  )
}

// Edits a saved memory (initial has an id), a scan proposal (no id) or writes a new one (null).
function MemoryEditor({ initial, onDone }: { initial: Memory | Fact | null; onDone: (fact?: Fact) => void }) {
  const [kind, setKind] = useState(initial?.kind ?? 'Context')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [text, setText] = useState(initial?.text ?? '')
  const save = () => {
    if (!title.trim() || !text.trim()) return
    const fact = { kind, title: title.trim(), text: text.trim() }
    const s = useStore.getState()
    if (initial && 'id' in initial) s.updateMemory(initial.id, fact)
    else if (!initial) s.addMemory({ ...fact, enabled: true })
    onDone(fact)
  }
  return (
    <div className="memory" style={{ gridTemplateColumns: '1fr', gap: 10, borderColor: 'var(--accent)' }}>
      <div className="pills">
        {KINDS.map((k) => (
          <button key={k} className={kind === k ? 'on' : ''} style={{ height: 30, fontSize: 13 }} onClick={() => setKind(k)}>
            {k}
          </button>
        ))}
      </div>
      <input className="field" placeholder="Title, e.g. Where things live" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <textarea className="field" placeholder="What the agent should know" value={text} onChange={(e) => setText(e.target.value)} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn" onClick={() => onDone()}>
          Cancel
        </button>
        <button className="btn primary" onClick={save}>
          Save
        </button>
      </div>
    </div>
  )
}

// A memory card on the board: wire it to consoles, then Push types the active entries into them.
function MemoryCardImpl({ id }: NodeProps<Node>) {
  const p = useStore(project)
  const targets = useStore(useShallow((s) => workspace(s)?.edges.filter((e) => e.source === id && e.type === 'memory').map((e) => e.target) ?? []))
  const active = p?.memories.filter((m) => m.enabled) ?? []
  const push = () => {
    const s = useStore.getState()
    const sent = s.sendTo(targets, asPrompt(active))
    s.notify(sent ? `Pushed ${active.length} memor${active.length === 1 ? 'y' : 'ies'} to ${sent} console${sent === 1 ? '' : 's'}` : 'None of the wired consoles is running')
  }
  return (
    <div className="memory-card">
      <div className="mc-head">
        <Brain size={15} />
        <b>Memory</b>
        <span className="n">{active.length} active</span>
        <span className="spacer" />
        <button className="icon-btn sm nodrag" title="Open memory" onClick={() => useStore.getState().set({ modal: 'memory' })}>
          <Maximize2 size={13} />
        </button>
      </div>
      <div className="mc-list">
        {active.slice(0, 6).map((m) => (
          <div key={m.id}>
            <i style={{ background: KIND_COLORS[m.kind] ?? 'var(--muted)' }} />
            {m.title}
          </div>
        ))}
        {active.length > 6 && <div className="more">+{active.length - 6} more</div>}
        {!active.length && <div className="more">No active entries yet</div>}
      </div>
      <div className="mc-foot">
        <span>{targets.length ? `Wired to ${targets.length} console${targets.length === 1 ? '' : 's'}` : 'Drag the dot onto consoles'}</span>
        <button className="btn primary sm nodrag" disabled={!targets.length || !active.length} onClick={push}>
          <Send size={13} /> Push
        </button>
      </div>
      <Handle type="source" position={Position.Right} className="wire-handle" title="Drag onto a console to feed it this memory" />
    </div>
  )
}
export const MemoryCard = memo(MemoryCardImpl)
