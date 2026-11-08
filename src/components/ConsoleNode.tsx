import { memo, useEffect, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Check, ChevronDown, Forward, RotateCcwClock, RotateCw, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { api, ptyUrl, type Subagent } from '../api'
import { absolute, agentColor, consoles, launchCache, project, useStore, workspace, type ConsoleData } from '../store'
import { CONSOLE_SIZE, MIN_CONSOLE } from '../layout'
import { ContextChip, ContextDetails, useContextReport } from './ContextPanel'
import { parseSize, Popover, SizeMenu, sizeText } from './SizeMenu'
import { AGENTS, agentById } from '../../shared/agents.js'
import { AgentGlyph, AgentIcon } from './icons'
import { initials } from './UsagePanel'
import { currentTheme, useTheme, type Theme } from '../theme'
import { Conversation, SimpleFooter, StatusStrip } from './SimpleView'

const DARK = {
  background: '#0f0e0c',
  foreground: '#ece4d8',
  cursor: '#f0553a',
  cursorAccent: '#0f0e0c',
  selectionBackground: 'rgba(240, 85, 58, 0.32)',
  black: '#1d1d1f',
  red: '#ff6b5b',
  green: '#62d48a',
  yellow: '#f5c560',
  blue: '#6aa2ff',
  magenta: '#c792ea',
  cyan: '#5fd4d4',
  white: '#d9d4cc',
  brightBlack: '#6b655e',
  brightRed: '#ff8a7a',
  brightGreen: '#86e3a6',
  brightYellow: '#ffd98a',
  brightBlue: '#94bcff',
  brightMagenta: '#ddb0f5',
  brightCyan: '#8ce6e6',
  brightWhite: '#ffffff',
}
const LIGHT = {
  background: '#fffdf9',
  foreground: '#211d18',
  cursor: '#dd4a28',
  cursorAccent: '#fffdf9',
  selectionBackground: 'rgba(221, 74, 40, 0.2)',
  black: '#1d1d1f',
  red: '#c4261a',
  green: '#1a7f37',
  yellow: '#8a5a00',
  blue: '#0a5fd6',
  magenta: '#8f3fc4',
  cyan: '#0f7c8a',
  white: '#6e6e73',
  brightBlack: '#6e6e73',
  brightRed: '#d12f1b',
  brightGreen: '#228b45',
  brightYellow: '#a86a00',
  brightBlue: '#2f76e0',
  brightMagenta: '#a24fd6',
  brightCyan: '#14899a',
  brightWhite: '#3a3a3c',
}
// Agent CLIs choose their own colours, often for a dark screen: on white xterm darkens any that are too faint.
const terminalLook = (theme: Theme) => (theme === 'light' ? { theme: LIGHT, minimumContrastRatio: 4.5 } : { theme: DARK, minimumContrastRatio: 1 })

export type ConsoleStatus = 'idle' | 'working' | 'needs' | 'done' | 'paused' | 'stopped'

export function StatusPill({ status }: { status: ConsoleStatus }) {
  const label = { idle: 'Ready', working: 'Working', needs: 'Needs you', done: 'Done', paused: 'Paused', stopped: 'Stopped' }[status]
  return (
    <span className={`status-pill ${status}`}>
      <span className="dot" />
      {label}
    </span>
  )
}

// Decide once per (console, epoch, process) how to launch: attach, fresh with a new
// session id, or resume. Cached so a quick remount never re-decides with stale data.
function launchParams(id: string, epoch: number): Record<string, string> {
  const key = `${id}:${epoch}`
  const cached = launchCache.get(key)
  if (cached) return cached
  const s = useStore.getState()
  const d = workspace(s)!.nodes.find((n) => n.id === id)!.data as ConsoleData
  const folders = project(s)?.folders
  let params: Record<string, string> = {
    agent: d.agent,
    cwd: d.cwd,
    yolo: d.yolo ? '1' : '0',
    ...(d.lead ? { lead: '1' } : {}),
    ...(d.profile ? { profile: d.profile } : {}),
    ...(folders?.length ? { dirs: JSON.stringify(folders) } : {}),
  }
  if (!s.live[id] && agentById(d.agent)?.resume) {
    if (d.resumeNext && d.lastSessionId) {
      params = { ...params, resume: d.lastSessionId }
      s.updateData(id, { sessionId: d.lastSessionId, resumeNext: false })
    } else {
      const sessionId = crypto.randomUUID()
      params = { ...params, sessionId }
      // A prompted conversation with no live process means the app was restarted: offer to pick it back up.
      s.updateData(id, d.resumable ? { sessionId, lastSessionId: d.resumable, resumeOffer: true } : { sessionId })
    }
  }
  launchCache.set(key, params)
  return params
}

const COMMAND_NOT_FOUND = 127

// Why it stopped, in words that say what to do about it.
function exitMessage(name: string, code: number | undefined, reason: string | null) {
  if (reason?.startsWith('folder not found')) return `This project's folder is gone: ${reason.replace('folder not found: ', '')}`
  if (reason) return `${name} could not start: ${reason}`
  if (code === COMMAND_NOT_FOUND) return `${name} is not installed on this Mac. Install it, or pick another agent from the menu at the top left of this console.`
  if (code === 0 || code === undefined) return `${name} has closed.`
  return `${name} stopped unexpectedly (code ${code}).`
}

const ACK_EVERY = 64 * 1024
const RETRY_FIRST_MS = 400
const RETRY_MAX_MS = 5000
const REFIT_AFTER_MS = 60
// Sizes in board pixels; the terminal takes as many columns and rows as fit.
const CONSOLE_SIZES: [string, string][] = [
  ['480 × 320', 'Small'],
  ['640 × 420', 'Medium'],
  ['960 × 640', 'Large'],
  ['1280 × 800', 'Extra large'],
  ['1200 × 420', 'Wide'],
  ['640 × 900', 'Tall'],
]

function TerminalView({ id, epoch, onExit }: { id: string; epoch: number; onExit: (reason?: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const termRef = useRef<{ term: Terminal; fit: FitAddon } | null>(null)
  const fontSize = useStore((s) => s.settings.fontSize)
  const theme = useTheme()

  useEffect(() => {
    const el = ref.current!
    let disposed = false
    let ws: WebSocket | null = null
    const size = useStore.getState().settings.fontSize
    // No macOptionIsMeta: on Italian (and most non-US) Mac layouts Option is how you type @ # [ ] { } ~.
    // Option+Enter and Option+Backspace still send ESC on their own.
    const term = new Terminal({
      fontFamily: '"JetBrains Mono Variable", Menlo, monospace',
      fontSize: size,
      lineHeight: 1.22,
      cursorBlink: true,
      scrollback: 10000,
      ...terminalLook(currentTheme()),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    termRef.current = { term, fit }
    const refit = () => {
      if (term.element && el.clientWidth > 0) fit.fit()
    }
    // Metrics are measured at open(): the web font must be ready first.
    document.fonts.load(`${size}px "JetBrains Mono Variable"`).finally(() => {
      if (disposed) return
      term.open(el)
      refit()
      // Tells the server how much has been drawn. A hidden tab draws slowly by design: it does not hold agents back.
      let drawn = 0
      const ack = (n: number) => {
        drawn += n
        if (drawn < ACK_EVERY && !document.hidden) return
        if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'a', n: drawn }))
        drawn = 0
      }
      let delay = RETRY_FIRST_MS
      const connect = () => {
        ws = new WebSocket(ptyUrl({ id, cols: String(term.cols), rows: String(term.rows), ...launchParams(id, epoch) }))
        ws.onopen = () => (delay = RETRY_FIRST_MS)
        ws.onmessage = (e) => term.write(e.data, () => ack(e.data.length))
        ws.onclose = (e) => {
          if (disposed) return
          if (e.code === 4000) return onExit()
          if (e.code === 4001) return onExit(e.reason)
          retry()
        }
      }
      // The socket fell but the agent may be fine (the Mac slept, the server restarted): look before
      // declaring it dead, and pick the screen up again if it is still running.
      const retry = () => {
        setTimeout(async () => {
          if (disposed) return
          try {
            const alive = (await api.sessions()).some((x) => x.id === id)
            if (disposed) return
            if (!alive) return onExit()
            term.reset()
            connect()
          } catch {
            delay = Math.min(delay * 2, RETRY_MAX_MS)
            retry()
          }
        }, delay)
      }
      connect()
      term.onData((data) => ws?.readyState === 1 && ws.send(JSON.stringify({ t: 'i', d: data })))
      // "Typing starts fresh": only a real keystroke dismisses the resume offer. onData would not do:
      // it also fires for the terminal's automatic replies to the TUI's capability queries.
      term.onKey(() => {
        const n = workspace(useStore.getState())?.nodes.find((x) => x.id === id)
        if ((n?.data as ConsoleData | undefined)?.resumeOffer) useStore.getState().updateData(id, { resumeOffer: false })
      })
      term.onResize(({ cols, rows }) => ws?.readyState === 1 && ws.send(JSON.stringify({ t: 'r', cols, rows })))
    })
    // Settles first: refitting on every frame of a resize would make the CLI repaint as many times.
    let settling: ReturnType<typeof setTimeout>
    const ro = new ResizeObserver(() => {
      clearTimeout(settling)
      settling = setTimeout(refit, REFIT_AFTER_MS)
    })
    ro.observe(el)
    return () => {
      disposed = true
      clearTimeout(settling)
      termRef.current = null
      ro.disconnect()
      ws?.close()
      term.dispose()
    }
  }, [id, epoch])

  // Font size changes in place: remounting would reconnect and replay every console.
  useEffect(() => {
    const t = termRef.current
    if (!t || t.term.options.fontSize === fontSize) return
    t.term.options.fontSize = fontSize
    if (t.term.element) t.fit.fit()
  }, [fontSize])

  // The theme changes in place too.
  useEffect(() => {
    const t = termRef.current
    if (t) Object.assign(t.term.options, terminalLook(theme))
  }, [theme])

  // ponytail: xterm ignores the board's CSS scale, so mouse selection is offset when zoom != 100%.
  // Keyboard is unaffected; double-click the header to snap the console to 100%.
  return <div ref={ref} style={{ height: '100%' }} />
}

// The header's hand-off menu: say what this agent is for, or pass its work to another console now.
function HandoffMenu({ id, role, onClose }: { id: string; role?: string; onClose: () => void }) {
  const others = useStore(
    useShallow((s) =>
      consoles(workspace(s)?.nodes ?? [])
        .filter((n) => n.id !== id && n.data.agent !== 'shell') // a shell would run the brief as commands
        .map((n) => `${n.id}\u0000${n.data.name}`),
    ),
  )
  const s = useStore.getState()
  return (
    <div className="menu nodrag nowheel" style={{ top: 44, right: 8, width: 290, maxHeight: 360, overflow: 'auto' }} onMouseLeave={onClose}>
      <div className="menu-title">What this agent does</div>
      <input
        className="field"
        style={{ width: '100%', margin: '6px 0 12px' }}
        placeholder="e.g. Reviews the code it receives"
        defaultValue={role}
        onBlur={(e) => s.updateData(id, { role: e.target.value.trim() || undefined })}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <div className="menu-title">Hand its work to</div>
      {others.length === 0 && <div className="menu-hint">Add another agent console first.</div>}
      {others.map((o) => {
        const [oid, name] = o.split('\u0000')
        return (
          <button
            key={oid}
            className="menu-item"
            onClick={() => {
              onClose()
              s.handoff(id, oid)
            }}
          >
            <Forward size={15} /> {name}
          </button>
        )
      })}
      <div className="menu-hint" style={{ marginTop: 8 }}>
        To do it every time this agent finishes, drag the dot on its right edge onto another console.
      </div>
    </div>
  )
}

const NO_SUBAGENTS: Subagent[] = []
const SUBAGENT_LINGER_MS = 20_000

// Claude's sub-agents hang under its console like satellites: one card per helper with its job,
// pulsing while it runs, ticked and then gone a little after it finishes.
function SubagentTray({ id }: { id: string }) {
  const subs = useStore((s) => s.live[id]?.subagents) ?? NO_SUBAGENTS
  const [now, setNow] = useState(() => Date.now())
  const lingering = subs.some((a) => a.status === 'done')
  useEffect(() => {
    if (!lingering) return
    const t = setInterval(() => setNow(Date.now()), 4000)
    return () => clearInterval(t)
  }, [lingering])
  const shown = subs.filter((a) => a.status === 'running' || now - (a.endedAt ?? 0) < SUBAGENT_LINGER_MS)
  if (!shown.length) return null
  return (
    <div className="subagent-tray">
      {shown.slice(0, 3).map((a) => (
        <div key={a.id} className={`subagent ${a.status}`} title={a.task}>
          {a.status === 'running' ? <span className="sa-dot" /> : <Check size={12} className="sa-check" />}
          <span className="sa-type">{a.type === 'general-purpose' ? 'Helper' : a.type}</span>
          <span className="sa-task">{a.task}</span>
        </div>
      ))}
      {shown.length > 3 && <div className="subagent more">+{shown.length - 3}</div>}
    </div>
  )
}

function ResumeOffer({ id, sessionId }: { id: string; sessionId: string }) {
  const [exists, setExists] = useState(false)
  const resumeConsole = useStore((s) => s.resumeConsole)
  const updateData = useStore((s) => s.updateData)
  useEffect(() => {
    api.claudeSession(sessionId).then((r) => (r.exists ? setExists(true) : updateData(id, { resumeOffer: false })))
  }, [sessionId])
  if (!exists) return null
  return (
    <button className="resume-offer nodrag" onClick={() => resumeConsole(id)}>
      <RotateCcwClock size={18} color="var(--accent)" style={{ marginTop: 2 }} />
      <span>
        <div className="t">Resume last conversation?</div>
        <div className="s">Click to pick it back up · typing starts fresh</div>
      </span>
      <span
        className="icon-btn sm close"
        onClick={(e) => {
          e.stopPropagation()
          updateData(id, { resumeOffer: false })
        }}
      >
        <X size={13} />
      </span>
    </button>
  )
}

// While an orchestrator's Connect is on, a console or group is a big target: click to wire or unwire it.
export function WirePick({ id }: { id: string }) {
  const orch = useStore((s) => s.connecting)
  const wired = useStore((s) => !!s.connecting && !!workspace(s)?.edges.some((e) => e.type === 'command' && e.source === s.connecting && e.target === id))
  if (!orch) return null
  return (
    <button className={`wire-pick nodrag ${wired ? 'on' : ''}`} onClick={() => useStore.getState().toggleWire(orch, id)}>
      <span>{wired ? 'Connected · click to remove' : 'Click to connect'}</span>
    </button>
  )
}

function ConsoleNodeImpl({ id, data, selected, width, height }: NodeProps<Node<ConsoleData>>) {
  const live = useStore((s) => s.live[id])
  const { updateData, restartConsole, removeNode, resizeNode } = useStore.getState()
  const [pop, setPop] = useState<{ what: 'size' | 'context'; anchor: DOMRect } | null>(null)
  const toggle = (what: 'size' | 'context') => (e: React.MouseEvent<HTMLElement>) => setPop(pop?.what === what ? null : { what, anchor: e.currentTarget.getBoundingClientRect() })
  const report = useContextReport(data.agent === 'claude' ? id : '')
  const size = sizeText(width ?? CONSOLE_SIZE.width, height ?? CONSOLE_SIZE.height)
  const [editing, setEditing] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [agentMenu, setAgentMenu] = useState(false)
  const [handMenu, setHandMenu] = useState(false)
  const [exited, setExited] = useState(false)
  const [exitReason, setExitReason] = useState<string | null>(null)
  const exitCode = useStore((s) => s.exits[id])
  const profiles = useStore((s) => s.settings.profiles) ?? []
  const account = data.profile ? profiles.find((p) => p.id === data.profile) : undefined
  const status: ConsoleStatus = !live ? 'stopped' : live.paused ? 'paused' : live.status
  const color = agentColor(data.agent)
  const simple = data.view === 'simple' && data.agent !== 'shell'
  // Only Claude's transcript can be read as a conversation; other agents keep their terminal in view.
  const chat = simple && data.agent === 'claude'

  useEffect(() => setExited(false), [data.epoch])

  const snapTo100 = () => {
    const s = useStore.getState()
    const ws = workspace(s)!
    const n = ws.nodes.find((x) => x.id === id)!
    const pos = absolute(ws.nodes, n)
    s.flow?.setCenter(pos.x + (n.measured?.width ?? 640) / 2, pos.y + (n.measured?.height ?? 420) / 2, { zoom: 1, duration: 400 })
  }

  return (
    <>
      <NodeResizer isVisible={selected} minWidth={MIN_CONSOLE.width} minHeight={MIN_CONSOLE.height} />
      {pop && (
        <Popover anchor={pop.anchor} onClose={() => setPop(null)}>
          {pop.what === 'size' ? (
            <SizeMenu
              current={size}
              sizes={CONSOLE_SIZES}
              min={MIN_CONSOLE.height}
              onPick={(v) => {
                setPop(null)
                const [w, h] = parseSize(v)
                resizeNode(id, Math.max(w, MIN_CONSOLE.width), h)
              }}
            />
          ) : (
            report && (
              <div className="menu ctx-pop">
                <ContextDetails id={id} report={report} onDone={() => setPop(null)} />
              </div>
            )
          )}
        </Popover>
      )}
      <Handle type="target" position={Position.Left} className="wire-handle" />
      <Handle type="source" position={Position.Right} className="wire-handle" title="Drag onto another console: it takes over whenever this one finishes" />
      <div className={`console ${status}`} style={{ ['--c' as string]: `color-mix(in srgb, ${color} 48%, var(--panel-3))` }}>
        <WirePick id={id} />
        <div className="console-head" onDoubleClick={snapTo100}>
          <button className="agent-switch nodrag" onClick={() => setAgentMenu((v) => !v)} title={agentById(data.agent)?.name}>
            <AgentGlyph id={data.agent} size={19} />
            <ChevronDown size={12} />
          </button>
          <span className="dot" style={{ background: data.dot }} />
          {editing ? (
            <input
              className="name nodrag"
              autoFocus
              defaultValue={data.name}
              onBlur={(e) => {
                updateData(id, { name: e.target.value.trim() || data.name })
                setEditing(false)
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <span
              className="name"
              onDoubleClick={(e) => {
                e.stopPropagation()
                setEditing(true)
              }}
            >
              {data.name}
            </span>
          )}
          {data.lead && (
            <span className="badge" style={{ color: 'var(--lead)' }} title="Brings in helpers on the board when a job splits into parts">
              lead
            </span>
          )}
          {account && (
            <span className="badge acct" title={`Runs on ${account.name}'s own sign-in`}>
              {initials(account.name)}
            </span>
          )}
          {data.role && <span className="role">{data.role}</span>}
          {data.yolo && (
            <span className="badge" style={{ color: 'var(--accent)' }} title="This agent acts without asking first. Use it only on projects you trust.">
              Auto-approve
            </span>
          )}
          <span className="spacer" />
          <button className="vp-chip size-chip nodrag" data-popover-toggle title="Size of this terminal: pick one or type your own" onClick={toggle('size')}>
            {size}
          </button>
          {report && <ContextChip report={report} onClick={toggle('context')} />}
          {data.agent !== 'shell' && (
            <div className="seg view-switch nodrag" title="Simple shows a conversation. Terminal shows the real thing underneath.">
              <button className={simple ? 'on' : ''} onClick={() => updateData(id, { view: 'simple' })}>
                Simple
              </button>
              <button className={simple ? '' : 'on'} onClick={() => updateData(id, { view: 'terminal' })}>
                Terminal
              </button>
            </div>
          )}
          <StatusPill status={status} />
          <button className="icon-btn sm nodrag" title="Pass this agent's work to another one" onClick={() => setHandMenu((v) => !v)}>
            <Forward size={15} />
          </button>
          <button className="icon-btn sm nodrag" title="Stop it and start it again" onClick={() => restartConsole(id)}>
            <RotateCw size={14} />
          </button>
          <button className="icon-btn sm nodrag" title="Stop it and remove it" onClick={() => setConfirmClose(true)}>
            <X size={15} />
          </button>
        </div>

        {handMenu && <HandoffMenu id={id} role={data.role} onClose={() => setHandMenu(false)} />}

        {agentMenu && (
          <div className="menu nodrag nowheel" style={{ top: 44, left: 8, width: 260, maxHeight: 320, overflow: 'auto' }}>
            <div className="menu-title">Switch agent</div>
            {AGENTS.flatMap((a) =>
              // The default sign-in first, then each extra account of this CLI (Settings › Accounts).
              [undefined, ...profiles.filter((p) => p.agent === a.id)].map((p) => (
                <button
                  key={`${a.id}:${p?.id ?? ''}`}
                  className="menu-item"
                  onClick={() => {
                    setAgentMenu(false)
                    updateData(id, { agent: a.id, profile: p?.id })
                    restartConsole(id)
                  }}
                >
                  <AgentIcon id={a.id} size={28} />
                  <span className="title" style={{ fontSize: 14 }}>
                    {a.name}
                    {p && <span style={{ color: 'var(--muted)' }}> · {p.name}</span>}
                  </span>
                </button>
              )),
            )}
          </div>
        )}

        {confirmClose && (
          <div className="confirm-bar nodrag">
            Stop {data.name} and remove it?
            <button className="btn" onClick={() => setConfirmClose(false)}>
              Cancel
            </button>
            <button className="btn primary" onClick={() => removeNode(id)}>
              Stop
            </button>
          </div>
        )}

        {data.resumeOffer && data.lastSessionId && <ResumeOffer id={id} sessionId={data.lastSessionId} />}

        {simple && !chat && <StatusStrip id={id} status={status} />}

        <div className="console-body nodrag nowheel nopan">
          <TerminalView
            id={id}
            epoch={data.epoch}
            onExit={(reason) => {
              setExited(true)
              setExitReason(reason ?? null)
            }}
          />
          {/* Laid over the terminal, never beside it: resizing a terminal makes the CLI redraw, and a
              question that opens and closes with each redraw would resize it again, forever. */}
          {chat && (
            <div className="simple-layer">
              <StatusStrip id={id} status={status} />
              <Conversation id={id} name={data.name} />
              {live && <SimpleFooter id={id} data={data} status={status} />}
            </div>
          )}
          {exited && (
            <div className="console-overlay">
              <div className="box">
                <div>{exitMessage(agentById(data.agent)?.name ?? 'This console', exitCode, exitReason)}</div>
                <button className="btn primary" onClick={() => restartConsole(id, false)}>
                  <RotateCw size={14} /> Start again
                </button>
              </div>
            </div>
          )}
        </div>
        {simple && !chat && live && <SimpleFooter id={id} data={data} status={status} />}
      </div>
      <SubagentTray id={id} />
    </>
  )
}

export const ConsoleNode = memo(ConsoleNodeImpl)
