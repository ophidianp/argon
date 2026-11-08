// A team runs in three tiles:
//   Prompter  - at the start. Write the prompt, give each agent or group its task, press Run.
//               Wire it only to the first agent or group; the console wires carry the work on down the chain.
//   Manager   - the supervisor. Shows what each agent or group is doing right now.
//   Secretary - the output at the end. Collects the summary, links and proof when the team finishes.
import { S, ws, save, emit, on, h, toast } from './state.js';
import { registerTile, tileEl, groupMembers, groupTag, addNode, select } from './tiles.js';
import { sendTo, rt, statusOf, waitReady, lastLines } from './consoles.js';
import { collectReports, resultParts, absPath } from './pipeline.js';
import { askText, showMenu } from './ui.js';
import { animationsOn } from './appearance.js';
import { setBrief, clearBriefs } from './teamwork.js';
import { flyTo } from './board.js';
import { paced } from './pace.js';

const NS = 'http://www.w3.org/2000/svg';
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent';
const isPipe = (n) => !!(n && n.data && n.data.space === 'pipe');
const find = (w, id) => w.nodes.find((n) => n.id === id);
const targets = (w, p) => (p.data.links || []).map((id) => find(w, id)).filter(Boolean);
// Every agent a target stands for: a group's consoles (nested groups too), or the terminal itself.
function agentsFor(w, t) {
  if (t.type === 'console') return [t];
  if (t.type !== 'group') return [];
  return groupMembers(t, w).flatMap((n) => (n.type === 'group' ? agentsFor(w, n) : n.type === 'console' ? [n] : []));
}
const label = (t) => (t.type === 'group' ? '#' + groupTag(t) : t.title);
const defaultTask = (t, via) => (via ? `Take ${via.title}'s work and do the next part.` : t.type === 'group' ? `Handle the ${t.title} part of the goal, splitting it between you.` : 'Do your part of the goal.');
const colorOf = (t) => (t.type === 'group' ? t.data.color : 'var(--accent-light)');

// The whole team: what the Prompter is wired to, then everyone the console wires lead to from there.
function chainOf(w, p) {
  const direct = targets(w, p);
  const rows = direct.map((t) => ({ node: t, via: null }));
  const seen = new Set(direct.flatMap((t) => [t.id, ...agentsFor(w, t).map((a) => a.id)]));
  const queue = direct.flatMap((t) => agentsFor(w, t));
  while (queue.length) {
    const a = queue.shift();
    for (const x of w.wires || []) {
      if (x.from !== a.id || x.paused) continue;
      const n = find(w, x.to);
      if (!n || n.type !== 'console' || seen.has(n.id)) continue;
      seen.add(n.id); rows.push({ node: n, via: a }); queue.push(n);
    }
  }
  return rows;
}
// The ends of the chain: rows whose agents hand off to no one else on the team. Their wires lead into the Secretary.
function tailsOf(w, rows) {
  const ids = new Set(rows.flatMap((r) => agentsFor(w, r.node).map((a) => a.id)));
  return rows.filter((r) => !agentsFor(w, r.node).some((a) => (w.wires || []).some((x) => x.from === a.id && ids.has(x.to) && !x.paused)));
}
// Managers and Secretaries follow a Prompter: the one they were set to, else the nearest.
function sourceOf(w, n) {
  const ps = w.nodes.filter((x) => x.type === 'prompter');
  const set = ps.find((x) => x.id === n.data.source); if (set) return set;
  let best = null, bd = Infinity;
  for (const p of ps) { const d = Math.hypot(p.x - n.x, p.y - n.y); if (d < bd) { bd = d; best = p; } }
  return best;
}
const followers = (w, p, type) => w.nodes.filter((n) => n.type === type && sourceOf(w, n) === p);
const repaintAll = (w) => { for (const n of w.nodes) if (n._paint) n._paint(); };
const stop = (e) => e.stopPropagation();

