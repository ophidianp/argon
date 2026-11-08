import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, ChevronLeft, ChevronUp, Mic, Minus, Plus, RotateCw, Square, X } from 'lucide-react'
import { consoles, EMPTY, useStore, workspace } from '../store'
import { AGENTS, agentById } from '../../shared/agents.js'
import { AgentGlyph, AgentIcon } from './icons'
import { command, mentionTargets } from '../planner'
import { TEAMS } from '../teams'

const ROLES: [string, string][] = [
  ['Frontend', '#f5a33d'],
  ['Backend', '#a477ff'],
  ['Testers', '#3ecf8e'],
  ['Reviewers', '#5b8cff'],
  ['Design', '#f472b6'],
  ['Docs', '#4fd1d9'],
  ['Security', '#ff5a4e'],
  ['General', '#8a847c'],
]
const FILL = ['claude', 'codex', 'gemini', 'grok', 'opencode', 'shell', 'aider', 'cursor', 'qwen', 'copilot']

const CHIPS = {
  new: ['#3ecfb2', '#f472b6'],
  spawn: ['#7fd36b', '#f0553a'],
  group: ['#d9c34a', '#8a7a3a'],
  presets: ['#f5a33d', '#5b8cff'],
  pause: ['#f0553a', '#5b8cff'],
  resume: ['#f472b6', '#3ecf8e'],
  memory: ['#a477ff', '#f5d547'],
}

function Chip({ k, label, hint, onClick, on }: { k: keyof typeof CHIPS; label: string; hint: string; onClick: () => void; on?: boolean }) {
  const [a, b] = CHIPS[k]
  return (
    <button className={`chip ${on ? 'on' : ''}`} style={{ ['--a' as string]: a, ['--b' as string]: b }} title={hint} onClick={onClick}>
      {label}
    </button>
  )
}

// Several things selected: what can be done with them, in plain sight.
function SelectionBar() {
  const count = useStore((s) => workspace(s)?.nodes.filter((n) => n.selected).length ?? 0)
  if (count < 2) return null
  const s = useStore.getState()
  return (
    <div className="selection-bar" style={{ marginBottom: 8 }}>
      {count} selected
      <kbd>⌫ closes them</kbd>
      <button className="btn" onClick={() => s.groupSelected()}>
        Group
      </button>
      <button className="btn" onClick={() => s.deleteSelected()}>
        Close
      </button>
    </div>
  )
}

export function BottomBar() {
  const modal = useStore((s) => s.modal)
  const defaultAgent = useStore((s) => s.settings.defaultAgent)
  const [composer, setComposer] = useState(false)
  const anyPaused = useStore((st) => consoles(workspace(st)?.nodes ?? []).some((n) => st.live[n.id]?.paused))
  const s = useStore.getState()

  return (
    <div className="bottom">
      <div style={{ position: 'relative' }}>
        {composer && <Composer onClose={() => setComposer(false)} />}
        {modal === 'presets' && <Presets />}
        <SelectionBar />
        <div className="chips">
          <Chip k="new" label="New agent" hint="Start one more agent" onClick={() => s.addConsole(defaultAgent, s.viewCenter())} />
          <Chip k="spawn" label="4 agents" hint="Start four agents at once" onClick={() => s.spawnMany(Array(4).fill(defaultAgent))} />
          <Chip
            k="group"
            label="Group"
            hint="Put the selected agents in a group, or start a new one. You can also drag one terminal onto another"
            on={composer}
            onClick={() => {
              const selected = consoles(workspace(useStore.getState())?.nodes ?? []).filter((n) => n.selected && !n.parentId)
              if (selected.length) s.groupSelected()
              else setComposer((v) => !v)
            }}
          />
          <Chip k="presets" label="Presets" hint="Ready-made teams, such as plan, build and review" on={modal === 'presets'} onClick={() => s.set({ modal: modal === 'presets' ? null : 'presets' })} />
          {anyPaused ? (
            <Chip k="resume" label="Resume all" hint="Let every frozen agent continue" onClick={s.resumeAll} />
          ) : (
            <Chip k="pause" label="Pause all" hint="Freeze every agent on this board" onClick={s.pauseAll} />
          )}
          <Chip k="memory" label="Context" hint="How full your agents are, what they should know, and connected folders such as a second brain" onClick={() => s.set({ modal: 'memory' })} />
        </div>
      </div>
      <CommandBar />
    </div>
  )
}

