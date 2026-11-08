import { useEffect, useState } from 'react'
import { FileText, FolderOpen, FolderPlus, Trash2 } from 'lucide-react'
import { api, type ContextReport } from '../api'
import { consoles, project, useStore, workspace, type ConsoleData } from '../store'
import { contextAdvice } from '../../shared/context.js'
import { useShallow } from 'zustand/react/shallow'
import { AgentGlyph } from './icons'
import { FolderBrowser } from './Home'
import { fmtTokens } from './UsagePanel'

const PART_COLORS: Record<string, string> = {
  'Instructions and tools': '#8a847c',
  'Your messages': '#5b8cff',
  'Claude’s replies': '#f0553a',
  'Files read': '#3ecf8e',
  Edits: '#f5a33d',
  Commands: '#a477ff',
  Searches: '#4fd1d9',
  Web: '#f472b6',
  Helpers: '#f5d547',
  'Other tools': '#6b655e',
}
const NEARLY_FULL = 0.8
const FILLING = 0.5
const level = (share: number) => (share >= NEARLY_FULL ? 'full' : share >= FILLING ? 'filling' : '')
const percent = (share: number) => `${Math.max(1, Math.round(share * 100))}%`

// Reads again whenever the agent's conversation moves on.
export function useContextReport(id: string) {
  const tick = useStore((s) => s.live[id]?.tick ?? 0)
  const alive = useStore((s) => !!s.live[id])
  const [report, setReport] = useState<ContextReport | null>(null)
  useEffect(() => {
    if (!alive) return
    let gone = false
    api
      .context(id)
      .then((r) => !gone && setReport(r.report))
      .catch((e) => console.error('could not read the context', e))
    return () => {
      gone = true
    }
  }, [id, tick, alive])
  return report
}

// The small gauge in a console's header.
export function ContextChip({ report, onClick }: { report: ContextReport; onClick: (e: React.MouseEvent<HTMLElement>) => void }) {
  const share = report.used / report.window
  return (
    <button className={`ctx-chip nodrag ${level(share)}`} data-popover-toggle title="How full this agent's memory is. Click to see what fills it" onClick={onClick}>
      <i>
        <b style={{ width: percent(share) }} />
      </i>
      {percent(share)}
    </button>
  )
}