// ---------- Prompter ----------
function renderPrompter(node, w, { el, body, extras, btns }) {
  const state = h('span', { class: 'mgr-state' });
  extras.append(state);
  btns.append(h('button', { class: 'tile-btn', title: 'More', onclick: (e) => { stop(e); prompterMenu(node, w, e.clientX, e.clientY); } }, '⋯'));
  const sock = h('span', { class: 'mgr-sock', title: 'Drag onto the first agent or group. Wires from there carry the work on.' });
  el.append(sock);
  sock.addEventListener('pointerdown', (e) => startLink(node, w, e));

  const goal = h('textarea', { class: 'mgr-goal', rows: 2, placeholder: 'Prompt, e.g. Make a Minecraft mod that makes happy ghasts fly faster' });
  goal.value = node.data.goal || '';
  goal.addEventListener('input', () => { node.data.goal = goal.value; save(); });
  goal.addEventListener('pointerdown', stop);
  const team = h('div', { class: 'mgr-team' });
  const run = h('button', { class: 'btn primary mgr-run', onclick: (e) => { stop(e); toggle(node, w); } });
  body.append(h('div', { class: 'mgr-label' }, 'PROMPT'), goal, h('div', { class: 'mgr-label' }, 'AGENTS AND GROUPS'), team, run);

  node._paint = () => {
    if (!document.contains(el)) return;
    const r = node.data.run, active = !!(r && r.active), rows = chainOf(w, node);
    if (document.activeElement !== goal && goal.value !== (node.data.goal || '')) goal.value = node.data.goal || '';
    el.classList.toggle('running', active);
    state.textContent = active ? `Running · ${Object.keys(r.done || {}).length}/${Object.keys(r.files || {}).length}` : node.data.result ? 'Done' : rows.length ? `${rows.length} on the team` : 'No team yet';
    run.textContent = active ? '■ Stop' : '▶ Run';
    if (team.contains(document.activeElement)) { paintRowStates(); return; } // don't rebuild under the cursor
    team.innerHTML = '';
    if (!rows.length) team.append(h('p', { class: 'mgr-hint' }, 'Drag from the ● on the left edge onto the first agent or group. Wire agents to each other and they join the list here.'));
    for (const { node: t, via } of rows) {
      const ag = agentsFor(w, t);
      const task = h('input', { class: 'mgr-task', type: 'text', placeholder: defaultTask(t, via), value: (node.data.tasks || {})[t.id] || '' });
      task.addEventListener('input', () => { node.data.tasks = { ...(node.data.tasks || {}), [t.id]: task.value }; save(); });
      task.addEventListener('pointerdown', stop);
      const sub = h('span', {});
      const x = via ? h('span', { class: 'mgr-via', title: 'Joined through a wire. Remove the wire to take it off.' }, '↳')
        : h('button', { class: 'tile-btn', title: 'Take off the team', onclick: (e) => { stop(e); node.data.links = node.data.links.filter((k) => k !== t.id); save(); emit('nodes'); } }, '✕');
      const row = h('div', { class: 'mgr-row' + (via ? ' chained' : ''), 'data-id': t.id },
        h('i', { style: { background: colorOf(t) } }),
        h('div', { class: 'mgr-who' }, h('b', {}, label(t)), sub), task, x);
      row._sub = () => {
        const done = r && ag.length && ag.every((a) => r.done && r.done[a.id]);
        const busy = active && !done && ag.some((a) => statusOf(a.id) === 'working');
        row.classList.toggle('done', !!done); row.classList.toggle('busy', !!busy);
        sub.textContent = (via ? `after ${via.title}` : `${ag.length} agent${ag.length === 1 ? '' : 's'}`) + (done ? ' · reported' : busy ? ' · working' : active ? ' · waiting' : '');
      };
      row._sub();
      team.append(row);
    }
  };
  const paintRowStates = () => team.querySelectorAll('.mgr-row').forEach((r) => r._sub && r._sub());
  node._paint();
  on('nodes', () => node._paint && node._paint());
  on('status', () => node.data.run && node.data.run.active && node._paint());
}

function prompterMenu(node, w, x, y) {
  showMenu(x, y, [
    { label: 'Add a Manager', note: 'shows what each one is doing', onClick: () => addFollower(node, w, 'manager') },
    { label: 'Add a Secretary', note: 'collects the results', onClick: () => addFollower(node, w, 'secretary') },
    { label: 'Clear results', onClick: () => { node.data.result = null; save(); repaintAll(w); } },
    { label: 'Take everyone off the team', onClick: () => { node.data.links = []; save(); emit('nodes'); } },
  ]);
}
function addFollower(p, w, type) {
  const rows = chainOf(w, p), boxes = rows.map((r) => r.node);
  const right = boxes.length ? Math.max(...boxes.map((b) => b.x + b.w)) : p.x + p.w;
  const top = boxes.length ? Math.min(...boxes.map((b) => b.y)) : p.y;
  const pos = type === 'secretary' ? { x: right + 140, y: top } : { x: p.x, y: p.y + p.h + 60 };
  const n = addNode(type, { source: p.id }, pos);
  save(); emit('nodes');
  return n;
}