// The group composer. From the right-click menu it lands where you clicked and has a way back.
export function Composer({ onClose, onBack, at }: { onClose: () => void; onBack?: () => void; at?: { x: number; y: number } }) {
  const defaultAgent = useStore((s) => s.settings.defaultAgent)
  const [name, setName] = useState('Team')
  const [role, setRole] = useState('General')
  const [slots, setSlots] = useState<string[]>(Array(4).fill(defaultAgent))
  const [more, setMore] = useState(false)
  const resize = (n: number) => setSlots((cur) => Array.from({ length: Math.max(1, Math.min(12, n)) }, (_, i) => cur[i] ?? cur[cur.length - 1] ?? defaultAgent))
  const cycle = (i: number) => setSlots((cur) => cur.map((a, k) => (k === i ? FILL[(FILL.indexOf(a) + 1) % FILL.length] : a)))
  const roleColor = ROLES.find((r) => r[0] === role)?.[1] ?? '#8a847c'

  return (
    <div className="menu composer nowheel">
      {onBack && (
        <button className="composer-back" onClick={onBack}>
          <ChevronLeft size={15} /> Compose group
        </button>
      )}
      <div className="name">
        <span className="dot" style={{ background: roleColor }} />
        <input value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
        <button className="icon-btn sm" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="roles">
        {ROLES.map(([r, c]) => (
          <button
            key={r}
            className={role === r ? 'on' : ''}
            onClick={() => {
              setRole(r)
              if (name === 'Team' || ROLES.some(([x]) => x === name)) setName(r)
            }}
          >
            <span className="dot" style={{ background: c, width: 7, height: 7 }} />
            {r}
          </button>
        ))}
      </div>
      <div className="slots">
        {slots.map((a, i) => (
          <button key={i} className="slot" style={{ ['--c' as string]: agentById(a)?.color }} onClick={() => cycle(i)} title="Click to change agent">
            <AgentIcon id={a} size={36} />
            {agentById(a)?.name}
          </button>
        ))}
      </div>
      <div className="fill-row">
        Fill all
        {(more ? AGENTS.map((a) => a.id) : FILL).map((id) => (
          <button key={id} title={agentById(id)?.name} onClick={() => setSlots((cur) => cur.map(() => id))}>
            <AgentGlyph id={id} size={20} />
          </button>
        ))}
        {!more && (
          <button className="round-btn" style={{ width: 28, height: 28 }} onClick={() => setMore(true)}>
            <Plus size={14} />
          </button>
        )}
      </div>
      <div className="composer-foot">
        <button className="icon-btn" onClick={() => resize(slots.length - 1)}>
          <Minus size={16} />
        </button>
        <span style={{ minWidth: 22, textAlign: 'center' }}>{slots.length}</span>
        <button className="icon-btn" onClick={() => resize(slots.length + 1)} disabled={slots.length >= 12}>
          <Plus size={16} />
        </button>
        <button
          className="spawn-btn"
          onClick={() => {
            useStore.getState().spawnMany(slots, name.trim() || role, undefined, at)
            onClose()
          }}
        >
          Start {slots.length} agent{slots.length === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  )
}

function Presets() {
  const presets = useStore((s) => s.presets)
  const [naming, setNaming] = useState<string | null>(null)
  const s = useStore.getState()
  const selectedAgents = () => consoles(workspace(useStore.getState())?.nodes ?? []).filter((n) => n.selected).map((n) => n.data.agent)
  return (
    <div className="menu nowheel" style={{ bottom: 'calc(100% + 16px)', left: '50%', transform: 'translateX(-50%)', width: 400, maxHeight: '70vh', overflow: 'auto' }}>
      <button className="icon-btn sm menu-close" title="Close" onClick={() => useStore.getState().set({ modal: null })}>
        <X size={14} />
      </button>
      <div className="menu-title">Teams</div>
      {TEAMS.map((t) => (
        <button
          key={t.id}
          className="menu-item"
          onClick={() => {
            s.spawnTeam(t)
            s.set({ modal: null })
          }}
        >
          <span style={{ flex: 1 }}>
            <div className="title" style={{ fontSize: 14 }}>
              {t.name}
            </div>
            <div className="sub">{t.description}</div>
            <div className="team-flow">{t.members.map((m) => m.name).join('  →  ')}</div>
          </span>
        </button>
      ))}
      <div className="menu-title" style={{ marginTop: 10 }}>
        Presets
      </div>
      {presets.map((p) => (
        <button
          key={p.id}
          className="menu-item"
          onClick={() => {
            s.spawnMany(p.agents, p.label)
            s.set({ modal: null })
          }}
        >
          <span style={{ display: 'flex', gap: 3 }}>
            {p.agents.slice(0, 5).map((a, i) => (
              <AgentIcon key={i} id={a} size={24} />
            ))}
          </span>
          <span style={{ flex: 1 }}>
            <div className="title" style={{ fontSize: 14 }}>
              {p.name}
            </div>
            <div className="sub">
              {p.agents.length} console{p.agents.length > 1 ? 's' : ''}
              {p.label ? ` · group "${p.label}"` : ''}
            </div>
          </span>
        </button>
      ))}
      {naming === null ? (
        <button
          className="menu-item"
          onClick={() => (selectedAgents().length ? setNaming('') : s.notify('Select consoles to save them as a preset'))}
        >
          <Plus size={16} color="var(--accent)" style={{ margin: '0 4px' }} />
          <span className="title" style={{ fontSize: 14 }}>
            Save selection as preset
          </span>
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 8, padding: 8 }}>
          <input className="field" autoFocus placeholder="Preset name" value={naming} onChange={(e) => setNaming(e.target.value)} />
          <button
            className="btn primary"
            onClick={() => {
              if (naming.trim()) s.savePreset({ name: naming.trim(), agents: selectedAgents() })
              setNaming(null)
            }}
          >
            Save
          </button>
        </div>
      )}
    </div>
  )
}

