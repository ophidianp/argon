import { useSyncExternalStore } from 'react'

export type ThemeMode = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

const KEY = 'vibeboard-theme'
const media = matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

// The browser's copy of the setting paints the very first frame, before the board state has loaded.
function remembered(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

let mode = remembered()

export const currentTheme = (): Theme => (mode === 'system' ? (media.matches ? 'dark' : 'light') : mode)

function paint() {
  document.documentElement.dataset.theme = currentTheme()
  listeners.forEach((l) => l())
}

export function setThemeMode(next: ThemeMode = 'system') {
  mode = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // Private window: the setting still comes back from the board state on the next start.
  }
  window.vibeboardDesktop?.setTheme(next)
  // Day and night melt into each other. Without the API the change is simply immediate.
  if (document.startViewTransition) document.startViewTransition(paint)
  else paint()
}

media.addEventListener('change', paint)
paint()

export const useTheme = () =>
  useSyncExternalStore((cb) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }, currentTheme)

// The default ink of shapes, text and drawings is saved on the board as this colour. It means
// "the theme's text colour": a light line on a white board would disappear.
export const THEME_INK = '#ece8e2'
export const themed = (color: string) => (color === THEME_INK ? 'var(--text)' : color)
