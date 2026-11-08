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
})
