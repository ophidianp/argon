// Liquid glass: the backdrop bends at the rim of each glass surface like the thick edge of a lens, with a
// slight colour split, and a soft glare follows the pointer. Surfaces are found by class as they appear.
const SVGNS = 'http://www.w3.org/2000/svg'
// Bars, pills, menus and dialogs. Everything else keeps the plain frosted look.
const SURFACES = '.pill, .toolbar, .commandbar, .menu, .modal, .hint-chip, .ctx-panel, .ask-card, .selection-bar, .connect-banner, .toast, .project-card'
let defs: SVGDefsElement | null = null
let strength = 0
let prism = 0.25
let seq = 0
type Item = { id: string; w: number; h: number; s: number; p: number; ro: ResizeObserver; timer: number }
const items = new Map<HTMLElement, Item>()

function ensureDefs() {
  if (defs) return defs
  const svg = document.createElementNS(SVGNS, 'svg')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'
  defs = document.createElementNS(SVGNS, 'defs')
  svg.append(defs)
  document.body.append(svg)
  return defs
}

// Displacement maps for a rounded rectangle: pixels near the rim sample from further inside (the lens),
// and a dispersion field, stronger toward the rim, pulls red and blue apart.
function maps(w: number, h: number, radius: number): [string, string] {
  const k = Math.min(1, 420 / Math.max(w, h))
  const W = Math.max(4, Math.round(w * k)),
    H = Math.max(4, Math.round(h * k))
  const R = radius * k
  const bezel = Math.max(8 * k, Math.min(R * 1.25 + 6 * k, Math.min(W, H) / 2, 42 * k))
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')!
  const a = ctx.createImageData(W, H),
    b = ctx.createImageData(W, H)
  const d = a.data,
    d2 = b.data
  const cx = W / 2,
    cy = H / 2,
    hx = W / 2 - R,
    hy = H / 2 - R
  for (let y = 0; y < H; y++) {
    const py = y + 0.5 - cy,
      ay = Math.abs(py),
      sy = Math.sign(py) || 1
    for (let x = 0; x < W; x++) {
      const px = x + 0.5 - cx,
        ax = Math.abs(px),
        sx = Math.sign(px) || 1
      const qx = ax - hx,
        qy = ay - hy
      let sd: number, nx: number, ny: number
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy)
        sd = len - R
        nx = (qx / len) * sx
        ny = (qy / len) * sy
      } else if (qx > qy) {
        sd = qx - R
        nx = sx
        ny = 0
      } else {
        sd = qy - R
        nx = 0
        ny = sy
      }
      const i = (y * W + x) * 4
      const inside = -sd
      let m = 0
      if (inside >= 0 && inside < bezel) m = Math.pow(1 - inside / bezel, 1.5)
      d[i] = 128 - nx * m * 127
      d[i + 1] = 128 - ny * m * 127
      d[i + 2] = 128
      d[i + 3] = 255
      const rx = px / cx,
        ry = py / cy
      const rr = Math.min(1, Math.hypot(rx, ry))
      const base = inside >= 0 ? 0.55 * Math.pow(rr, 1.4) : 0
      const ex = rx * base + nx * m * 0.65,
        ey = ry * base + ny * m * 0.65
      d2[i] = 128 + Math.max(-1, Math.min(1, ex)) * 127
      d2[i + 1] = 128 + Math.max(-1, Math.min(1, ey)) * 127
      d2[i + 2] = 128
      d2[i + 3] = 255
    }
  }
  ctx.putImageData(a, 0, 0)
  const lens = cv.toDataURL()
  ctx.putImageData(b, 0, 0)
  return [lens, cv.toDataURL()]
}

