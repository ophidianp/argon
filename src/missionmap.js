// Mission Map: one view of who runs what. Leads (Managers, or you via the command bar) → teams → consoles,
// with filters, search, and a detail panel to jump to, pause, stop or answer any console.
import { S, ws, on, h, emit, save, toast } from './state.js';
import { statusOf, sendTo, lastLines, rt, restartConsole } from './consoles.js';
import { select, tileEl, groupTag } from './tiles.js';
import { flyTo } from './board.js';
import { agentByKey } from './agents.js';
import { openCommandBar } from './panels.js';

const NS = 'http://www.w3.org/2000/svg';
const LABEL = { working: 'Working', needs: 'Needs you', resting: 'Idle', exited: 'Done', starting: 'Starting' };
const FILTERS = [['all', 'All'], ['working', 'Working'], ['needs', 'Needs you'], ['resting', 'Idle'], ['exited', 'Done']];
const RANK = { needs: 0, working: 1, starting: 2, resting: 3, exited: 4 };
let M = null; // {root, graph, svg, detail, filter, q, sel}

const stOf = (n) => { const s = statusOf(n.id); return s === 'starting' ? 'working' : s; };
const agentOf = (n) => agentByKey(n.data.agent, S.data.customAgents);
const ctxPct = (n) => { const c = window.__argonTeam && window.__argonTeam.contextOf(n.id); return c ? c.pct : null; };

// ---------- the model ----------
function model() {
  const w = ws();
  const cons = w.nodes.filter((n) => n.type === 'console');
  const teams = new Map();
  const teamOf = (n) => {
    if (n.data && n.data.space === 'pipe') {
      const s = w.pipe && w.pipe.stages.find((x) => x.id === n.data.stage);
      return s ? { key: 'st:' + s.id, name: s.title, color: 'var(--accent)', kind: 'stage', id: s.id } : { key: 'pipe', name: 'Pipeline (unassigned)', color: 'var(--muted)', kind: 'stage' };
    }
    const g = n.data.groupId && w.nodes.find((x) => x.id === n.data.groupId);
    return g ? { key: g.id, name: g.title, color: g.data.color || 'var(--accent)', kind: 'group', id: g.id, node: g } : { key: 'none', name: 'Ungrouped', color: 'var(--muted)', kind: 'none' };
  };
  for (const n of cons) { const t = teamOf(n); if (!teams.has(t.key)) teams.set(t.key, { ...t, members: [] }); teams.get(t.key).members.push(n); }
  for (const t of teams.values()) t.members.sort((a, b) => (stOf(a) === 'needs') - (stOf(b) === 'needs') ? (stOf(b) === 'needs') - (stOf(a) === 'needs') : a.x - b.x || a.y - b.y);
  const leads = w.nodes.filter((n) => n.type === 'prompter').map((m) => {
    const keys = new Set();
    for (const id of m.data.links || []) { if (teams.has(id)) keys.add(id); else { const c = cons.find((x) => x.id === id); if (c) keys.add(teamOf(c).key); } }
    return { key: m.id, name: m.title, node: m, sub: m.data.goal ? m.data.goal.slice(0, 40) : 'Prompter', teams: keys };
  });
  const owned = new Set(leads.flatMap((l) => [...l.teams]));
  const loose = [...teams.keys()].filter((k) => !owned.has(k));
  if (loose.length || !leads.length) leads.push({ key: 'you', name: 'You', sub: 'Command bar', you: true, teams: new Set(loose) });
  const order = [...teams.values()].sort((a, b) => (a.kind === 'none') - (b.kind === 'none') || a.name.localeCompare(b.name));
  return { w, cons, teams: order, leads };
}

