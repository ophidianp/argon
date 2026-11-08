const { contextBridge, ipcRenderer, webFrame } = require('electron');

const dataHandlers = new Map();
const exitHandlers = new Map();
ipcRenderer.on('pty:data', (_e, id, data) => { const h = dataHandlers.get(id); if (h) h(data); });
ipcRenderer.on('pty:exit', (_e, id, code) => { const h = exitHandlers.get(id); if (h) h(code); });

contextBridge.exposeInMainWorld('argon', {
  platform: process.platform,
  pty: {
    spawn: (opts) => ipcRenderer.invoke('pty:spawn', opts),
    write: (id, data) => ipcRenderer.send('pty:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id) => ipcRenderer.invoke('pty:kill', id),
    alive: (id) => ipcRenderer.invoke('pty:alive', id),
    // Return nothing: a returned Map can't cross the context bridge.
    onData: (id, fn) => { dataHandlers.set(id, fn); },
    onExit: (id, fn) => { exitHandlers.set(id, fn); },
    off: (id) => { dataHandlers.delete(id); exitHandlers.delete(id); },
  },
  state: {
    load: () => ipcRenderer.invoke('state:load'),
    save: (json) => ipcRenderer.invoke('state:save', json),
    dir: () => ipcRenderer.invoke('state:dir'),
  },
  pickFolder: () => ipcRenderer.invoke('dialog:folder'),
  claudeContext: (cwd, count) => ipcRenderer.invoke('claude:context', cwd, count),
  setAppIcon: (png) => ipcRenderer.invoke('app:icon', Array.from(png)),
  dictateWin: () => ipcRenderer.invoke('dictate:win'),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  home: () => ipcRenderer.invoke('app:home'),
  detectAgents: (cmds) => ipcRenderer.invoke('agents:detect', cmds),
  agentAuth: () => ipcRenderer.invoke('agents:auth'),
  git: {
    info: (cwd) => ipcRenderer.invoke('git:info', cwd),
    action: (cwd, action, arg) => ipcRenderer.invoke('git:action', cwd, action, arg),
  },
  fs: {
    list: (dir) => ipcRenderer.invoke('fs:list', dir),
    read: (file) => ipcRenderer.invoke('fs:read', file),
    changed: (dir, since, limit) => ipcRenderer.invoke('fs:changed', dir, since, limit),
    write: (file, text) => ipcRenderer.invoke('fs:write', file, text),
    exists: (file) => ipcRenderer.invoke('fs:exists', file),
  },
  usage: (days) => ipcRenderer.invoke('usage:tokens', days),
  setOverlay: (o) => ipcRenderer.invoke('win:overlay', o),
  zoom: (f) => { if (Math.abs(webFrame.getZoomFactor() - f) > 0.001) webFrame.setZoomFactor(f); },
});
