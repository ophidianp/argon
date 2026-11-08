// The Manager: a board tile you wire to groups and terminals. Give it a goal, it hands each one a task,
// waits for their reports, and shows the summary, links and proof (like the pipeline's Output).
import { S, ws, save, emit, on, h, toast } from './state.js';
import { registerTile, tileEl, groupMembers, groupTag } from './tiles.js';
import { sendTo, rt, statusOf, waitReady } from './consoles.js';
import { collectReports, resultParts, absPath } from './pipeline.js';
import { askText, showMenu } from './ui.js';
import { animationsOn } from './appearance.js';

const NS = 'http://www.w3.org/2000/svg';
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent';
const isPipe = (n) => !!(n && n.data && n.data.space === 'pipe');
const find = (w, id) => w.nodes.find((n) => n.id === id);
const targets = (w, m) => (m.data.links || []).map((id) => find(w, id)).filter(Boolean);
// Every agent a target stands for: a group's consoles (nested groups too), or the terminal itself.
function agentsFor(w, t) {
  if (t.type === 'console') return [t];
  if (t.type !== 'group') return [];
  return groupMembers(t, w).flatMap((n) => (n.type === 'group' ? agentsFor(w, n) : n.type === 'console' ? [n] : []));
}
const label = (t) => (t.type === 'group' ? '#' + groupTag(t) : t.title);
const defaultTask = (t) => (t.type === 'group' ? `Handle the ${t.title} part of the goal, splitting it between you.` : 'Do your part of the goal.');
const colorOf = (t) => (t.type === 'group' ? t.data.color : 'var(--accent-light)');

// ---------- the tile ----------
function render(node, w, { el, body, extras, btns, head }) {
  head.querySelector('.tile-ico').textContent = '◎';
  const state = h('span', { class: 'mgr-state' });
  extras.append(state);
  btns.append(h('button', { class: 'tile-btn', title: 'More', onclick: (e) => { e.stopPropagation(); menu(node, w, e.clientX, e.clientY); } }, '⋯'));
  const sock = h('span', { class: 'mgr-sock', title: 'Drag onto a group or terminal to put it on the team' });
  el.append(sock);
  sock.addEventListener('pointerdown', (e) => startLink(node, w, e));

  const goal = h('textarea', { class: 'mgr-goal', rows: 2, placeholder: 'Goal, e.g. Ship a pricing page with monthly and yearly plans' });
  goal.value = node.data.goal || '';
  goal.addEventListener('input', () => { node.data.goal = goal.value; save(); });
  goal.addEventListener('pointerdown', (e) => e.stopPropagation());
  const team = h('div', { class: 'mgr-team' });
  const run = h('button', { class: 'btn primary mgr-run', onclick: (e) => { e.stopPropagation(); toggle(node, w); } });
  const out = h('div', { class: 'po-body mgr-out' });
  body.append(h('div', { class: 'mgr-label' }, 'GOAL'), goal, h('div', { class: 'mgr-label' }, 'TEAM'), team, run, out);

  node._paint = (reveal) => {
    if (!document.contains(el)) return;
    const r = node.data.run, active = !!(r && r.active), ts = targets(w, node);
    if (document.activeElement !== goal && goal.value !== (node.data.goal || '')) goal.value = node.data.goal || '';
    el.classList.toggle('running', active);
    state.textContent = active ? `Running · ${Object.keys(r.done || {}).length}/${Object.keys(r.files || {}).length}` : node.data.result ? 'Done' : ts.length ? `${ts.length} on the team` : 'No team yet';
    run.textContent = active ? '■ Stop' : '▶ Run the team';
    team.innerHTML = '';
    if (!ts.length) team.append(h('p', { class: 'mgr-hint' }, 'Drag from the ● on the left edge onto a group or terminal to put it on the team.'));
    for (const t of ts) {
      const ag = agentsFor(w, t), done = r && ag.length && ag.every((a) => r.done && r.done[a.id]);
      const busy = active && !done && ag.some((a) => r.files && r.files[a.id]);
      const task = h('input', { class: 'mgr-task', type: 'text', placeholder: defaultTask(t), value: (node.data.tasks || {})[t.id] || '' });
      task.addEventListener('input', () => { node.data.tasks = { ...(node.data.tasks || {}), [t.id]: task.value }; save(); });
      task.addEventListener('pointerdown', (e) => e.stopPropagation());
      team.append(h('div', { class: 'mgr-row' + (done ? ' done' : busy ? ' busy' : '') },
        h('i', { style: { background: colorOf(t) } }),
        h('div', { class: 'mgr-who' }, h('b', {}, label(t)), h('span', {}, `${ag.length} agent${ag.length === 1 ? '' : 's'}${done ? ' · reported' : busy ? ' · working' : ''}`)),
        task,
        h('button', { class: 'tile-btn', title: 'Take off the team', onclick: (e) => { e.stopPropagation(); node.data.links = node.data.links.filter((x) => x !== t.id); save(); node._paint(); } }, '✕')));
    }
    out.innerHTML = '';
    const res = node.data.result;
    if (res) {
      const parts = resultParts(w, res); out.append(...parts);
      if (reveal && animationsOn()) parts.forEach((c, i) => c.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 120 + i * 110, easing: 'cubic-bezier(.2,.9,.25,1)', fill: 'backwards' }));
    } else out.append(h('p', { class: 'po-wait' }, active ? 'Waiting for every agent to write its report…' : 'The summary, links to the website and repo, and the proof land here.'));
  };
  node._paint();
  on('nodes', () => node._paint && node._paint());
  on('status', () => node.data.run && node.data.run.active && node._paint());
}