// ---------- Manager: the supervisor ----------
const STATE = { working: ['Working', 'busy'], needs: ['Needs you', 'needs'], exited: ['Stopped', 'off'] };
// The last line in a terminal that reads like something the agent is doing.
function doing(id) {
  const lines = lastLines(id, 40).split('\n').map((l) => l.replace(/[│┃║╭╮╰╯─━═╌┄]+/g, ' ').replace(/\s+/g, ' ').trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.length < 3 || !/[a-z]{3}/i.test(l) || /^(>|\?|esc |ctrl|shift\+tab|PS [A-Z]:)/i.test(l) || /for shortcuts|bypass permissions|auto-accept/i.test(l)) continue;
    return l.length > 110 ? l.slice(0, 107) + '…' : l;
  }
  return '';
}
function renderManager(node, w, { el, body, extras, btns }) {
  const state = h('span', { class: 'mgr-state' });
  extras.append(state);
  btns.append(h('button', { class: 'tile-btn', title: 'Watch a different Prompter', onclick: (e) => { stop(e); pickSource(node, w, e.clientX, e.clientY); } }, '⋯'));
  const list = h('div', { class: 'sup-list' });
  body.append(h('div', { class: 'mgr-label' }, 'WHAT EVERYONE IS DOING'), list);
  node._paint = () => {
    if (!document.contains(el)) return;
    const p = sourceOf(w, node);
    list.innerHTML = '';
    if (!p) { state.textContent = 'No Prompter'; list.append(h('p', { class: 'mgr-hint' }, 'Add a Prompter. The Manager watches its team and tells you what each agent or group is doing.')); return; }
    const r = p.data.run, rows = chainOf(w, p);
    let working = 0, reported = 0;
    if (!rows.length) list.append(h('p', { class: 'mgr-hint' }, `Watching ${p.title}. Wire it to an agent or group to start a team.`));
    for (const { node: t, via } of rows) {
      const ag = agentsFor(w, t);
      const card = h('div', { class: 'sup-card' }, h('div', { class: 'sup-head' }, h('i', { style: { background: colorOf(t) } }), h('b', {}, label(t)), via ? h('small', {}, `after ${via.title}`) : null));
      for (const a of ag) {
        const st = statusOf(a.id), done = !!(r && r.done && r.done[a.id]);
        const [word, cls] = done ? ['Reported', 'done'] : STATE[st] || [r && r.active ? 'Waiting' : 'Idle', 'idle'];
        if (st === 'working') working++; if (done) reported++;
        const line = doing(a.id);
        card.append(h('button', { class: 'sup-row ' + cls, title: `Go to ${a.title}`, onclick: (e) => { stop(e); select(a.id); flyTo(a, 1); } },
          h('span', { class: 'sup-dot' }), h('b', {}, a.title), h('em', {}, word), h('span', { class: 'sup-line' }, line || (done ? 'Wrote its report.' : 'Nothing yet.'))));
      }
      if (!ag.length) card.append(h('p', { class: 'mgr-hint' }, 'No terminals in this group yet.'));
      list.append(card);
    }
    state.textContent = r && r.active ? `${working} working · ${reported} reported` : `Watching ${p.title}`;
  };
  node._paint();
  on('nodes', () => node._paint && node._paint());
  on('status', () => node._paint && node._paint());
  const t = setInterval(() => { if (!document.contains(el)) { clearInterval(t); return; } const p = sourceOf(w, node); if (p && p.data.run && p.data.run.active) node._paint(); }, 2000);
}
function pickSource(node, w, x, y) {
  const ps = w.nodes.filter((n) => n.type === 'prompter');
  if (!ps.length) { toast('Add a Prompter first.'); return; }
  const cur = sourceOf(w, node);
  showMenu(x, y, ps.map((p) => ({ label: (p === cur ? '✓  ' : '') + p.title, note: (p.data.goal || '').slice(0, 30), onClick: () => { node.data.source = p.id; save(); repaintAll(w); } })));
}

