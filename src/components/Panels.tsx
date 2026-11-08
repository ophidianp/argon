import { useEffect } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useStore } from '../store'
import { useTheme } from '../theme'
import { SettingsSheet } from './SettingsSheet'

// Day or night in one click, wherever you are. Settings also offers "Same as Windows".
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

// Settings: the tabbed sheet (General, Agents, Appearance, Data).
export function SettingsModal() {
  return <SettingsSheet />
}
