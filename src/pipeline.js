// Pipeline mode. Each workspace has two modes:
//   Board    — the free canvas (tiles, notes, groups).
//   Pipeline — stages wired together like shader nodes. Agents dock inside a stage and take a role;
//              when a stage finishes, its reports flow down the wire to the next stage, and the
//              Output node collects the summary, links and proof.
// Stages pass work through files: every agent writes a short report under .argon/pipeline/<run>/.
import { S, ws, save, emit, on, h, toast, uid } from './state.js';
import { applyView, animateTo, visibleRect, viewCenter, toWorld, boardHooks } from './board.js';
import { tileEl, tileHooks, place, select } from './tiles.js';
import { sendTo, rt, statusOf, queueFit, waitReady } from './consoles.js';
import { spawnMenu } from './panels.js';
import { askText, confirmBox, showMenu } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
export const STAGES = {
  think: { title: 'Think', purpose: 'Research the idea and agree on a plan.', color: '#9a83d4', roles: ['Researcher', 'Planner', 'Critic'] },
  code: { title: 'Code', purpose: 'Build the feature from the plan, with tests.', color: '#82a7f0', roles: ['Builder', 'Tester', 'Reviewer'] },
  website: { title: 'Website', purpose: 'Build and deploy a preview anyone can open.', color: '#5cc2c2', roles: ['Deployer', 'Designer'] },
  check: { title: 'Final check', purpose: 'Test the live result and collect proof.', color: '#e2b15a', roles: ['Verifier', 'Proof'] },
  custom: { title: 'New stage', purpose: 'Describe this stage’s job.', color: '#e0889f', roles: ['Helper', 'Researcher', 'Builder', 'Verifier'] },
};
const ALL_ROLES = ['Researcher', 'Planner', 'Critic', 'Builder', 'Tester', 'Reviewer', 'Deployer', 'Designer', 'Verifier', 'Proof', 'Helper'];
const ROLE_TASK = {
  Researcher: 'Research the brief: read the repo and anything relevant, then list what you found and the options.',
  Planner: 'Turn the brief into a concrete, step-by-step plan the next stage can build from.',
  Critic: 'Look for risks, gaps and edge cases in the approach, and suggest fixes.',
  Builder: 'Build it in the repo, following the plan. Commit your work on a new branch.',
  Tester: 'Write and run tests for what is being built, and fix what fails.',
  Reviewer: 'Review the changes for bugs and clarity, and fix anything important.',
  Deployer: 'Build the site and deploy a preview (or run it locally). Report the URL.',
  Designer: 'Polish the look: spacing, contrast, dark mode and the mobile layout.',
  Verifier: 'Check the live result end to end against the brief: open it, click through it, run the tests.',
  Proof: 'Collect proof: test results, screenshots saved under .argon/pipeline/proof/, and links.',
  Helper: 'Do this stage’s job as described.',
};
const COLORS = ['#9a83d4', '#82a7f0', '#5cc2c2', '#7fd1a0', '#e2b15a', '#e0889f'];
const STAGE_W = 420, DOCK_H = 232, GAP = 120, HEAD_Y = 17;

const motion = () => !document.body.classList.contains('no-anim') && !matchMedia('(prefers-reduced-motion: reduce)').matches;
const isPipe = (n) => !!(n && n.data && n.data.space === 'pipe');
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'stage';
const modeOf = (w = ws()) => (w.mode === 'pipe' ? 'pipe' : 'board');
export const inPipe = () => modeOf() === 'pipe';

// ---------- data ----------
export function ensurePipe(w) {
  w.mode = modeOf(w);
  w.views = w.views || {};
  w.views.board = w.views.board || w.view || { x: 80, y: 60, z: 1 };
  w.views.pipe = w.views.pipe || { x: 70, y: 150, z: 0.8 };
  w.view = w.views[w.mode];
  if (!w.pipe) w.pipe = { stages: [], links: [], out: { id: uid('out'), x: 0, y: 0, auto: true, result: null }, brief: '', run: null };
}
function seedPipe(w) {
  const p = w.pipe; if (p.stages.length) return false;
  p.stages = ['think', 'code', 'website', 'check'].map(newStage);
  p.links = [[0, 1], [1, 2], [2, 3]].map(([a, b]) => ({ from: p.stages[a].id, to: p.stages[b].id }));
  p.links.push({ from: p.stages[3].id, to: p.out.id });
  return true;
}
function newStage(key) { const d = STAGES[key]; return { id: uid('stg'), key, title: d.title, purpose: d.purpose, color: d.color, x: 0, y: 0, auto: true }; }
const stageById = (w, id) => w.pipe.stages.find((s) => s.id === id);
const agentsOf = (w, s) => { const v = views.get(w.id), slot = v && v.slots.get(s.id); if (!slot) return []; return [...slot.children].map((el) => w.nodes.find((n) => n.id === el.dataset.id)).filter(Boolean); };
const wired = (w, id) => w.pipe.links.some((l) => l.from === id || l.to === id);
const runState = (w, id) => (w.pipe.run && w.pipe.run.state[id]) || 'idle';
function order(w) { // stages wired into the flow, each after the stages feeding it; unwired stages last
  const p = w.pipe, st = p.stages.filter((s) => wired(w, s.id)), indeg = new Map(st.map((s) => [s.id, p.links.filter((l) => l.to === s.id).length])), out = [];
  const q = st.filter((s) => !indeg.get(s.id));
  while (q.length) { const s = q.shift(); out.push(s); for (const l of p.links) if (l.from === s.id && indeg.has(l.to)) { indeg.set(l.to, indeg.get(l.to) - 1); if (!indeg.get(l.to)) q.push(stageById(w, l.to)); } }
  return [...out, ...p.stages.filter((s) => !wired(w, s.id))];
}
const reaches = (w, a, b) => a === b || w.pipe.links.some((l) => l.from === a && reaches(w, l.to, b));

// ---------- DOM ----------
const views = new Map(); // wsId -> { layer, svg, els: Map(id->el), slots: Map(stageId->el), paths: Map(key->path) }
function pv(w) {
  let v = views.get(w.id);
  if (v) return v;
  const layer = h('div', { class: 'pipe-layer', 'data-ws': w.id, style: { display: 'none' } });
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'pipe-wires'); layer.append(svg);
  document.getElementById('nodes').append(layer);
  v = { layer, svg, els: new Map(), slots: new Map(), paths: new Map() };
  views.set(w.id, v);
  return v;
}
export function dropWorkspace(w) { const v = views.get(w.id); if (v) { v.layer.remove(); views.delete(w.id); } }

