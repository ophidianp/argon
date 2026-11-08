// Infinite board: pan, zoom, ink layer.
import { S, ws, save, uid, emit } from './state.js';
import { look } from './appearance.js';

const board = () => document.getElementById('board');
const world = () => document.getElementById('world');
export let tool = 'select';
// Pipeline mode swaps in its own list of things to fit (stages instead of board tiles).
export const boardHooks = { items: null };
const MIN_Z = 0.15, MAX_Z = 2.5;

export function applyView() {
  const v = ws().view;
  world().style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
  const b = board();
  const g = (+look().patternSize || 24) * v.z;
  b.style.backgroundSize = `${g}px ${g}px`;
  b.style.backgroundPosition = `${v.x}px ${v.y}px`;
  document.getElementById('zoom-label').textContent = Math.round(v.z * 100) + '%';
}

// screen (client) -> world coords
export function toWorld(cx, cy) {
  const r = board().getBoundingClientRect();
  const v = ws().view;
  return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z };
}

// The part of the board not covered by floating glass bars.
export function visibleRect() {
  const b = board().getBoundingClientRect();
  const pad = { l: 0, t: 0, r: 0, b: 0 };
  for (const id of ['topbar', 'dock', 'mission']) {
    const el = document.getElementById(id);
    if (!el || el.classList.contains('closed')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.width > b.width * 0.5 && r.top < b.top + 90) pad.t = Math.max(pad.t, r.bottom - b.top);
    else if (r.height > r.width && r.left + r.width / 2 < b.left + b.width / 2) pad.l = Math.max(pad.l, r.right - b.left);
    else if (r.height > r.width) pad.r = Math.max(pad.r, b.right - r.left);
    else if (r.top > b.top + b.height / 2) pad.b = Math.max(pad.b, b.bottom - r.top);
  }
  return { left: pad.l, top: pad.t, width: Math.max(200, b.width - pad.l - pad.r), height: Math.max(150, b.height - pad.t - pad.b), bl: b.left, bt: b.top };
}

export function viewCenter() {
  const v = visibleRect();
  return toWorld(v.bl + v.left + v.width / 2, v.bt + v.top + v.height / 2);
}

export function zoomAt(cx, cy, factor) {
  const v = ws().view;
  const r = board().getBoundingClientRect();
  const nz = Math.min(MAX_Z, Math.max(MIN_Z, v.z * factor));
  const px = cx - r.left, py = cy - r.top;
  v.x = px - (px - v.x) * (nz / v.z);
  v.y = py - (py - v.y) * (nz / v.z);
  v.z = nz;
  applyView(); save();
}

// Eased wheel zoom: each notch moves a target, the view glides toward it.
let zTarget = null, zAnchor = null, zRaf = 0;
export function smoothZoom(cx, cy, factor) {
  const motion = !document.body.classList.contains('no-anim') && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!motion) { zoomAt(cx, cy, factor); return; }
  const v = ws().view;
  if (zTarget == null) zTarget = v.z;
  zTarget = Math.min(MAX_Z, Math.max(MIN_Z, zTarget * factor));
  zAnchor = [cx, cy];
  if (zRaf) return;
  const step = () => {
    const cur = ws().view.z;
    const diff = zTarget - cur;
    if (Math.abs(diff) < 0.0015) { zoomAt(zAnchor[0], zAnchor[1], zTarget / cur); zTarget = null; zRaf = 0; return; }
    zoomAt(zAnchor[0], zAnchor[1], (cur + diff * 0.28) / cur);
    zRaf = requestAnimationFrame(step);
  };
  zRaf = requestAnimationFrame(step);
}

let anim = null;
export function animateTo(target, ms = 380) {
  cancelAnimationFrame(zRaf); zRaf = 0; zTarget = null;
  const v = ws().view;
  const from = { ...v };
  const t0 = performance.now();
  cancelAnimationFrame(anim);
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    v.x = from.x + (target.x - from.x) * e;
    v.y = from.y + (target.y - from.y) * e;
    v.z = from.z + (target.z - from.z) * e;
    applyView();
    if (k < 1) anim = requestAnimationFrame(step); else { save(); emit('view:settled'); }
  };
  anim = requestAnimationFrame(step);
}

// Center a node on screen at a readable zoom.
export function flyTo(node, z = 1) {
  const r = visibleRect();
  const fitZ = Math.min(z, (r.width - 60) / node.w, (r.height - 60) / node.h);
  const nz = Math.max(MIN_Z, fitZ);
  animateTo({ x: r.left + r.width / 2 - (node.x + node.w / 2) * nz, y: r.top + r.height / 2 - (node.y + node.h / 2) * nz, z: nz });
}

export function fitAll() {
  const nodes = boardHooks.items ? boardHooks.items() : ws().nodes;
  const r = visibleRect();
  if (!nodes.length) { animateTo({ x: r.left + 30, y: r.top + 20, z: 1 }); return; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h); }
  const pad = 36;
  const z = Math.max(MIN_Z, Math.min(1.2, (r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0)));
  animateTo({ x: r.left + (r.width - (x1 - x0) * z) / 2 - x0 * z, y: r.top + (r.height - (y1 - y0) * z) / 2 - y0 * z, z });
}

