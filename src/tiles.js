// Tiles on the board: consoles, notes, checklists, kanban, calendar, text, web, files, git, images.
import { S, ws, save, uid, emit, on, h, esc, toast, basename, findNode } from './state.js';
import { iconEl, hasIcon } from './icons.js';
import { viewCenter, toWorld, tool } from './board.js';
import { mountConsole, disposeConsole, rt, restartConsole, lastLines, sendTo, queueFit } from './consoles.js';
import { agentByKey } from './agents.js';
import { askText, confirmBox, showMenu } from './ui.js';
import { openLoopEditor, openHandoff, pushMemory, spawnMenu } from './panels.js';
import { animationsOn } from './appearance.js';

const els = new Map(); // nodeId -> element
let topZ = 10;
export let selectedId = null;

const SIZES = {
  console: [640, 400], note: [240, 220], checklist: [280, 300], kanban: [620, 360], calendar: [420, 360],
  text: [320, 70], web: [720, 480], files: [620, 420], git: [320, 360], image: [360, 260], group: [620, 420],
};
const ICONS = { console: 'console', note: 'note', checklist: 'checklist', kanban: 'kanban', calendar: 'calendar', text: 'text', web: 'web', files: 'files', git: 'git', image: 'image', group: 'group' };
// Other modules (manager.js) add their own tile types here.
const EXTRA = {};
export function registerTile(type, def) { EXTRA[type] = def; SIZES[type] = def.size; ICONS[type] = def.icon; RENDER[type] = def.render; }
export const NOTE_COLORS = ['#d9cdf7', '#f6e3a1', '#bfe6cf', '#f5c6cf', '#bcd7f5'];
// 'accent' follows your accent color live; it is the default for new groups.
export const GROUP_COLORS = ['accent', '#6fcfa3', '#7ea8ec', '#e2b15a', '#e0889f', '#5cc2c2'];
export const groupColor = (c) => (!c || c === 'accent' || c === '#9a83d4' ? 'var(--accent)' : c);

// ---------- groups: drop tiles in and the frame sizes itself around them ----------
// Pipeline mode (pipeline.js) plugs in here: where a tile lives, how it drags, and extra chrome.
export const tileHooks = { host: null, drag: null, decorate: null, docked: null, groupItems: null };
const isPipeNode = (n) => !!(n && n.data && n.data.space === 'pipe');
const boardCount = (w) => w.nodes.filter(n => !isPipeNode(n)).length;
const GPAD = 26, GHEAD = 50, GMIN = [340, 220];
const area = (n) => n.w * n.h;
export const groupMembers = (g, w) => w.nodes.filter(n => n !== g && n.data && n.data.groupId === g.id);
const descendants = (g, w) => groupMembers(g, w).flatMap(n => n.type === 'group' ? [n, ...descendants(n, w)] : [n]);
const within = (n, anc, w) => { for (let p = n; p && p.data && p.data.groupId;) { if (p.data.groupId === anc.id) return true; p = w.nodes.find(x => x.id === p.data.groupId); } return false; };
function groupAtPoint(pt, w, self) {
  return w.nodes.filter(g => g.type === 'group' && g !== self && !(self && within(g, self, w)) && pt.x > g.x && pt.x < g.x + g.w && pt.y > g.y && pt.y < g.y + g.h)
    .sort((a, b) => area(a) - area(b))[0] || null;
}
export const groupTag = (g) => g.title.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'group';
// Consoles in a group get its name as their team tag, so "#name do X" reaches them.
function retag(n, w) {
  if (n.type !== 'console' || isPipeNode(n)) return;
  const g = n.data.groupId && w.nodes.find(x => x.id === n.data.groupId), old = n.data.group;
  if (g) { n.data.group = groupTag(g); n.data.groupFrame = g.id; }
  else if (n.data.groupFrame) { n.data.group = ''; n.data.groupFrame = null; }
  if (n.data.group !== old) emit('consoleMeta', n.id);
}
export const retagAll = (w) => w.nodes.forEach(n => retag(n, w));
// Wrap the frame around its members (springy, see .tile.group in the CSS); empty groups keep a drop pad.
// Auto-tiling (on unless the group's menu turns it off): members snap into a grid, ordered by where they sit,
// so dropping a tile between two others puts it there.
const TGAP = 16;
function shift(n, dx, dy, w) { n.x += dx; n.y += dy; place(n); if (n.type === 'group') groupMembers(n, w).forEach(c => shift(c, dx, dy, w)); }
function tileGroup(g, w) {
  const m = groupMembers(g, w); if (!m.length) return;
  const cols = m.length <= 1 ? 1 : m.length <= 4 ? 2 : m.length <= 9 ? 3 : 4, rows = Math.ceil(m.length / cols);
  const ox = g.x + GPAD, oy = g.y + GPAD + GHEAD, rowH = Math.max(...m.map(n => n.h)) || 1;
  const ord = m.slice().sort((a, b) => (Math.round((a.y + a.h / 2 - oy) / rowH) - Math.round((b.y + b.h / 2 - oy) / rowH)) || (a.x + a.w / 2) - (b.x + b.w / 2));
  const colW = Array(cols).fill(0), rH = Array(rows).fill(0);
  ord.forEach((n, i) => { colW[i % cols] = Math.max(colW[i % cols], n.w); rH[Math.floor(i / cols)] = Math.max(rH[Math.floor(i / cols)], n.h); });
  const anim = animationsOn();
  ord.forEach((n, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const x = ox + colW.slice(0, c).reduce((s, v) => s + v + TGAP, 0), y = oy + rH.slice(0, r).reduce((s, v) => s + v + TGAP, 0);
    if (Math.round(n.x) === Math.round(x) && Math.round(n.y) === Math.round(y)) return;
    const el = els.get(n.id); if (anim && el) { el.classList.add('tiling'); clearTimeout(el._tt); el._tt = setTimeout(() => el.classList.remove('tiling'), 520); }
    shift(n, x - n.x, y - n.y, w);
  });
}
export function fitGroup(g, w) {
  if (g.data.tile !== false && !document.body.classList.contains('dragging')) tileGroup(g, w);
  const m = groupMembers(g, w);
  if (m.length) {
    const x0 = Math.min(...m.map(n => n.x)), y0 = Math.min(...m.map(n => n.y)), x1 = Math.max(...m.map(n => n.x + n.w)), y1 = Math.max(...m.map(n => n.y + n.h));
    Object.assign(g, { x: x0 - GPAD, y: y0 - GPAD - GHEAD, w: Math.max(GMIN[0], x1 - x0 + GPAD * 2), h: Math.max(GMIN[1] - 40, y1 - y0 + GPAD * 2 + GHEAD) });
  } else { g.w = GMIN[0]; g.h = GMIN[1]; }
  place(g);
  const parent = g.data.groupId && w.nodes.find(x => x.id === g.data.groupId);
  if (parent) fitGroup(parent, w);
}
function absorb(g) {
  const el = els.get(g.id); if (!el || !animationsOn()) return;
  const c = groupColor(g.data.color);
  el.animate([{ outline: `2px solid ${c}`, outlineOffset: '0px' }, { outline: `2px solid color-mix(in srgb, ${c} 0%, transparent)`, outlineOffset: '16px' }], { duration: 700, easing: 'ease-out' });
}
// Old free-form groups: whatever sat inside the frame becomes a member.
function migrateGroups(w) {
  for (const g of w.nodes) {
    if (g.type !== 'group' || g.data.v2) continue;
    for (const n of w.nodes) {
      if (n === g || n.data.groupId || isPipeNode(n)) continue;
      const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
      if (cx > g.x && cx < g.x + g.w && cy > g.y && cy < g.y + g.h && !(n.type === 'group' && area(n) >= area(g))) n.data.groupId = g.id;
    }
    g.data.v2 = true;
  }
}
// New group: around the selected tile, or an empty drop pad below everything.
export function addGroup() {
  const w = ws(), f = selectedId && findNode(selectedId);
  if (f && f.node.type !== 'group' && f.ws === w && !isPipeNode(f.node)) {
    const n = f.node, old = n.data.groupId;
    const g = addNode('group', {}, { x: n.x - GPAD, y: n.y - GPAD - GHEAD, w: n.w + GPAD * 2, h: n.h + GPAD * 2 + GHEAD });
    n.data.groupId = g.id; if (old) g.data.groupId = old;
    fitGroup(g, w); retagAll(w); absorb(g); save(); emit('nodes'); return g;
  }
  const board = w.nodes.filter(n => !isPipeNode(n));
  const x0 = board.length ? Math.min(...board.map(n => n.x)) : viewCenter().x - GMIN[0] / 2;
  const y1 = board.length ? Math.max(...board.map(n => n.y + n.h)) + 60 : viewCenter().y - GMIN[1] / 2;
  const g = addNode('group', {}, { x: Math.round(x0), y: Math.round(y1), w: GMIN[0], h: GMIN[1] });
  emit('fly', g.id); toast('New group. Drag tiles into it.');
  return g;
}

