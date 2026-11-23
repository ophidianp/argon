// The window and taskbar icon follow the accent: the Argon "a" (shared/logo.js, the website's favicon) is drawn
// here on a tile in the current accent and handed to Windows. Works for every accent, custom colours included.
import { MARK, markInk, markPlacement } from '../shared/logo.js'

type Colors = { bg: string; light: boolean; accent: string; accentLight: string; accentDeep: string; nucleus: string; glow: string }
let lastKey = '' // the icon Windows has now
let timer = 0
let current: Colors | null = null // the colours of the icon now, for Settings → About
let mark: Path2D | null = null

export const appIconColors = () => current

export function drawAppIcon(c: HTMLCanvasElement, k: Colors, S = 256) {
  const g = c.getContext('2d')!
  c.width = c.height = S
  g.clearRect(0, 0, S, S)
  const p = markPlacement(S)
  g.beginPath()
  g.roundRect(0, 0, S, S, p.radius)
  g.fillStyle = k.accent
  g.fill()
  mark ??= new Path2D(MARK)
  g.save()
  g.translate(p.x, p.y)
  g.scale(p.scale, p.scale)
  g.fillStyle = markInk(k.accent)
  g.fill(mark)
  g.restore()
}

export function syncAppIcon(k: Colors) {
  current = k
  const set = window.vibeboardDesktop?.setAppIcon
  if (!set) return
  const key = JSON.stringify(k)
  // Always drop a pending redraw first: changing the look and changing it straight back must end on the last one.
  clearTimeout(timer)
  if (key === lastKey) return
  timer = window.setTimeout(() => {
    lastKey = key
    const c = document.createElement('canvas')
    drawAppIcon(c, k)
    c.toBlob(async (b) => b && set(new Uint8Array(await b.arrayBuffer())), 'image/png')
  }, 250)
}