function build(w) {
  const v = pv(w);
  for (const s of w.pipe.stages) if (!v.els.has(s.id)) buildStage(w, s);
  if (!v.els.has(w.pipe.out.id)) buildOutput(w);
}
function buildStage(w, s) {
  const v = pv(w);
  const title = h('b', { class: 'pn-title', title: 'Double-click to rename' }, s.title);
  const head = h('div', { class: 'pn-head' }, h('i', { class: 'pn-num' }), title, h('span', { class: 'pn-state' }),
    h('button', { class: 'tile-btn', title: 'Stage options', onclick: (e) => { e.stopPropagation(); stageMenu(w, s, e.clientX, e.clientY); } }, '⋯'));
  const purpose = h('div', { class: 'pn-purpose', title: 'Double-click to change this stage’s job' }, s.purpose);
  const briefText = h('div', { class: 'pn-brief-text', contenteditable: 'true', spellcheck: 'false', 'data-ph': 'What should the pipeline build?' });
  briefText.textContent = w.pipe.brief || '';
  briefText.addEventListener('input', () => { w.pipe.brief = briefText.textContent.trim(); save(); });
  briefText.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); briefText.blur(); } });
  const brief = h('div', { class: 'pn-brief' }, h('span', {}, 'BRIEF'), briefText);
  const slots = h('div', { class: 'pn-slots' });
  const add = h('button', { class: 'pn-add', title: 'Spawn an agent straight into this stage' }, h('span', {}, '+'), 'Add agent');
  add.onclick = (e) => { e.stopPropagation(); const r = add.getBoundingClientRect(); spawnMenu(r.left, r.bottom + 6, { data: { space: 'pipe', stage: s.id }, at: { w: STAGE_W - 24, h: DOCK_H } }); };
  const el = h('div', { class: 'pnode stage', 'data-id': s.id }, head, purpose, brief, slots, h('div', { class: 'pn-empty' }, 'Drop agents here'), add,
    h('span', { class: 'sock in', title: 'Input: grab to pull the wire off' }), h('span', { class: 'sock out', title: 'Output: drag to another stage' }));
  el.style.setProperty('--nc', s.color);
  v.layer.append(el); v.els.set(s.id, el); v.slots.set(s.id, slots);
  dragNode(w, s, head);
  wireSockets(w, s.id, el);
  title.addEventListener('dblclick', (e) => { e.stopPropagation(); renameStage(w, s); });
  purpose.addEventListener('dblclick', (e) => { e.stopPropagation(); editPurpose(w, s); });
  placeNode(w, s);
  return el;
}
function buildOutput(w) {
  const v = pv(w), o = w.pipe.out;
  const head = h('div', { class: 'pn-head' }, h('i', { class: 'pn-num' }, '⇥'), h('b', { class: 'pn-title' }, 'Output'), h('span', { class: 'pn-state' }),
    h('button', { class: 'tile-btn', title: 'Output options', onclick: (e) => { e.stopPropagation(); outputMenu(w, e.clientX, e.clientY); } }, '⋯'));
  const el = h('div', { class: 'pnode output', 'data-id': o.id }, head, h('div', { class: 'po-body' }), h('span', { class: 'sock in', title: 'Input' }));
  v.layer.append(el); v.els.set(o.id, el);
  dragNode(w, o, head); wireSockets(w, o.id, el); placeNode(w, o); renderOutput(w, false);
}
// Auto-tiling: a busy stage widens into 2 or 3 columns of agents.
function stageCols(w, s) { const n = agentsOf(w, s).length; return s.tile === false ? 1 : n >= 5 ? 3 : n >= 3 ? 2 : 1; }
function nodeW(w, n) { const s = stageById(w, n.id); return s ? STAGE_W + (stageCols(w, s) - 1) * (STAGE_W - 34) : STAGE_W; }
function placeNode(w, n) { const el = pv(w).els.get(n.id); if (!el) return; el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; el.style.width = nodeW(w, n) + 'px'; }
const rect = (w, id) => { const el = pv(w).els.get(id); return el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null; };

function paintStage(w, s) {
  const v = pv(w), el = v.els.get(s.id); if (!el) return;
  const ag = agentsOf(w, s), st = runState(w, s.id), needs = ag.some((n) => statusOf(n.id) === 'needs');
  el.classList.toggle('running', st === 'running'); el.classList.toggle('done', st === 'done'); el.classList.toggle('waiting', needs);
  el.classList.toggle('unwired', !wired(w, s.id));
  el.classList.toggle('root', wired(w, s.id) && !w.pipe.links.some((l) => l.to === s.id));
  el.querySelector('.pn-state').textContent = needs ? 'Needs you' : st === 'running' ? 'Running' : st === 'done' ? 'Done' : ag.length ? `${ag.length} agent${ag.length === 1 ? '' : 's'}` : 'Empty';
  el.querySelector('.pn-title').textContent = s.title; el.querySelector('.pn-purpose').textContent = s.purpose;
  el.style.setProperty('--nc', s.color);
  const cols = stageCols(w, s); if (el.style.getPropertyValue('--cols') !== String(cols)) { el.style.setProperty('--cols', cols); placeNode(w, s); ag.forEach((n) => setTimeout(() => queueFit(n.id), 560)); }
  const bt = el.querySelector('.pn-brief-text'); if (document.activeElement !== bt && bt.textContent !== (w.pipe.brief || '')) bt.textContent = w.pipe.brief || '';
}
function renumber(w) { let i = 0; for (const s of order(w)) { const el = pv(w).els.get(s.id); if (el) el.querySelector('.pn-num').textContent = wired(w, s.id) ? ++i : '–'; } }
function paintAll(w = ws()) {
  if (!views.has(w.id)) return;
  renumber(w); w.pipe.stages.forEach((s) => paintStage(w, s));
  const o = pv(w).els.get(w.pipe.out.id);
  if (o) { const st = runState(w, w.pipe.out.id); o.classList.toggle('done', st === 'done'); o.querySelector('.pn-state').textContent = st === 'done' ? 'Done' : w.pipe.run && w.pipe.run.active ? 'Waiting' : w.pipe.out.result ? 'Last run' : 'Waiting'; }
  const run = document.querySelector('#dock [data-pipe="run"]');
  if (run && w === ws()) { const on = !!(w.pipe.run && w.pipe.run.active); run.classList.toggle('running', on); run.textContent = on ? '■' : '▶'; run.title = on ? 'Stop the pipeline' : 'Run the pipeline (Ctrl+Enter)'; }
  drawWires(w);
}

