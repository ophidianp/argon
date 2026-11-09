// The frame around the board: the chips and the ask bar at the bottom, the branch pill, the running count and
// the day/night switch in the top bar, the rail of panels on the right, the empty-board start, and the Teams sheet.
import { S, ws, h, on, emit, save, toast, findNode, consoles, allConsoles } from './state.js';
import { addNode, addGroup, select, tileEl, selectedId } from './tiles.js';
import { statusOf, sendTo, rt } from './consoles.js';
import { spawn, openCommandBar, openUsage, openMemory, spawnMenu, parseTargets } from './panels.js';
import { spawnTeam, defaultAgent, dictate } from './teamwork.js';
import { fitAll } from './board.js';
import { openMissionMap } from './missionmap.js';
import { look, applyAppearance, THEMES } from './appearance.js';
import { agentByKey } from './agents.js';
import { icon } from './icons.js';
import { glassify } from './glass.js';
import { openContext } from './context.js';

const $ = (s) => document.querySelector(s);
const ico = (k, s = 16) => { const t = document.createElement('template'); t.innerHTML = icon(k, s); return t.content.firstChild; };

// ---------- spawning ----------
function center() { const v = ws().view; return { x: (innerWidth / 2 - v.x) / v.z, y: (innerHeight / 2 - v.y) / v.z }; }
export function spawnMany(keys, { group = null } = {}) {
  const c = center(), cw = 560, chh = 380, gap = 40, cols = keys.length > 3 ? 2 : keys.length;
  const rows = Math.ceil(keys.length / cols);
  const x0 = c.x - (cols * cw + (cols - 1) * gap) / 2, y0 = c.y - (rows * chh + (rows - 1) * gap) / 2;
  const nodes = keys.map((k, i) => spawn(k, { at: { x: Math.round(x0 + (i % cols) * (cw + gap)), y: Math.round(y0 + Math.floor(i / cols) * (chh + gap)), w: cw, h: chh } }));
  if (group && nodes.length) { select(nodes[0].id); const g = addGroup(); if (g) { g.title = group; for (const n of nodes) n.data.groupId = g.id; save(); emit('nodes'); } }
  return nodes;
}
const newAgent = () => { const c = center(); return spawn(defaultAgent(), { at: { x: Math.round(c.x - 280), y: Math.round(c.y - 190), w: 560, h: 380 } }); };

