import { useEffect } from 'react'
import { CircleUserRound, Moon, Settings, Sun, X } from 'lucide-react'
import { askNotifyPermission, useStore } from '../store'
import { AGENTS } from '../../shared/agents.js'
import { useTheme } from '../theme'
import { AgentIcon } from './icons'

// Day or night in one click, wherever you are. Settings also offers "Same as my Mac".
export function ThemeToggle() {
  const theme = useTheme()
  const flip = () => {
    const s = useStore.getState()
    s.set({ settings: { ...s.settings, theme: theme === 'dark' ? 'light' : 'dark' } })
  }
  return (
    <button className="icon-btn" title={theme === 'dark' ? 'Switch to day mode' : 'Switch to night mode'} onClick={flip}>
      {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  )
}

export function ConfirmSheet() {
  const c = useStore((s) => s.confirming)
  useEffect(() => {
    if (!c) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') c.answer(false)
      if (e.key === 'Enter') c.answer(true)
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [c])
  if (!c) return null
  return (
    <div className="backdrop confirm" onMouseDown={(e) => e.target === e.currentTarget && c.answer(false)}>
      <div className="modal confirm-sheet" role="alertdialog" aria-label={c.title}>
        <h2>{c.title}</h2>
        <p>{c.detail}</p>
        <div className="row">
          <button className="btn" onClick={() => c.answer(false)}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => c.answer(true)}>
            {c.yes}
          </button>
        </div>
      </div>
    </div>
  )
}

export function SettingsModal() {
  const settings = useStore((s) => s.settings)
  const installed = useStore((s) => s.installed)
  const s = useStore.getState()
  const close = () => s.set({ modal: null })
  const patch = (p: Partial<typeof settings>) => s.set({ settings: { ...settings, ...p } })
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal narrow" style={{ width: 'min(620px, calc(100vw - 120px))' }}>
        <div className="modal-head">
          <span className="ico">
            <Settings size={20} />
          </span>
          <div style={{ flex: 1 }}>
            <h2>Settings</h2>
            <div className="sub">Stored on your disk in ~/.vibeboard</div>
          </div>
          <button className="icon-btn" title="Close" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <div className="loops">
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="section-label">Appearance</div>
            <div className="pills">
              {(['system', 'light', 'dark'] as const).map((m) => (
                <button key={m} className={(settings.theme ?? 'system') === m ? 'on' : ''} onClick={() => patch({ theme: m })}>
                  {{ system: 'Same as my Mac', light: 'Light', dark: 'Dark' }[m]}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="section-label">Default agent</div>
            <div className="pills">
              {AGENTS.filter((a) => installed.includes(a.id)).map((a) => (
                <button key={a.id} className={settings.defaultAgent === a.id ? 'on' : ''} onClick={() => patch({ defaultAgent: a.id })} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <AgentIcon id={a.id} size={22} /> {a.name}
                </button>
              ))}
            </div>
          </div>
          <div className="toggle-row">
            <button className={`toggle ${settings.simpleView === true ? 'on' : ''}`} onClick={() => patch({ simpleView: settings.simpleView !== true })} />
            <span>
              New agents open in the simple view
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>A conversation and plain buttons, for those who prefer not to use a terminal. Each agent can switch at any time.</div>
            </span>
          </div>
          <div className="toggle-row">
            <button className={`toggle ${settings.yolo ? 'on' : ''}`} onClick={() => patch({ yolo: !settings.yolo })} />
            <span>
              New agents do not ask before acting (Auto-approve)
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>Claude runs with --dangerously-skip-permissions. Only on projects you trust.</div>
            </span>
          </div>
          <div className="toggle-row">
            <button
              className={`toggle ${settings.notify !== false ? 'on' : ''}`}
              onClick={() => {
                if (settings.notify === false) askNotifyPermission()
                patch({ notify: settings.notify === false })
              }}
            />
            <span>
              Notify me when an agent needs me or finishes
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>Only while you are in another window. Click the notification to jump to the agent.</div>
            </span>
          </div>
          <div className="toggle-row">
            <button className={`toggle ${settings.speak !== false ? 'on' : ''}`} onClick={() => patch({ speak: settings.speak === false })} />
            <span>
              Speak planner replies after a voice command
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>Uses the system voice. Note: browser dictation may send audio to its vendor.</div>
            </span>
          </div>
          <div className="toggle-row">
            <CircleUserRound size={20} color="var(--muted)" style={{ margin: '0 7px' }} />
            <span style={{ flex: 1 }}>
              Accounts
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                {settings.profiles?.length ? `${settings.profiles.length} extra sign-in${settings.profiles.length > 1 ? 's' : ''}` : 'Run a second sign-in of Claude or Codex side by side'}
              </div>
            </span>
            <button className="btn" onClick={() => s.set({ modal: 'usage', usageView: 'accounts' })}>
              Manage
            </button>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="section-label">Terminal font size</div>
            <div className="pills">
              {[11, 12, 13, 14, 15, 16].map((n) => (
                <button key={n} className={settings.fontSize === n ? 'on' : ''} onClick={() => patch({ fontSize: n })}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
