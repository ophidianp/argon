// Markdown studio: which notes link to which, and where to draw them on the link graph.

const MD = /\.(md|mdx|markdown)$/i
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/** A link's target as a path from the repo root ("/x" starts at the root), or null when it climbs out. */
export function resolveLink(from, href) {
  const parts = href.startsWith('/') ? [] : dirOf(from).split('/').filter(Boolean)
  for (const seg of href.split('/')) {
    if (seg === '..') {
      if (!parts.length) return null
      parts.pop()
    } else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

/** The notes `from` links to: [text](other.md) relative to it, and [[other]] by file name. */
export function noteLinks(from, text, paths) {
  const known = new Set(paths)
  const byName = new Map(paths.map((p) => [p.split('/').pop().replace(MD, '').toLowerCase(), p]))
  const out = new Set()
  for (const m of text.matchAll(/\]\(\s*<?([^)\s>#?]+)[^)]*\)/g)) {
    let href
    try {
      href = decodeURI(m[1])
    } catch {
      continue // a link with a broken escape
    }
    if (/^[a-z][\w+.-]*:/i.test(href) || !MD.test(href)) continue // a web link or not a note
    const target = resolveLink(from, href)
    if (target && known.has(target)) out.add(target)
  }
  for (const m of text.matchAll(/\[\[([^\]|#]+)/g)) {
    const target = byName.get(m[1].trim().replace(MD, '').toLowerCase())
    if (target) out.add(target)
  }
  out.delete(from)
  return [...out]
}

/**
 * A force layout of the link graph: notes push each other apart, links pull, a weak pull keeps it
 * centred. Deterministic (notes start on a sunflower spiral), scaled to fit width × height.
 * ponytail: O(n²) per step, fine for a few hundred notes; a quadtree if repos bring thousands.
 */
export function layoutGraph(ids, links, { width = 800, height = 600, steps = 300 } = {}) {
  const n = ids.length
  const at = new Map(ids.map((id, i) => [id, i]))
  const pos = ids.map((_, i) => {
    const a = i * 2.39996 // golden angle
    const r = 12 * Math.sqrt(i + 0.5)
    return { x: Math.cos(a) * r, y: Math.sin(a) * r }
  })
  const pairs = links.map(([a, b]) => [at.get(a), at.get(b)]).filter(([a, b]) => a !== undefined && b !== undefined && a !== b)
  for (let step = 0; step < steps; step++) {
    const move = pos.map((p) => ({ x: -p.x * 0.05, y: -p.y * 0.05 }))
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i].x - pos[j].x
        const dy = pos[i].y - pos[j].y
        const d2 = Math.max(dx * dx + dy * dy, 1)
        const f = 400 / d2
        move[i].x += dx * f
        move[i].y += dy * f
        move[j].x -= dx * f
        move[j].y -= dy * f
      }
    for (const [a, b] of pairs) {
      const dx = pos[b].x - pos[a].x
      const dy = pos[b].y - pos[a].y
      const d = Math.max(Math.hypot(dx, dy), 1)
      const f = ((d - 30) / d) * 0.06
      move[a].x += dx * f
      move[a].y += dy * f
      move[b].x -= dx * f
      move[b].y -= dy * f
    }
    const limit = 12 * (1 - step / steps) + 0.5
    for (let i = 0; i < n; i++) {
      const m = Math.hypot(move[i].x, move[i].y)
      const k = m > limit ? limit / m : 1
      pos[i].x += move[i].x * k
      pos[i].y += move[i].y * k
    }
  }
  const xs = pos.map((p) => p.x)
  const ys = pos.map((p) => p.y)
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const pad = 40
  const scale = Math.min((width - 2 * pad) / Math.max(x1 - x0, 1), (height - 2 * pad) / Math.max(y1 - y0, 1), 1.6)
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  return Object.fromEntries(ids.map((id, i) => [id, { x: width / 2 + (pos[i].x - cx) * scale, y: height / 2 + (pos[i].y - cy) * scale }]))
}