// ---------- the Teams sheet: ready-made teams with roles, then presets ----------
export const TEMPLATES = [
  { name: 'A lead and its helpers', note: 'Give one agent the job. When it splits into parts, it brings helpers onto the board and combines their work.', roles: ['Lead'], notes: ['Splits the job and brings in helpers'], wires: [], lead: true },
  { name: 'Build, then review', note: 'One agent does the work, a second checks it when it is done.', roles: ['Builder', 'Reviewer'], notes: ['Does the work', 'Checks the work it receives'], wires: [[0, 1, 'review']] },
  { name: 'Plan, build, review', note: 'A planner breaks the job down, a builder does it, a reviewer checks it.', roles: ['Planner', 'Builder', 'Reviewer'], notes: ['Turns the request into a short plan', 'Builds what the plan says', 'Checks the work it receives'], wires: [[0, 1, 'done'], [1, 2, 'done']] },
  { name: 'Research, then write', note: 'One agent digs through the code and docs, another writes it up.', roles: ['Researcher', 'Writer'], notes: ['Digs through the code and docs', 'Writes up what it receives'], wires: [[0, 1, 'done']] },
  { name: 'Fix, then test', note: 'One agent fixes the bug, another writes and runs tests for it. Failures go back to the fixer.', roles: ['Fixer', 'Tester'], notes: ['Fixes the bug', 'Writes and runs tests for the fix'], wires: [[0, 1, 'done'], [1, 0, 'if', 'fail|error|✗']] },
  { name: 'A Prompter and three builders', note: 'Write one prompt, give each builder its part, press Run. The Secretary collects the result.', roles: ['Builder 1', 'Builder 2', 'Builder 3'], notes: ['', '', ''], wires: [], manager: true },
];
function presetsList() {
  const d = defaultAgent(), have = (k) => { const a = agentByKey(k, S.data.customAgents); return a.key === k && (!a.cmd || S.installed[a.cmd]); };
  const mixed = ['claude', 'codex', 'gemini', 'copilot'].filter(have).slice(0, 3);
  const out = [
    { name: 'Pair', agents: [d, d] },
    { name: `Four ${agentByKey(d, S.data.customAgents).name.split(' ')[0]}s`, agents: [d, d, d, d] },
  ];
  if (mixed.length > 1) out.push({ name: mixed.map((k) => agentByKey(k, S.data.customAgents).name.split(' ')[0]).join(', '), agents: mixed });
  for (const p of S.data.settings.presets || []) out.push({ name: p.name, saved: p });
  return out;
}
export function openTeams() {
  closeTeams();
  const back = h('div', { class: 'sheet-back', id: 'teams-sheet', onpointerdown: (e) => { if (e.target === back) closeTeams(); } });
  const sheet = h('div', { class: 'sheet teams' });
  const d = defaultAgent(), an = agentByKey(d, S.data.customAgents).name;
  sheet.append(h('div', { class: 'sheet-head' }, h('span', { class: 'sheet-title' }, 'Teams'), h('span', { class: 'sheet-sub' }, `every member runs ${an}`), h('button', { class: 'tile-btn', title: 'Close (Esc)', onclick: closeTeams }, '✕')));
  const list = h('div', { class: 'sheet-list' });
  for (const t of TEMPLATES) list.append(h('button', { class: 'team-row', type: 'button', onclick: () => { closeTeams(); startTemplate(t); } },
    h('span', { class: 'tr-name' }, t.name), h('span', { class: 'tr-note' }, t.note),
    h('span', { class: 'tr-roles' }, (t.manager ? ['Prompter', ...t.roles, 'Secretary'] : t.roles).join(' → '))));
  list.append(h('div', { class: 'sheet-sec' }, 'Presets'));
  for (const p of presetsList()) {
    const ags = p.saved ? p.saved.agents || p.saved.roles.map(() => d) : p.agents;
    list.append(h('button', { class: 'preset-row', type: 'button', onclick: () => { closeTeams(); p.saved ? spawnTeam(p.saved) : spawnMany(p.agents, { group: p.agents.length > 1 ? p.name : null }); } },
      h('span', { class: 'pr-marks' }, ...ags.slice(0, 5).map((k) => { const a = agentByKey(k, S.data.customAgents); return h('span', { class: 'agent-mark', style: { '--ac': a.color }, title: a.name }, a.key === 'claude' ? '✳' : a.name.charAt(0)); })),
      h('span', { class: 'pr-text' }, h('span', { class: 'tr-name' }, p.name), h('span', { class: 'tr-note' }, `${ags.length} console${ags.length > 1 ? 's' : ''}${p.saved ? ' · saved' : ''}`))));
  }
  list.append(h('div', { class: 'sheet-tip' }, 'Make your own: put agents in a group, wire them, then right-click the group › Save as preset.'));
  sheet.append(list);
  back.append(sheet);
  document.body.append(back);
  glassify(sheet, { refract: false });
  const esc = (e) => { if (e.key === 'Escape') { closeTeams(); removeEventListener('keydown', esc, true); } };
  addEventListener('keydown', esc, true);
}
function closeTeams() { const s = $('#teams-sheet'); if (s) s.remove(); }
function startTemplate(t) {
  const r = spawnTeam(t, defaultAgent());
  if (!r) return;
  if (t.lead && r.nodes[0]) {
    const lead = r.nodes[0];
    lead.data.lead = true; save();
    toast('Give the lead the whole job. It brings in helpers by itself when the job splits into parts.', 'ok');
  }
}

