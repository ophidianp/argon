import { useEffect, useState } from 'react'
import { ArrowLeft, Folder, FolderGit2, FolderOpen, Plus, Search, X } from 'lucide-react'
import { api } from '../api'
import { consoles, useStore } from '../store'
import { Spark } from './icons'
import { ThemeToggle } from './Panels'

export function Home() {
  const projects = useStore((s) => s.projects)
  const live = useStore((s) => s.live)
  const openProject = useStore((s) => s.openProject)
  const recent = [...projects].sort((a, b) => b.openedAt - a.openedAt)

  return (
    <div className="home">
      <div className="home-inner">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <Spark size={26} color="var(--accent)" />
            <span style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>vibeboard</span>
            <ThemeToggle />
          </div>
          <h1>
            One board for <em>your agents</em>.
          </h1>
          <div className="lead">Open a project folder and your coding agents work side by side.</div>
        </div>

        {recent.length > 0 && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div className="section-label">Recent</div>
            <div className="project-grid">
              {recent.map((p) => {
                const ids = p.workspaces.flatMap((w) => consoles(w.nodes).map((n) => n.id))
                const running = ids.filter((id) => live[id]).length
                return (
                  <button key={p.path} className="project-card" onClick={() => openProject(p.path)}>
                    <div className="t">
                      <Folder size={17} color="var(--muted)" /> {p.name}
                      <span className="spacer" />
                      <span
                        className="icon-btn sm forget"
                        title="Remove from Recent"
                        onClick={(e) => {
                          e.stopPropagation()
                          useStore.getState().forgetProject(p.path)
                        }}
                      >
                        <X size={13} />
                      </span>
                    </div>
                    <div className="p">{p.path}</div>
                    <div className="meta">
                      <span>
                        {p.workspaces.length} workspace{p.workspaces.length > 1 ? 's' : ''}
                      </span>
                      <span>{ids.length} consoles</span>
                      {running > 0 && (
                        <span style={{ color: 'var(--live)' }}>
                          <span className="dot" style={{ background: 'var(--live)', width: 6, height: 6, marginRight: 6 }} />
                          {running} live
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {window.vibeboardDesktop ? <NativePicker onPick={openProject} /> : <FolderBrowser onPick={openProject} />}
      </div>
    </div>
  )
}

// In the desktop app the Mac's own folder window does the browsing.
function NativePicker({ onPick }: { onPick: (path: string) => void }) {
  return (
    <div>
      <button className="btn primary" onClick={() => window.vibeboardDesktop!.pickFolder().then((p) => p && onPick(p))}>
        <FolderOpen size={15} /> Open a folder…
      </button>
    </div>
  )
}

export function FolderBrowser({ onPick, action }: { onPick: (path: string) => void; action?: string }) {
  const [dir, setDir] = useState<{ path: string; parent: string; dirs: string[]; isRepo: boolean } | null>(null)
  const [typed, setTyped] = useState('')
  const [filter, setFilter] = useState('')

  const go = (path?: string) =>
    api
      .ls(path)
      .then((d) => {
        setDir(d)
        setTyped(d.path)
        setFilter('')
      })
      .catch(() => useStore.getState().notify('Not a folder'))

  useEffect(() => {
    go()
  }, [])

  const shown = dir?.dirs.filter((d) => d.toLowerCase().includes(filter.toLowerCase())) ?? []

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {!action && <div className="section-label">Open a folder</div>}
      <div className="browser">
        <div className="browser-head">
          <button className="icon-btn" title="Up" onClick={() => dir && go(dir.parent)}>
            <ArrowLeft size={16} />
          </button>
          <input
            className="field mono"
            style={{ padding: '8px 12px', fontSize: 13 }}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && go(typed)}
          />
          <div className="search" style={{ minWidth: 180, height: 36 }}>
            <Search size={14} />
            <input placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <button className="btn primary" onClick={() => dir && onPick(dir.path)}>
            <Plus size={15} /> {action ?? `Open ${dir?.isRepo ? 'repo' : 'here'}`}
          </button>
        </div>
        <div className="browser-list">
          {shown.map((d) => (
            <button key={d} onClick={() => go(`${dir!.path.replace(/\/$/, '')}/${d}`)} onDoubleClick={() => onPick(`${dir!.path.replace(/\/$/, '')}/${d}`)}>
              <FolderGit2 size={15} color="var(--muted)" /> {d}
            </button>
          ))}
          {dir && !shown.length && <div className="menu-hint">No subfolders</div>}
        </div>
      </div>
    </div>
  )
}