// ---------- open / close ----------
export function openMissionMap() {
  if (M) { closeMap(); return; }
  const search = h('input', { class: 'mx-search', placeholder: 'Find a console or team', spellcheck: 'false' });
  const chips = h('div', { class: 'mx-chips' });
  const sub = h('div', { class: 'mx-sub' });
  const graph = h('div', { class: 'mx-graph' });
  const detail = h('aside', { class: 'mx-detail' });
  const panel = h('div', { class: 'mx-panel' },
    h('header', { class: 'mx-head' },
      h('span', { class: 'mx-logo' }, mapIcon()),
      h('div', { class: 'mx-titles' }, h('div', { class: 'mx-title' }, 'Mission Map'), sub),
      h('button', { class: 'mx-hbtn', title: 'Keep a compact list on the right side', onclick: () => { S.data.settings.showMission = !S.data.settings.showMission; save(); emit('nodes'); paintChips(); } }, 'Sidebar list'),
      h('button', { class: 'mx-x', title: 'Close (Esc)', onclick: closeMap }, '✕')),
    h('div', { class: 'mx-bar' }, chips, h('label', { class: 'mx-find' }, h('span', {}, '⌕'), search)),
    h('div', { class: 'mx-body' }, h('div', { class: 'mx-scroll' }, graph), detail),
    h('footer', { class: 'mx-legend' },
      ...['working', 'needs', 'resting', 'exited'].map((s) => h('span', {}, h('i', { class: 'status-dot ' + s }), LABEL[s])),
      h('span', {}, h('i', { class: 'mx-dash' }), 'Command bar only'),
      h('span', { class: 'mx-hint' }, 'Click to inspect · double-click to jump · Esc to close')));
  const root = h('div', { class: 'mx-scrim' }, panel);
  root.addEventListener('pointerdown', (e) => { if (e.target === root) closeMap(); });
  document.body.append(root);
  M = { root, panel, graph, detail, chips, sub, search, filter: 'all', q: '', sel: null };
  search.addEventListener('input', () => { M.q = search.value.trim().toLowerCase(); paint(); });
  M.keys = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeMap(); }
    else if (e.key === '/' && document.activeElement !== search) { e.preventDefault(); search.focus(); }
  };
  addEventListener('keydown', M.keys, true);
  M.ro = new ResizeObserver(() => lines()); M.ro.observe(graph);
  paint();
  requestAnimationFrame(() => root.classList.add('in'));
  document.getElementById('mission-toggle')?.classList.add('on');
}
function closeMap() {
  if (!M) return;
  const m = M; M = null;
  removeEventListener('keydown', m.keys, true); m.ro.disconnect();
  m.root.classList.remove('in'); m.root.classList.add('out');
  setTimeout(() => m.root.remove(), document.body.classList.contains('no-anim') ? 0 : 260);
  document.getElementById('mission-toggle')?.classList.toggle('on', !!S.data.settings.showMission);
}
export const missionOpen = () => !!M;