function layer(wsId) {
  let l = document.querySelector(`.ws-layer[data-ws="${wsId}"]`);
  if (!l) { l = h('div', { class: 'ws-layer', 'data-ws': wsId }); document.getElementById('nodes').append(l); }
  return l;
}

export function showWorkspace(w) {
  document.querySelectorAll('.ws-layer').forEach(l => { l.style.display = l.dataset.ws === w.id ? '' : 'none'; });
  const ly = layer(w.id);
  ly.style.display = '';
  ly.classList.remove('fade-in'); void ly.offsetWidth; ly.classList.add('fade-in');
  migrateGroups(w);
  for (const n of w.nodes) if (!els.has(n.id)) createTile(n, w);
  for (const n of w.nodes) topZ = Math.max(topZ, n.zi || 0);
  document.getElementById('empty-hint').classList.toggle('hidden', boardCount(w) > 0);
  setTimeout(() => w.nodes.forEach(n => n.type === 'console' && queueFit(n.id)), 30);
}

export function mountAll() {
  for (const w of S.data.workspaces) { layer(w.id); migrateGroups(w); for (const n of w.nodes) if (!els.has(n.id)) createTile(n, w); }
}

// Place a new tile near the view center without stacking exactly on another.
function freeSpot(w, wdt, hgt) {
  const c = viewCenter();
  let x = Math.round(c.x - wdt / 2), y = Math.round(c.y - hgt / 2);
  for (let i = 0; i < 30; i++) {
    const hit = w.nodes.some(n => Math.abs(n.x - x) < 30 && Math.abs(n.y - y) < 30);
    if (!hit) break;
    x += 36; y += 36;
  }
  return { x, y };
}

export function addNode(type, data = {}, opts = {}) {
  const w = opts.ws || ws();
  const [dw, dh] = SIZES[type] || [300, 200];
  const wdt = opts.w || dw, hgt = opts.h || dh;
  const pos = opts.x != null ? { x: opts.x, y: opts.y } : freeSpot(w, wdt, hgt);
  const node = { id: uid(type.slice(0, 3)), type, x: pos.x, y: pos.y, w: wdt, h: hgt, zi: ++topZ, title: opts.title || defaultTitle(type, data, w), data: defaultData(type, data) };
  w.nodes.push(node);
  createTile(node, w);
  const el = els.get(node.id);
  el.classList.add('enter');
  el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true });
  if (w === ws()) { if (!isPipeNode(node)) document.getElementById('empty-hint').classList.add('hidden'); if (!opts.quiet) select(node.id); }
  save(); emit('nodes');
  return node;
}

function defaultTitle(type, data, w) {
  if (type === 'console') {
    const a = agentByKey(data.agent, S.data.customAgents);
    const base = a.key === 'shell' ? 'terminal' : a.name.split(' ')[0].toLowerCase();
    let i = 1;
    const names = new Set(w.nodes.map(n => n.title));
    while (names.has(`${base}-${i}`)) i++;
    return `${base}-${i}`;
  }
  if (type === 'group') { const names = new Set(w.nodes.map(n => n.title)); let i = 1; while (names.has(`Group ${i}`)) i++; return `Group ${i}`; }
  if (EXTRA[type] && EXTRA[type].title) return EXTRA[type].title(w);
  return { note: 'Note', checklist: 'Checklist', kanban: 'Kanban', calendar: 'Calendar', text: 'Text', web: 'Preview', files: basename(w.cwd) || 'Files', git: 'Git', image: 'Image' }[type] || type;
}

function defaultData(type, d) {
  switch (type) {
    case 'console': return { agent: 'shell', group: '', loop: null, started: false, ...d };
    case 'note': return { text: '', color: NOTE_COLORS[0], ...d };
    case 'checklist': return { items: [{ t: '', done: false }], ...d };
    case 'kanban': return { cols: [{ name: 'To do', cards: [] }, { name: 'Doing', cards: [] }, { name: 'Done', cards: [] }], ...d };
    case 'calendar': { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth(), events: {}, ...d }; }
    case 'text': return { text: 'Heading', size: 30, ...d };
    case 'web': return { url: 'http://localhost:3000', ...d };
    case 'files': return { root: null, open: null, ...d };
    case 'git': return { ...d };
    case 'image': return { src: '', ...d };
    case 'group': return { color: 'accent', ...d };
    default: return EXTRA[type] && EXTRA[type].data ? EXTRA[type].data(d) : d;
  }
}

export function select(id) {
  selectedId = id;
  for (const [nid, el] of els) el.classList.toggle('selected', nid === id);
  window.__selectedConsole = null;
  if (id) {
    const f = findNode(id);
    if (f && f.node.type === 'console') window.__selectedConsole = id;
    if (f && f.node.type !== 'group' && f.node.zi !== topZ) { f.node.zi = ++topZ; const el = els.get(id); el && (el.style.zIndex = f.node.zi); }
  }
}
on('select', select);

