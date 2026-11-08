// vibeboard as a macOS app: starts the local server, then shows the board in a real window. Web tiles
// become real browsers here: pages that refuse to be framed (Google, GitHub…) load, because the window
// strips the headers that forbid framing, for frames only.
const { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const PORT = Number(process.env.PORT) || 4317
const ORIGIN = `http://127.0.0.1:${PORT}`
const ROOT = path.join(__dirname, '..')
let server = null
let quitting = false
let restarts = []
const MAX_RESTARTS = 3
const RESTART_WINDOW_MS = 60_000

const alive = () =>
  new Promise((resolve) => {
    const req = http.get(`${ORIGIN}/api/state`, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1000, () => req.destroy())
  })

const logFile = () => path.join(app.getPath('logs'), 'server.log')

// A downloaded app has no Node to count on, so it runs the server with the Node inside Electron (node-pty
// ships prebuilt for it). From a checkout, the system's Node, as in `npm run dev`.
function startServer() {
  const env = { ...process.env, NODE_ENV: 'production', PORT: String(PORT) }
  if (!app.isPackaged) {
    const shell = process.env.SHELL || '/bin/zsh'
    return spawn(shell, ['-lic', 'exec node server/index.mjs'], { cwd: ROOT, env, stdio: 'inherit' })
  }
  fs.mkdirSync(path.dirname(logFile()), { recursive: true })
  const log = fs.openSync(logFile(), 'a')
  return spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], { cwd: ROOT, env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', log, log] })
}

// A server already running on the port (npm run dev, a second window) is reused, not doubled.
async function ensureServer() {
  if (await alive()) return
  let failed = false
  server = startServer()
  server.on('exit', (code) => {
    server = null
    failed = true
    if (quitting) return
    console.error(`vibeboard server exited with ${code}`)
    // After a crash the page reconnects by itself, and consoles offer to pick their conversation up.
    if (BrowserWindow.getAllWindows().length) restartServer()
  })
  for (let i = 0; i < 80 && !failed; i++) {
    if (await alive()) return
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`the vibeboard server did not start on port ${PORT}`)
}

async function restartServer() {
  restarts = [...restarts.filter((t) => Date.now() - t < RESTART_WINDOW_MS), Date.now()]
  if (restarts.length > MAX_RESTARTS) {
    dialog.showErrorBox('vibeboard stopped working', `Its server keeps stopping. Details are in ${logFile()}.`)
    return app.quit()
  }
  try {
    await ensureServer()
  } catch (err) {
    console.error(err.message)
  }
}

// Only the board itself may use the microphone (dictation), notifications and the clipboard. A site in a
// web tile gets nothing: Electron would otherwise grant it the camera, the microphone and the location.
const MAY = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'fullscreen'])
const ours = (url) => typeof url === 'string' && (url === ORIGIN || url.startsWith(`${ORIGIN}/`))
function guardPermissions() {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done, details) => done(MAY.has(permission) && details.isMainFrame && ours(details.requestingUrl)))
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin, details) => MAY.has(permission) && ours(origin) && details.isMainFrame !== false)
}

// Frames only: the app's own page keeps every protection it has.
function allowFraming() {
  session.defaultSession.webRequest.onHeadersReceived((details, done) => {
    if (details.resourceType !== 'subFrame') return done({})
    const headers = { ...details.responseHeaders }
    for (const key of Object.keys(headers)) {
      const k = key.toLowerCase()
      if (k === 'x-frame-options') delete headers[key]
      else if (k === 'content-security-policy') headers[key] = headers[key].map((v) => v.replace(/frame-ancestors[^;]*;?/gi, ''))
    }
    done({ responseHeaders: headers })
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    title: 'vibeboard',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0908' : '#f5f1ea',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    show: !process.env.VIBEBOARD_DESKTOP_HIDDEN, // tests drive a hidden window over CDP
    // Agents keep working while the window is behind others: their output must keep being drawn.
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  })
  // Links meant for a new window ("Open in your browser") go to the real browser; nothing else opens.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  // The board never navigates away from itself.
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) e.preventDefault()
  })
  // The server can be a moment late, or restarting.
  win.webContents.on('did-fail-load', (_e, _code, _text, url, isMain) => {
    if (isMain && url.startsWith(ORIGIN)) setTimeout(() => !win.isDestroyed() && win.loadURL(ORIGIN), 800)
  })
  win.loadURL(ORIGIN)
  return win
}

ipcMain.on('inspect', (e, x, y) => {
  e.sender.inspectElement(Math.round(Number(x) || 0), Math.round(Number(y) || 0))
})

// The traffic lights and native dialogs follow the theme chosen in Settings.
ipcMain.on('theme', (_e, mode) => {
  if (['system', 'light', 'dark'].includes(mode)) nativeTheme.themeSource = mode
})

ipcMain.handle('pick-folder', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
  return canceled ? null : filePaths[0]
})

// Quitting stops every agent, so it is never silent while any is running.
async function runningAgents() {
  try {
    const res = await fetch(`${ORIGIN}/api/sessions`)
    return (await res.json()).filter((s) => s.agent !== 'shell').length
  } catch {
    return 0
  }
}

app.on('before-quit', async (e) => {
  if (quitting || !server) return
  e.preventDefault()
  const n = await runningAgents()
  if (n) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      message: `Quit vibeboard and stop ${n} running agent${n > 1 ? 's' : ''}?`,
      detail: 'Claude conversations can be picked up again next time.',
      buttons: ['Quit', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    })
    if (response === 1) return
  }
  quitting = true
  app.quit()
})

app.setName('vibeboard')

// Opening it a second time brings the window that is already there to the front.
if (!app.requestSingleInstanceLock()) app.exit(0)
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return createWindow()
  if (win.isMinimized()) win.restore()
  win.focus()
})
app.whenReady().then(async () => {
  guardPermissions()
  allowFraming()
  try {
    await ensureServer()
  } catch (err) {
    console.error(err.message)
    dialog.showErrorBox('vibeboard could not start', `${err.message}. Another program may be using the port, or the details may be in ${logFile()}.`)
    app.quit()
    return
  }
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
app.on('window-all-closed', () => app.quit())
app.on('quit', () => server?.kill('SIGTERM'))
