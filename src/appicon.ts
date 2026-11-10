// The window and taskbar icon follow the accent: the Argon atom is drawn here in the current colours and
// handed to Windows. Works for every accent, custom colours included.
type Colors = { bg: string; light: boolean; accent: string; accentLight: string; accentDeep: string; nucleus: string; glow: string }
let lastKey = '' // the icon Windows has now
let timer = 0

export function drawAtom(c: HTMLCanvasElement, k: Colors, S = 256) {
  const g = c.getContext('2d')!
  c.width = c.height = S
  g.clearRect(0, 0, S, S)
  const r = S * 0.23,
    m = S * 0.04,
    w = S - m * 2
  g.beginPath()
  g.roundRect(m, m, w, w, r)
  g.fillStyle = k.bg
  g.fill()
  g.save()
  g.clip()
  const rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.42)
  rg.addColorStop(0, k.glow)
  rg.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = rg
  g.fillRect(0, 0, S, S)
  g.restore()
  if (k.light) {
    g.lineWidth = S * 0.012
    g.strokeStyle = 'rgba(0,0,0,.08)'
    g.beginPath()
    g.roundRect(m, m, w, w, r)
    g.stroke()
  }
  g.lineWidth = S * 0.058
  g.lineCap = 'round'
  const orbit = (deg: number, color: string) => {
    g.save()
    g.translate(S / 2, S / 2)
    g.rotate((deg * Math.PI) / 180)
    g.beginPath()
    g.ellipse(0, 0, S * 0.355, S * 0.13, 0, 0, Math.PI * 2)
    g.strokeStyle = color
    g.stroke()
    g.restore()
  }
  orbit(60, k.accentDeep)
  orbit(120, k.accent)
  orbit(0, k.accentLight)
  g.beginPath()
  g.arc(S / 2, S / 2, S * 0.085, 0, Math.PI * 2)
  g.fillStyle = k.nucleus
  g.fill()
}

export function syncAppIcon(k: Colors) {
  const set = window.vibeboardDesktop?.setAppIcon
  if (!set) return
  const key = JSON.stringify(k)
  // Always drop a pending redraw first: changing the look and changing it straight back must end on the last one.
  clearTimeout(timer)
  if (key === lastKey) return
  timer = window.setTimeout(() => {
    lastKey = key
    const c = document.createElement('canvas')
    drawAtom(c, k)
    c.toBlob(async (b) => b && set(new Uint8Array(await b.arrayBuffer())), 'image/png')
  }, 250)
}