// Nodes nobody has moved by hand keep a tidy left-to-right chain.
function flow(w, animate = true) {
  const p = w.pipe, ord = order(w), rank = (n) => (n.id === p.out.id ? 1e6 : !wired(w, n.id) ? 2e6 + ord.indexOf(n) : ord.indexOf(n));
  const auto = [...p.stages, p.out].filter((n) => n.auto).sort((a, b) => rank(a) - rank(b));
  let x = 0;
  for (const n of auto) { n.x = x; n.y = 0; x += nodeW(w, n) + GAP; placeNode(w, n); }
  animate ? animateWires(w) : drawWires(w);
}

// ---------- wires ----------
const sockPt = (w, id, side) => { const r = rect(w, id); return r ? [side === 'out' ? r.x + r.w : r.x, r.y + HEAD_Y] : [0, 0]; };
function curve([x1, y1], [x2, y2]) { const c = Math.max(50, Math.abs(x2 - x1) / 2); return `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`; }
function wireClass(w, l) {
  const a = runState(w, l.from), b = runState(w, l.to);
  if (a === 'done' && b === 'done') return 'done';
  if (a === 'done' && (b === 'running' || b === 'idle') && w.pipe.run && w.pipe.run.active) return 'flow';
  return '';
}
function drawWires(w) {
  const v = pv(w), keep = new Set();
  for (const l of w.pipe.links) {
    const key = l.from + '>' + l.to; keep.add(key);
    let p = v.paths.get(key);
    if (!p) { p = document.createElementNS(NS, 'path'); v.svg.append(p); v.paths.set(key, p); }
    p.setAttribute('d', curve(sockPt(w, l.from, 'out'), sockPt(w, l.to, 'in')));
    p.setAttribute('class', 'wire ' + wireClass(w, l));
    const st = stageById(w, l.from); p.style.setProperty('--wc', st ? st.color : 'var(--accent)');
  }
  for (const [k, p] of v.paths) if (!keep.has(k)) { p.remove(); v.paths.delete(k); }
}
let wireRaf = 0;
function animateWires(w, ms = 650) { const end = performance.now() + ms; cancelAnimationFrame(wireRaf); const step = () => { drawWires(w); if (performance.now() < end) wireRaf = requestAnimationFrame(step); }; step(); }
// A glowing packet rides the wire when a stage hands its reports on.
function packet(w, l) {
  if (!motion()) return;
  const v = pv(w), p = v.paths.get(l.from + '>' + l.to); if (!p) return;
  const st = stageById(w, l.from), c = st ? st.color : '#b9a6ec';
  const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'packet');
  const halo = document.createElementNS(NS, 'circle'); halo.setAttribute('r', 13); halo.setAttribute('fill', c); halo.setAttribute('opacity', '.25');
  const dot = document.createElementNS(NS, 'circle'); dot.setAttribute('r', 6); dot.setAttribute('fill', c);
  g.append(halo, dot); v.svg.append(g);
  const len = p.getTotalLength(), t0 = performance.now(), dur = 900;
  const step = (now) => { const k = Math.min(1, (now - t0) / dur), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2, pt = p.getPointAtLength(len * e); g.setAttribute('transform', `translate(${pt.x},${pt.y})`); if (k < 1) requestAnimationFrame(step); else { g.remove(); const el = v.els.get(l.to); el && el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.025)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' }); } };
  requestAnimationFrame(step);
}
function drawIn(w) { // wires sketch themselves in when the pipeline appears
  if (!motion()) return;
  [...pv(w).paths.values()].forEach((p, i) => { const len = p.getTotalLength(); p.animate([{ strokeDasharray: `${len}`, strokeDashoffset: len }, { strokeDasharray: `${len}`, strokeDashoffset: 0 }], { duration: 700, delay: 160 + i * 110, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'backwards' }); });
}

// ---------- dragging stages ----------
function dragNode(w, n, head) {
  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, [contenteditable="true"]')) return;
    e.stopPropagation(); e.preventDefault();
    const el = pv(w).els.get(n.id), z = w.view.z, sx = e.clientX, sy = e.clientY, ox = el.offsetLeft, oy = el.offsetTop; let moved = false;
    const move = (m) => {
      const dx = (m.clientX - sx) / z, dy = (m.clientY - sy) / z;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      if (!moved) { moved = true; n.auto = false; el.classList.add('moving'); document.body.classList.add('dragging'); }
      n.x = Math.round(ox + dx); n.y = Math.round(oy + dy); placeNode(w, n); drawWires(w);
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); el.classList.remove('moving'); document.body.classList.remove('dragging'); if (moved) save(); };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  });
  head.addEventListener('dblclick', (e) => { if (e.target === head) fly(w, n.id); });
}

