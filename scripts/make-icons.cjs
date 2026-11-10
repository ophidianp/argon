// Draws Argon's logo (the atom) in the default Ember look and writes every static copy of it:
//   build/icon.svg, docs/logo/argon.svg   the vector logo
//   build/icon.ico                        16–256 px, for the installer, shortcuts, Explorer and the taskbar
//   build/icon.icns                       for a Mac build
// The geometry and colours are the same as drawAtom in src/appicon.ts and paintLook in src/appearance.ts, so the
// icon Windows shows before the page paints matches the one the page then draws.
//
//   npx electron scripts/make-icons.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const BG = '#0a0908' // Ember's background
const ACCENT = '#f0553a'

// ---------- colour maths, as in src/appearance.ts ----------
const hexToRgb = (h) => h.replace('#', '').match(/../g).map((x) => parseInt(x, 16))
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const hex = (c) => '#' + c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')
function rgbToHsl([r, g, b]) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b)
  let h = 0,
    s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h /= 6
  }
  return [h * 360, s * 100, l * 100]
}
function hslToRgb(h, s, l) {
  s /= 100
  l /= 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}
const shade = (c, dl, ds = 1) => {
  const [h, s, l] = rgbToHsl(hexToRgb(c))
  return hex(hslToRgb(h, clamp(s * ds, 0, 100), clamp(l + dl, 0, 100)))
}
// The dark-mode colours paintLook hands to syncAppIcon.
const [h, s, l] = rgbToHsl(hexToRgb(ACCENT))
const K = {
  accent: ACCENT,
  accentLight: shade(ACCENT, 16),
  accentDeep: shade(ACCENT, -10, 0.9),
  nucleus: hex(hslToRgb(h, s, Math.min(92, l + 26))),
}

// ---------- the atom, as drawAtom draws it on a 256 grid ----------
const S = 256
const n = (v) => +v.toFixed(2)
const m = S * 0.04,
  w = S - m * 2,
  r = S * 0.23
const orbit = (deg, color) =>
  `  <ellipse cx="128" cy="128" rx="${n(S * 0.355)}" ry="${n(S * 0.13)}" transform="rotate(${deg} 128 128)" stroke="${color}" stroke-width="${n(S * 0.058)}"/>`
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="1024" height="1024" fill="none" stroke-linecap="round">
  <defs>
    <radialGradient id="glow" gradientUnits="userSpaceOnUse" cx="128" cy="128" r="${n(S * 0.42)}"><stop offset="0" stop-color="${ACCENT}" stop-opacity=".42"/><stop offset="1" stop-color="${ACCENT}" stop-opacity="0"/></radialGradient>
    <clipPath id="tile"><rect x="${n(m)}" y="${n(m)}" width="${n(w)}" height="${n(w)}" rx="${n(r)}"/></clipPath>
  </defs>
  <rect x="${n(m)}" y="${n(m)}" width="${n(w)}" height="${n(w)}" rx="${n(r)}" fill="${BG}"/>
  <rect width="256" height="256" fill="url(#glow)" clip-path="url(#tile)"/>
${orbit(60, K.accentDeep)}
${orbit(120, K.accent)}
${orbit(0, K.accentLight)}
  <circle cx="128" cy="128" r="${n(S * 0.085)}" fill="${K.nucleus}"/>
</svg>
`

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
  console.log('wrote build/icon.svg, build/icon.ico, build/icon.icns, docs/logo/argon.svg', K)
  app.quit()
})
