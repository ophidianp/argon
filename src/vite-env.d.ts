/// <reference types="vite/client" />

interface Window {
  // Only inside the desktop app (desktop/preload.cjs).
  vibeboardDesktop?: {
    platform?: string
    inspect: (x: number, y: number) => void
    setTheme: (mode: 'system' | 'light' | 'dark') => void
    pickFolder: () => Promise<string | null>
    setLook?: (look: { overlay: string; symbol: string; backdrop: string; scale: number }) => void
    setAppIcon?: (png: Uint8Array) => void
    // Only in the installed app (desktop/updater.cjs).
    update?: {
      version: () => Promise<string>
      check: () => Promise<UpdateCheck>
      download: (onProgress?: (p: { got: number; total: number }) => void) => Promise<{ ok: boolean; available?: boolean; version?: string; error?: string }>
      install: (restart: boolean) => Promise<{ ok: boolean; error?: string }>
      forget: () => Promise<{ ok: boolean }>
    }
  }
}

type UpdateCheck = { ok: boolean; error?: string; available?: boolean; version?: string; current?: string; notes?: string; date?: string | null; ready?: boolean }
