import { useEffect, useState } from 'react'
import { Briefcase, ChevronDown, ChevronLeft, Folder, FolderOpen, Info, Plus, Settings, X } from 'lucide-react'
import { consoles, project, useStore } from '../store'
import { ClaudeMark } from './icons'
import { ThemeToggle } from './Panels'
import { fmtTokens, loadLimits, loadTokens, useUsage } from './UsagePanel'

const todayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function TopBar() {
  const p = useStore(project)!
  const projects = useStore((s) => s.projects)
  const live = useStore((s) => Object.keys(s.live).length)
  const hasClaude = useStore((s) => s.installed.includes('claude'))
  const s = useStore.getState()
  const [projMenu, setProjMenu] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const resets = useUsage((u) => u.limits?.limits[0]?.resets?.replace(/\s*\(.*\)$/, ''))
  const today = useUsage((u) => {
    const d = u.tokens?.claude.days[todayKey()]
    return u.tokens ? (d ? d[0] + d[1] + d[2] : 0) : null
  })

  // The session's reset time comes from Claude's own /usage, read in the background now and then.
  useEffect(() => {
    loadLimits()
    loadTokens()
    const t = setInterval(() => {
      loadLimits()
      loadTokens()
    }, 10 * 60_000)
    return () => clearInterval(t)
  }, [hasClaude])

  // However many workspaces there are, the current one is in view.
  useEffect(() => {
    const keep = () => document.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    keep()
    // The space for the tabs changes as the pills on the right fill in.
    const watcher = new ResizeObserver(keep)
    watcher.observe(document.querySelector('.tab-list')!)
    return () => watcher.disconnect()
  }, [p.activeWs, p.workspaces.length])

  return (
    <div className="topbar">
      <h1 className="sr-only">{p.name}</h1>
      <button className="pill" title="Back to your projects: agents keep running" onClick={s.goHome}>
        <ChevronLeft size={16} /> Home
      </button>

      <div className="pill tabs" style={{ position: 'relative' }}>
        <button className="project" title="Switch project" onClick={() => setProjMenu((v) => !v)}>
          <Folder size={15} fill="currentColor" strokeWidth={1.5} /> {p.name} <ChevronDown size={14} color="var(--muted)" />
        </button>
        <div className="tab-list">
        {p.workspaces.map((w) => (
          <button
            key={w.id}
            className={`tab ${w.id === p.activeWs ? 'active' : ''}`}
            onClick={() => s.switchWorkspace(w.id)}
            onDoubleClick={() => setRenaming(w.id)}
          >
            {renaming === w.id ? (
              <input
                autoFocus
                defaultValue={w.name}
                onBlur={(e) => {
                  s.renameWorkspace(w.id, e.target.value.trim() || w.name)
                  setRenaming(null)
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            ) : (
              w.name
            )}
            <span className="count">{consoles(w.nodes).length}</span>
            <span
              className="x"
              title="Close this workspace"
              onClick={(e) => {
                e.stopPropagation()
                s.closeWorkspace(w.id)
              }}
            >
              <X size={13} />
            </span>
          </button>
        ))}
        </div>
        <button className="icon-btn" title="New workspace" onClick={s.addWorkspace}>
          <Plus size={16} />
        </button>

        {projMenu && (
          <div className="menu" style={{ top: 44, left: 0, width: 300 }} onMouseLeave={() => setProjMenu(false)}>
            <div className="menu-title">Projects</div>
            {projects.map((x) => (
              <button
                key={x.path}
                className="menu-item"
                onClick={() => {
                  setProjMenu(false)
                  s.openProject(x.path)
                }}
              >
                <Folder size={16} color="var(--muted)" />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div className="title">
                    {x.name}
                  </div>
                  <div className="sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {x.path}
                  </div>
                </span>
              </button>
            ))}
            <button className="menu-item" onClick={s.goHome}>
              <FolderOpen size={16} color="var(--muted)" />
              <span className="title">Open another folder…</span>
            </button>
          </div>
        )}
      </div>

      <button className="pill" title="Close this project: its agents stop" onClick={s.closeProject}>
        <X size={15} /> Close
      </button>

      <span className="spacer" />

      <span className="pill" title="Agents running right now">
        <span className="dot" style={{ background: 'var(--live)', width: 7, height: 7 }} /> {live} <span className="muted">running</span>
      </span>
      <button className="pill usage-pill" title="How much of your plan you have used" onClick={() => s.set({ modal: useStore.getState().modal === 'usage' ? null : 'usage', usageView: 'usage' })}>
        <Info size={15} color="var(--muted)" />
        <ClaudeMark size={14} />
        {resets ? (
          <>
            <span className="muted">resets</span> {resets}
          </>
        ) : (
          <>
            <span className="muted">today</span> {today === null ? '–' : fmtTokens(today)}
          </>
        )}
      </button>
      <button className="icon-btn" title="Mission map: all your agents at a glance" onClick={() => s.set({ modal: useStore.getState().modal === 'mission' ? null : 'mission' })}>
        <Briefcase size={17} />
      </button>
      <ThemeToggle />
      <button className="icon-btn" title="Settings" onClick={() => s.set({ modal: 'settings' })}>
        <Settings size={17} />
      </button>
    </div>
  )
}