// ---------- painting ----------
let pT = 0;
function schedule() { if (!M) return; clearTimeout(pT); pT = setTimeout(paint, 120); }
function visible(n, t) {
  if (M.filter !== 'all' && stOf(n) !== M.filter) return false;
  if (!M.q) return true;
  return [n.title, n.data.role, agentOf(n).name, t.name].some((s) => s && String(s).toLowerCase().includes(M.q));
}
function paintChips(mod) {
  mod = mod || model();
  const c = (s) => mod.cons.filter((n) => s === 'all' || stOf(n) === s).length;
  M.chips.innerHTML = '';
  for (const [k, l] of FILTERS) M.chips.append(h('button', { class: 'mx-chip f-' + k + (M.filter === k ? ' on' : ''), onclick: () => { M.filter = k; paint(); } }, k !== 'all' ? h('i', { class: 'status-dot ' + k }) : null, l, h('b', {}, String(c(k)))));
  const working = c('working'), teamsN = mod.teams.filter((t) => t.kind !== 'none').length, leadsN = mod.leads.filter((l) => !l.you).length;
  M.sub.textContent = `${leadsN} orchestrator${leadsN === 1 ? '' : 's'} · ${teamsN} team${teamsN === 1 ? '' : 's'} · ${mod.cons.length} console${mod.cons.length === 1 ? '' : 's'} · ${working} working`;
}
function paint() {
  if (!M) return;
  const mod = model(); M.mod = mod;
  paintChips(mod);
  const g = M.graph, scroll = g.parentNode.scrollTop;
  g.innerHTML = '';
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'mx-lines'); g.append(svg); M.svg = svg;
  if (!mod.cons.length) {
    g.append(h('div', { class: 'mx-empty' }, h('b', {}, 'No consoles on this board yet'), h('span', {}, 'Spawn an agent with N, or start a team from the ⧉ presets button in the dock.')));
    paintDetail(); return;
  }
  const leadCol = h('div', { class: 'mx-col mx-leads' });
  const teamCol = h('div', { class: 'mx-col mx-rows' });
  g.append(leadCol, teamCol);
  const shownTeams = new Set();
  for (const t of mod.teams) {
    const vis = t.members.filter((n) => visible(n, t));
    if (!vis.length && (M.filter !== 'all' || M.q)) continue;
    shownTeams.add(t.key);
    const working = t.members.filter((n) => stOf(n) === 'working').length, needs = t.members.filter((n) => stOf(n) === 'needs').length;
    const card = h('button', { class: 'mx-node mx-team' + (M.sel === 'team:' + t.key ? ' sel' : '') + (needs ? ' needs' : working ? ' working' : ''), 'data-k': 'team:' + t.key, style: { '--tc': t.color } },
      h('span', { class: 'mx-tdot' }), h('span', { class: 'mx-nt' }, h('b', {}, t.name), h('small', {}, `${t.members.length} agent${t.members.length === 1 ? '' : 's'}${working ? ` · ${working} working` : ''}${needs ? ` · ${needs} need you` : ''}`)),
      h('span', { class: 'mx-count' }, String(t.members.length)));
    card.onclick = () => pick('team:' + t.key);
    card.ondblclick = () => { if (t.node) { select(t.node.id); flyTo(t.node, .9); closeMap(); } };
    const list = h('div', { class: 'mx-cons' });
    for (const n of vis) list.append(consoleRow(n, t));
    teamCol.append(h('div', { class: 'mx-row' }, card, list));
  }
  for (const l of mod.leads) {
    const n = [...l.teams].filter((k) => shownTeams.has(k)).length;
    if (!n && !l.you && (M.filter !== 'all' || M.q)) continue;
    const running = l.node && l.node.data.run && l.node.data.run.active;
    const b = h('button', { class: 'mx-node mx-lead' + (l.you ? ' you' : '') + (running ? ' working' : '') + (M.sel === 'lead:' + l.key ? ' sel' : ''), 'data-k': 'lead:' + l.key },
      h('span', { class: 'mx-lico' }, l.you ? '›_' : '◎'), h('span', { class: 'mx-nt' }, h('b', {}, l.name), h('small', {}, l.you ? `${n} team${n === 1 ? '' : 's'} · command bar` : `${n} team${n === 1 ? '' : 's'}${running ? ' · running' : ''}`)),
      h('span', { class: 'mx-count' }, String(n)));
    b.onclick = () => pick('lead:' + l.key);
    b.ondblclick = () => { if (l.node) { select(l.node.id); flyTo(l.node, .9); closeMap(); } else { closeMap(); openCommandBar(''); } };
    leadCol.append(b);
  }
  if (!M.sel || !g.querySelector(`[data-k="${CSS.escape(M.sel)}"]`)) {
    const first = mod.cons.slice().sort((a, b) => RANK[stOf(a)] - RANK[stOf(b)]).find((n) => g.querySelector(`[data-k="con:${n.id}"]`));
    M.sel = first ? 'con:' + first.id : null;
    if (M.sel) g.querySelector(`[data-k="${M.sel}"]`)?.classList.add('sel');
  }
  g.parentNode.scrollTop = scroll;
  lines(); paintDetail();
}
function consoleRow(n, t) {
  const st = stOf(n), a = agentOf(n), pct = ctxPct(n);
  const row = h('button', { class: 'mx-node mx-con ' + st + (M.sel === 'con:' + n.id ? ' sel' : ''), 'data-k': 'con:' + n.id },
    h('i', { class: 'status-dot ' + st }),
    h('span', { class: 'mx-nt' }, h('b', {}, n.title, h('em', { style: { color: a.color, borderColor: a.color } }, a.name)), h('small', {}, LABEL[st] || st, pct != null ? ` · ${pct}% context` : '')),
    h('span', { class: 'mx-go', title: 'Go to the console' }, '›'));
  row.onclick = () => pick('con:' + n.id);
  row.ondblclick = () => goTo(n);
  row.querySelector('.mx-go').onclick = (e) => { e.stopPropagation(); goTo(n); };
  return row;
}
function pick(k) { if (!M) return; M.sel = k; M.graph.querySelectorAll('.mx-node.sel').forEach((x) => x.classList.remove('sel')); M.graph.querySelector(`[data-k="${CSS.escape(k)}"]`)?.classList.add('sel'); lines(); paintDetail(); }
function goTo(n) {
  closeMap();
  if (n.data.space === 'pipe' && ws().mode !== 'pipe') document.querySelector('#mode-seg [data-mode="pipe"]')?.click();
  setTimeout(() => { select(n.id); flyTo(n, 1); const el = tileEl(n.id); el && el.querySelector('.xterm-helper-textarea')?.focus(); }, 80);
}

