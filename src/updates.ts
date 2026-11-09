// Updates: checks GitHub for a newer signed Argon and installs it, the way browsers and game launchers do.
// Two modes (Settings → Updates):
//   auto: download quietly, install when Argon closes, offer "Restart now".
//   ask:  say so first, with Update now / When I close Argon / Skip this version.
// Installing closes Argon and every agent with it, so nothing restarts without a click and a warning.
// Only in the installed app: window.vibeboardDesktop.update (desktop/updater.cjs).
import { create } from 'zustand'
import { askToConfirm, useStore, type Settings } from './store'

const EVERY = 6 * 3600_000 // check every 6 hours
const FIRST = 25_000 // first check shortly after start, once the board is up

type Card = { kind: 'ask' | 'ready'; version: string; current?: string; notes: string; sub: string; pct: number | null; busy: boolean }
export const useUpdateCard = create<{ card: Card | null }>(() => ({ card: null }))

export const updater = () => window.vibeboardDesktop?.update
export type UpdatePrefs = NonNullable<Settings['updates']>

export function updatePrefs(): UpdatePrefs {
  const u = useStore.getState().settings.updates
  return { ...u, mode: u?.mode === 'auto' ? 'auto' : 'ask' }
}
export function setUpdatePrefs(p: Partial<UpdatePrefs>) {
  const s = useStore.getState()
  const next = { ...updatePrefs(), ...p }
  for (const k of Object.keys(next) as (keyof UpdatePrefs)[]) if (next[k] === undefined) delete next[k]
  s.set({ settings: { ...s.settings, updates: next } })
}

let started = false
export function initUpdates() {
  if (!updater() || started) return
  started = true
  setTimeout(() => checkForUpdates(false), FIRST)
  setInterval(() => checkForUpdates(false), EVERY)
}

let busy = false
let shownFor = '' // the version a card was already shown for in this session
const notify = (msg: string) => useStore.getState().notify(msg)
const shortNotes = (s?: string) => {
  const t = String(s || '').trim()
  return t.length > 280 ? `${t.slice(0, 280)}…` : t
}

/** `manual`: the user pressed Check now, so every outcome is said. Returns a short status line for Settings. */
export async function checkForUpdates(manual = true): Promise<string> {
  const up = updater()
  if (!up) return 'Updates work in the installed Argon app.'
  if (busy) return 'Already checking…'
  busy = true
  try {
    const r = await up.check()
    setUpdatePrefs({ lastCheck: Date.now() })
    const u = updatePrefs()
    if (!r?.ok) {
      const msg = "Couldn't check for updates. You may be offline, or no update has been published yet."
      if (manual) notify(msg)
      return msg
    }
    if (!r.available || !r.version) {
      const msg = `You have the latest version (${r.current}).`
      if (manual) notify(msg)
      return msg
    }
    if (!manual && u.mode === 'ask' && u.skip === r.version) return `Argon ${r.version} is out (skipped).`
    if (u.mode === 'auto') {
      if (!r.ready) {
        const d = await up.download()
        if (!d.ok) {
          if (manual) notify(d.error === UNVERIFIED ? `${UNVERIFIED} Argon won't install it.` : "The update didn't download. Argon will try again later.")
          return d.error === UNVERIFIED ? UNVERIFIED : 'The download failed.'
        }
      }
      if (manual || shownFor !== r.version) show({ kind: 'ready', version: r.version, notes: shortNotes(r.notes), sub: 'It installs when you close Argon. Or restart now.' })
      return `Argon ${r.version} is ready. It installs when you close Argon.`
    }
    if (manual || shownFor !== r.version) show({ kind: 'ask', version: r.version, current: r.current, notes: shortNotes(r.notes), sub: `You have ${r.current}.` })
    return `Argon ${r.version} is out. You have ${r.current}.`
  } catch {
    if (manual) notify("Couldn't check for updates.")
    return "Couldn't check for updates."
  } finally {
    busy = false
  }
}
const UNVERIFIED = "The update couldn't be verified."

function show(c: Omit<Card, 'pct' | 'busy'>) {
  shownFor = c.version
  useUpdateCard.setState({ card: { ...c, pct: null, busy: false } })
}
const patchCard = (p: Partial<Card>) => useUpdateCard.setState((s) => ({ card: s.card ? { ...s.card, ...p } : null }))
export const closeCard = () => useUpdateCard.setState({ card: null })

// Agents still running stop when Argon closes to install.
const runningAgents = () => Object.values(useStore.getState().live).filter((l) => l.agent !== 'shell').length

async function restartNow(): Promise<boolean> {
  const n = runningAgents()
  if (n) {
    const ok = await askToConfirm(
      'Restart to update?',
      `Argon closes to install the update, and ${n} running agent${n > 1 ? 's' : ''} stop${n > 1 ? '' : 's'} with it. Claude conversations can be picked up again next time.`,
      'Restart and update',
    )
    if (!ok) return false
  }
  const r = await updater()!.install(true)
  if (!r.ok) notify(`The update couldn't start: ${r.error || 'unknown error'}`)
  return r.ok
}

// ---------- the card's buttons ----------
export function skipVersion(version: string) {
  setUpdatePrefs({ skip: version })
  closeCard()
  notify(`Skipped ${version}. Settings → Updates can still install it.`)
}

export async function installOnClose() {
  closeCard()
  const d = await updater()!.download()
  notify(d.ok ? 'Downloaded. The update installs when you close Argon.' : d.error === UNVERIFIED ? `${UNVERIFIED} Argon won't install it.` : "The update didn't download. Try again from Settings → Updates.")
}

export async function updateNow() {
  patchCard({ busy: true, pct: 0, sub: 'Downloading…' })
  const d = await updater()!.download((p) => {
    if (p.total) {
      const pct = Math.min(100, Math.round((p.got / p.total) * 100))
      patchCard({ pct, sub: `Downloading… ${pct}%` })
    }
  })
  if (!d.ok) return patchCard({ busy: false, pct: null, sub: d.error === UNVERIFIED ? `${UNVERIFIED} Argon won't install it.` : 'The download failed. Check your connection and try again.' })
  patchCard({ busy: false, pct: 100, sub: 'Downloaded. Restart to finish.' })
  if (await restartNow()) closeCard()
  else patchCard({ kind: 'ready', pct: null, sub: 'Downloaded. It installs when you close Argon.' })
}

export async function restartFromCard() {
  patchCard({ busy: true })
  const ok = await restartNow()
  if (ok) closeCard()
  else patchCard({ busy: false })
}

/** Leaving Automatic: a quietly downloaded update shouldn't install behind the user's back. */
export function setUpdateMode(mode: 'auto' | 'ask') {
  setUpdatePrefs({ mode })
  if (mode === 'ask') updater()?.forget().catch(() => {})
}
