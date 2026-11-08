import { SquareTerminal } from 'lucide-react'
import { agentById } from '../../shared/agents.js'

// Our own burst glyph for Claude (not the vendor logo).
export function Spark({ size = 18, color = '#e8643c' }: { size?: number; color?: string }) {
  const rays = Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6 + 0.13
    const r = i % 2 ? 6.2 : 9.4
    return <line key={i} x1={12} y1={12} x2={12 + Math.cos(a) * r} y2={12 + Math.sin(a) * r} />
  })
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} stroke={color} strokeWidth={2.1} strokeLinecap="round" aria-hidden>
      {rays}
    </svg>
  )
}

// GitHub's mark, for links to GitHub (lucide dropped brand icons).
export function GitHubMark({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

// The CLIs' own marks (src/assets/agents, MIT, see NOTICE.md). Shown as images: one-colour marks
// are drawn in `currentColor`, which an <img> can't inherit, so the colour is written in first.
const MARKS = import.meta.glob('../assets/agents/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const markSrc = (id: string, color: string) => {
  const svg = MARKS[`../assets/agents/${id}.svg`]
  return svg && `data:image/svg+xml;utf8,${encodeURIComponent(svg.replaceAll('currentColor', color))}`
}

// Claude's mark in any colour (white on an active tool button, muted in panels).
export function ClaudeMark({ size = 18, color }: { size?: number; color?: string }) {
  const svg = MARKS['../assets/agents/claude.svg']
  const src = `data:image/svg+xml;utf8,${encodeURIComponent(color ? svg.replace('#D97757', color) : svg)}`
  return <img src={src} width={size} height={size} alt="" draggable={false} style={{ display: 'block' }} />
}

export function AgentGlyph({ id, size = 18 }: { id: string; size?: number }) {
  const a = agentById(id)
  const color = a?.color ?? '#9a948c'
  const src = markSrc(id, color)
  if (src) return <img src={src} width={size} height={size} alt="" draggable={false} style={{ display: 'block' }} />
  if (id === 'shell') return <SquareTerminal size={size} color={color} strokeWidth={1.8} />
  return (
    <span style={{ color, fontSize: size * 0.8, fontWeight: 800, lineHeight: 1, fontFamily: 'var(--mono)' }}>
      {(a?.name ?? '?').slice(0, 1).toLowerCase()}
    </span>
  )
}

export function AgentIcon({ id, size = 34 }: { id: string; size?: number }) {
  const color = agentById(id)?.color ?? '#9a948c'
  return (
    <span
      className="agent-icon"
      style={{
        width: size,
        height: size,
        background: `color-mix(in srgb, ${color} 16%, var(--panel-2))`,
        border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
      }}
    >
      <AgentGlyph id={id} size={size * 0.55} />
    </span>
  )
}