// ---------- Secretary: the output ----------
function renderSecretary(node, w, { el, body, extras, btns }) {
  const state = h('span', { class: 'mgr-state' });
  extras.append(state);
  btns.append(h('button', { class: 'tile-btn', title: 'More', onclick: (e) => { stop(e); secretaryMenu(node, w, e.clientX, e.clientY); } }, '⋯'));
  const out = h('div', { class: 'po-body mgr-out' });
  body.append(out);
  let shown = null;
  node._paint = () => {
    if (!document.contains(el)) return;
    const p = sourceOf(w, node), r = p && p.data.run, res = p && p.data.result;
    state.textContent = !p ? 'No Prompter' : r && r.active ? `Collecting · ${Object.keys(r.done || {}).length}/${Object.keys(r.files || {}).length}` : res ? 'Done' : 'Waiting';
    const key = res ? res.at : r && r.active ? 'run' : 'idle';
    if (key === shown) return;
    const reveal = shown !== null && !!res; shown = key;
    out.innerHTML = '';
    if (res) {
      const parts = resultParts(w, res); out.append(...parts);
      if (reveal && animationsOn()) parts.forEach((c, i) => c.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 120 + i * 110, easing: 'cubic-bezier(.2,.9,.25,1)', fill: 'backwards' }));
    } else out.append(h('p', { class: 'po-wait' }, !p ? 'Add a Prompter. When its team finishes, the summary, links and proof land here.' : r && r.active ? 'Collecting each agent’s report…' : 'When the team finishes, the summary, links to the website and repo, and the proof land here.'));
  };
  node._paint();
  on('nodes', () => node._paint && node._paint());
}
function secretaryMenu(node, w, x, y) {
  const p = sourceOf(w, node);
  showMenu(x, y, [
    p && p.data.run && p.data.run.id ? { label: 'Open reports folder', onClick: () => window.argon.reveal(absPath(w, `.argon/manager/${p.data.run.id}`)) } : null,
    p && p.data.result ? { label: 'Clear results', onClick: () => { p.data.result = null; save(); repaintAll(w); } } : null,
    { label: 'Follow a different Prompter', onClick: () => pickSource(node, w, x, y) },
  ].filter(Boolean));
}

// ---------- wiring: drag from the Prompter's socket onto an agent or group ----------
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
    if (chainOf(w, m).some((r) => r.node.id === hot.id)) { toast(`${label(hot)} is already on the team`); return; }
    m.data.links.push(hot.id); save(); emit('nodes');
    const more = chainOf(w, m).length - m.data.links.length;
    toast(more > 0 ? `${label(hot)} joined ${m.title}'s team, with ${more} more down its wires` : `${label(hot)} joined ${m.title}'s team`);
    setTimeout(() => packet(w, m, hot, true), 60);
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up); move(e);
}

