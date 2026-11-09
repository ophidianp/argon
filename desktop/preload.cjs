// What the board may ask of the desktop app: the inspector on a point, the theme, the Mac's folder window.
const { contextBridge, ipcRenderer, webFrame } = require('electron')

contextBridge.exposeInMainWorld('vibeboardDesktop', {
  inspect: (x, y) => ipcRenderer.send('inspect', x, y),
  setTheme: (mode) => ipcRenderer.send('theme', mode),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  platform: process.platform,
  // Caption buttons, Windows' blur behind the window, interface size.
  setLook: (look) => {
    ipcRenderer.send('look', look)
    if (look && look.scale) webFrame.setZoomFactor(look.scale)
  },
  setAppIcon: (png) => ipcRenderer.send('app-icon', png),
  // Only in the installed app (or a checkout pointed at a test feed): updates from GitHub, checked against Argon's key.
  ...(ipcRenderer.sendSync('update:available')
    ? {
        update: {
          version: () => ipcRenderer.invoke('update:version'),
          check: () => ipcRenderer.invoke('update:check'),
          download: (onProgress) => {
            const listen = (_e, p) => {
              try {
                onProgress?.(p)
              } catch {}
            }
            ipcRenderer.on('update:progress', listen)
            return ipcRenderer.invoke('update:download').finally(() => ipcRenderer.off('update:progress', listen))
          },
          install: (restart) => ipcRenderer.invoke('update:install', !!restart),
          forget: () => ipcRenderer.invoke('update:forget'),
        },
      }
    : {}),
})