type Recognition = { start: () => void; stop: () => void; onresult: (e: any) => void; onend: () => void; onerror: (e: { error: string }) => void; interimResults: boolean; continuous: boolean; lang: string }

// Browser dictation into a text field: what is said is appended to what was typed.
// start() says whether dictation began (it is missing in some browsers).
export function useDictation(text: string, setText: (t: string) => void) {
  const [listening, setListening] = useState(false)
  const recRef = useRef<Recognition | null>(null)
  const start = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      useStore.getState().notify('Dictation is not available in this browser')
      return false
    }
    const rec: Recognition = new SR()
    rec.interimResults = true
    rec.continuous = true
    rec.lang = navigator.language
    const base = text ? `${text} ` : ''
    rec.onresult = (e) => setText(base + [...e.results].map((r: any) => r[0].transcript).join(''))
    rec.onend = () => setListening(false)
    // The desktop app has no access to the browser's speech service: the Mac's own dictation works in any field.
    rec.onerror = (e: { error: string }) => {
      setListening(false)
      if (e.error === 'no-speech' || e.error === 'aborted') return
      const why = e.error === 'not-allowed' ? 'The microphone is not allowed for vibeboard.' : 'Dictation is not available here.'
      useStore.getState().notify(`${why} Use the Mac's own dictation instead: press the fn key twice in any text field.`)
    }
    rec.start()
    recRef.current = rec
    setListening(true)
    return true
  }
  const stop = () => {
    recRef.current?.stop()
    setListening(false)
  }
  return { listening, start, stop, recRef }
}

