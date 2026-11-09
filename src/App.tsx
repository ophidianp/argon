import { useEffect } from 'react'
import { useStore } from './store'
import { Home } from './components/Home'
import { BoardScreen } from './components/BoardScreen'
import { Tips } from './components/Tips'
import { ConfirmSheet } from './components/Panels'
import { setThemeMode } from './theme'
import { setLook } from './appearance'
import { UpdateCard } from './components/UpdateCard'
import { initUpdates } from './updates'

export function App() {
  const ready = useStore((s) => s.ready)
  const active = useStore((s) => s.active)
  const toast = useStore((s) => s.toast)
  const linkDown = useStore((s) => s.linkDown)
  const toastAction = useStore((s) => s.toastAction)
  const themeMode = useStore((s) => s.settings.theme)
  const look = useStore((s) => s.settings.look)

  useEffect(() => useStore.getState().init(), [])
  // Before the board state arrives the settings hold only defaults: keep the remembered theme until then.
  useEffect(() => {
    if (ready) setThemeMode(themeMode)
  }, [ready, themeMode])
  useEffect(() => {
    if (ready) setLook(look)
  }, [ready, look])
  // The installed app looks for updates now and then (src/updates.ts); a checkout never does.
  useEffect(() => {
    if (ready) initUpdates()
  }, [ready])

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
      {linkDown && <div className="link-down">Reconnecting to Argon…</div>}
      <ConfirmSheet />
      <UpdateCard />
      <Tips />
    </>
  )
}
