/// <reference types="vite/client" />

interface Window {
  // Only inside the desktop app (desktop/preload.cjs).
  vibeboardDesktop?: {
    platform?: string
    inspect: (x: number, y: number) => void
    setTheme: (mode: 'system' | 'light' | 'dark') => void
    pickFolder: () => Promise<string | null>
  }
}