// ---------- curves ----------
function lines() {
  if (!M || !M.svg || !M.mod) return;
  const g = M.graph, svg = M.svg, base = g.getBoundingClientRect();
  svg.setAttribute('width', g.scrollWidth); svg.setAttribute('height', g.scrollHeight);
  svg.innerHTML = '';
  const pt = (el, side) => { const r = el.getBoundingClientRect(); return [(side ? r.right : r.left) - base.left, r.top + r.height / 2 - base.top]; };
  const path = (a, b, cls) => {
    const c = Math.max(40, (b[0] - a[0]) * .5), p = document.createElementNS(NS, 'path');
    p.setAttribute('d', `M${a[0]},${a[1]} C${a[0] + c},${a[1]} ${b[0] - c},${b[1]} ${b[0]},${b[1]}`); p.setAttribute('class', cls); svg.append(p);
  };
  const selK = M.sel || '';
  for (const l of M.mod.leads) {
    const le = g.querySelector(`[data-k="lead:${l.key}"]`); if (!le) continue;
    for (const tk of l.teams) {
      const te = g.querySelector(`[data-k="team:${tk}"]`); if (!te) continue;
      const hot = selK === 'lead:' + l.key || selK === 'team:' + tk || (selK.startsWith('con:') && te.parentNode.querySelector(`[data-k="${selK}"]`));
      path(pt(le, 1), pt(te, 0), 'mx-l' + (l.you ? ' dash' : '') + (te.classList.contains('needs') ? ' needs' : te.classList.contains('working') ? ' working' : '') + (hot ? ' hot' : ''));
    }
  }
  for (const row of g.querySelectorAll('.mx-row')) {
    const te = row.querySelector('.mx-team');
    for (const ce of row.querySelectorAll('.mx-con')) {
      const st = ['needs', 'working'].find((s) => ce.classList.contains(s)) || '';
      const hot = selK === ce.dataset.k || selK === te.dataset.k;
      path(pt(te, 1), pt(ce, 0), 'mx-l ' + st + (hot ? ' hot' : ''));
    }
  }
}

