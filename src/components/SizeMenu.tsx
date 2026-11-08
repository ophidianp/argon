import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// A size on the board, in the form it is stored and shown.
export const sizeText = (w: number, h: number) => `${Math.round(w)} × ${Math.round(h)}`
export const parseSize = (v: string) => v.split(' × ').map(Number) as [number, number]

// Closes on Esc, a click elsewhere or the board scrolling: typing a custom size must survive the pointer wandering off.
export function useClickAway(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as Element
      if (!ref.current?.contains(t) && !t.closest?.('[data-popover-toggle]')) onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    // The board scrolls under a menu that stays put: it would end up pointing at nothing.
    const scroll = (e: WheelEvent) => !ref.current?.contains(e.target as Node) && onClose()
    addEventListener('pointerdown', away, true)
    addEventListener('keydown', key)
    addEventListener('wheel', scroll, { capture: true, passive: true })
    return () => {
      removeEventListener('pointerdown', away, true)
      removeEventListener('keydown', key)
      removeEventListener('wheel', scroll, true)
    }
  }, [])
  return ref
}

const EDGE = 8
const GAP = 6

// Opens under the control that asked for it, above if there is no room, always inside the window.
// On the page rather than in the node: never clipped by it, and just as readable at any zoom.
export function Popover({ anchor, onClose, children }: { anchor: DOMRect; onClose: () => void; children: ReactNode }) {
  const ref = useClickAway(onClose)
  const [spot, setSpot] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const { width, height } = ref.current!.getBoundingClientRect()
    const below = anchor.bottom + GAP
    const top = below + height + EDGE <= innerHeight ? below : anchor.top - height - GAP
    setSpot({ left: Math.max(EDGE, Math.min(anchor.right - width, innerWidth - width - EDGE)), top: Math.max(EDGE, Math.min(top, innerHeight - height - EDGE)) })
  }, [])
  return createPortal(
    <div ref={ref} className="popover" style={spot ?? { visibility: 'hidden' }}>
      {children}
    </div>,
    document.body,
  )
}

// The same menu for terminals and web pages: a few named sizes, or exactly the one you type.
export function SizeMenu({ current, sizes, min = 200, max = 5000, onPick }: { current: string; sizes: [string, string][]; min?: number; max?: number; onPick: (v: string) => void }) {
  const [w, h] = current === 'Fit' ? ['', ''] : current.split(' × ')
  const [width, setWidth] = useState(w)
  const [height, setHeight] = useState(h)
  const ok = (v: string) => Number(v) >= min && Number(v) <= max
  return (
    <div className="menu size-menu">
      {sizes.map(([v, label]) => (
        <button key={v} className={`menu-item ${current === v ? 'on' : ''}`} onClick={() => onPick(v)}>
          <span>{label}</span>
          <span className="mono">{v === 'Fit' ? '' : v}</span>
        </button>
      ))}
      <form
        className="size-custom"
        onSubmit={(e) => {
          e.preventDefault()
          if (ok(width) && ok(height)) onPick(sizeText(Number(width), Number(height)))
        }}
      >
        <input type="number" min={min} max={max} aria-label="Width" placeholder="width" value={width} onChange={(e) => setWidth(e.target.value)} />×
        <input type="number" min={min} max={max} aria-label="Height" placeholder="height" value={height} onChange={(e) => setHeight(e.target.value)} />
        <button className="btn sm" disabled={!ok(width) || !ok(height)}>
          Set
        </button>
      </form>
    </div>
  )
}