// ---------- the ask bar ----------
const HIST_MAX = 30;
function askBar() {
  const input = h('textarea', { rows: 1, spellcheck: 'false', autocomplete: 'off', placeholder: 'Ask your agents · @ to pick one · hold space to talk', 'aria-label': 'Ask your agents' });
  const pop = h('div', { class: 'ask-pop', hidden: true });
  const hist = h('button', { type: 'button', class: 'round', title: 'What you sent before' }, ico('chev', 15));
  const send = h('button', { type: 'button', class: 'round', title: 'Send to your agents (Enter)' }, ico('up', 15));
  const mic = h('button', { type: 'button', class: 'round', title: 'Dictate instead of typing (or hold Space)' }, ico('mic', 15));
  const form = h('form', { class: 'askbar', id: 'askbar' }, h('span', { class: 'orb' }), input, hist, send, mic);
  let sel = 0, opts = [];
  const word = () => { const m = input.value.slice(0, input.selectionStart).match(/(^|\s)([@#])([^\s]*)$/); return m ? { kind: m[2], q: m[3].toLowerCase(), at: input.selectionStart - m[3].length } : null; };
  const paintPop = () => {
    const w = word();
    if (!w) { pop.hidden = true; opts = []; return; }
    const cs = consoles();
    const groups = ws().nodes.filter((n) => n.type === 'group');
    opts = w.kind === '@'
      ? [{ t: 'all', d: 'every agent on this board' }, ...cs.filter((c) => c.title.toLowerCase().startsWith(w.q)).map((c) => ({ t: c.title, d: `${agentByKey(c.data.agent, S.data.customAgents).name} · ${statusOf(c.id)}` })), ...groups.filter((g) => g.title.toLowerCase().startsWith(w.q)).map((g) => ({ t: g.title.replace(/\s+/g, '-'), d: 'a whole group' }))]
      : groups.map((g) => ({ t: (g.data && g.data.tag) || g.title.toLowerCase().replace(/[^a-z0-9_-]+/g, '-'), d: g.title })).filter((o) => o.t.startsWith(w.q));
    opts = opts.filter((o) => o.t.toLowerCase().startsWith(w.q)).slice(0, 8);
    sel = Math.min(sel, Math.max(0, opts.length - 1));
    pop.replaceChildren(...opts.map((o, i) => h('div', { class: 'ap-item' + (i === sel ? ' on' : ''), onpointerdown: (e) => { e.preventDefault(); pick(i); } }, h('b', {}, w.kind + o.t), h('span', {}, o.d))));
    pop.hidden = !opts.length;
  };
  const pick = (i) => { const w = word(), o = opts[i]; if (!w || !o) return; input.value = input.value.slice(0, w.at) + o.t + ' ' + input.value.slice(input.selectionStart); input.focus(); pop.hidden = true; };
  let hi = -1;
  const remember = (t) => { const L = (S.data.settings.askHistory = (S.data.settings.askHistory || []).filter((x) => x !== t)); L.unshift(t); L.length = Math.min(L.length, HIST_MAX); save(); };
  const submit = () => {
    const t = input.value.trim(); if (!t) return;
    if (t.startsWith('/')) { input.value = ''; openCommandBar(t); return; }
    const { ids, text } = parseTargets(t);
    let targets = ids;
    if (!targets.length) { const s = selectedId && findNode(selectedId); if (s && s.node.type === 'console') targets = [s.node.id]; }
    if (!targets.length) { const cs = consoles().filter((c) => c.data.agent !== 'shell'); if (cs.length === 1) targets = [cs[0].id]; }
    if (!targets.length || !text.trim()) { input.value = ''; openCommandBar(t); return; }
    let n = 0;
    for (const id of targets) {
      const S2 = window.__argonSimple, v = S2 && S2.views.get(id);
      if (v) { if (S2.deliver(v, text, true)) n++; continue; } // a busy Claude: waits for its turn in the Simple view
      if (sendTo(id, text)) n++;
    }
    remember(t); hi = -1; input.value = ''; pop.hidden = true;
    const names = targets.map((id) => findNode(id)?.node.title).filter(Boolean);
    toast(n ? `Sent to ${names.length > 3 ? names.length + ' agents' : names.join(', ')}` : 'No running agents to send to', n ? '' : 'warn');
  };
  // grows to fit what you type (Shift+Enter for a new line), up to a cap, then scrolls
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, Math.round(innerHeight * 0.4)) + 'px'; };
  const setVal = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  Object.defineProperty(input, 'value', { get() { return setVal.get.call(this); }, set(v) { setVal.set.call(this, v); requestAnimationFrame(grow); } });
  input.addEventListener('input', () => { sel = 0; paintPop(); grow(); });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (!pop.hidden && opts.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % opts.length; paintPop(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + opts.length) % opts.length; paintPop(); return; }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); pick(sel); return; }
    }
    const L = S.data.settings.askHistory || [];
    if (e.key === 'ArrowUp' && (!input.value || hi >= 0) && L.length) { e.preventDefault(); hi = Math.min(L.length - 1, hi + 1); input.value = L[hi]; return; }
    if (e.key === 'ArrowDown' && hi >= 0) { e.preventDefault(); hi--; input.value = hi >= 0 ? L[hi] : ''; return; }
    if (e.key === 'Escape') { pop.hidden = true; input.blur(); }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { pop.hidden = true; }, 120));
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  send.onclick = (e) => { e.preventDefault(); submit(); };
  mic.onclick = (e) => { e.preventDefault(); dictate(); };
  hist.onclick = (e) => {
    e.preventDefault();
    const L = S.data.settings.askHistory || [];
    if (!L.length) { toast('Nothing sent from here yet'); return; }
    pop.replaceChildren(...L.slice(0, 10).map((t) => h('div', { class: 'ap-item', onpointerdown: (ev) => { ev.preventDefault(); input.value = t; input.focus(); pop.hidden = true; } }, h('span', { class: 'ap-hist' }, t))));
    pop.hidden = false; input.focus();
  };
  return h('div', { class: 'askwrap' }, pop, form);
}

