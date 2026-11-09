// Updates for the installed app: signed releases from GitHub (ophidianp/argon) through electron-updater.
// The page decides when to download and install (Settings → Updates, the card in the corner); nothing installs
// without a click, except an update the user chose to have installed when Argon closes.
//
// Every installer is checked against Argon's own minisign key (desktop/minisign.cjs) before it can install: its .sig
// is fetched from the same release, and a missing or bad one throws the download away.
const { verifyFile } = require('./minisign.cjs')

const UNVERIFIED = "The update couldn't be verified."

/**
 * `stop()` ends the server and its agents before the installer runs; `quitting()` tells main.cjs not to ask again
 * (the page has already confirmed the running agents).
 */
function setupUpdater({ app, ipcMain, net, stop, quitting }) {
  // Tests point a checkout at a local feed: ARGON_UPDATE_FEED=<dev-app-update.yml>. Never honoured once installed.
  const feed = !app.isPackaged && process.env.ARGON_UPDATE_FEED
  const enabled = app.isPackaged || !!feed
  ipcMain.on('update:available', (e) => (e.returnValue = enabled))
  if (!enabled) return

  const { autoUpdater } = require('electron-updater')
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.disableWebInstaller = true
  autoUpdater.logger = { info() {}, warn() {}, debug() {}, error: (e) => console.error('[update]', e?.message || e) }
  // A checkout started as `electron desktop/main.cjs` reports Electron's own version; the feed test needs Argon's.
  let version = () => app.getVersion()
  if (feed) {
    autoUpdater.forceDevUpdateConfig = true
    autoUpdater.updateConfigPath = feed
    const own = require('../package.json').version
    const semver = require(require.resolve('semver', { paths: [require.resolve('electron-updater')] }))
    autoUpdater.currentVersion = semver.parse(own)
    version = () => own
  }

  // electron-updater calls this on every downloaded installer; a string back means "refuse", and it deletes the file.
  const sigUrl = () => {
    const { info, provider } = autoUpdater.updateInfoAndProvider || {}
    const [file] = provider ? provider.resolveFiles(info) : []
    if (!file) throw new Error('no installer in this release')
    const u = new URL(file.url)
    u.pathname += '.sig'
    return u.href
  }
  const checkSignature = async (installer) => {
    try {
      const res = await net.fetch(sigUrl())
      if (!res.ok) return `no signature next to the installer (${res.status})`
      await verifyFile(installer, await res.text())
      return null
    } catch (e) {
      return e.message || 'the signature could not be checked'
    }
  }
  autoUpdater.verifySignature = checkSignature
  autoUpdater.verifyUpdateCodeSignature = (_names, installer) => checkSignature(installer)

  let ready = null // the version downloaded and verified
  const fail = (e) => ({ ok: false, error: e?.code === 'ERR_UPDATER_INVALID_SIGNATURE' ? UNVERIFIED : e?.message || String(e) })
  const text = (notes) =>
    (Array.isArray(notes) ? notes.map((n) => n.note || '').join('\n\n') : String(notes || ''))
      .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

  ipcMain.handle('update:version', () => version())

  ipcMain.handle('update:check', async () => {
    try {
      const r = await autoUpdater.checkForUpdates()
      const current = version()
      if (!r || !r.isUpdateAvailable) return { ok: true, available: false, current }
      const info = r.updateInfo
      return { ok: true, available: true, version: info.version, current, notes: text(info.releaseNotes), date: info.releaseDate || null, ready: ready === info.version }
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('update:download', async (e) => {
    const progress = (p) => {
      if (!e.sender.isDestroyed()) e.sender.send('update:progress', { got: p.transferred, total: p.total })
    }
    autoUpdater.on('download-progress', progress)
    try {
      const r = await autoUpdater.checkForUpdates()
      if (!r || !r.isUpdateAvailable) return { ok: true, available: false }
      const version = r.updateInfo.version
      if (ready !== version) {
        await autoUpdater.downloadUpdate()
        ready = version
      }
      // Downloaded and verified: it installs when Argon closes, unless the user switches to Ask first.
      autoUpdater.autoInstallOnAppQuit = true
      return { ok: true, available: true, version }
    } catch (err) {
      return fail(err)
    } finally {
      autoUpdater.off('download-progress', progress)
    }
  })

  ipcMain.handle('update:install', (_e, restart) => {
    if (!ready) return { ok: false, error: 'No update is downloaded yet.' }
    quitting()
    stop()
    // After this handler has answered, so the page isn't left waiting on a closed window.
    setTimeout(() => autoUpdater.quitAndInstall(true, !!restart), 200)
    return { ok: true }
  })

  ipcMain.handle('update:forget', () => {
    autoUpdater.autoInstallOnAppQuit = false
    ready = null
    return { ok: true }
  })
}

module.exports = { setupUpdater, UNVERIFIED }