function menu(node, w, x, y) {
  showMenu(x, y, [
    { label: 'Clear results', onClick: () => { node.data.result = null; save(); node._paint(); } },
    { label: 'Take everyone off the team', onClick: () => { node.data.links = []; save(); node._paint(); } },
    node.data.run && node.data.run.id ? { label: 'Open reports folder', onClick: () => window.argon.reveal(absPath(w, `.argon/manager/${node.data.run.id}`)) } : null,
  ].filter(Boolean));
}

// ---------- wiring: drag from the socket onto a group or terminal ----------
function targetAt(cx, cy, w, m) {
  for (const el of document.elementsFromPoint(cx, cy)) {
    const t = el.closest && el.closest('.tile'); if (!t) continue;
    const n = find(w, t.dataset.id);
    if (n && n !== m && !isPipe(n) && (n.type === 'console' || n.type === 'group')) return n;
  }
  return null;
}
function startLink(m, w, e) {
  e.stopPropagation(); e.preventDefault();
  const v = wiresFor(w); if (!v) return;
  const tmp = document.createElementNS(NS, 'path'); tmp.setAttribute('class', 'mgr-wire temp'); v.append(tmp);
  let hot = null;
  const move = (ev) => {
    const z = w.view.z, ox = w.view.x, oy = w.view.y, b = document.getElementById('board').getBoundingClientRect();
    const p = [(ev.clientX - b.left - ox) / z, (ev.clientY - b.top - oy) / z];
    tmp.setAttribute('d', curve(p, sockPt(m)));
    const t = targetAt(ev.clientX, ev.clientY, w, m);
    if (t !== hot) { hot && tileEl(hot.id)?.classList.remove('link-hot'); hot = t; hot && tileEl(hot.id)?.classList.add('link-hot'); }
  };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); tmp.remove();
    if (!hot) return;
    tileEl(hot.id)?.classList.remove('link-hot');
    m.data.links = m.data.links || [];
    if (m.data.links.includes(hot.id)) { toast(`${label(hot)} is already on the team`); return; }
    m.data.links.push(hot.id); save(); m._paint && m._paint(); emit('nodes');
    toast(`${label(hot)} joined ${m.title}'s team`);
    setTimeout(() => packet(w, m, hot, true), 60);
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up); move(e);
}