// ---------- bottom chips ----------
function chip(label, a, b, hint, fn) { const c = h('button', { type: 'button', class: 'chip2', title: hint, style: { '--a': a, '--b': b }, onclick: fn }, label); return c; }
function pausedAll(w = ws()) { return !!w.paused; }
function togglePause() {
  const w = ws(), on = !w.paused;
  w.paused = on;
  for (const x of w.wires || []) { if (on) { if (!x.paused) { x.paused = true; x.byPauseAll = true; } } else if (x.byPauseAll) { x.paused = false; delete x.byPauseAll; } }
  for (const n of w.nodes) { const L = n.data && n.data.loop; if (!L) continue; if (on) { if (L.on) { L.on = false; L.byPauseAll = true; } } else if (L.byPauseAll) { L.on = true; delete L.byPauseAll; } }
  save(); emit('nodes'); paintChips();
  toast(on ? 'Paused every wire and loop on this board. Agents finish what they are doing, nothing new starts.' : 'Wires and loops are running again', on ? 'warn' : 'ok');
}
let chipsEl = null;
function paintChips() {
  if (!chipsEl) return;
  const p = pausedAll();
  const pb = chipsEl.querySelector('[data-k="pause"]');
  pb.textContent = p ? 'Resume all' : 'Pause all'; pb.title = p ? 'Let every wire and loop on this board run again' : 'Stop every wire and loop on this board, so nothing hands off or repeats';
  pb.classList.toggle('on', p);
}

// ---------- branch pill, running count, day/night ----------
async function paintBranch(pill) {
  const w = ws();
  let g = null; try { g = w.cwd ? await window.argon.git.info(w.cwd) : null; } catch (_) {}
  if (!g || !g.repo) { pill.hidden = true; return; }
  pill.hidden = false;
  pill.querySelector('.b').textContent = g.branch || 'detached';
  const n = (g.changes || []).length, c = pill.querySelector('.n');
  c.textContent = n; c.hidden = !n;
  pill.title = `${g.branch}: ${n ? n + ' changed file' + (n > 1 ? 's' : '') : 'nothing changed'}${g.ahead ? `, ${g.ahead} to upload` : ''}${g.behind ? `, ${g.behind} to download` : ''}. Click for the Git card.`;
}
function openGit() {
  const w = ws();
  let g = w.nodes.find((n) => n.type === 'git');
  if (!g) { const c = center(); g = addNode('git', {}, { x: Math.round(c.x - 210), y: Math.round(c.y - 220) }); }
  emit('fly', g.id); select(g.id);
}
function paintRunning(pill) {
  const n = allConsoles().filter(({ node }) => node.data.agent !== 'shell' && rt(node.id) && rt(node.id).alive).length;
  const busy = allConsoles().filter(({ node }) => statusOf(node.id) === 'working').length;
  pill.querySelector('.n').textContent = n;
  pill.classList.toggle('busy', busy > 0);
  pill.title = `${n} agent${n === 1 ? '' : 's'} running, ${busy} working right now. Click for the mission map.`;
}
const isLight = () => !!(THEMES[look().theme] || {}).light;
function toggleDay(btn) {
  const L = look();
  const go = () => {
    if (isLight()) L.theme = S.data.settings.lastDark || 'midnight';
    else { S.data.settings.lastDark = L.theme; L.theme = S.data.settings.lastLight || (L.theme === 'ember' ? 'paper' : 'daylight'); }
    if (isLight()) S.data.settings.lastLight = L.theme;
    applyAppearance(); save(); paintDay(btn);
  };
  if (document.startViewTransition && !document.body.classList.contains('no-anim')) document.startViewTransition(go); else go();
}
function paintDay(btn) { btn.replaceChildren(ico(isLight() ? 'moon' : 'sun', 17)); btn.title = isLight() ? 'Switch to night' : 'Switch to day'; }