// ---------- wires ----------
function wiresFor(w) {
  const layer = document.querySelector(`.ws-layer[data-ws="${w.id}"]`); if (!layer) return null;
  let svg = layer.querySelector(':scope > .mgr-wires');
  if (!svg) { svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'mgr-wires'); layer.prepend(svg); }
  return svg;
}
const box = (n) => { const el = tileEl(n.id); return el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : { x: n.x, y: n.y, w: n.w, h: n.h }; };
const sockPt = (m) => { const b = box(m); return [b.x, b.y + 18]; };
// Joins a tile (b) and a team tile (M) on the sides that face each other: left/right side by side, top/bottom when stacked.
function wireEnds(b, M) {
  const ty = b.y + Math.min(24, b.h / 2), my = M.y + 18;
  if (b.x >= M.x + M.w - 20) return [[b.x, ty], [-1, 0], [M.x + M.w, my], [1, 0]];
  if (b.x + b.w <= M.x + 20) return [[b.x + b.w, ty], [1, 0], [M.x, my], [-1, 0]];
  if (b.y + b.h <= M.y + 10) return [[b.x + b.w / 2, b.y + b.h], [0, 1], [M.x + M.w / 2, M.y], [0, -1]];
  if (b.y >= M.y + M.h - 10) return [[b.x + b.w / 2, b.y], [0, -1], [M.x + M.w / 2, M.y + M.h], [0, 1]];
  return [[b.x + b.w, ty], [1, 0], [M.x + M.w, my], [1, 0]];
}
function wirePath(b, M) {
  const [[x1, y1], [ax, ay], [x2, y2], [bx, by]] = wireEnds(b, M);
  const c = Math.max(50, (ax ? Math.abs(x2 - x1) : Math.abs(y2 - y1)) / 2);
  return `M${x1},${y1} C${x1 + c * ax},${y1 + c * ay} ${x2 + c * bx},${y2 + c * by} ${x2},${y2}`;
}
function curve([x1, y1], [x2, y2]) { const c = Math.max(60, Math.abs(x2 - x1) / 2), d = x2 >= x1 ? 1 : -1; return `M${x1},${y1} C${x1 + c * d},${y1} ${x2 - c},${y2} ${x2},${y2}`; }
function path(v, key, cls, color, d, rev, keep) {
  keep.add(key);
  let p = v.querySelector(`path[data-k="${key}"]`);
  if (!p) { p = document.createElementNS(NS, 'path'); p.dataset.k = key; v.prepend(p); }
  p.setAttribute('class', cls); p.dataset.rev = rev ? '1' : '0';
  p.style.setProperty('--wc', color);
  if (p.getAttribute('d') !== d) p.setAttribute('d', d);
}
function draw() {
  const w = ws(); if (!w || w.mode === 'pipe') return;
  const v = wiresFor(w); if (!v) return;
  const keep = new Set();
  for (const p of w.nodes) {
    if (p.type !== 'prompter') continue;
    const r = p.data.run, live = !!(r && r.active);
    const doneOf = (t) => { const ag = agentsFor(w, t); return !!(r && ag.length && ag.every((a) => r.done && r.done[a.id])); };
    // Prompter -> the first agents or groups (dots run out to them)
    for (const t of targets(w, p)) path(v, p.id + '>' + t.id, 'mgr-wire' + (live ? (doneOf(t) ? ' done' : ' flow') : p.data.result ? ' done' : ''), colorOf(t), wirePath(box(t), box(p)), true, keep);
    // Prompter -> Manager (one quiet line: it watches)
    for (const m of followers(w, p, 'manager')) path(v, p.id + '~' + m.id, 'mgr-wire watch' + (live ? ' flow' : ''), 'var(--accent-light)', wirePath(box(m), box(p)), true, keep);
    // the ends of the chain -> Secretary (dots run into it)
    const secs = followers(w, p, 'secretary');
    if (secs.length) {
      const tails = tailsOf(w, chainOf(w, p));
      for (const s of secs) for (const { node: t } of tails) path(v, t.id + '»' + s.id, 'mgr-wire' + (doneOf(t) ? ' done' : live ? ' flow' : ''), colorOf(t), wirePath(box(t), box(s)), false, keep);
    }
  }
  v.querySelectorAll('path[data-k]').forEach((p) => { if (!keep.has(p.dataset.k)) p.remove(); });
}
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
async function toggle(p, w) { if (p.data.run && p.data.run.active) halt(p, w); else run(p, w); }
async function run(p, w) {
  if (!(p.data.goal || '').trim()) {
    const g = await askText('What should the team do?', { placeholder: 'e.g. Ship a pricing page with monthly and yearly plans', sub: 'The Prompter gives each agent or group its part of this.' });
    if (!g || !g.trim()) return; p.data.goal = g.trim();
  }
  const rows = chainOf(w, p);
  if (!rows.length) { toast('Wire the Prompter to the first agent or group: drag from its ● socket.', 'warn'); return; }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const r = p.data.run = { id: stamp, active: true, files: {}, done: {}, started: Date.now(), chained: [] };
  p.data.result = null;
  const everyone = rows.flatMap((x) => agentsFor(w, x.node)).map((a) => a.title);
  const goal = p.data.goal.trim();
  let sent = 0;
  for (const { node: t, via } of rows) {
    const task = ((p.data.tasks || {})[t.id] || '').trim() || defaultTask(t, via);
    const ag = agentsFor(w, t);
    if (!ag.length) { toast(`${label(t)} has no terminals in it yet.`, 'warn'); continue; }
    for (const a of ag) {
      if (a.data.agent === 'shell') { toast(`${a.title} is a plain terminal, so it gets no prompt.`); continue; }
      const c = rt(a.id);
      if (!c || !c.alive) { toast(`${a.title} is not running. Restart it and run again.`, 'warn'); continue; }
      const rel = `.argon/manager/${r.id}/${slug(a.title)}.md`; r.files[a.id] = rel;
      const others = everyone.filter((x) => x !== a.title);
      const prompt = [
        `[Argon] Team goal: ${goal}`,
        t.type === 'group' ? `You are ${a.title} on team #${groupTag(t)} (with ${ag.filter((x) => x !== a).map((x) => x.title).join(', ') || 'no one else'}).` : `You are ${a.title}.`,
        via ? `${via.title} worked before you; what it handed over is below.` : '',
        `Your task: ${task}`,
        others.length ? `Others on the team: ${others.join(', ')}. Do not redo their parts.` : '',
        `When you are done, write a short report to ${rel} (create the folders if needed). Start it with "## Summary" (2-3 sentences), then "## Links" (URLs of any website, repo or pull request), then "## Proof" (tests, checks, screenshot paths). Then stop.`,
      ].filter(Boolean).join(' ');
      sent++;
      // Agents further down the chain get their task together with the handoff that reaches them.
      if (via) { setBrief(a.id, prompt); r.chained.push(a.id); continue; }
      waitReady(c, 6000).then(() => { if (p.data.run === r && r.active) sendTo(a.id, prompt); });
    }
    if (!via) setTimeout(() => packet(w, p, t, true), 80);
  }
  if (!sent) { r.active = false; save(); repaintAll(w); toast('No agents could take the work. Use terminals running Claude, Codex or Gemini.', 'warn'); return; }
  if (!followers(w, p, 'secretary').length) addFollower(p, w, 'secretary'); // the results need somewhere to land
  save(); repaintAll(w); ensurePoll();
  const chained = r.chained.length;
  toast(`${p.title} started ${sent - chained} agent${sent - chained === 1 ? '' : 's'}${chained ? `; ${chained} more get their task when the wires reach them` : ''}`);
}
function halt(p, w) {
  const r = p.data.run; if (!r) return;
  r.active = false; clearBriefs(r.chained || []); save(); repaintAll(w);
  toast('Stopped. Agents keep whatever they were doing.');
}

