// Personalization: the palette behind the board, the accent that tints it, liquid glass, Windows' own
// blur behind the window, the interface font and size. Light and dark stay in theme.ts; this paints on top.
import { useSyncExternalStore } from 'react'
import { setRefraction, startGlass } from './glass'
import { syncAppIcon } from './appicon'

export type GlassStyle = 'liquid' | 'frosted' | 'tinted' | 'solid'
export type Backdrop = 'off' | 'mica' | 'acrylic'
export type Look = {
  dark: string // palette used at night
  light: string // palette used by day
  accent: string
  tint: number // how much of the accent soaks into backgrounds and lines, 0–100
  glass: GlassStyle
  blur: number // px
  opacity: number // how solid glass surfaces are, 0–100
  refraction: number // lens strength at the glass rim, 0 = off
  prism: number // colour split at the rim, 0–100
  backdrop: Backdrop
  font: string
  scale: number // interface size, %
  anim: boolean // springs, glides and fly-to
}

// Ember: warm near-black and the ember accent, the same as the Ember entry in LOOKS. By day it pairs with Paper.
export const DEFAULT_LOOK: Look = {
  dark: 'ember',
  light: 'paper',
  accent: '#f0553a',
  tint: 0,
  glass: 'liquid',
  blur: 22,
  opacity: 58,
  refraction: 70,
  prism: 25,
  backdrop: 'off',
  font: 'Segoe UI Variable Text',
  scale: 100,
  anim: true,
}

export const ACCENTS = [
  ['Lavender', '#9a83d4'],
  ['Orchid', '#c07ad0'],
  ['Rose', '#e0889f'],
  ['Coral', '#e8957a'],
  ['Ember', '#f0553a'],
  ['Amber', '#e2b15a'],
  ['Lime', '#a9cf6a'],
  ['Mint', '#6fcfa3'],
  ['Teal', '#5cc2c2'],
  ['Sky', '#7ea8ec'],
  ['Silver', '#a9adbd'],
  ['Clay', '#d97757'],
  ['Jade', '#10a37f'],
  ['Iris', '#a371f7'],
] as const

type Palette = { name: string; bg: string; panel: string; panel2: string; panel3: string; line: string; line2: string; text: string; muted: string; dim: string; term: string }
export const DARK_PALETTES: Record<string, Palette> = {
  midnight: { name: 'Midnight', bg: '#0d0b14', panel: '#181423', panel2: '#201a2e', panel3: '#2a2340', line: '#2c2541', line2: '#3a3156', text: '#ebe6f6', muted: '#9a90b3', dim: '#6b6382', term: '#0f0c18' },
  abyss: { name: 'Abyss', bg: '#000000', panel: '#0c0a12', panel2: '#14111c', panel3: '#1d1928', line: '#1d1928', line2: '#2b2539', text: '#eeeaf8', muted: '#9a90b3', dim: '#665e7c', term: '#000000' },
  dusk: { name: 'Dusk', bg: '#1a1724', panel: '#2a2539', panel2: '#332d45', panel3: '#3d3652', line: '#3a3350', line2: '#4b4366', text: '#f2eef9', muted: '#b0a7c8', dim: '#8a81a3', term: '#1c1828' },
  slate: { name: 'Slate', bg: '#0d1016', panel: '#191e2a', panel2: '#212736', panel3: '#2b3244', line: '#262d3e', line2: '#353e54', text: '#e6e9f2', muted: '#959db4', dim: '#646c84', term: '#0f131b' },
  ember: { name: 'Ember', bg: '#0a0908', panel: '#151311', panel2: '#1d1a17', panel3: '#28241f', line: '#24211d', line2: '#37322c', text: '#f1e9dd', muted: '#968d80', dim: '#665f56', term: '#0f0e0c' },
  claude: { name: 'Claude', bg: '#1f1e1d', panel: '#30302e', panel2: '#3a3936', panel3: '#44433f', line: '#3e3d39', line2: '#4f4d48', text: '#f5f4ef', muted: '#b7b5a9', dim: '#8a877d', term: '#1f1e1d' },
  codex: { name: 'Codex', bg: '#0b0b0c', panel: '#18181b', panel2: '#202024', panel3: '#2a2a2f', line: '#26262b', line2: '#34343a', text: '#ececec', muted: '#a1a1aa', dim: '#71717a', term: '#0b0b0c' },
  gemini: { name: 'Gemini', bg: '#131314', panel: '#1e1f20', panel2: '#282a2c', panel3: '#333537', line: '#2f3133', line2: '#3c4043', text: '#e3e3e3', muted: '#a8adb3', dim: '#80868b', term: '#131314' },
  copilot: { name: 'Copilot', bg: '#010409', panel: '#161b22', panel2: '#1c2128', panel3: '#22272e', line: '#21262d', line2: '#30363d', text: '#e6edf3', muted: '#9198a1', dim: '#6e7681', term: '#0d1117' },
}
export const LIGHT_PALETTES: Record<string, Palette> = {
  daylight: { name: 'Daylight', bg: '#e7e4ef', panel: '#ffffff', panel2: '#f4f1fa', panel3: '#e8e3f3', line: '#dcd5ea', line2: '#c8bfdc', text: '#1c1727', muted: '#5a526e', dim: '#8a829e', term: '#fbfaff' },
  paper: { name: 'Paper', bg: '#f5f1ea', panel: '#fffdf9', panel2: '#f3eee6', panel3: '#e9e3d9', line: '#e4ddd2', line2: '#d4ccbf', text: '#211d18', muted: '#756c5f', dim: '#9a9184', term: '#fffdf9' },
  cloud: { name: 'Cloud', bg: '#e8eef8', panel: '#ffffff', panel2: '#f1f5fb', panel3: '#e2e9f4', line: '#d6dfec', line2: '#c1cde0', text: '#141b28', muted: '#55617a', dim: '#8792a8', term: '#fbfcff' },
}