function filterMarkup(id: string, w: number, h: number, [lens, disp]: [string, string], s: number) {
  const a = (6 + s * 0.3) * prism * 2.6
  const only = { r: '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0', g: '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0', b: '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0' }
  return `<filter id="${id}" x="0" y="0" width="${w}" height="${h}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feImage href="${lens}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="lensMap"/>
<feImage href="${disp}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="dispMap"/>
<feDisplacementMap in="SourceGraphic" in2="lensMap" scale="${s.toFixed(1)}" xChannelSelector="R" yChannelSelector="G" result="lens"/>
<feDisplacementMap in="lens" in2="dispMap" scale="${(-a).toFixed(1)}" xChannelSelector="R" yChannelSelector="G" result="dr"/>
<feColorMatrix in="dr" type="matrix" values="${only.r}" result="r"/>
<feDisplacementMap in="lens" in2="dispMap" scale="${(-a * 0.5).toFixed(1)}" xChannelSelector="R" yChannelSelector="G" result="dg"/>
<feColorMatrix in="dg" type="matrix" values="${only.g}" result="g"/>
<feColorMatrix in="lens" type="matrix" values="${only.b}" result="b"/>
<feBlend in="r" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="b" mode="screen"/>
</filter>`
}

function build(el: HTMLElement, it: Item, force: boolean) {
  if (!el.isConnected) return drop(el)
  const w = Math.round(el.offsetWidth),
    h = Math.round(el.offsetHeight)
  if (strength <= 0 || w < 10 || h < 10) {
    el.style.removeProperty('--lg-filter')
    defs?.querySelector('#' + it.id)?.remove()
    it.w = 0
    it.s = 0
    return
  }
  if (!force && w === it.w && h === it.h && it.s === strength && it.p === prism) return
  Object.assign(it, { w, h, s: strength, p: prism })
  const r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, h / 2, w / 2)
  const holder = document.createElementNS(SVGNS, 'svg')
  holder.innerHTML = filterMarkup(it.id, w, h, maps(w, h, r), strength * 0.5)
  ensureDefs().querySelector('#' + it.id)?.remove()
  defs!.append(holder.firstElementChild!)
  el.style.setProperty('--lg-filter', `url(#${it.id})`)
}

function drop(el: HTMLElement) {
  const it = items.get(el)
  if (!it) return
  it.ro.disconnect()
  clearTimeout(it.timer)
  defs?.querySelector('#' + it.id)?.remove()
  items.delete(el)
}

function glassify(el: HTMLElement) {
  el.classList.add('lg')
  if (items.has(el)) return
  const it: Item = { id: 'lgf' + ++seq, w: 0, h: 0, s: 0, p: 0, ro: null!, timer: 0 }
  // Rebuilt once the size settles: panels animate their size.
  it.ro = new ResizeObserver(() => {
    clearTimeout(it.timer)
    it.timer = window.setTimeout(() => build(el, it, false), it.w ? 90 : 0)
  })
  it.ro.observe(el)
  items.set(el, it)
}

export function setRefraction(s: number, p: number) {
  const ns = Math.max(0, +s || 0),
    np = Math.max(0, Math.min(1, +p || 0))
  if (ns === strength && np === prism) return
  strength = ns
  prism = np
  for (const [el, it] of items) build(el, it, true)
}

let started = false
export function startGlass() {
  if (started) return
  started = true
  const scan = (root: ParentNode) => {
    if (root instanceof HTMLElement && root.matches(SURFACES)) glassify(root)
    root.querySelectorAll?.<HTMLElement>(SURFACES).forEach(glassify)
  }
  const go = () => {
    scan(document.body)
    new MutationObserver((list) => {
      for (const m of list) {
        m.addedNodes.forEach((n) => n instanceof HTMLElement && scan(n))
        m.removedNodes.forEach((n) => {
          if (!(n instanceof HTMLElement)) return
          if (items.has(n)) drop(n)
          n.querySelectorAll?.<HTMLElement>('.lg').forEach(drop)
        })
      }
    }).observe(document.body, { childList: true, subtree: true })
  }
  if (document.body) go()
  else addEventListener('DOMContentLoaded', go)

  // A glare that follows the pointer across glass.
  let last: HTMLElement | null = null
  document.addEventListener(
    'pointermove',
    (e) => {
      const el = (e.target as Element)?.closest?.<HTMLElement>('.lg') || null
      if (last && last !== el) last.classList.remove('lg-hot')
      last = el
      if (!el) return
      const r = el.getBoundingClientRect()
      el.style.setProperty('--mx', (e.clientX - r.left).toFixed(0) + 'px')
      el.style.setProperty('--my', (e.clientY - r.top).toFixed(0) + 'px')
      el.classList.add('lg-hot')
    },
    { passive: true },
  )
}