export async function removeNode(id, ask = true) {
  const f = findNode(id); if (!f) return;
  if (ask && f.node.type === 'console' && rt(id) && rt(id).alive) {
    const ok = await confirmBox(`Close ${f.node.title}?`, 'This stops the agent running in this console.', 'Stop and close');
    if (!ok) return;
  }
  if (f.node.type === 'console') disposeConsole(id);
  if (f.node.type === 'group') { for (const n of groupMembers(f.node, f.ws)) { if (f.node.data.groupId) n.data.groupId = f.node.data.groupId; else delete n.data.groupId; } }
  const parent = f.node.data && f.node.data.groupId && f.ws.nodes.find(x => x.id === f.node.data.groupId);
  const el = els.get(id);
  els.delete(id);
  if (el) { el.classList.add('leaving'); setTimeout(() => el.remove(), animationsOn() ? 200 : 0); }
  f.ws.nodes = f.ws.nodes.filter(n => n.id !== id);
  if (parent) fitGroup(parent, f.ws);
  retagAll(f.ws);
  if (selectedId === id) selectedId = null;
  document.getElementById('empty-hint').classList.toggle('hidden', boardCount(ws()) > 0 || document.body.dataset.mode === 'pipe');
  save(); emit('nodes');
}

export function place(node) {
  const el = els.get(node.id); if (!el) return;
  if (tileHooks.docked && tileHooks.docked(node)) { el.style.left = el.style.top = el.style.width = el.style.height = el.style.zIndex = ''; return; }
  el.style.left = node.x + 'px'; el.style.top = node.y + 'px';
  el.style.width = node.w + 'px'; el.style.height = node.h + 'px';
  el.style.zIndex = node.type === 'group' ? 0 : (node.zi || 1);
}

export function tileEl(id) { return els.get(id); }
// Rebuild a tile after its data changed from outside (an agent edited it through the board).
export function remountTile(node, w) {
  if (node.type === 'console') return;
  const old = els.get(node.id), was = old && old.classList.contains('selected');
  if (old) old.remove();
  els.delete(node.id);
  createTile(node, w);
  if (was) els.get(node.id)?.classList.add('selected');
}

function createTile(node, w) {
  const titleEl = h('div', { class: 'tile-title', title: 'Double-click to rename' }, node.title);
  const head = h('div', { class: 'tile-head' });
  const body = h('div', { class: 'tile-body' });
  const resize = h('div', { class: 'tile-resize' });
  const el = h('div', { class: `tile ${node.type}`, 'data-id': node.id }, head, body, resize);
  els.set(node.id, el);
  ((tileHooks.host && tileHooks.host(node, w)) || layer(w.id)).append(el);
  place(node);

  const extras = h('span', { class: 'row', style: { gap: '6px' } });
  const btns = h('span', { class: 'row', style: { gap: '1px' } });
  const close = h('button', { class: 'tile-btn danger', title: 'Close', onclick: (e) => { e.stopPropagation(); removeNode(node.id); } }, '✕');
  const ico = h('span', { class: 'tile-ico' }); if (hasIcon(ICONS[node.type])) ico.append(iconEl(ICONS[node.type], 15)); else ico.textContent = ICONS[node.type] || '•';
  head.append(ico, titleEl, extras, btns, close);

  // rename
  titleEl.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    titleEl.contentEditable = 'true'; titleEl.focus();
    document.getSelection().selectAllChildren(titleEl);
    const done = () => {
      titleEl.contentEditable = 'false';
      const t = titleEl.textContent.trim().slice(0, 60);
      if (t) node.title = t; titleEl.textContent = node.title;
      if (node.type === 'group') retagAll(w);
      save(); emit('nodes');
    };
    titleEl.addEventListener('blur', done, { once: true });
    titleEl.addEventListener('keydown', (k) => { if (k.key === 'Enter' || k.key === 'Escape') { k.preventDefault(); titleEl.blur(); } });
  });

  // select / bring to front
  el.addEventListener('pointerdown', () => { if (tool === 'select') select(node.id); }, true);

  // drag by header: drop onto a group to join it, drag out of its frame to leave
  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, input, select, [contenteditable="true"]')) return;
    if (tileHooks.drag && tileHooks.drag(node, e, el, w)) return;
    e.preventDefault();
    const z = ws().view.z, sx = e.clientX, sy = e.clientY, ox = node.x, oy = node.y;
    const members = node.type === 'group' ? descendants(node, w).map(n => [n, n.x, n.y]) : [];
    let hot = null, moved = false;
    head.setPointerCapture(e.pointerId);
    document.body.classList.add('dragging');
    const move = (m) => {
      const dx = (m.clientX - sx) / z, dy = (m.clientY - sy) / z;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 3) { moved = true; el.classList.add('lifted'); }
      node.x = Math.round(ox + dx); node.y = Math.round(oy + dy); place(node);
      for (const [n, x, y] of members) { n.x = Math.round(x + dx); n.y = Math.round(y + dy); place(n); }
      const g = groupAtPoint(toWorld(m.clientX, m.clientY), w, node);
      if (g !== hot) { hot && els.get(hot.id)?.classList.remove('drop'); hot = g; hot && els.get(hot.id)?.classList.add('drop'); }
    };
    const up = () => {
      head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); document.body.classList.remove('dragging');
      el.classList.remove('lifted'); hot && els.get(hot.id)?.classList.remove('drop');
      if (moved) {
        const old = node.data.groupId && w.nodes.find(x => x.id === node.data.groupId);
        if (hot && hot !== old) { node.data.groupId = hot.id; fitGroup(hot, w); absorb(hot); toast(`${node.title} joined ${hot.title}`); }
        else if (!hot && old) delete node.data.groupId;
        if (old) fitGroup(old, w);
        if (old && old === hot) fitGroup(old, w);
        retagAll(w);
      }
      save(); emit('nodes');
    };
    head.addEventListener('pointermove', move); head.addEventListener('pointerup', up);
  });
  head.addEventListener('dblclick', (e) => { if (e.target === head) emit('fly', node.id); });

  // resize
  resize.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const z = ws().view.z, sx = e.clientX, sy = e.clientY, ow = node.w, oh = node.h;
    resize.setPointerCapture(e.pointerId);
    document.body.classList.add('dragging');
    const move = (m) => { node.w = Math.max(160, Math.round(ow + (m.clientX - sx) / z)); node.h = Math.max(70, Math.round(oh + (m.clientY - sy) / z)); place(node); };
    const up = () => { resize.removeEventListener('pointermove', move); resize.removeEventListener('pointerup', up); document.body.classList.remove('dragging'); const g = node.data.groupId && w.nodes.find(x => x.id === node.data.groupId); if (g) fitGroup(g, w); save(); };
    resize.addEventListener('pointermove', move); resize.addEventListener('pointerup', up);
  });

  const R = RENDER[node.type];
  if (R) R(node, w, { el, head, body, extras, btns, titleEl });
  if (tileHooks.decorate) tileHooks.decorate(node, el, w);
}