// ---------- wires: from each team member into the Manager ----------
function wiresFor(w) {
  const layer = document.querySelector(`.ws-layer[data-ws="${w.id}"]`); if (!layer) return null;
  let svg = layer.querySelector(':scope > .mgr-wires');
  if (!svg) { svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'mgr-wires'); layer.prepend(svg); }
  return svg;
}
const box = (n) => { const el = tileEl(n.id); return el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : { x: n.x, y: n.y, w: n.w, h: n.h }; };
const sockPt = (m) => { const b = box(m); return [b.x, b.y + 18]; };
function fromPt(t, m) { const b = box(t), mb = box(m); const right = b.x + b.w / 2 < mb.x + mb.w / 2; return [right ? b.x + b.w : b.x, b.y + Math.min(24, b.h / 2)]; }
function curve([x1, y1], [x2, y2]) { const c = Math.max(60, Math.abs(x2 - x1) / 2), d = x2 >= x1 ? 1 : -1; return `M${x1},${y1} C${x1 + c * d},${y1} ${x2 - c},${y2} ${x2},${y2}`; }
function draw() {
  const w = ws(); if (!w || w.mode === 'pipe') return;
  const v = wiresFor(w); if (!v) return;
  const keep = new Set();
  for (const m of w.nodes) {
    if (m.type !== 'manager') continue;
    const r = m.data.run;
    for (const t of targets(w, m)) {
      const key = m.id + '>' + t.id; keep.add(key);
      let p = v.querySelector(`path[data-k="${key}"]`);
      if (!p) { p = document.createElementNS(NS, 'path'); p.dataset.k = key; v.prepend(p); }
      const ag = agentsFor(w, t), done = r && ag.length && ag.every((a) => r.done && r.done[a.id]);
      p.setAttribute('class', 'mgr-wire' + (r && r.active ? (done ? ' done' : ' flow') : m.data.result ? ' done' : ''));
      p.style.setProperty('--wc', colorOf(t));
      p.setAttribute('d', curve(fromPt(t, m), sockPt(m)));
    }
  }
  v.querySelectorAll('path[data-k]').forEach((p) => { if (!keep.has(p.dataset.k)) p.remove(); });
}
function loop() { draw(); requestAnimationFrame(loop); }
// A glowing dot rides the wire: out to the team when work is handed over, back when a report lands.
function packet(w, m, t, outbound) {
  if (!animationsOn()) return;
  const v = wiresFor(w), p = v && v.querySelector(`path[data-k="${m.id}>${t.id}"]`); if (!p) return;
  const c = colorOf(t), g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'packet');
  const halo = document.createElementNS(NS, 'circle'); halo.setAttribute('r', 13); halo.setAttribute('fill', c); halo.setAttribute('opacity', '.25');
  const dot = document.createElementNS(NS, 'circle'); dot.setAttribute('r', 6); dot.setAttribute('fill', c);
  g.append(halo, dot); v.append(g);
  const len = p.getTotalLength(), t0 = performance.now(), dur = 900;
  const step = (now) => { const k = Math.min(1, (now - t0) / dur), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2, pt = p.getPointAtLength(len * (outbound ? 1 - e : e)); g.setAttribute('transform', `translate(${pt.x},${pt.y})`); if (k < 1) requestAnimationFrame(step); else g.remove(); };
  requestAnimationFrame(step);
}