// ---------- sockets: drag a wire from an output to an input ----------
function wireSockets(w, id, el) {
  const out = el.querySelector('.sock.out'), inn = el.querySelector('.sock.in');
  out && out.addEventListener('pointerdown', (e) => { if (e.button) return; e.stopPropagation(); e.preventDefault(); startLink(w, id, e); });
  inn && inn.addEventListener('pointerdown', (e) => {
    if (e.button) return; e.stopPropagation(); e.preventDefault();
    const l = w.pipe.links.find((x) => x.to === id); if (!l) return;
    w.pipe.links.splice(w.pipe.links.indexOf(l), 1); drawWires(w); startLink(w, l.from, e);
  });
}
function socketTarget(w, cx, cy, from) {
  const p = toWorld(cx, cy), v = pv(w); let best = null, bd = 46 / w.view.z;
  for (const [id, el] of v.els) { if (id === from || !el.querySelector('.sock.in')) continue; const [x, y] = sockPt(w, id, 'in'), d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = id; } }
  if (best) return best;
  for (const [id, el] of v.els) { if (id === from || !el.querySelector('.sock.in')) continue; const r = rect(w, id); if (p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) return id; }
  return null;
}
function startLink(w, from, e) {
  const v = pv(w), tmp = document.createElementNS(NS, 'path'); tmp.setAttribute('class', 'wire temp'); v.svg.append(tmp);
  const p0 = sockPt(w, from, 'out'); let hot = null;
  const move = (m) => {
    const p = toWorld(m.clientX, m.clientY); tmp.setAttribute('d', curve(p0, [p.x, p.y]));
    const t = socketTarget(w, m.clientX, m.clientY, from);
    if (t !== hot) { hot && v.els.get(hot)?.classList.remove('link-hot'); hot = t; t && v.els.get(t)?.classList.add('link-hot'); }
  };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); tmp.remove();
    if (hot) {
      v.els.get(hot)?.classList.remove('link-hot');
      if (reaches(w, hot, from)) toast('That would make a loop.', 'warn');
      else { w.pipe.links = w.pipe.links.filter((l) => l.to !== hot); w.pipe.links.push({ from, to: hot }); const a = stageById(w, from); toast(`${a ? a.title : 'Stage'} → ${hot === w.pipe.out.id ? 'Output' : stageById(w, hot).title}`); }
    }
    save(); paintAll(w); flow(w);
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up); move(e);
}

// ---------- agents: drag and drop between stages ----------
function stageAt(w, cx, cy) {
  const p = toWorld(cx, cy);
  return [...w.pipe.stages].reverse().find((s) => { const r = rect(w, s.id); return r && p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h; }) || null;
}
const slotBefore = (slot, cy, self) => [...slot.children].find((c) => { if (c === self) return false; const r = c.getBoundingClientRect(); return cy < r.top + r.height / 2; }) || null;
function flip(el, before, ms = 520) { // animate el from its old screen rect into its new place
  if (!motion() || !before) return;
  const after = el.getBoundingClientRect(); if (!after.width) return;
  const dx = before.left - after.left, dy = before.top - after.top, sx = before.width / after.width, sy = before.height / after.height;
  el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, transformOrigin: '0 0' }, { transform: 'none', transformOrigin: '0 0' }], { duration: ms, easing: 'cubic-bezier(.2,.9,.25,1.12)' });
}
function dock(w, n, s, before, fromRect) {
  const v = pv(w), el = tileEl(n.id), slot = v.slots.get(s.id); if (!el || !slot) return;
  const prev = n.data.stage;
  n.data.stage = s.id; n.data.group = slug(s.title);
  const roles = STAGES[s.key].roles;
  if (!n.data.role || (!roles.includes(n.data.role) && prev !== s.id)) n.data.role = roles[Math.min(agentsOf(w, s).length, roles.length - 1)];
  el.classList.add('docked'); slot.insertBefore(el, before); place(n); el.style.zIndex = '';
  flip(el, fromRect);
  const sel = v.els.get(s.id); motion() && sel && sel.animate([{ boxShadow: `0 0 0 0 ${s.color}66` }, { boxShadow: `0 0 0 14px ${s.color}00` }], { duration: 650, easing: 'ease-out' });
  syncSlots(w); paintRole(w, n); emit('consoleMeta', n.id); emit('nodes');
  setTimeout(() => queueFit(n.id), 560);
}
function undock(w, n, x, y, wdt) {
  const v = pv(w), el = tileEl(n.id); if (!el) return;
  delete n.data.stage; n.data.group = '';
  el.classList.remove('docked'); v.layer.append(el);
  n.x = Math.round(x); n.y = Math.round(y); n.w = Math.round(Math.max(340, wdt || STAGE_W - 24)); n.h = DOCK_H; place(n);
  syncSlots(w); emit('consoleMeta', n.id); emit('nodes');
}
function syncSlots(w) { // remember the order agents sit in, and repaint
  for (const s of w.pipe.stages) agentsOf(w, s).forEach((n, i) => { n.data.slot = i; });
  paintAll(w); flow(w); save();
}
function dragAgent(w, n, e, el) {
  e.stopPropagation(); e.preventDefault();
  const r0 = el.getBoundingClientRect(), z = w.view.z, off = [(e.clientX - r0.left) / z, (e.clientY - r0.top) / z], sx = e.clientX, sy = e.clientY;
  let started = false, hot = null;
  const move = (m) => {
    if (!started) {
      if (Math.abs(m.clientX - sx) + Math.abs(m.clientY - sy) < 6) return;
      started = true; document.body.classList.add('dragging');
      if (n.data.stage) { const p = toWorld(r0.left, r0.top); undock(w, n, p.x, p.y, r0.width / z); }
      el.classList.add('lifted'); select(n.id);
    }
    const p = toWorld(m.clientX, m.clientY); n.x = Math.round(p.x - off[0]); n.y = Math.round(p.y - off[1]); place(n);
    const s = stageAt(w, m.clientX, m.clientY);
    if (s !== hot) { hot && pv(w).els.get(hot.id)?.classList.remove('drop'); hot = s; s && pv(w).els.get(s.id)?.classList.add('drop'); }
  };
  const up = (m) => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    document.body.classList.remove('dragging'); el.classList.remove('lifted');
    if (!started) return;
    if (hot) { pv(w).els.get(hot.id)?.classList.remove('drop'); const before = slotBefore(pv(w).slots.get(hot.id), m.clientY, el); const fr = el.getBoundingClientRect(); dock(w, n, hot, before, fr); toast(`${n.title} joined ${hot.title} as ${n.data.role}`); }
    else { queueFit(n.id); save(); }
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
}