// ---------- renderers ----------
const RENDER = {
  console(node, w, { el, body, extras, btns, head, titleEl }) {
    const agent = agentByKey(node.data.agent, S.data.customAgents);
    const dot = h('span', { class: 'status-dot', title: 'Status' });
    head.insertBefore(dot, titleEl);
    head.querySelector('.tile-ico').remove();
    const badge = h('span', { class: 'agent-badge', style: { color: agent.color } }, agent.name);
    const group = h('span', { class: 'group-chip' });
    const loopB = h('span', { class: 'loop-badge', title: 'Loop running' });
    extras.append(group, loopB, badge);
    const paint = () => {
      group.textContent = node.data.group || ''; group.style.display = node.data.group ? '' : 'none';
      const gn = node.data.groupId && w.nodes.find((x) => x.id === node.data.groupId);
      group.style.setProperty('--gcc', gn ? groupColor(gn.data.color) : 'var(--accent)');
      const L = node.data.loop;
      loopB.textContent = L && L.on ? `↻ ${L.runs || 0}${L.maxRuns ? '/' + L.maxRuns : ''}` : '';
    };
    paint();
    on('loop', (id) => { if (id === node.id) paint(); });
    on('consoleMeta', (id) => { if (id === node.id) paint(); });
    on('status', (id, st) => {
      if (id !== node.id) return;
      dot.className = 'status-dot ' + st; dot.title = st;
      el.classList.toggle('needs', st === 'needs');
    });
    btns.append(
      h('button', { class: 'tile-btn', title: 'Loop', onclick: (e) => { e.stopPropagation(); openLoopEditor(node); } }, '↻'),
      h('button', { class: 'tile-btn', title: 'More', onclick: (e) => { e.stopPropagation(); consoleMenu(node, w, e.clientX, e.clientY); } }, '⋯'));
    mountConsole(node, body, w);
    el.addEventListener('contextmenu', (e) => { if (e.target.closest('.tile-head')) { e.preventDefault(); consoleMenu(node, w, e.clientX, e.clientY); } });
  },

  note(node, w, { el, body, btns }) {
    const paint = () => { el.style.background = node.data.color; };
    paint();
    const ta = h('textarea', { placeholder: 'Write something…' });
    ta.value = node.data.text;
    ta.addEventListener('input', () => { node.data.text = ta.value; save(); });
    body.append(ta);
    const colors = h('span', { class: 'note-colors' });
    NOTE_COLORS.forEach(c => colors.append(h('i', { style: { background: c }, onclick: (e) => { e.stopPropagation(); node.data.color = c; paint(); save(); } })));
    btns.append(colors);
  },

  text(node, w, { body }) {
    const t = h('div', { class: 'text-body', contenteditable: 'true', spellcheck: 'false' });
    t.textContent = node.data.text;
    t.style.fontSize = node.data.size + 'px';
    t.addEventListener('input', () => { node.data.text = t.textContent; save(); });
    t.addEventListener('wheel', (e) => { if (e.altKey) { e.preventDefault(); node.data.size = Math.max(10, Math.min(160, node.data.size - Math.sign(e.deltaY) * 2)); t.style.fontSize = node.data.size + 'px'; save(); } }, { passive: false });
    t.title = 'Alt + scroll to change size';
    body.append(t);
  },

  checklist(node, w, { body }) {
    const wrap = h('div', { class: 'checklist' });
    body.append(wrap);
    const render = (focusIdx) => {
      wrap.innerHTML = '';
      const items = node.data.items;
      const done = items.filter(i => i.done && i.t).length, total = items.filter(i => i.t).length;
      wrap.append(h('div', { class: 'progress' }, h('i', { style: { width: (total ? done / total * 100 : 0) + '%' } })));
      items.forEach((it, i) => {
        const cb = h('input', { type: 'checkbox' }); cb.checked = it.done;
        cb.onchange = () => { it.done = cb.checked; save(); render(); };
        const t = h('div', { class: 'ct', contenteditable: 'true', spellcheck: 'false' }); t.textContent = it.t;
        t.addEventListener('input', () => { it.t = t.textContent; save(); });
        t.addEventListener('blur', () => render());
        t.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); items.splice(i + 1, 0, { t: '', done: false }); save(); render(i + 1); }
          if (e.key === 'Backspace' && !t.textContent && items.length > 1) { e.preventDefault(); items.splice(i, 1); save(); render(Math.max(0, i - 1)); }
        });
        const x = h('button', { class: 'x', onclick: () => { items.splice(i, 1); if (!items.length) items.push({ t: '', done: false }); save(); render(); } }, '✕');
        wrap.append(h('div', { class: 'check-row' + (it.done ? ' done' : '') }, cb, t, x));
        if (focusIdx === i) setTimeout(() => t.focus());
      });
      wrap.append(h('button', { class: 'btn sm check-add', onclick: () => { items.push({ t: '', done: false }); save(); render(items.length - 1); } }, '+ Add item'));
    };
    render();
  },

  kanban(node, w, { body }) {
    const wrap = h('div', { class: 'kanban' });
    body.append(wrap);
    let drag = null;
    const render = () => {
      wrap.innerHTML = '';
      node.data.cols.forEach((col, ci) => {
        const cards = h('div', { class: 'kcards' });
        cards.addEventListener('dragover', (e) => { e.preventDefault(); cards.classList.add('drop'); });
        cards.addEventListener('dragleave', () => cards.classList.remove('drop'));
        cards.addEventListener('drop', (e) => {
          e.preventDefault(); cards.classList.remove('drop');
          if (!drag) return;
          const [card] = node.data.cols[drag.ci].cards.splice(drag.ki, 1);
          col.cards.push(card); drag = null; save(); render();
        });
        col.cards.forEach((card, ki) => {
          const c = h('div', { class: 'kcard', draggable: 'true' });
          const t = h('div', { contenteditable: 'true', spellcheck: 'false', style: { outline: 'none' } }); t.textContent = card.t;
          t.addEventListener('input', () => { card.t = t.textContent; save(); });
          c.addEventListener('dragstart', (e) => { drag = { ci, ki }; e.dataTransfer.effectAllowed = 'move'; });
          c.append(t, h('button', { class: 'x', onclick: () => { col.cards.splice(ki, 1); save(); render(); } }, '✕'));
          cards.append(c);
        });
        const name = h('span', { contenteditable: 'true', spellcheck: 'false', style: { outline: 'none' } }); name.textContent = col.name;
        name.addEventListener('input', () => { col.name = name.textContent; save(); });
        wrap.append(h('div', { class: 'kcol' },
          h('div', { class: 'kcol-head' }, name, h('span', { class: 'n' }, String(col.cards.length))),
          cards,
          h('button', { class: 'kadd', onclick: () => { col.cards.push({ t: 'New card' }); save(); render(); setTimeout(() => { const all = wrap.querySelectorAll('.kcol')[ci].querySelectorAll('.kcard [contenteditable]'); const last = all[all.length - 1]; last.focus(); document.getSelection().selectAllChildren(last); }); } }, '+ Add card')));
      });
    };
    render();
  },

  calendar(node, w, { body }) {
    const wrap = h('div', { class: 'cal' });
    body.append(wrap);
    const render = () => {
      const { y, m } = node.data;
      const first = new Date(y, m, 1);
      const start = new Date(y, m, 1 - ((first.getDay() + 6) % 7));
      const today = new Date(); const tk = key(today);
      wrap.innerHTML = '';
      wrap.append(h('div', { class: 'cal-head' },
        h('button', { class: 'tile-btn', onclick: () => { shift(-1); } }, '‹'),
        h('span', {}, first.toLocaleString(undefined, { month: 'long', year: 'numeric' })),
        h('button', { class: 'tile-btn', onclick: () => { shift(1); } }, '›')));
      const grid = h('div', { class: 'cal-grid' });
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(d => grid.append(h('div', { class: 'cal-dow' }, d)));
      for (let i = 0; i < 42; i++) {
        const d = new Date(start); d.setDate(start.getDate() + i);
        const k = key(d);
        const evs = node.data.events[k] || [];
        const cell = h('div', { class: 'cal-day' + (d.getMonth() !== m ? ' other' : '') + (k === tk ? ' today' : ''), title: 'Click to add an event' }, String(d.getDate()),
          ...evs.map((ev, ei) => h('span', { class: 'ev', title: 'Right-click to remove', oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); evs.splice(ei, 1); if (!evs.length) delete node.data.events[k]; save(); render(); } }, ev)));
        cell.onclick = async () => {
          const t = await askText('Add event', { sub: d.toDateString(), placeholder: 'e.g. Ship v1' });
          if (t && t.trim()) { (node.data.events[k] = node.data.events[k] || []).push(t.trim()); save(); render(); }
        };
        grid.append(cell);
      }
      wrap.append(grid);
    };
    const key = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    const shift = (n) => { let { y, m } = node.data; m += n; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } node.data.y = y; node.data.m = m; save(); render(); };
    render();
  },

  web(node, w, { body, btns }) {
    const input = h('input', { type: 'text', value: node.data.url, spellcheck: 'false' });
    if (!window.process && window.argon && window.argon.shell === 'tauri') {
      // Tauri has no <webview> tag: an iframe shows the local dev server instead.
      const fr = h('iframe', { class: 'web-frame', src: normUrl(node.data.url), allow: 'clipboard-read; clipboard-write' });
      const hist = [normUrl(node.data.url)];
      const go = () => { node.data.url = input.value.trim(); const u = normUrl(node.data.url); hist.push(u); fr.src = u; save(); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      body.append(
        h('div', { class: 'webbar' },
          h('button', { class: 'tile-btn', title: 'Back', onclick: () => { if (hist.length > 1) { hist.pop(); const u = hist[hist.length - 1]; input.value = u; node.data.url = u; fr.src = u; save(); } } }, '‹'),
          h('button', { class: 'tile-btn', title: 'Reload', onclick: () => { fr.src = 'about:blank'; setTimeout(() => { fr.src = normUrl(input.value); }, 30); } }, '⟳'),
          input,
          h('button', { class: 'tile-btn', title: 'Open in browser', onclick: () => window.argon.openExternal(normUrl(input.value)) }, '↗')),
        h('div', { class: 'web-wrap' }, fr),
        h('div', { class: 'web-shield' }));
      return;
    }
    const wv = document.createElement('webview');
    wv.setAttribute('src', normUrl(node.data.url));
    wv.setAttribute('partition', 'persist:argon-web');
    const go = () => { node.data.url = input.value.trim(); wv.loadURL(normUrl(node.data.url)).catch(() => {}); save(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    wv.addEventListener('did-navigate', (e) => { input.value = e.url; node.data.url = e.url; save(); });
    wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) { input.value = e.url; node.data.url = e.url; save(); } });
    wv.addEventListener('did-fail-load', (e) => { if (e.errorCode !== -3 && e.isMainFrame) wv.executeJavaScript(`document.body.innerHTML='<div style="font:14px system-ui;color:#6b6382;padding:24px">Nothing is running at ${esc(input.value).replace(/'/g, '')} yet.<br>Start your dev server, then press ⟳.</div>'`).catch(() => {}); });
    body.append(
      h('div', { class: 'webbar' },
        h('button', { class: 'tile-btn', title: 'Back', onclick: () => wv.canGoBack() && wv.goBack() }, '‹'),
        h('button', { class: 'tile-btn', title: 'Reload', onclick: () => wv.reload() }, '⟳'),
        input,
        h('button', { class: 'tile-btn', title: 'Open in browser', onclick: () => window.argon.openExternal(normUrl(input.value)) }, '↗')),
      h('div', { class: 'web-wrap' }, wv),
      h('div', { class: 'web-shield' }));
    btns.append(h('button', { class: 'tile-btn', title: 'Toggle Web Inspector', onclick: () => { try { wv.isDevToolsOpened() ? wv.closeDevTools() : wv.openDevTools(); } catch (_) {} } }, '⚒'));
  },

  // A mini file manager: browse, open, edit and save text files, make files and folders,
  // rename, drag onto a folder to move, delete to the Recycle Bin.
  files(node, w, { body, btns }) {
    const win = window.argon.platform === 'win32', SEP = win ? '\\' : '/';
    const norm = (p) => (win ? String(p || '').replace(/\//g, '\\') : String(p || '')).replace(/[\\/]+$/, '') || (win ? 'C:\\' : '/');
    const join = (a, b) => norm(a) + SEP + b;
    const parent = (p) => { const n = norm(p), i = Math.max(n.lastIndexOf('\\'), n.lastIndexOf('/')); return i > 2 ? n.slice(0, i) : n.slice(0, i + 1) || n; };
    const nameOf = (p) => norm(p).split(/[\\/]/).pop();
    const root = () => norm(node.data.root || w.cwd || '');
    const expanded = new Set(node.data.expanded || []);
    let sel = node.data.open || null, dirty = false, current = null;

    const crumbs = h('div', { class: 'fm-crumbs' });
    const bar = h('div', { class: 'fm-bar' },
      h('button', { class: 'fm-b', title: 'Up one folder', onclick: () => setRoot(parent(root())) }, '↑'), crumbs,
      h('button', { class: 'fm-b', title: 'New file', onclick: () => create(false) }, '+ File'),
      h('button', { class: 'fm-b', title: 'New folder', onclick: () => create(true) }, '+ Folder'));
    const tree = h('div', { class: 'ftree' });
    const pathEl = h('span', { class: 'fm-path' }, 'Select a file');
    const editBtn = h('button', { class: 'fm-b', hidden: true, onclick: () => toggleEdit() }, 'Edit');
    const saveBtn = h('button', { class: 'fm-b primary', hidden: true, onclick: () => saveFile() }, 'Save');
    const openBtn = h('button', { class: 'fm-b', hidden: true, title: 'Open with its default app', onclick: () => sel && window.argon.fs.open(sel) }, 'Open');
    const pre = h('pre', { class: 'fpreview' }, 'Select a file to preview it.');
    const ta = h('textarea', { class: 'fm-edit', spellcheck: 'false', hidden: true });
    ta.addEventListener('input', () => { dirty = true; saveBtn.disabled = false; });
    ta.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveFile(); } e.stopPropagation(); });
    ta.addEventListener('pointerdown', (e) => e.stopPropagation());
    const side = h('div', { class: 'fm-side' }, h('div', { class: 'fm-head' }, pathEl, openBtn, editBtn, saveBtn), pre, ta);
    body.append(h('div', { class: 'files fm' }, h('div', { class: 'fm-left' }, bar, tree), side));

    const setRoot = (p) => { node.data.root = norm(p); save(); refresh(); };
    const paintCrumbs = () => {
      crumbs.innerHTML = '';
      const parts = root().split(/[\\/]/).filter(Boolean);
      let acc = win ? '' : '/';
      parts.forEach((part, i) => {
        acc = i === 0 && win ? part + '\\' : join(acc, part);
        const at = acc;
        crumbs.append(h('button', { class: 'fm-crumb', title: at, onclick: () => setRoot(at) }, part.replace(/\\$/, '')));
        if (i < parts.length - 1) crumbs.append(h('span', { class: 'fm-sep' }, '›'));
      });
      crumbs.scrollLeft = crumbs.scrollWidth;
    };
    // where new files go: the selected folder, the selected file's folder, or the top
    const targetDir = () => { const s = tree.querySelector('.frow.sel'); if (!s) return root(); return s.dataset.dir === '1' ? s.dataset.path : parent(s.dataset.path); };
    const create = async (folder) => {
      const dir = targetDir();
      const name = await askText(folder ? 'New folder' : 'New file', { placeholder: folder ? 'folder name' : 'notes.md', sub: 'In ' + dir });
      if (!name || !name.trim()) return;
      const p = join(dir, name.trim());
      if (await window.argon.fs.exists(p)) { toast('Something with that name is already there.', 'err'); return; }
      const ok = folder ? (await window.argon.fs.mkdir(p)).ok : await window.argon.fs.write(p, '');
      if (!ok) { toast("Couldn't create it.", 'err'); return; }
      expanded.add(dir); node.data.expanded = [...expanded]; save();
      await refresh(); if (!folder) openFile(p, true);
    };
    const rename = async (p) => {
      const n = await askText('Rename', { value: nameOf(p) });
      if (!n || !n.trim() || n.trim() === nameOf(p)) return;
      const to = join(parent(p), n.trim()), r = await window.argon.fs.rename(p, to);
      if (!r.ok) { toast(r.error || "Couldn't rename it.", 'err'); return; }
      if (sel === p) { sel = to; node.data.open = to; save(); }
      refresh();
    };
    const move = async (p, dir) => {
      if (norm(dir).toLowerCase().startsWith(norm(p).toLowerCase())) return; // not into itself
      const to = join(dir, nameOf(p)); if (norm(to) === norm(p)) return;
      const r = await window.argon.fs.rename(p, to);
      if (!r.ok) { toast(r.error || "Couldn't move it.", 'err'); return; }
      toast(`Moved ${nameOf(p)} to ${nameOf(dir)}`);
      if (sel === p) { sel = to; node.data.open = to; save(); }
      expanded.add(dir); node.data.expanded = [...expanded]; save(); refresh();
    };
    const trash = async (p, isDir) => {
      if (!(await confirmBox(`Delete ${nameOf(p)}?`, `${isDir ? 'The folder and everything in it go' : 'It goes'} to the Recycle Bin, so you can get it back from there.`, 'Delete'))) return;
      const r = await window.argon.fs.trash(p);
      if (!r.ok) { toast(r.error || "Couldn't delete it.", 'err'); return; }
      if (sel === p) { sel = null; node.data.open = null; save(); showNothing(); }
      refresh();
    };
    const rowMenu = (it, x, y) => showMenu(x, y, [
      !it.dir ? { label: 'Open', onClick: () => openFile(it.path) } : { label: 'Open as top folder', onClick: () => setRoot(it.path) },
      { label: 'Open with default app', onClick: () => window.argon.fs.open(it.path) },
      { label: 'Show in Explorer', onClick: () => window.argon.reveal(it.path) },
      { label: 'Copy path', onClick: () => { navigator.clipboard.writeText(it.path).then(() => toast('Path copied')).catch(() => {}); } },
      'sep',
      { label: 'Rename…', onClick: () => rename(it.path) },
      { label: 'Delete', note: 'Recycle Bin', onClick: () => trash(it.path, it.dir) },
    ]);

    const renderDir = async (dir, depth, into) => {
      const items = await window.argon.fs.list(dir);
      for (const it of items) {
        const row = h('div', { class: 'frow' + (sel === it.path ? ' sel' : ''), style: { paddingLeft: (8 + depth * 14) + 'px' }, title: it.path, draggable: 'true', 'data-path': it.path, 'data-dir': it.dir ? '1' : '0' },
          h('span', { class: 'fm-ico' }, it.dir ? (expanded.has(it.path) ? '▾' : '▸') : '·'), it.name);
        into.append(row);
        row.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); select(row); rowMenu(it, e.clientX, e.clientY); });
        row.addEventListener('dragstart', (e) => { e.stopPropagation(); e.dataTransfer.setData('text/argon-path', it.path); e.dataTransfer.effectAllowed = 'move'; });
        if (it.dir) {
          row.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/argon-path')) { e.preventDefault(); row.classList.add('drop'); } });
          row.addEventListener('dragleave', () => row.classList.remove('drop'));
          row.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); row.classList.remove('drop'); const p = e.dataTransfer.getData('text/argon-path'); if (p) move(p, it.path); });
          const kids = h('div');
          into.append(kids);
          if (expanded.has(it.path)) await renderDir(it.path, depth + 1, kids);
          row.onclick = async () => {
            select(row);
            if (expanded.has(it.path)) { expanded.delete(it.path); kids.innerHTML = ''; row.firstChild.textContent = '▸'; }
            else { expanded.add(it.path); row.firstChild.textContent = '▾'; await renderDir(it.path, depth + 1, kids); }
            node.data.expanded = [...expanded]; save();
          };
          row.ondblclick = () => setRoot(it.path);
        } else {
          row.onclick = () => { select(row); openFile(it.path); };
          row.ondblclick = () => window.argon.fs.open(it.path);
        }
      }
    };
    const select = (row) => { tree.querySelectorAll('.sel').forEach((s) => s.classList.remove('sel')); row.classList.add('sel'); };
    // dropping on empty space in the tree moves to the top folder
    tree.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/argon-path')) e.preventDefault(); });
    tree.addEventListener('drop', (e) => { const p = e.dataTransfer.getData('text/argon-path'); if (p) { e.preventDefault(); move(p, root()); } });

    const showNothing = () => { pathEl.textContent = 'Select a file'; pre.hidden = false; ta.hidden = true; pre.textContent = 'Select a file to preview it.'; editBtn.hidden = saveBtn.hidden = openBtn.hidden = true; };
    const openFile = async (p, edit) => {
      if (dirty && current && !(await confirmBox('Discard changes?', `${nameOf(current)} has unsaved edits.`, 'Discard'))) return;
      dirty = false; sel = p; node.data.open = p; save();
      pathEl.textContent = nameOf(p); pathEl.title = p; openBtn.hidden = false;
      const r = await window.argon.fs.read(p);
      if (!r.ok) { current = null; pre.hidden = false; ta.hidden = true; pre.textContent = r.error; editBtn.hidden = saveBtn.hidden = true; return; }
      current = p; ta.value = r.text; editBtn.hidden = false;
      pre.innerHTML = highlight(r.text, p);
      if (edit) toggleEdit(true); else { pre.hidden = false; ta.hidden = true; saveBtn.hidden = true; editBtn.textContent = 'Edit'; }
    };
    const toggleEdit = (on = ta.hidden) => {
      ta.hidden = !on; pre.hidden = on; saveBtn.hidden = !on; saveBtn.disabled = !dirty; editBtn.textContent = on ? 'Done' : 'Edit';
      if (on) ta.focus(); else pre.innerHTML = highlight(ta.value, current || '');
    };
    const saveFile = async () => {
      if (!current) return;
      if (!(await window.argon.fs.write(current, ta.value))) { toast("Couldn't save.", 'err'); return; }
      dirty = false; saveBtn.disabled = true; toast(`Saved ${nameOf(current)}`);
    };
    const refresh = async () => {
      paintCrumbs(); tree.innerHTML = '';
      if (!root()) { tree.append(h('div', { class: 'frow' }, 'No folder')); return; }
      await renderDir(root(), 0, tree);
    };
    refresh();
    if (node.data.open) openFile(node.data.open);
    btns.append(h('button', { class: 'tile-btn', title: 'Refresh', onclick: refresh }, '⟳'));
    // keep up with changes agents make: refresh every few seconds while visible
    const iv = setInterval(() => { if (!document.contains(body)) { clearInterval(iv); return; } if (body.offsetParent && !body.contains(document.activeElement)) refresh(); }, 6000);
  },

  git(node, w, { body, btns }) {
    const card = h('div', { class: 'gitcard' }, 'Loading…');
    body.append(card);
    const cwd = () => node.data.cwd || w.cwd;
    let busy = false;
    const act = async (action, arg, label) => {
      if (busy) return; busy = true;
      toast(label + '…');
      const r = await window.argon.git.action(cwd(), action, arg);
      busy = false;
      toast(r.ok ? label + ' done' : (r.err || 'Failed').split('\n')[0].slice(0, 140), r.ok ? '' : 'err');
      refresh();
    };
    const refresh = async () => {
      if (!document.contains(card)) { clearInterval(iv); return; }
      const g = await window.argon.git.info(cwd());
      if (!g.repo) {
        card.innerHTML = '';
        card.append(h('div', { style: { color: 'var(--muted)' } }, 'This folder is not a git repository.'));
        return;
      }
      const sel = h('select', { onchange: () => act('checkout', sel.value, 'Switching to ' + sel.value) }, ...g.branches.map(b => { const o = h('option', { value: b }, b); if (b === g.branch) o.selected = true; return o; }));
      const msg = h('input', { type: 'text', placeholder: 'Commit message' });
      card.innerHTML = '';
      card.append(
        h('div', { class: 'git-branch' }, h('span', { style: { color: 'var(--accent)' } }, '⑂'), sel),
        h('div', { class: 'git-stats' },
          h('span', {}, `${g.changes.length} changed`),
          g.upstream ? h('span', {}, `↑${g.ahead} ↓${g.behind}`) : h('span', {}, 'no upstream')),
        g.changes.length ? h('div', { class: 'git-changes' }, ...g.changes.slice(0, 200).map(c => h('div', { class: 'c', title: c.file }, h('b', {}, c.code.trim() || '?'), c.file))) : h('div', { style: { color: 'var(--dim)', fontSize: '12px' } }, 'Working tree clean'),
        h('div', { class: 'git-commit' }, msg, h('button', { class: 'btn sm primary', disabled: !g.changes.length, onclick: () => { if (msg.value.trim()) act('commit', msg.value.trim(), 'Committing'); else msg.focus(); } }, 'Commit')),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', onclick: () => act('pull', null, 'Pulling') }, '↓ Pull'),
          h('button', { class: 'btn sm', onclick: () => act('push', null, 'Pushing') }, '↑ Push'),
          h('button', { class: 'btn sm', onclick: () => act('fetch', null, 'Fetching') }, 'Fetch')),
        h('div', { class: 'section-title', style: { margin: '6px 0 0' } }, 'Recent commits'),
        h('div', { class: 'git-log' }, ...g.log.map(l => h('div', { title: l.s }, h('code', {}, l.h), l.s, h('span', { style: { color: 'var(--dim)' } }, ' · ' + l.t)))));
      msg.addEventListener('keydown', (e) => { if (e.key === 'Enter' && msg.value.trim()) act('commit', msg.value.trim(), 'Committing'); });
    };
    const iv = setInterval(() => { if (!card.contains(document.activeElement)) refresh(); }, 8000);
    refresh();
    btns.append(h('button', { class: 'tile-btn', title: 'Refresh', onclick: refresh }, '⟳'));
  },

  image(node, w, { body }) {
    body.append(h('img', { src: node.data.src, draggable: 'false' }));
  },

  group(node, w, { el, head, extras, btns }) {
    const paint = () => { el.style.setProperty('--gc', groupColor(node.data.color)); colors.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.c === (node.data.color === '#9a83d4' ? 'accent' : node.data.color || 'accent'))); };
    const colors = h('span', { class: 'note-colors group-colors' });
    const count = h('span', { class: 'group-count', title: 'Tiles in this group' });
    const tag = h('span', { class: 'group-tag', title: 'Message every console here with this tag' });
    const upd = () => {
      if (!document.contains(el)) return;
      const m = groupMembers(node, w).filter(n => n.type !== 'group');
      count.textContent = m.length ? m.length + (m.length === 1 ? ' tile' : ' tiles') : 'Drop tiles here';
      el.classList.toggle('empty', !m.length);
      tag.textContent = m.some(n => n.type === 'console') ? '#' + groupTag(node) : '';
    };
    upd(); on('nodes', upd);
    extras.append(count, tag);
    // real buttons, so pressing one doesn't start dragging the group; the tags and wires of everyone inside repaint too
    GROUP_COLORS.forEach(c => colors.append(h('button', { type: 'button', 'data-c': c, style: { background: groupColor(c) }, title: c === 'accent' ? 'Accent color' : 'Color', onclick: (e) => { e.stopPropagation(); node.data.color = c; paint(); save(); for (const m of groupMembers(node, w)) emit('consoleMeta', m.id); emit('nodes'); } })));
    paint();
    btns.append(colors, h('button', { class: 'tile-btn', title: 'More', onclick: (e) => { e.stopPropagation(); groupMenu(node, w, e.clientX, e.clientY); } }, '⋯'));
    head.querySelector('.tile-btn.danger').title = 'Ungroup (keeps the tiles)';
    el.addEventListener('contextmenu', (e) => { if (e.target.closest('.tile-head')) { e.preventDefault(); groupMenu(node, w, e.clientX, e.clientY); } });
  },
};