export function setTool(t) {
  tool = t;
  document.querySelectorAll('#dock .tool[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  const b = board();
  b.classList.toggle('tool-pen', t === 'pen');
  b.classList.toggle('tool-erase', t === 'erase');
}

// ---------- ink ----------
const INK_COLORS = ['#b9a6ec', '#f0b45a', '#7fd1a0', '#e0727c', '#ebe6f6'];
export let inkColor = INK_COLORS[0];
export function cycleInk() { inkColor = INK_COLORS[(INK_COLORS.indexOf(inkColor) + 1) % INK_COLORS.length]; return inkColor; }

function pathD(pts) {
  if (!pts.length) return '';
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  if (pts.length > 1) { const p = pts[pts.length - 1]; d += ` L${p[0].toFixed(1)} ${p[1].toFixed(1)}`; }
  return d;
}

export function renderInk() {
  const svg = document.getElementById('ink');
  svg.innerHTML = '';
  for (const s of ws().ink || []) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', pathD(s.pts));
    p.setAttribute('stroke', s.color);
    p.setAttribute('stroke-width', s.width);
    p.dataset.id = s.id;
    svg.append(p);
  }
}

export function initBoard() {
  const b = board();
  let pan = null, spaceDown = false;

  b.addEventListener('wheel', (e) => {
    const onEmpty = e.target === b || e.target.id === 'nodes' || e.target.id === 'world' || e.target.id === 'pen-capture';
    if (e.ctrlKey || onEmpty) {
      e.preventDefault();
      // Touchpads send small deltas with ctrlKey for pinch; mouse wheels send ~100.
      const isPinchOrWheel = e.ctrlKey || Math.abs(e.deltaY) >= 40 && !e.deltaX;
      if (isPinchOrWheel) {
        const pinch = e.ctrlKey && Math.abs(e.deltaY) < 40;
        const f = Math.exp(-e.deltaY * (pinch ? 0.01 : 0.0018));
        pinch ? zoomAt(e.clientX, e.clientY, f) : smoothZoom(e.clientX, e.clientY, f);
      }
      else { const v = ws().view; v.x -= e.deltaX; v.y -= e.deltaY; applyView(); save(); }
    }
  }, { passive: false });

  b.addEventListener('pointerdown', (e) => {
    const onEmpty = e.target === b || e.target.id === 'nodes' || e.target.id === 'world' || e.target.classList.contains('ws-layer') || e.target.classList.contains('pipe-layer') || e.target.classList.contains('pipe-wires');
    const wantPan = e.button === 1 || (e.button === 0 && (spaceDown || (onEmpty && tool === 'select')));
    if (!wantPan) return;
    e.preventDefault();
    if (onEmpty && e.button === 0) emit('select', null);
    const v = ws().view;
    pan = { sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y, id: e.pointerId };
    b.setPointerCapture(e.pointerId);
    b.classList.add('panning');
  });
  b.addEventListener('pointermove', (e) => {
    if (!pan) return;
    const v = ws().view;
    v.x = pan.vx + (e.clientX - pan.sx);
    v.y = pan.vy + (e.clientY - pan.sy);
    applyView();
  });
  const endPan = () => { if (pan) { pan = null; b.classList.remove('panning'); save(); } };
  b.addEventListener('pointerup', endPan);
  b.addEventListener('pointercancel', endPan);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !isTyping(e)) { spaceDown = true; b.classList.add('space-pan'); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceDown = false; b.classList.remove('space-pan'); } });

  // pen drawing
  const cap = document.getElementById('pen-capture');
  let stroke = null, livePath = null;
  cap.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    cap.setPointerCapture(e.pointerId);
    const p = toWorld(e.clientX, e.clientY);
    stroke = { id: uid('ink'), color: inkColor, width: Math.max(1.5, 3 / ws().view.z), pts: [[p.x, p.y]] };
    livePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    livePath.setAttribute('stroke', stroke.color);
    livePath.setAttribute('stroke-width', stroke.width);
    document.getElementById('ink').append(livePath);
  });
  cap.addEventListener('pointermove', (e) => {
    if (!stroke) return;
    const p = toWorld(e.clientX, e.clientY);
    const last = stroke.pts[stroke.pts.length - 1];
    if (Math.hypot(p.x - last[0], p.y - last[1]) < 1.5 / ws().view.z) return;
    stroke.pts.push([p.x, p.y]);
    livePath.setAttribute('d', pathD(stroke.pts));
  });
  cap.addEventListener('pointerup', () => {
    if (!stroke) return;
    if (stroke.pts.length > 1) { (ws().ink = ws().ink || []).push(stroke); save(); }
    stroke = null; renderInk();
  });

  // eraser
  document.getElementById('ink').addEventListener('pointerdown', (e) => {
    if (tool !== 'erase' || !e.target.dataset.id) return;
    e.stopPropagation();
    ws().ink = ws().ink.filter(s => s.id !== e.target.dataset.id);
    renderInk(); save();
  });

  // zoom buttons
  document.getElementById('zoomctl').addEventListener('click', (e) => {
    const z = e.target.dataset.z; if (!z) return;
    const r = b.getBoundingClientRect();
    if (z === '1') { const c = viewCenter(); animateTo({ x: r.width / 2 - c.x, y: r.height / 2 - c.y, z: 1 }); }
    else smoothZoom(r.left + r.width / 2, r.top + r.height / 2, z === '+' ? 1.25 : 1 / 1.25);
  });

  window.addEventListener('resize', applyView);
}

export function isTyping(e) {
  const t = e.target;
  if (!t) return false;
  if (t.closest && t.closest('.xterm')) return true;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || t.tagName === 'WEBVIEW';
}
