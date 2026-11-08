import { useEffect } from 'react'
import { useStore } from './store'
import { Home } from './components/Home'
import { BoardScreen } from './components/BoardScreen'
import { Tips } from './components/Tips'
import { ConfirmSheet } from './components/Panels'
import { setThemeMode } from './theme'

export function App() {
  const ready = useStore((s) => s.ready)
  const active = useStore((s) => s.active)
  const toast = useStore((s) => s.toast)
  const linkDown = useStore((s) => s.linkDown)
  const toastAction = useStore((s) => s.toastAction)
  const themeMode = useStore((s) => s.settings.theme)

  useEffect(() => useStore.getState().init(), [])
  // Before the board state arrives the settings hold only defaults: keep the remembered theme until then.
  useEffect(() => {
    if (ready) setThemeMode(themeMode)
  }, [ready, themeMode])

  if (!ready) return <div className="home" />
  return (
    <>
      {active ? <BoardScreen key={active} /> : <Home />}
      {toast && (
        <div className="toast">
          {toast}
          {toastAction && (
            <button className="btn" onClick={toastAction.run}>
              {toastAction.label}
            </button>
          )}
        </div>
      )}
      {linkDown && <div className="link-down">Reconnecting to vibeboard…</div>}
      <ConfirmSheet />
      <Tips />
    </>
  )
}