// How full, what with, and what to do about it.
export function ContextDetails({ id, report, onDone }: { id: string; report: ContextReport; onDone?: () => void }) {
  const share = report.used / report.window
  const idle = useStore((s) => s.live[id]?.status !== 'working')
  const send = (command: string) => {
    api.prompt(id, command).catch((e) => useStore.getState().notify(`Could not send it: ${(e as Error).message}`))
    onDone?.()
  }
  return (
    <div className="ctx-report">
      <div className="ctx-total">
        <b className={level(share)}>{percent(share)}</b>
        <span>
          {fmtTokens(report.used)} of {fmtTokens(report.window)} tokens
          <small>{contextAdvice(share)}</small>
        </span>
      </div>
      <div className="ctx-bar" role="img" aria-label={`${percent(share)} of this agent's memory is used`}>
        {report.parts.map((p) => (
          <i key={p.label} title={`${p.label}: ${fmtTokens(p.tokens)}`} style={{ width: `${(p.tokens / report.window) * 100}%`, background: PART_COLORS[p.label] }} />
        ))}
      </div>
      <ul className="ctx-parts">
        {report.parts.map((p) => (
          <li key={p.label}>
            <i style={{ background: PART_COLORS[p.label] }} />
            <span>{p.label}</span>
            <em>{fmtTokens(p.tokens)}</em>
          </li>
        ))}
      </ul>
      {report.biggest.length > 0 && (
        <>
          <div className="section-label">Biggest things it read</div>
          <ul className="ctx-parts plain">
            {report.biggest.map((b, i) => (
              <li key={i}>
                <span title={b.label}>{b.label}</span>
                <em>{fmtTokens(b.tokens)}</em>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="ctx-actions">
        <button className="btn" disabled={!idle} title={idle ? 'Claude sums up the conversation so far and frees the room' : 'Wait for it to finish'} onClick={() => send('/compact')}>
          Compact
        </button>
        <button className="btn" disabled={!idle} title={idle ? 'Forget this conversation and start empty' : 'Wait for it to finish'} onClick={() => send('/clear')}>
          Clear
        </button>
      </div>
    </div>
  )
}

function AgentRow({ id, data }: { id: string; data: ConsoleData }) {
  const report = useContextReport(id)
  const [open, setOpen] = useState(false)
  const share = report ? report.used / report.window : 0
  return (
    <div className={`ctx-agent ${open ? 'open' : ''}`}>
      <button className="ctx-agent-row" disabled={!report} onClick={() => setOpen((v) => !v)}>
        <AgentGlyph id={data.agent} size={17} />
        <span className="n">{data.name}</span>
        {report ? (
          <>
            <i className={`ctx-meter ${level(share)}`}>
              <b style={{ width: percent(share) }} />
            </i>
            <em>{percent(share)}</em>
          </>
        ) : (
          <span className="faint">Nothing yet</span>
        )}
      </button>
      {open && report && <ContextDetails id={id} report={report} />}
    </div>
  )
}

// Every Claude on this board side by side, so the one running out of room stands out.
export function AgentsTab() {
  const rows = useStore(useShallow((s) => consoles(workspace(s)?.nodes ?? []).filter((n) => n.data.agent === 'claude' && s.live[n.id])))
  return (
    <div className="modal-body nowheel">
      {rows.length ? (
        <div className="ctx-agents">
          {rows.map((n) => (
            <AgentRow key={n.id} id={n.id} data={n.data} />
          ))}
        </div>
      ) : (
        <div className="memory-empty">
          <b>No Claude is running on this board</b>
          <span>Start one and it shows here, with how much of its memory is used and what fills it.</span>
        </div>
      )}
    </div>
  )
}

const folderName = (path: string) => path.split('/').filter(Boolean).pop() ?? path

// Folders that live outside the project, such as a second brain: connected here, reachable everywhere.
export function FoldersTab() {
  const p = useStore(project)!
  const s = useStore.getState()
  const folders = p.folders ?? []
  const desktop = window.vibeboardDesktop
  const [browsing, setBrowsing] = useState(false)
  // A disk that is not plugged in, a folder moved or renamed: said before anyone tries to open it.
  const [missing, setMissing] = useState<Set<string>>(new Set())
  useEffect(() => {
    let gone = false
    Promise.all(folders.map((f) => api.ls(f).then(() => null, () => f))).then((r) => !gone && setMissing(new Set(r.filter((f): f is string => !!f))))
    return () => {
      gone = true
    }
  }, [folders.join('|')])
  const connect = (path: string | null) => {
    setBrowsing(false)
    if (!path) return
    s.connectFolder(path)
    s.notify(`Connected ${folderName(path)}. New agents can use it; running ones get it when they restart.`)
  }
  return (
    <div className="modal-body nowheel">
      <div className="folders-intro">
        <div>
          <b>Connect a folder from outside this project</b>
          <span>A second brain, your notes, another repo. Claude can read and edit it, and its notes open in Markdown.</span>
        </div>
        <button className="btn primary" onClick={() => (desktop ? desktop.pickFolder().then(connect) : setBrowsing((v) => !v))}>
          <FolderPlus size={15} /> Connect a folder
        </button>
      </div>
      {browsing && <FolderBrowser onPick={connect} action="Connect" />}
      {folders.map((f) => (
        <div className="folder-row" key={f}>
          <FolderOpen size={17} color="var(--muted)" />
          <span className="n">
            <span>
              {folderName(f)}
              {missing.has(f) && <em className="folder-missing">Not found</em>}
            </span>
            <small>{missing.has(f) ? `${f} is not there any more. Plug its disk in, or disconnect it.` : f}</small>
          </span>
          <button
            className="btn sm"
            title="Read its notes in the Markdown studio"
            disabled={missing.has(f)}
            onClick={() => s.set({ modal: 'markdown', studioRoot: f })}
          >
            <FileText size={13} /> Notes
          </button>
          <button className="icon-btn sm" title="Show in Finder" onClick={() => api.reveal(f)}>
            <FolderOpen size={14} />
          </button>
          <button className="icon-btn sm" title="Disconnect: the folder itself stays as it is" onClick={() => s.disconnectFolder(f)}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      {!folders.length && !browsing && <p className="folders-none">Nothing connected yet. Other agents than Claude can still use a folder if you tell them its path.</p>}
    </div>
  )
}