function groupMenu(node, w, x, y) {
  const members = () => groupMembers(node, w).filter(n => n.type !== 'group');
  const cons = () => members().filter(n => n.type === 'console');
  showMenu(x, y, [
    { label: 'Rename', onClick: async () => { const t = await askText('Rename group', { value: node.title, sub: 'Consoles inside are tagged with this name.' }); if (t && t.trim()) { node.title = t.trim().slice(0, 60); els.get(node.id).querySelector('.tile-title').textContent = node.title; retagAll(w); save(); emit('nodes'); } } },
    { label: 'Auto-tile', note: node.data.tile === false ? 'off' : 'on', onClick: () => { node.data.tile = node.data.tile === false; fitGroup(node, w); save(); emit('nodes'); toast(node.data.tile === false ? 'Auto-tile off: tiles stay where you drop them' : 'Auto-tile on: tiles snap into a grid'); } },
    { label: 'Message consoles…', note: String(cons().length), onClick: async () => {
      const cs = cons(); if (!cs.length) { toast('No consoles in this group yet.'); return; }
      const t = await askText('Message ' + node.title, { placeholder: 'Sent to every console in this group', sub: cs.map(c => c.title).join(', ') });
      if (t && t.trim()) { const sent = cs.filter(c => sendTo(c.id, t.trim())).length; toast(`Sent to ${sent} of ${cs.length}`); }
    } },
    ...(tileHooks.groupItems ? tileHooks.groupItems(node, w) : []),
    'sep',
    { label: 'Ungroup', note: 'keeps tiles', onClick: () => removeNode(node.id) },
    { label: 'Delete group and tiles', onClick: async () => {
      const m = members();
      const ok = await confirmBox(`Delete ${node.title}?`, `This closes ${m.length} tile${m.length === 1 ? '' : 's'} inside it, including any running agents.`, 'Delete all');
      if (!ok) return;
      for (const n of m) await removeNode(n.id, false);
      removeNode(node.id);
    } },
  ]);
}

