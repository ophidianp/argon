import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { tipSpot } from '../layout'

const DELAY = 300

// The one tooltip of the app: any element with a `title` shows it here, quickly and inside the
// window. The native tooltip waits over a second, so the attribute steps aside while it is hovered.
export function Tips() {
  const [tip, setTip] = useState<{ text: string; anchor: DOMRect } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let held: { el: Element; text: string } | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const release = () => {
      clearTimeout(timer)
      if (held && !held.el.hasAttribute('title')) held.el.setAttribute('title', held.text)
      held = null
      setTip(null)
    }
    const show = (el: Element, delay: number) => {
      release()
      const text = el.getAttribute('title')
      if (!text) return
      el.removeAttribute('title')
      // An icon-only control keeps its name for screen readers once the title is gone.
      if (!el.hasAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', text)
      held = { el, text }
      timer = setTimeout(() => setTip({ text, anchor: el.getBoundingClientRect() }), delay)
    }
    const over = (e: PointerEvent) => {
      if (!(e.target instanceof Element)) return
      if (held && !held.el.isConnected) release() // its control has gone (a menu that closed)
      const el = e.target.closest('[title]')
      if (el) show(el, DELAY)
      else if (!held?.el.contains(e.target)) release()
    }
    const focus = (e: FocusEvent) => {
      if (!(e.target instanceof Element) || !e.target.matches(':focus-visible')) return
      if (e.target.hasAttribute('title')) show(e.target, 0)
    }
    addEventListener('pointerover', over, true)
    addEventListener('focusin', focus, true)
    addEventListener('focusout', release, true)
    addEventListener('pointerdown', release, true)
    addEventListener('keydown', release, true)
    addEventListener('wheel', release, true)
    return () => {
      release()
      removeEventListener('pointerover', over, true)
      removeEventListener('focusin', focus, true)
      removeEventListener('focusout', release, true)
      removeEventListener('pointerdown', release, true)
      removeEventListener('keydown', release, true)
      removeEventListener('wheel', release, true)
    }
  }, [])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !tip) return
    const { x, y } = tipSpot(tip.anchor, el.getBoundingClientRect(), { width: innerWidth, height: innerHeight })
    el.style.transform = `translate(${x}px, ${y}px)`
    el.style.opacity = '1'
  }, [tip])

  if (!tip) return null
  return (
    <div ref={ref} className="hover-tip" role="tooltip">
      {tip.text}
    </div>
  )
}
