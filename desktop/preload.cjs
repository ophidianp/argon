// What the board may ask of the desktop app: the inspector on a point, the theme, the Mac's folder window.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('vibeboardDesktop', {
  inspect: (x, y) => ipcRenderer.send('inspect', x, y),
  setTheme: (mode) => ipcRenderer.send('theme', mode),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
})