let poll = 0, busy = false;
function ensurePoll() { if (!poll) poll = setInterval(tick, 1500); }
async function tick() {
  if (busy) return; busy = true;
  try {
    let any = false;
    for (const w of S.data.workspaces) for (const p of w.nodes) {
      const r = p.type === 'prompter' && p.data.run; if (!r || !r.active) continue; any = true;
      for (const [id, rel] of Object.entries(r.files)) {
        if (r.done[id]) continue;
        if (await window.argon.fs.exists(absPath(w, rel)) && statusOf(id) !== 'working') { r.done[id] = true; save(); }
      }
      if (w === ws()) repaintAll(w);
      if (Object.keys(r.files).every((id) => r.done[id])) await finish(p, w);
    }
    if (!any) { clearInterval(poll); poll = 0; }
  } finally { busy = false; }
}
async function finish(p, w) {
  const r = p.data.run, reports = Object.values(r.files);
  const res = await collectReports(w, reports);
  p.data.result = { ...res, summary: res.summary || 'The team finished. Open the reports below for details.', reports, run: r.id, at: Date.now() };
  r.active = false; save(); repaintAll(w);
  for (const s of followers(w, p, 'secretary')) { const el = tileEl(s.id); el && animationsOn() && el.animate([{ boxShadow: '0 0 0 0 rgba(127,209,160,.5)' }, { boxShadow: '0 0 0 18px rgba(127,209,160,0)' }], { duration: 800, easing: 'ease-out' }); }
  toast(`${p.title}: the team finished. The Secretary has the summary.`);
}

const nameFor = (base) => (w) => { const names = new Set(w.nodes.map((n) => n.title)); let i = 1, t = base; while (names.has(t)) t = `${base} ${++i}`; return t; };
export function initManager() {
  // Boards from before the split: the old Manager did the Prompter's job, so it becomes one.
  for (const w of S.data.workspaces) for (const n of w.nodes) {
    if (n.type === 'manager' && n.data && Array.isArray(n.data.links)) { n.type = 'prompter'; if (/^Manager( \d+)?$/.test(n.title)) n.title = n.title.replace('Manager', 'Prompter'); }
  }
  registerTile('prompter', { size: [460, 480], icon: 'prompter', render: renderPrompter, title: nameFor('Prompter'), data: (d) => ({ goal: '', links: [], tasks: {}, run: null, result: null, ...d }) });
  registerTile('manager', { size: [400, 380], icon: 'manager', render: renderManager, title: nameFor('Manager'), data: (d) => ({ source: null, ...d }) });
  registerTile('secretary', { size: [420, 420], icon: 'secretary', render: renderSecretary, title: nameFor('Secretary'), data: (d) => ({ source: null, ...d }) });
  paced(draw);
  if (S.data.workspaces.some((w) => w.nodes.some((n) => n.type === 'prompter' && n.data.run && n.data.run.active))) ensurePoll();
}