function normUrl(u) { u = (u || '').trim(); if (!u) return 'about:blank'; if (/^(https?|file|about):/i.test(u)) return u; if (/^localhost|^127\.|^\d+$/.test(u)) return 'http://' + (/^\d+$/.test(u) ? 'localhost:' + u : u); return 'https://' + u; }

const KW = /\b(const|let|var|function|return|if|else|for|while|import|export|from|class|new|async|await|def|fn|pub|struct|impl|use|package|public|private|static|void|int|string|bool|true|false|null|None|True|False|this|self|try|catch|throw|switch|case|break|continue|interface|type|extends|implements|enum|match|lambda|yield|in|of|default)\b/g;
function highlight(text, file) {
  const lines = text.split('\n').slice(0, 4000);
  const ext = (file.split('.').pop() || '').toLowerCase();
  const code = ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'kt', 'c', 'cpp', 'h', 'cs', 'swift', 'rb', 'php', 'lua', 'json', 'css', 'scss', 'html'].includes(ext);
  const hashCmt = ['py', 'rb', 'sh', 'yml', 'yaml', 'toml'].includes(ext);
  return lines.map((l, i) => {
    let s = esc(l);
    if (code) {
      s = s.replace(/(&quot;.*?&quot;|&#39;.*?&#39;|`.*?`)|(\/\/.*$|#.*$)|(\b\d+(\.\d+)?\b)|\b([a-zA-Z_]+)\b/g, (m, str, cmt, num, _f, word) => {
        if (str) return `<span class="tok-s">${str}</span>`;
        if (cmt) return (cmt.startsWith('#') && !hashCmt) ? cmt : `<span class="tok-c">${cmt}</span>`;
        if (num) return `<span class="tok-n">${num}</span>`;
        if (word && KW.test(word)) { KW.lastIndex = 0; return `<span class="tok-k">${word}</span>`; }
        KW.lastIndex = 0;
        return m;
      });
    }
    return `<span class="ln">${i + 1}</span>${s}`;
  }).join('\n');
}