// Role chip on each docked agent: tap to cycle.
const roleChips = new Map();
function paintRole(w, n) {
  const c = roleChips.get(n.id); if (!c) return;
  const s = n.data.stage && stageById(w, n.data.stage);
  c.textContent = n.data.role || 'Helper'; c.style.display = s ? '' : 'none';
  if (s) c.style.setProperty('--nc', s.color);
}
function cycleRole(w, n) {
  const s = n.data.stage && stageById(w, n.data.stage); if (!s) return;
  const rs = s.key === 'custom' ? ALL_ROLES : STAGES[s.key].roles;
  n.data.role = rs[(rs.indexOf(n.data.role) + 1) % rs.length]; paintRole(w, n); save();
  const c = roleChips.get(n.id); motion() && c && c.animate([{ transform: 'scale(.8)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' });
}

// ---------- menus ----------
async function renameStage(w, s) { const t = await askText('Rename stage', { value: s.title, sub: 'Agents here can be messaged with #' + slug(s.title) + '.' }); if (t && t.trim()) { s.title = t.trim().slice(0, 40); agentsOf(w, s).forEach((n) => { n.data.group = slug(s.title); emit('consoleMeta', n.id); }); save(); paintAll(w); emit('nodes'); } }
async function editPurpose(w, s) { const t = await askText('What does this stage do?', { value: s.purpose, multiline: true, sub: 'Every agent in the stage gets this as its job.' }); if (t && t.trim()) { s.purpose = t.trim(); save(); paintAll(w); flow(w); } }
function stageMenu(w, s, x, y) {
  const running = runState(w, s.id) === 'running';
  showMenu(x, y, [
    { label: 'Add agent…', onClick: () => spawnMenu(x, y, { data: { space: 'pipe', stage: s.id }, at: { w: STAGE_W - 24, h: DOCK_H } }) },
    { label: 'Rename', onClick: () => renameStage(w, s) },
    { label: 'Change its job…', onClick: () => editPurpose(w, s) },
    { label: 'Auto-tile agents', note: s.tile === false ? 'off' : 'on', onClick: () => { s.tile = s.tile === false; save(); paintAll(w); flow(w); toast(`Auto-tile ${s.tile === false ? 'off: agents stack in one column' : 'on: busy stages widen into columns'}`); } },
    { title: 'Color' },
    ...COLORS.map((c) => ({ label: c === s.color ? 'Current' : ' ', dot: c, onClick: () => { s.color = c; save(); paintAll(w); agentsOf(w, s).forEach((n) => paintRole(w, n)); } })),
    'sep',
    running ? { label: 'Mark as done', note: 'skip waiting', onClick: () => finishStage(w, s) } : null,
    { label: 'Remove stage', note: 'agents stay', onClick: () => removeStage(w, s) },
  ].filter(Boolean));
}
function outputMenu(w, x, y) {
  showMenu(x, y, [
    { label: 'Clear results', onClick: () => { w.pipe.out.result = null; save(); renderOutput(w, false); paintAll(w); } },
    w.pipe.run && w.pipe.run.id ? { label: 'Open reports folder', onClick: () => window.argon.reveal(absPath(w, `.argon/pipeline/${w.pipe.run.id}`)) } : null,
  ].filter(Boolean));
}
function removeStage(w, s) {
  const v = pv(w), r = rect(w, s.id), ag = agentsOf(w, s);
  ag.forEach((n, i) => undock(w, n, r.x + 12, r.y + r.h + 40 + i * (DOCK_H + 16), STAGE_W - 24));
  w.pipe.links = w.pipe.links.filter((l) => l.from !== s.id && l.to !== s.id);
  w.pipe.stages = w.pipe.stages.filter((x) => x !== s);
  const el = v.els.get(s.id); v.els.delete(s.id); v.slots.delete(s.id);
  if (el) { if (motion()) { el.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.92)' }], { duration: 220, easing: 'ease-in' }).onfinish = () => el.remove(); } else el.remove(); }
  save(); paintAll(w); flow(w);
}
export function addStage(w = ws()) {
  const s = newStage('custom'), used = new Set(w.pipe.stages.map((x) => x.color)); s.color = COLORS.find((c) => !used.has(c)) || s.color; s.auto = false;
  const xs = [...pv(w).els.keys()].map((id) => rect(w, id)).filter(Boolean);
  s.x = xs.length ? Math.max(...xs.map((r) => r.x + r.w)) + GAP : 0; s.y = xs.length ? Math.max(...xs.map((r) => r.y + r.h)) - 120 : 0;
  w.pipe.stages.push(s); buildStage(w, s); paintAll(w); save();
  const el = pv(w).els.get(s.id); el.classList.add('pop-in');
  setTimeout(() => fly(w, s.id), 40);
  toast('New stage. Drag from a socket to wire it in, and drop agents into it.');
  return s;
}
function fly(w, id) { const r = rect(w, id); if (!r) return; const vr = visibleRect(), z = Math.min(1, (vr.width - 80) / r.w, (vr.height - 80) / r.h); animateTo({ x: vr.left + vr.width / 2 - (r.x + r.w / 2) * z, y: vr.top + vr.height / 2 - (r.y + r.h / 2) * z, z }, 520); }

// ---------- running ----------
export function absPath(w, rel) { const base = (w.cwd || '').replace(/[\\/]+$/, ''); return window.argon.platform === 'win32' ? base + '\\' + rel.replace(/\//g, '\\') : base + '/' + rel; }
export async function toggleRun(w = ws()) { if (w.pipe.run && w.pipe.run.active) stopRun(w); else runPipeline(w); }
export async function runPipeline(w = ws()) {
  const p = w.pipe;
  if (!p.brief.trim()) {
    const b = await askText('What should the pipeline build?', { placeholder: 'e.g. A pricing page with monthly and yearly plans', sub: 'Every stage gets this brief.' });
    if (!b || !b.trim()) return; p.brief = b.trim(); paintAll(w);
  }
  const ord = order(w).filter((s) => wired(w, s.id));
  const roots = ord.filter((s) => !p.links.some((l) => l.to === s.id));
  if (!roots.length) { toast('Wire at least one stage into the flow first.', 'warn'); return; }
  if (!ord.some((s) => agentsOf(w, s).length)) { toast('Add agents to the stages first: use “+ Add agent” inside a stage.', 'warn'); return; }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  p.run = { id: stamp, active: true, state: {}, files: {}, started: Date.now() };
  p.out.result = null; renderOutput(w, false);
  roots.forEach((s) => startStage(w, s));
  ensurePoll(); paintAll(w); save();
  toast(`Pipeline running: ${ord.map((s) => s.title).join(' → ')} → Output`);
}
export function stopRun(w = ws()) { if (!w.pipe.run) return; w.pipe.run.active = false; for (const k in w.pipe.run.state) if (w.pipe.run.state[k] === 'running') w.pipe.run.state[k] = 'idle'; paintAll(w); save(); toast('Pipeline stopped. Agents keep whatever they were doing.'); }
function startStage(w, s) {
  const p = w.pipe, run = p.run; run.state[s.id] = 'running'; paintAll(w); follow(w, s.id);
  const ag = agentsOf(w, s);
  if (!ag.length) { setTimeout(() => finishStage(w, s), 700); return; }
  const ord = order(w).filter((x) => wired(w, x.id)), idx = ord.indexOf(s) + 1;
  const inputs = p.links.filter((l) => l.to === s.id).flatMap((l) => run.files[l.from] || []);
  const feedsOut = p.links.some((l) => l.from === s.id && l.to === p.out.id);
  const rels = [];
  ag.forEach((n) => {
    const rel = `.argon/pipeline/${run.id}/${slug(s.title)}-${slug(n.title)}.md`; rels.push(rel);
    const role = n.data.role || 'Helper';
    const prompt = [
      `[Argon pipeline] You are the ${role} in the "${s.title}" stage (stage ${idx} of ${ord.length}). Stage job: ${s.purpose}`,
      `Brief: ${p.brief}`,
      inputs.length ? `Start by reading the reports from the earlier stages: ${inputs.join(', ')}.` : '',
      `Your task: ${ROLE_TASK[role] || ROLE_TASK.Helper}`,
      `When you are done, write a short report (what you did, key files, links, anything the next stage needs) to ${rel} (create the folders if needed), then stop.`,
      feedsOut ? 'Your stage feeds the final Output, so start the report with "## Summary" (2–3 sentences), then "## Links" (URLs of any website, repo or pull request), then "## Proof" (tests, checks, screenshot paths).' : '',
    ].filter(Boolean).join(' ');
    if (n.data.agent === 'shell') { toast(`${n.title} is a plain terminal, so it gets no prompt. ${s.title} finishes once ${rel} exists.`); return; }
    const r = rt(n.id);
    if (!r || !r.alive) { toast(`${n.title} is not running. Restart it, or mark ${s.title} as done.`, 'warn'); return; }
    waitReady(r, 6000).then(() => { if (p.run === run && run.active) sendTo(n.id, prompt); });
  });
  run.files[s.id] = rels; save();
}
let poll = 0, polling = false;
function ensurePoll() { if (!poll) poll = setInterval(tickRuns, 1500); }
async function tickRuns() {
  if (polling) return; polling = true;
  try {
    let any = false;
    for (const w of S.data.workspaces) {
      const run = w.pipe && w.pipe.run; if (!run || !run.active) continue; any = true;
      for (const s of w.pipe.stages) {
        if (run.state[s.id] !== 'running') continue;
        const ag = agentsOf(w, s), rels = run.files[s.id] || [];
        if (!ag.length || !rels.length) continue;
        let done = true;
        for (const rel of rels) if (!(await window.argon.fs.exists(absPath(w, rel)))) { done = false; break; }
        if (done && ag.every((n) => statusOf(n.id) !== 'working')) finishStage(w, s);
      }
      paintAll(w);
    }
    if (!any) { clearInterval(poll); poll = 0; }
  } finally { polling = false; }
}
function finishStage(w, s) {
  const p = w.pipe, run = p.run; if (!run || !run.active || run.state[s.id] === 'done') return;
  run.state[s.id] = 'done'; paintAll(w); save();
  const el = pv(w).els.get(s.id); el && el.classList.add('just-done'); setTimeout(() => el && el.classList.remove('just-done'), 900);
  const outs = p.links.filter((l) => l.from === s.id);
  outs.forEach((l) => packet(w, l));
  setTimeout(() => {
    if (!run.active) return;
    for (const l of outs) {
      if (!p.links.filter((x) => x.to === l.to).every((x) => run.state[x.from] === 'done')) continue;
      if (l.to === p.out.id) finishOutput(w);
      else { const t = stageById(w, l.to); if (t && runState(w, t.id) === 'idle') startStage(w, t); }
    }
    if (!outs.length && !Object.values(run.state).includes('running')) { run.active = false; paintAll(w); save(); }
  }, motion() ? 950 : 60);
}
function sections(text) {
  const out = { _: [] }; let cur = '_';
  for (const line of String(text).split(/\r?\n/)) { const m = line.match(/^#{1,6}\s+(.+?)\s*$/); if (m) { cur = m[1].toLowerCase().replace(/[^a-z]+/g, ' ').trim(); out[cur] = out[cur] || []; continue; } (out[cur] = out[cur] || []).push(line); }
  for (const k in out) out[k] = out[k].join('\n').trim();
  return out;
}
// Shared with the Manager: read reports into a summary, links and proof, and draw them.
export async function collectReports(w, reports) {
  const summary = [], links = [], proof = [], files = [];
  for (const rel of reports) {
    const r = await window.argon.fs.read(absPath(w, rel)); if (!r || !r.ok) continue;
    const sec = sections(r.text), body = sec.summary || (sec._ || r.text).split(/\n\s*\n/)[0];
    for (const l of (sec.files || '').split(/\n/)) { const f = l.replace(/^\s*([-*•]|\d+\.)\s*/, '').replace(/[`*]/g, '').replace(/\s+[-–—(].*$/, '').trim(); if (f && /[\\/.]/.test(f) && !files.includes(f)) files.push(f); }
    if (body) summary.push(body.replace(/\s+/g, ' ').slice(0, 420));
    for (const u of ((sec.links || r.text).match(/https?:\/\/[^\s)>\]"'`]+/g) || [])) if (!links.includes(u)) links.push(u);
    for (const l of (sec.proof || '').split(/\n/)) { const t = l.replace(/^\s*([-*•]|\d+\.)\s*/, '').trim(); if (t) proof.push(t); }
  }
  return { summary: summary.join(' '), links: links.slice(0, 8), proof: proof.slice(0, 8), files };
}
export function resultParts(w, res) {
  const parts = [h('p', { class: 'po-sum' }, res.summary)];
  if (res.links.length) parts.push(h('div', { class: 'po-links' }, ...res.links.map((u) => h('button', { class: 'po-link', title: u, onclick: () => window.argon.openExternal(u) }, h('i', {}, linkLabel(u)), h('span', {}, u.replace(/^https?:\/\//, ''))))));
  if (res.proof.length) parts.push(h('div', { class: 'po-proof' }, ...res.proof.map((t) => h('span', {}, '✓ ' + t))));
  if (res.files && res.files.length) parts.push(filesPart(w, res.files));
  if (res.reports.length) parts.push(h('div', { class: 'po-reports' }, h('span', {}, 'Reports'), ...res.reports.map((rel) => h('button', { onclick: () => window.argon.reveal(absPath(w, rel)) }, rel.split('/').pop()))));
  return parts;
}
// Every file the team made or changed, grouped by folder. Click a folder or file to show it in Explorer.
function filesPart(w, files) {
  const win = window.argon.platform === 'win32', sep = win ? '\\' : '/';
  const base = (win ? (w.cwd || '').replace(/\//g, '\\') : (w.cwd || '')).replace(/[\\/]+$/, '');
  const abs = (f) => (/^([a-z]:[\\/]|[\\/]|~)/i.test(f) || !base ? f : base + sep + f.replace(/^\.[\\/]/, ''));
  const groups = new Map();
  for (const f of files) {
    const a = win ? abs(f).replace(/\//g, '\\') : abs(f);
    const i = Math.max(a.lastIndexOf('\\'), a.lastIndexOf('/'));
    const dir = a.slice(0, i), name = a.slice(i + 1);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push([name, a]);
  }
  const short = (d) => (base && d.toLowerCase().startsWith(base.toLowerCase()) ? (d.slice(base.length).replace(/^[\\/]/, '') || '(project folder)') : d);
  const box = h('div', { class: 'po-files' }, h('span', { class: 'po-files-t' }, `Output · ${files.length} file${files.length === 1 ? '' : 's'} in ${groups.size} folder${groups.size === 1 ? '' : 's'}`));
  let shown = 0;
  for (const [dir, list] of groups) {
    if (shown > 80) { box.append(h('p', { class: 'mgr-hint' }, `…and ${files.length - shown} more`)); break; }
    const kids = list.slice(0, 30).map(([name, a]) => h('button', { class: 'po-file', title: a, onclick: () => window.argon.reveal(a) }, name));
    shown += kids.length;
    box.append(h('div', { class: 'po-dir' },
      h('button', { class: 'po-dir-name', title: dir, onclick: () => window.argon.reveal(dir) }, '▸ ' + short(dir)),
      h('div', { class: 'po-dir-files' }, ...kids, list.length > 30 ? h('span', { class: 'mgr-hint' }, `+${list.length - 30}`) : null)));
  }
  return box;
}
async function finishOutput(w) {
  const p = w.pipe, run = p.run; run.state[p.out.id] = 'done';
  const srcs = p.links.filter((l) => l.to === p.out.id).map((l) => l.from), reports = srcs.flatMap((id) => run.files[id] || []);
  let summary = [], links = [], proof = [];
  for (const rel of reports) {
    const r = await window.argon.fs.read(absPath(w, rel)); if (!r || !r.ok) continue;
    const sec = sections(r.text), body = sec.summary || (sec._ || r.text).split(/\n\s*\n/)[0];
    if (body) summary.push(body.replace(/\s+/g, ' ').slice(0, 420));
    for (const u of ((sec.links || r.text).match(/https?:\/\/[^\s)>\]"'`]+/g) || [])) if (!links.includes(u)) links.push(u);
    for (const l of (sec.proof || '').split(/\n/)) { const t = l.replace(/^\s*([-*•]|\d+\.)\s*/, '').trim(); if (t) proof.push(t); }
  }
  p.out.result = { summary: summary.join(' ') || 'The pipeline finished. Open the reports below for details.', links: links.slice(0, 8), proof: proof.slice(0, 8), reports, run: run.id, at: Date.now() };
  run.active = false; save(); paintAll(w); renderOutput(w, true); follow(w, p.out.id);
  toast('Pipeline finished. The summary is in Output.');
}
function linkLabel(u) { if (/github\.com\/[^/]+\/[^/]+\/pull\//.test(u)) return 'Pull request'; if (/github\.com\//.test(u)) return 'Repo'; if (/localhost|127\.0\.0\.1/.test(u)) return 'Local'; return 'Website'; }
function renderOutput(w, reveal) {
  const el = pv(w).els.get(w.pipe.out.id); if (!el) return;
  const body = el.querySelector('.po-body'), res = w.pipe.out.result; body.innerHTML = '';
  if (!res) { body.append(h('p', { class: 'po-wait' }, 'Write a brief, drop agents into the stages, then press ▶. The summary, links to the website and repo, and the proof land here.')); animateWires(w); return; }
  const parts = [h('p', { class: 'po-sum' }, res.summary)];
  if (res.links.length) parts.push(h('div', { class: 'po-links' }, ...res.links.map((u) => h('button', { class: 'po-link', title: u, onclick: () => window.argon.openExternal(u) }, h('i', {}, linkLabel(u)), h('span', {}, u.replace(/^https?:\/\//, ''))))));
  if (res.proof.length) parts.push(h('div', { class: 'po-proof' }, ...res.proof.map((t) => h('span', {}, '✓ ' + t))));
  if (res.reports.length) parts.push(h('div', { class: 'po-reports' }, h('span', {}, 'Reports'), ...res.reports.map((rel) => h('button', { onclick: () => window.argon.reveal(absPath(w, rel)) }, rel.split('/').pop()))));
  body.append(...parts);
  if (reveal && motion()) parts.forEach((c, i) => c.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 120 + i * 110, easing: 'cubic-bezier(.2,.9,.25,1)', fill: 'backwards' }));
  animateWires(w);
}
function follow(w, id) { if (w === ws() && inPipe() && motion()) setTimeout(() => fly(w, id), 80); }

// ---------- modes ----------
export function setMode(m, w = ws()) {
  m = m === 'pipe' ? 'pipe' : 'board';
  if (modeOf(w) === m) return;
  w.views[modeOf(w)] = w.view; w.mode = m; w.view = w.views[m];
  let fresh = false;
  if (m === 'pipe') { fresh = seedPipe(w); build(w); }
  applyMode(w, true); save(); emit('mode', m);
  if (fresh) setTimeout(() => { fitPipe(w, false); toast('Pipeline mode: write a brief, add agents to each stage, then press ▶.'); }, 60);
}
export function applyMode(w = ws(), animate = false) {
  const m = modeOf(w);
  document.body.dataset.mode = m;
  document.querySelectorAll('.pipe-layer').forEach((l) => { l.style.display = l.dataset.ws === w.id && m === 'pipe' ? '' : 'none'; });
  const bl = document.querySelector(`.ws-layer[data-ws="${w.id}"]`); if (bl) bl.style.display = m === 'pipe' ? 'none' : '';
  document.getElementById('empty-hint').classList.toggle('hidden', m === 'pipe' || w.nodes.some((n) => !isPipe(n)));
  paintSeg(m);
  applyView();
  if (m === 'pipe' && views.has(w.id)) {
    flow(w, false); paintAll(w);
    w.nodes.filter(isPipe).forEach((n) => queueFit(n.id));
    if (animate && motion()) {
      const v = pv(w);
      [...v.els.values()].forEach((el, i) => el.animate([{ opacity: 0, transform: 'translateY(18px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: i * 70, easing: 'cubic-bezier(.2,.9,.25,1.1)', fill: 'backwards' }));
      drawIn(w);
    }
  } else if (animate && motion() && bl) {
    bl.animate([{ opacity: 0, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0)' }], { duration: 380, easing: 'ease-out' });
  }
  const dock = document.getElementById('dock');
  if (animate && motion()) dock.querySelectorAll(`[data-only="${m}"]`).forEach((g, i) => g.animate([{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 60 + i * 50, easing: 'cubic-bezier(.2,.9,.25,1.2)', fill: 'backwards' }));
}
function paintSeg(m) {
  const seg = document.getElementById('mode-seg'); if (!seg) return;
  seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  const on = seg.querySelector('button.on'), pill = seg.querySelector('.ms-pill');
  if (on && pill) { pill.style.width = on.offsetWidth + 'px'; pill.style.transform = `translateX(${on.offsetLeft}px)`; }
}
function fitPipe(w, animate = true) {
  const rs = [...pv(w).els.keys()].map((id) => rect(w, id)).filter(Boolean); if (!rs.length) return;
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)), x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  const vr = visibleRect(), z = Math.max(0.2, Math.min(1, (vr.width - 80) / (x1 - x0), (vr.height - 80) / (y1 - y0)));
  const t = { x: vr.left + (vr.width - (x1 - x0) * z) / 2 - x0 * z, y: vr.top + Math.max(30, (vr.height - (y1 - y0) * z) / 2) - y0 * z, z };
  if (animate) animateTo(t, 520); else { Object.assign(w.view, t); applyView(); }
}
// New agents spawned from the dock in pipeline mode land free near the middle of the view.
export function pipeSpawnOpts() { const c = viewCenter(); return { data: { space: 'pipe' }, at: { x: Math.round(c.x - 190), y: Math.round(c.y - 120), w: 380, h: DOCK_H } }; }

// ---------- wiring into tiles / board ----------
export function initPipeline() {
  for (const w of S.data.workspaces) { ensurePipe(w); if (w.pipe.stages.length) build(w); }
  // Pipeline agents live in the pipeline layer, docked in their stage's slot when they have one.
  tileHooks.host = (node, w) => {
    if (!isPipe(node)) return null;
    ensurePipe(w); if (w.pipe.stages.length) build(w);
    const v = pv(w), slot = node.data.stage && v.slots.get(node.data.stage);
    if (node.data.stage && !slot) delete node.data.stage;
    return slot || v.layer;
  };
  tileHooks.docked = (node) => isPipe(node) && !!node.data.stage;
  tileHooks.drag = (node, e, el, w) => { if (!isPipe(node)) return false; dragAgent(w, node, e, el); return true; };
  tileHooks.decorate = (node, el, w) => {
    if (!isPipe(node) || node.type !== 'console') return;
    if (node.data.stage) el.classList.add('docked');
    const chip = h('button', { class: 'pn-role', title: 'Role: click to change' }); chip.onclick = (e) => { e.stopPropagation(); cycleRole(w, node); };
    el.querySelector('.tile-head .row')?.prepend(chip); roleChips.set(node.id, chip);
    const s = node.data.stage && stageById(w, node.data.stage);
    if (s && !node.data.role) node.data.role = STAGES[s.key].roles[Math.min(agentsOf(w, s).length - 1, STAGES[s.key].roles.length - 1)] || 'Helper';
    if (s) node.data.group = slug(s.title);
    paintRole(w, node);
    if (views.has(w.id)) setTimeout(() => { paintAll(w); flow(w); }, 0);
  };
  boardHooks.items = () => {
    const w = ws();
    if (!inPipe()) return w.nodes.filter((n) => !isPipe(n));
    const rs = [...pv(w).els.keys()].map((id) => rect(w, id)).filter(Boolean);
    return rs.concat(w.nodes.filter((n) => isPipe(n) && !n.data.stage));
  };
  on('nodes', () => { const w = ws(); if (views.has(w.id)) paintAll(w); });
  on('status', () => { const w = ws(); if (inPipe() && views.has(w.id)) paintAll(w); });
  const seg = document.getElementById('mode-seg');
  seg && seg.addEventListener('click', (e) => { const b = e.target.closest('button[data-mode]'); if (b) setMode(b.dataset.mode); });
  addEventListener('resize', () => paintSeg(modeOf()));
  if (S.data.workspaces.some((w) => w.pipe.run && w.pipe.run.active)) ensurePoll();
}
// After every tile exists: put docked agents back in their saved order.
export function afterMount() {
  for (const w of S.data.workspaces) {
    const v = views.get(w.id); if (!v) continue;
    for (const s of w.pipe.stages) {
      const slot = v.slots.get(s.id); if (!slot) continue;
      [...slot.children].sort((a, b) => ((w.nodes.find((n) => n.id === a.dataset.id) || {}).data?.slot ?? 99) - ((w.nodes.find((n) => n.id === b.dataset.id) || {}).data?.slot ?? 99)).forEach((c) => slot.append(c));
    }
    paintAll(w);
  }
}