// ---------- the empty board ----------
function emptyState() {
  const e = $('#empty-hint'); if (!e) return;
  e.replaceChildren(
    h('div', { class: 'eh-title' }, 'Start with an agent'),
    h('div', { class: 'eh-sub' }, 'Give it a job and watch it work. Right-click anywhere on the board for more.'),
    h('div', { class: 'eh-btns' },
      h('button', { type: 'button', class: 'btn primary', onclick: newAgent }, 'New agent'),
      h('button', { type: 'button', class: 'btn', onclick: openTeams }, 'Ready-made team')));
}

export function initChrome() {
  // bottom: chips over the ask bar
  chipsEl = h('div', { class: 'chips2' },
    chip('New agent', '#5cc2c2', '#e0889f', 'Start one more agent', () => newAgent()),
    chip('4 agents', '#e2b15a', '#6fcfa3', 'Start four agents at once', () => spawnMany(Array(4).fill(defaultAgent()))),
    chip('Group', '#e2b15a', '#e0889f', 'Frame the selected agent in a group, then drop more in', () => addGroup()),
    chip('Presets', '#7ea8ec', '#e2b15a', 'Ready-made teams, such as plan, build and review', () => openTeams()),
    chip('Pause all', '#e0889f', '#7ea8ec', '', togglePause),
    chip('Context', '#a371f7', '#e2b15a', 'How full your agents are, what they should know, and connected folders', () => openContext()));
  chipsEl.querySelector('.chip2:nth-child(5)').dataset.k = 'pause';
  const bar = h('div', { id: 'bottombar' }, chipsEl, askBar());
  document.body.append(bar);
  glassify(bar.querySelector('.askbar'), { refract: false });
  paintChips();

  // bottom left: the branch
  const branch = h('button', { type: 'button', id: 'branch-pill', hidden: true, onclick: openGit }, ico('branch', 15), h('span', { class: 'b' }), h('span', { class: 'n' }));
  document.body.append(branch);
  glassify(branch, { refract: false });
  paintBranch(branch); setInterval(() => !document.hidden && paintBranch(branch), 8000);

  // top bar: running count and day/night, before the panel buttons
  const top = $('#topbar .top-actions');
  if (top) {
    const run = h('button', { type: 'button', class: 'run-pill nodrag', onclick: () => openMissionMap() }, h('span', { class: 'd' }), h('span', { class: 'n' }, '0'), h('span', { class: 'l' }, 'running'));
    const day = h('button', { type: 'button', class: 'icon-btn', id: 'day-toggle' });
    day.onclick = () => toggleDay(day);
    top.before(run); top.prepend(day);
    paintRunning(run); paintDay(day);
    on('status', () => paintRunning(run)); setInterval(() => paintRunning(run), 3000);
  }

  // right rail: the panels
  const rail = h('aside', { id: 'rail' },
    h('button', { type: 'button', title: 'Mission map: everything running, at a glance (Ctrl+M)', onclick: () => openMissionMap() }, ico('layers', 18)),
    h('button', { type: 'button', title: 'Context: how full each agent is, and connected folders', onclick: () => openContext() }, ico('context', 18)),
    h('button', { type: 'button', title: 'Project memory: what every agent should know', onclick: () => openMemory() }, ico('memory', 18)),
    h('button', { type: 'button', title: 'Usage: tokens and limits', onclick: () => openUsage() }, ico('usage', 18)),
    h('button', { type: 'button', title: 'Files of this project', onclick: () => { const w = ws(); let f = w.nodes.find((n) => n.type === 'files'); if (!f) { const c = center(); f = addNode('files', {}, { x: Math.round(c.x - 350), y: Math.round(c.y - 260), w: 700, h: 520 }); } emit('fly', f.id); } }, ico('files', 18)),
    h('button', { type: 'button', title: 'Git: changes, snapshots, upload and download', onclick: openGit }, ico('git', 18)));
  document.getElementById('main').append(rail);
  glassify(rail, { refract: false });

  emptyState();
  on('nodes', paintChips);
  on('workspace', () => { paintBranch(branch); paintChips(); });
  window.__argonChrome = { openTeams, spawnMany, TEMPLATES };
}