// ---------- running the team ----------
async function toggle(m, w) { if (m.data.run && m.data.run.active) stop(m, w); else run(m, w); }
async function run(m, w) {
  if (!(m.data.goal || '').trim()) {
    const g = await askText('What should the team do?', { placeholder: 'e.g. Ship a pricing page with monthly and yearly plans', sub: 'The Manager gives each group or terminal on its team a part of this.' });
    if (!g || !g.trim()) return; m.data.goal = g.trim();
    tileEl(m.id)?.querySelector('.mgr-goal') && (tileEl(m.id).querySelector('.mgr-goal').value = m.data.goal);
  }
  const ts = targets(w, m);
  if (!ts.length) { toast('Wire a group or terminal to the Manager first: drag from its ● socket.', 'warn'); return; }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const r = m.data.run = { id: stamp, active: true, files: {}, done: {}, started: Date.now() };
  m.data.result = null;
  const everyone = ts.flatMap((t) => agentsFor(w, t)).map((a) => a.title);
  let sent = 0;
  for (const t of ts) {
    const task = ((m.data.tasks || {})[t.id] || '').trim() || defaultTask(t);
    const ag = agentsFor(w, t);
    if (!ag.length) { toast(`${label(t)} has no terminals in it yet.`, 'warn'); continue; }
    for (const a of ag) {
      if (a.data.agent === 'shell') { toast(`${a.title} is a plain terminal, so it gets no prompt.`); continue; }
      const rel = `.argon/manager/${r.id}/${slug(a.title)}.md`; r.files[a.id] = rel;
      const others = everyone.filter((x) => x !== a.title);
      const prompt = [
        `[Argon manager] Team goal: ${m.data.goal.trim()}`,
        t.type === 'group' ? `You are ${a.title} on team #${groupTag(t)} (with ${ag.filter((x) => x !== a).map((x) => x.title).join(', ') || 'no one else'}).` : `You are ${a.title}.`,
        `Your task: ${task}`,
        others.length ? `Others working on the goal: ${others.join(', ')}. Do not redo their parts.` : '',
        `When you are done, write a short report to ${r.files[a.id]} (create the folders if needed). Start it with "## Summary" (2-3 sentences), then "## Links" (URLs of any website, repo or pull request), then "## Proof" (tests, checks, screenshot paths). Then stop.`,
      ].filter(Boolean).join(' ');
      const c = rt(a.id);
      if (!c || !c.alive) { toast(`${a.title} is not running. Restart it and run again.`, 'warn'); delete r.files[a.id]; continue; }
      sent++;
      waitReady(c, 6000).then(() => { if (m.data.run === r && r.active) sendTo(a.id, prompt); });
    }
    setTimeout(() => packet(w, m, t, true), 80);
  }
  if (!sent) { r.active = false; save(); m._paint(); toast('No agents could take the work. Wire in groups or terminals running Claude, Codex or Gemini.', 'warn'); return; }
  save(); m._paint(); ensurePoll();
  toast(`${m.title} handed the goal to ${sent} agent${sent === 1 ? '' : 's'}`);
}
function stop(m, w) { if (!m.data.run) return; m.data.run.active = false; save(); m._paint(); toast('Manager stopped. Agents keep whatever they were doing.'); }

let poll = 0, busy = false;
function ensurePoll() { if (!poll) poll = setInterval(tick, 1500); }
async function tick() {
  if (busy) return; busy = true;
  try {
    let any = false;
    for (const w of S.data.workspaces) for (const m of w.nodes) {
      const r = m.type === 'manager' && m.data.run; if (!r || !r.active) continue; any = true;
      for (const [id, rel] of Object.entries(r.files)) {
        if (r.done[id]) continue;
        if (await window.argon.fs.exists(absPath(w, rel)) && statusOf(id) !== 'working') {
          r.done[id] = true; save();
          const t = targets(w, m).find((x) => agentsFor(w, x).some((a) => a.id === id)); if (t && w === ws()) packet(w, m, t, false);
        }
      }
      m._paint && m._paint();
      if (Object.keys(r.files).every((id) => r.done[id])) await finish(m, w);
    }
    if (!any) { clearInterval(poll); poll = 0; }
  } finally { busy = false; }
}
async function finish(m, w) {
  const r = m.data.run, reports = Object.values(r.files);
  const res = await collectReports(w, reports);
  m.data.result = { ...res, summary: res.summary || 'The team finished. Open the reports below for details.', reports, run: r.id, at: Date.now() };
  r.active = false; save(); m._paint(true);
  const el = tileEl(m.id); el && animationsOn() && el.animate([{ boxShadow: '0 0 0 0 rgba(127,209,160,.5)' }, { boxShadow: '0 0 0 18px rgba(127,209,160,0)' }], { duration: 800, easing: 'ease-out' });
  toast(`${m.title}: the team finished. The summary is in the Manager.`);
}

export function initManager() {
  registerTile('manager', {
    size: [460, 520], icon: '◎', render,
    title: (w) => { const names = new Set(w.nodes.map((n) => n.title)); let i = 1, t = 'Manager'; while (names.has(t)) t = `Manager ${++i}`; return t; },
    data: (d) => ({ goal: '', links: [], tasks: {}, run: null, result: null, ...d }),
  });
  requestAnimationFrame(loop);
  if (S.data.workspaces.some((w) => w.nodes.some((n) => n.type === 'manager' && n.data.run && n.data.run.active))) ensurePoll();
}
