// Shared app state, saving and a tiny event bus.
export const S = {
  data: null,        // persisted state
  installed: {},     // cmd -> path|null
  runtime: new Map() // nodeId -> console runtime (terminal, status...)
};

export const uid = (p = 'n') => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

const listeners = {};
export function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
export function emit(ev, ...a) { (listeners[ev] || []).forEach(fn => { try { fn(...a); } catch (e) { console.error(e); } }); }

export function defaultState(home) {
  const ws = newWorkspace('Home', home);
  return {
    version: 1,
    activeWorkspace: ws.id,
    workspaces: [ws],
    customAgents: [],
    profiles: [],
    memory: { global: '', repos: {} },
    settings: {
      resumeOnLaunch: true,
      autoApprove: false,
      notify: true,
      fontSize: 13,
      idleSeconds: 4,
      showGrid: true,
      showMission: true,
    },
  };
}

export function newWorkspace(name, cwd) {
  return { id: uid('ws'), name, cwd, view: { x: 80, y: 60, z: 1 }, nodes: [], ink: [] };
}

export const ws = () => S.data.workspaces.find(w => w.id === S.data.activeWorkspace) || S.data.workspaces[0];
export const findNode = (id) => { for (const w of S.data.workspaces) { const n = w.nodes.find(n => n.id === id); if (n) return { node: n, ws: w }; } return null; };
export const consoles = (w = ws()) => w.nodes.filter(n => n.type === 'console');
export const allConsoles = () => S.data.workspaces.flatMap(w => w.nodes.filter(n => n.type === 'console').map(n => ({ node: n, ws: w })));

let saveTimer = null;
export function save(now = false) {
  clearTimeout(saveTimer);
  const run = () => window.argon.state.save(JSON.stringify(S.data, null, 1));
  if (now) return run();
  saveTimer = setTimeout(run, 600);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}

export function toast(msg, kind = '') {
  const t = h('div', { class: 'toast lg ' + kind }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
}

export const basename = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || p;
