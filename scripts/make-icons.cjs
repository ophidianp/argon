// Draws Argon's icon (the "a" from the website's wordmark, dark on a rounded Ember tile; see shared/logo.js) and
// writes every static copy of it:
//   build/icon.svg, docs/logo/argon.svg   the vector icon
//   build/icon.ico                        16–256 px, for the installer, shortcuts, Explorer and the taskbar
//   build/icon.icns                       for a Mac build
// It is the same drawing as drawAppIcon in src/appicon.ts with Ember's accent, so the icon Windows shows before the
// page paints matches the one the page then draws.
//
//   npx electron scripts/make-icons.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.join(__dirname, '..')
const ACCENT = '#f0553a' // Ember, the default look

// ---------- containers ----------
// ICO with PNG images (Windows Vista and later read these at every size).
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(pngs.length, 4)
  let offset = head.length
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + i * 16
    head.writeUInt8(size >= 256 ? 0 : size, e)
    head.writeUInt8(size >= 256 ? 0 : size, e + 1)
    head.writeUInt8(0, e + 2)
    head.writeUInt8(0, e + 3)
    head.writeUInt16LE(1, e + 4)
    head.writeUInt16LE(32, e + 6)
    head.writeUInt32LE(data.length, e + 8)
    head.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([head, ...pngs.map((p) => p.data)])
}
// ICNS with PNG chunks.
function icns(bySize) {
  const TYPES = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]]
  const chunks = TYPES.map(([type, size]) => {
    const data = bySize[size]
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([head, data])
  })
  const body = Buffer.concat(chunks)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([head, body])
}

app.whenReady().then(async () => {
  const { iconSvg } = await import(pathToFileURL(path.join(ROOT, 'shared', 'logo.js')).href)
  const svg = iconSvg(ACCENT)
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.svg'), svg)
  fs.writeFileSync(path.join(ROOT, 'docs', 'logo', 'argon.svg'), svg)
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html,<body></body>')
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
  const out = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image()
    img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}'
    await img.decode()
    const r = {}
    for (const s of ${JSON.stringify(sizes)}) {
      const c = document.createElement('canvas')
      c.width = c.height = s
      c.getContext('2d').drawImage(img, 0, 0, s, s)
      r[s] = c.toDataURL('image/png').split(',')[1]
    }
    return r
  })()`)
  const png = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Buffer.from(v, 'base64')]))
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, data: png[size] }))))
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.icns'), icns(png))
  if (process.env.ICON_PNG_DIR) for (const [k, v] of Object.entries(png)) fs.writeFileSync(path.join(process.env.ICON_PNG_DIR, `icon-${k}.png`), v)
  console.log('wrote build/icon.svg, build/icon.ico, build/icon.icns, docs/logo/argon.svg')
  app.quit()
})