// ---------- console menu ----------
function consoleMenu(node, w, x, y) {
  const others = w.nodes.filter(n => n.type === 'console' && n.id !== node.id);
  showMenu(x, y, [
    { label: 'Rename', onClick: async () => { const t = await askText('Rename console', { value: node.title }); if (t && t.trim()) { node.title = t.trim(); els.get(node.id).querySelector('.tile-title').textContent = node.title; save(); emit('nodes'); } } },
    { label: 'Set group / team…', note: node.data.group || '', onClick: async () => { const g = await askText('Group name', { value: node.data.group || '', placeholder: 'e.g. frontend', sub: 'Consoles in a group can be ordered together: #frontend do X' }); if (g !== null) { node.data.group = g.trim(); save(); emit('consoleMeta', node.id); emit('nodes'); } } },
    { label: 'Loop…', onClick: () => openLoopEditor(node) },
    { label: 'Hand off to…', onClick: () => openHandoff(node, w) },
    { label: 'Push project memory', onClick: () => pushMemory([node.id], w) },
    'sep',
    { label: 'Copy recent output', onClick: () => { navigator.clipboard.writeText(lastLines(node.id, 200)); toast('Copied'); } },
    { label: 'Focus (zoom to 100%)', onClick: () => emit('fly', node.id) },
    { label: 'Restart', note: 'fresh session', onClick: () => restartConsole(node, true) },
    { label: 'Duplicate', onClick: () => addNode('console', { agent: node.data.agent, group: node.data.group, profile: node.data.profile, cwd: node.data.cwd }, { x: node.x + 40, y: node.y + 40, w: node.w, h: node.h }) },
    'sep',
    { label: 'Close', onClick: () => removeNode(node.id) },
  ]);
}

// ---------- image drop + paste ----------
export function initDrops() {
  const b = document.getElementById('board');
  b.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  b.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer.files || [])].filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    const p = toWorld(e.clientX, e.clientY);
    files.forEach((f, i) => addImage(f, p.x + i * 30, p.y + i * 30));
  });
  window.addEventListener('paste', (e) => {
    if (e.target.closest && (e.target.closest('.xterm') || e.target.closest('input, textarea, [contenteditable="true"]'))) return;
    const f = [...(e.clipboardData.files || [])].find(f => f.type.startsWith('image/'));
    if (f) { const c = viewCenter(); addImage(f, c.x - 180, c.y - 130); }
  });
}
function addImage(file, x, y) {
  if (file.size > 6 * 1024 * 1024) { toast('Images over 6 MB are not supported.', 'warn'); return; }
  const fr = new FileReader();
  fr.onload = () => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 520 / img.width, 400 / img.height);
      addNode('image', { src: fr.result }, { x: Math.round(x), y: Math.round(y), w: Math.round(img.width * scale), h: Math.round(img.height * scale) + 34, title: file.name || 'Image' });
    };
    img.src = fr.result;
  };
  fr.readAsDataURL(file);
}