// ---------- detail panel ----------
function paintDetail() {
  if (!M) return;
  const d = M.detail; d.innerHTML = '';
  const [kind, id] = (M.sel || '').split(/:(.+)/);
  const w = ws();
  if (kind === 'con') {
    const n = w.nodes.find((x) => x.id === id); if (!n) return;
    const st = stOf(n), a = agentOf(n), team = M.mod.teams.find((t) => t.members.includes(n)), pct = ctxPct(n);
    const lead = team && M.mod.leads.find((l) => l.teams.has(team.key));
    const task = (n.data.loop && n.data.loop.on && n.data.loop.prompt) || n.data.role || (team && team.name) || '—';
    const wires = (w.wires || []).filter((x) => x.from === n.id || x.to === n.id);
    const name = (wid) => { const x = w.nodes.find((y) => y.id === wid); return x ? x.title : '?'; };
    d.append(
      h('div', { class: 'mx-dh' }, h('span', { class: 'mx-dico', style: { background: a.color } }, a.name[0]), h('div', {}, h('b', {}, n.title), h('small', {}, a.name, team && team.kind !== 'none' ? h('em', { style: { '--tc': team.color } }, team.name) : null))),
      h('button', { class: 'mx-primary', onclick: () => goTo(n) }, '↗ Go to the console'),
      h('div', { class: 'mx-pair' },
        h('button', { class: 'mx-sec', title: 'Sends Esc, which interrupts Claude, Codex and Gemini', onclick: () => { const r = rt(n.id); if (r && r.alive) { window.argon.pty.write(n.id, '\x1b'); toast(`Paused ${n.title}`); } } }, '❚❚ Pause'),
        st === 'exited'
          ? h('button', { class: 'mx-sec', onclick: () => { restartConsole(n, false); toast(`Restarting ${n.title}`); schedule(); } }, '↻ Restart')
          : h('button', { class: 'mx-sec danger', onclick: async (e) => { const b = e.currentTarget; if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Click again to stop'; setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = '⊘ Kill'; } }, 2500); return; } await window.argon.pty.kill(n.id); toast(`Stopped ${n.title}`); } }, '⊘ Kill')),
      section('Now', kv('Status', h('span', { class: 'mx-st ' + st }, LABEL[st] || st)), kv('Task', task), pct != null ? kv('Context', h('span', { class: 'mx-meter' }, h('span', { class: 'mx-track' }, h('i', { style: { width: pct + '%' } })), pct + '%')) : null));
    if (st === 'needs' && window.__argonTeam) {
      const q = window.__argonTeam.parseQuestion(lastLines(n.id, 40));
      if (q) d.append(section('Asking', h('div', { class: 'mx-q' }, q.q), h('div', { class: 'mx-qb' }, ...q.opts.map((o, i) => h('button', { class: 'mx-sec' + (i === 0 ? ' yes' : ''), onclick: () => { window.argon.pty.write(n.id, o.key); if (o.enter) setTimeout(() => window.argon.pty.write(n.id, '\r'), 80); const r = rt(n.id); if (r) r.lastIn = Date.now(); toast(`Answered "${o.label}"`); setTimeout(schedule, 400); } }, o.label)))));
    }
    const belongs = [];
    if (team) belongs.push(link(team.name, team.kind === 'none' ? 'No group' : team.kind === 'stage' ? 'Pipeline stage' : 'Team', team.color, () => pick('team:' + team.key)));
    if (lead) belongs.push(link(lead.name, lead.you ? 'Through the command bar' : 'Orchestrator', 'var(--accent)', () => pick('lead:' + lead.key), lead.you));
    d.append(section('Belongs to', ...belongs));
    if (wires.length) d.append(section('Wires', ...wires.map((x) => h('div', { class: 'mx-wire' }, h('span', {}, x.from === n.id ? `→ ${name(x.to)}` : `← ${name(x.from)}`), h('em', {}, x.mode + (x.mode === 'review' && x.rounds ? ` ${x.rounds}/5` : ''))))));
    d.append(section('Message', msgBox((t) => sendTo(n.id, t) && toast(`Sent to ${n.title}`))));
  } else if (kind === 'team') {
    const t = M.mod.teams.find((x) => x.key === id); if (!t) return;
    const lead = M.mod.leads.find((l) => l.teams.has(t.key));
    d.append(
      h('div', { class: 'mx-dh' }, h('span', { class: 'mx-dico', style: { background: t.color } }, '⬚'), h('div', {}, h('b', {}, t.name), h('small', {}, `${t.members.length} agents`))),
      t.node ? h('button', { class: 'mx-primary', onclick: () => { closeMap(); select(t.node.id); flyTo(t.node, .9); } }, '↗ Go to the team') : null,
      section('Members', ...t.members.map((n) => link(n.title, `${agentOf(n).name} · ${LABEL[stOf(n)]}`, agentOf(n).color, () => pick('con:' + n.id)))),
      lead ? section('Led by', link(lead.name, lead.you ? 'Through the command bar' : 'Orchestrator', 'var(--accent)', () => pick('lead:' + lead.key), lead.you)) : null,
      section('Order the team', msgBox((txt) => { const n = t.members.filter((c) => sendTo(c.id, txt)).length; toast(`Sent to ${n} of ${t.members.length}`); })));
  } else if (kind === 'lead') {
    const l = M.mod.leads.find((x) => x.key === id); if (!l) return;
    const ts = M.mod.teams.filter((t) => l.teams.has(t.key));
    d.append(
      h('div', { class: 'mx-dh' }, h('span', { class: 'mx-dico', style: { background: 'var(--accent)' } }, l.you ? '›_' : '◎'), h('div', {}, h('b', {}, l.name), h('small', {}, l.you ? 'You lead these teams through the command bar' : 'Manager'))),
      l.node ? h('button', { class: 'mx-primary', onclick: () => { closeMap(); select(l.node.id); flyTo(l.node, .9); } }, '↗ Go to the Manager') : h('button', { class: 'mx-primary', onclick: () => { closeMap(); openCommandBar(''); } }, '›_ Open the command bar'),
      l.node && l.node.data.goal ? section('Goal', h('div', { class: 'mx-q' }, l.node.data.goal)) : null,
      section('Teams', ...(ts.length ? ts.map((t) => link(t.name, `${t.members.length} agents`, t.color, () => pick('team:' + t.key))) : [h('div', { class: 'mx-none' }, 'No teams yet. Drag the Manager’s socket onto a group.')])));
  } else d.append(h('div', { class: 'mx-none' }, 'Pick a console, team or lead to see what it is doing.'));
}
const section = (title, ...kids) => h('section', { class: 'mx-sec-box' }, h('div', { class: 'mx-sh' }, title), ...kids.filter(Boolean));
const kv = (k, v) => h('div', { class: 'mx-kv' }, h('span', {}, k), typeof v === 'string' ? h('b', {}, v) : v);
const link = (name, sub, color, fn, dashed) => h('button', { class: 'mx-link', onclick: fn }, h('i', { style: { background: color }, class: dashed ? 'dash' : '' }), h('span', {}, h('b', {}, name), h('small', {}, sub)), h('span', { class: 'mx-chev' }, '›'));
function msgBox(send) {
  const i = h('input', { placeholder: 'Type and press Enter', spellcheck: 'false' });
  i.addEventListener('keydown', (e) => { if (e.key === 'Enter' && i.value.trim()) { send(i.value.trim()); i.value = ''; } e.stopPropagation(); });
  return h('div', { class: 'mx-msg' }, i);
}
function mapIcon() {
  const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '18'); s.setAttribute('height', '18');
  s.innerHTML = '<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 4v13.5M15 6.5V20" stroke="currentColor" stroke-width="1.8"/>';
  return s;
}

export function initMissionMap() {
  on('status', schedule); on('nodes', schedule); on('loop', schedule); on('consoleMeta', schedule); on('handoff', schedule);
  addEventListener('resize', () => M && lines());
}