// How much accent soaks in for a Look that doesn't say (Liquid Lavender and friends were made with this).
export const LOOK_TINT = 55
// One click sets several things at once.
export const LOOKS: { name: string; mode?: 'light' | 'dark'; set: Partial<Look> }[] = [
  { name: 'Liquid Lavender', mode: 'dark', set: { dark: 'midnight', accent: '#9a83d4', glass: 'liquid' } },
  { name: 'Obsidian', mode: 'dark', set: { dark: 'abyss', accent: '#5cc2c2', glass: 'frosted' } },
  { name: 'Campfire', mode: 'dark', set: { dark: 'dusk', accent: '#e8957a', glass: 'tinted' } },
  { name: 'Lagoon', mode: 'dark', set: { dark: 'slate', accent: '#6fcfa3', glass: 'liquid' } },
  { name: 'Ember', mode: 'dark', set: { dark: 'ember', accent: '#f0553a', glass: 'liquid', tint: 0 } },
  { name: 'Claude', mode: 'dark', set: { dark: 'claude', accent: '#d97757', glass: 'liquid' } },
  { name: 'Codex', mode: 'dark', set: { dark: 'codex', accent: '#10a37f', glass: 'liquid' } },
  { name: 'Gemini', mode: 'dark', set: { dark: 'gemini', accent: '#7c9df5', glass: 'liquid' } },
  { name: 'Copilot', mode: 'dark', set: { dark: 'copilot', accent: '#a371f7', glass: 'liquid' } },
  { name: 'Daybreak', mode: 'light', set: { light: 'daylight', accent: '#7ea8ec', glass: 'liquid' } },
  { name: 'Paper', mode: 'light', set: { light: 'paper', accent: '#dd4a28', glass: 'liquid', tint: 0 } },
]

export const UI_FONTS = ['Segoe UI Variable Text', 'Segoe UI', 'Inter', 'Bahnschrift', 'Calibri', 'Verdana', 'Georgia']