function CommandBar() {
  const nodes = useStore((s) => workspace(s)?.nodes ?? EMPTY)
  const [text, setText] = useState('')
  const [mention, setMention] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fromVoice = useRef(false)
  const { listening, start, stop, recRef } = useDictation(text, setText)
  const targets = useMemo(() => mentionTargets(), [nodes])

  const startVoice = () => {
    fromVoice.current = start()
  }
  const stopVoice = () => {
    stop()
    inputRef.current?.focus()
  }

  // Hold space anywhere on the board (not while typing) to dictate. Dictation only types: Enter is yours.
  useEffect(() => {
    const busyTarget = (e: KeyboardEvent) => (e.target as HTMLElement).closest('input, textarea, [contenteditable], .xterm')
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !busyTarget(e) && !useStore.getState().modal) {
        e.preventDefault()
        // A focused chip would also "click" on space; drop its focus first.
        if ((e.target as HTMLElement).closest('button')) (e.target as HTMLElement).blur()
        startVoice()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && recRef.current && listening) stopVoice()
    }
    addEventListener('keydown', down)
    addEventListener('keyup', up)
    return () => {
      removeEventListener('keydown', down)
      removeEventListener('keyup', up)
    }
  })

  const say = (msg: string) => {
    setReply(msg)
    setTimeout(() => setReply((r) => (r === msg ? null : r)), 6000)
    if (fromVoice.current && useStore.getState().settings.speak !== false && 'speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(msg))
  }

  const submit = async () => {
    const raw = text.trim()
    if (!raw || busy) return
    setHistory((h) => [raw, ...h.filter((x) => x !== raw)].slice(0, 20))
    setText('')
    setMention(null)
    setBusy(true)
    try {
      say(await command(raw))
    } catch (e) {
      say(`Planner failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
    fromVoice.current = false
  }

  const candidates = mention === null ? [] : targets.filter((t) => t.name.toLowerCase().startsWith(mention.toLowerCase())).slice(0, 8)
  const pickMention = (name: string) => {
    setText((t) => t.replace(/@[^@\n]*$/, `@${name} `))
    setMention(null)
    inputRef.current?.focus()
  }

  return (
    <div className={`commandbar ${listening ? 'listening' : ''}`}>
      {candidates.length > 0 && (
        <div className="menu mentions">
          {candidates.map((c) => (
            <button key={c.name} className="menu-item" onMouseDown={(e) => (e.preventDefault(), pickMention(c.name))}>
              {c.agent ? <AgentIcon id={c.agent} size={24} /> : <span className="agent-icon" style={{ width: 24, height: 24, background: 'var(--panel-3)' }}>@</span>}
              <span className="title" style={{ fontSize: 14 }}>
                {c.name}
              </span>
              <span className="sub">{c.ids.length > 1 || !c.agent ? `${c.ids.length} consoles` : ''}</span>
            </button>
          ))}
        </div>
      )}
      {showHistory && history.length > 0 && (
        <div className="menu mentions" style={{ left: 'auto', right: 0, width: 360 }}>
          <div className="menu-title">Recent</div>
          {history.map((h) => (
            <button
              key={h}
              className="menu-item"
              onClick={() => {
                setText(h)
                setShowHistory(false)
                inputRef.current?.focus()
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h}</span>
            </button>
          ))}
        </div>
      )}
      <div className="orb" />
      {listening && !text ? (
        <div className="listening-label" style={{ flex: 1 }}>
          <span className="dot" style={{ background: 'var(--accent)', width: 10, height: 10 }} /> listening
          <span className="bars">
            <i />
            <i />
            <i />
            <i />
          </span>
        </div>
      ) : (
        <input
          ref={inputRef}
          value={text}
          placeholder={busy ? 'Planning…' : 'Ask your agents · @ to pick one · hold space to talk'}
          onChange={(e) => {
            setText(e.target.value)
            const m = e.target.value.slice(0, e.target.selectionStart ?? undefined).match(/@([^@\n]*)$/)
            setMention(m ? m[1] : null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') setMention(null)
            if (e.key === 'Tab' && candidates[0]) {
              e.preventDefault()
              pickMention(candidates[0].name)
            }
          }}
        />
      )}
      {busy && <RotateCw size={16} color="var(--muted)" style={{ animation: 'spin 1s linear infinite' }} />}
      <button className="round-btn" title="Recent commands" onClick={() => setShowHistory((v) => !v)}>
        <ChevronUp size={17} />
      </button>
      <button className="round-btn" title="Send to your agents" onClick={submit}>
        <ArrowUp size={16} />
      </button>
      <button className={`round-btn ${listening ? 'hot' : ''}`} title="Dictate instead of typing (or hold space)" onClick={() => (listening ? stopVoice() : startVoice())}>
        {listening ? <Square size={13} fill="currentColor" /> : <Mic size={16} />}
      </button>
      {reply && (
        <div className="hint-chip" style={{ position: 'absolute', top: -34, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', color: 'var(--text-2)' }}>
          {reply}
        </div>
      )}
    </div>
  )
}