// ---- colour helpers ----
type RGB = [number, number, number]
export function hexToRgb(hex: string): RGB {
  const m = String(hex).replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [154, 131, 212]
}
function rgbToHsl([r, g, b]: RGB): RGB {
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
function hslToRgb(h: number, s: number, l: number): RGB {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const hex = (c: RGB) => '#' + c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')
const mix = (a: string, b: RGB | string, k: number) => {
  const x = hexToRgb(a),
    y = typeof b === 'string' ? hexToRgb(b) : b
  return hex([0, 1, 2].map((i) => x[i] * (1 - k) + y[i] * k) as RGB)
}
const rgba = (c: RGB | string, a: number) => {
  const v = typeof c === 'string' ? hexToRgb(c) : c
  return `rgb(${v[0]} ${v[1]} ${v[2]} / ${a.toFixed(3)})`
}
const shade = (hexColor: string, dl: number, ds = 1) => {
  const [h, s, l] = rgbToHsl(hexToRgb(hexColor))
  return hex(hslToRgb(h, clamp(s * ds, 0, 100), clamp(l + dl, 0, 100)))
}

// A spring that overshoots a touch and settles, used for every animation while Animations is on.
export const BOUNCE = 'linear(0, 0.0066, 0.0263 2.1%, 0.1023 4.4%, 0.2319 7.3%, 0.4103 10.6%, 0.6029 14.4%, 0.7663 18.3%, 0.8897 22.6%, 0.9582 26.6%, 1.0047 31.3%, 1.0272 36.7%, 1.0311 41.2%, 1.0219 48.3%, 1.0052 61.3%, 0.9989 77.7%, 1)'

// ---- the current look ----
const KEY = 'argon-look'
const listeners = new Set<() => void>()
function remembered(): Look {
  try {
    return { ...DEFAULT_LOOK, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch {
    return { ...DEFAULT_LOOK }
  }
}
let look: Look = remembered()
let tone: 'light' | 'dark' = 'dark'

export const currentLook = () => look
export const useLook = () =>
  useSyncExternalStore((cb) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }, currentLook)

export function setLook(next?: Partial<Look>) {
  look = { ...DEFAULT_LOOK, ...(next || {}) }
  try {
    localStorage.setItem(KEY, JSON.stringify(look))
  } catch {}
  paintLook(tone)
}

// Mixes the accent into the palette so the whole window takes its colour.
const TINT: [keyof Palette, number][] = [['bg', 0.16], ['panel', 0.19], ['panel2', 0.21], ['panel3', 0.23], ['line', 0.3], ['line2', 0.32], ['muted', 0.14], ['dim', 0.14], ['term', 0.12]]
function tinted(p: Palette, accent: string, amount: number, light: boolean): Palette {
  const k = (clamp(amount, 0, 100) / 100) * (light ? 0.45 : 1)
  if (!k) return p
  const out = { ...p }
  for (const [key, w] of TINT) out[key] = mix(p[key], accent, w * k)
  return out
}

// What a terminal draws with, so consoles match the board.
export function terminalColors(t: 'light' | 'dark') {
  const L = look
  const light = t === 'light'
  const p = tinted((light ? LIGHT_PALETTES[L.light] || LIGHT_PALETTES.paper : DARK_PALETTES[L.dark] || DARK_PALETTES.ember), L.accent, L.tint, light)
  const accent = light ? shade(L.accent, -12) : shade(L.accent, 8)
  return { background: p.term, foreground: p.text, cursor: accent, cursorAccent: p.term, selectionBackground: rgba(L.accent, light ? 0.25 : 0.32) }
}

const GLASS: Record<GlassStyle, { sat: number; rim: number; minBlur?: number; minOpacity?: number; accent?: boolean; lens: number }> = {
  liquid: { sat: 1.6, rim: 1, lens: 1 },
  frosted: { sat: 1.4, rim: 0.7, minBlur: 26, minOpacity: 68, lens: 0.5 },
  tinted: { sat: 1.7, rim: 0.9, accent: true, minOpacity: 50, lens: 1 },
  solid: { sat: 1, rim: 0.4, lens: 0 },
}

export function paintLook(t: 'light' | 'dark') {
  tone = t
  const L = look
  const light = t === 'light'
  const base = light ? LIGHT_PALETTES[L.light] || LIGHT_PALETTES.paper : DARK_PALETTES[L.dark] || DARK_PALETTES.ember
  const p = tinted(base, L.accent, L.tint, light)
  const g = GLASS[L.glass] || GLASS.liquid
  const root = document.documentElement
  const set = (k: string, v: string) => root.style.setProperty(k, v)
  const bd = (window.vibeboardDesktop?.platform === 'win32' && L.backdrop !== 'off') as boolean

  // palette
  set('--bg', bd ? rgba(p.bg, light ? 0.55 : 0.42) : p.bg)
  set('--panel', p.panel)
  set('--panel-2', p.panel2)
  set('--panel-3', p.panel3)
  set('--line', p.line)
  set('--line-2', p.line2)
  set('--text', p.text)
  set('--text-2', mix(p.text, p.muted, 0.35))
  set('--muted', p.muted)
  set('--faint', p.dim)
  set('--ink', hexToRgb(p.text).join(' '))
  set('--edge', mix(p.muted, p.bg, 0.25))
  set('--grid', mix(p.line, L.accent, light ? 0.18 : 0.22))
  set('--term-bg', p.term)
  set('--chip-bg', mix(p.panel, p.bg, 0.4))

  // accent: a little darker by day so text in it stays readable
  const accent = light ? shade(L.accent, -12) : L.accent
  set('--accent', accent)
  set('--accent-rgb', hexToRgb(accent).join(' '))
  set('--accent-light', light ? shade(L.accent, -4) : shade(L.accent, 14))
  set('--accent-deep', shade(L.accent, light ? -26 : -22, 0.85))
  set('--working', accent)
  set('--syn-heading', accent)

  // glass
  const opacity = clamp(Math.max(L.opacity, g.minOpacity || 0), 10, 100) / 100
  const glassRgb = g.accent ? hexToRgb(mix(p.panel, L.accent, 0.3)) : hexToRgb(p.panel)
  const solid = L.glass === 'solid'
  set('--glass', solid ? p.panel : rgba(glassRgb, opacity))
  set('--popover', solid ? p.panel : rgba(glassRgb, clamp(opacity + 0.26, 0, 0.95)))
  const blur = Math.max(L.blur, g.minBlur || 0)
  set('--blur', solid ? 'none' : `saturate(${Math.round(g.sat * 100)}%) blur(${blur}px)`)
  const rim = g.rim * (light ? 0.9 : 1)
  set('--g-rim', String(rim))
  set(
    '--rim',
    light
      ? `inset 0 0 0 1px rgb(60 45 90 / 0.1), inset 0 1px 0.5px rgb(255 255 255 / ${0.9 * rim}), inset 0 -1px 1px rgb(255 255 255 / ${0.3 * rim})`
      : `inset 0 0 0 1px rgb(255 255 255 / ${0.08 + 0.04 * rim}), inset 0 1px 0.5px rgb(255 255 255 / ${0.3 * rim}), inset 0 -1px 1px rgb(255 255 255 / ${0.06 * rim}), inset 0 0 14px rgb(255 255 255 / ${0.04 * rim})`,
  )
  document.body.dataset.glass = L.glass
  // Motion: springs that overshoot a little, or none at all.
  document.body.classList.toggle('no-anim', !L.anim)
  set('--spring', L.anim ? BOUNCE : 'cubic-bezier(0.22, 1, 0.36, 1)')
  document.body.dataset.tone = t
  root.dataset.backdrop = bd ? L.backdrop : 'off'
  setRefraction(solid ? 0 : L.refraction * g.lens, solid ? 0 : clamp(L.prism, 0, 100) / 100)

  // type and size
  set('--font', `"${L.font}", 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif`)

  // the window itself: caption buttons, Windows blur, zoom, the taskbar icon
  const desk = window.vibeboardDesktop
  desk?.setLook?.({ overlay: bd ? '#00000000' : p.bg, symbol: light ? p.text : mix(p.text, L.accent, 0.25), backdrop: bd ? L.backdrop : 'none', scale: clamp(L.scale, 75, 140) / 100 })
  const [h, s, l] = rgbToHsl(hexToRgb(L.accent))
  syncAppIcon({
    bg: base.bg,
    light,
    accent: L.accent,
    accentLight: light ? shade(L.accent, -10) : shade(L.accent, 16),
    accentDeep: light ? shade(L.accent, -28, 0.8) : shade(L.accent, -10, 0.9),
    nucleus: hex(hslToRgb(h, s, light ? Math.max(30, l - 8) : Math.min(92, l + 26))),
    glow: rgba(L.accent, light ? 0.22 : 0.42),
  })
  listeners.forEach((f) => f())
}

startGlass()
