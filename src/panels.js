// Mission map, command bar, loops, handoffs, memory, usage, settings, agents setup.
import { S, ws, save, emit, on, h, esc, toast, uid, basename, findNode, consoles } from './state.js';
import { iconEl } from './icons.js';
import { agentList, agentByKey, AGENTS } from './agents.js';
import { addNode, removeNode, select, tileEl } from './tiles.js';
import { statusOf, sendTo, startHandoff, rt, refitAll, setFontSize } from './consoles.js';
import { flyTo, fitAll, viewCenter, applyView } from './board.js';
import { modal, askText, confirmBox, showMenu } from './ui.js';
import { look, applyAppearance, ACCENTS, THEMES, FONTS, UI_FONTS, LOOKS, BG_COLORS, TERM_SCHEMES, greet, defaults, autoTermPreview } from './appearance.js';
import { applyTerminalLook } from './consoles.js';
import { glassify, morphFrom, rebuildGlass } from './glass.js';

const STATUS_LABEL = { working: 'Working', resting: 'Resting', needs: 'Needs you', exited: 'Stopped', starting: 'Starting' };

// ---------- mission map ----------
let mmTimer = 0;
const mmSeen = new Set(); // consoles already shown, so only new rows animate in
export function renderMission() {
  clearTimeout(mmTimer);
  mmTimer = setTimeout(_renderMission, 60);
}
function _renderMission() {
  const el = document.getElementById('mission');
  el.classList.toggle('closed', !S.data.settings.showMission);
  document.getElementById('mission-toggle').classList.toggle('on', !!S.data.settings.showMission || !!document.querySelector('.mx-scrim:not(.out)'));
  if (!S.data.settings.showMission) return;
  const list = consoles();
  const count = (st) => list.filter(n => statusOf(n.id) === st).length;
  el.innerHTML = '';
  el.append(h('div', { class: 'mm-head' },
    h('div', { class: 'mm-title' }, 'Mission map', h('button', { class: 'btn sm', onclick: () => spawnMenu(innerWidth - 300, 90) }, '+ Agent')),
    h('div', { class: 'mm-counts' },
      cnt(count('working'), 'working'), cnt(count('resting'), 'resting'), cnt(count('needs'), 'needs'))));
  const body = h('div', { class: 'mm-list' });
  if (!list.length) body.append(h('div', { class: 'mm-empty' }, 'No agents on this board yet. Spawn one with N, then add a Manager to run them as a team.'));
  const groups = {};
  for (const n of list) (groups[n.data.group || ''] = groups[n.data.group || ''] || []).push(n);
  const keys = Object.keys(groups).sort((a, b) => (a === '') - (b === '') || a.localeCompare(b));
  // needs-you first inside each group
  const rank = { needs: 0, working: 1, resting: 2, starting: 3, exited: 4 };
  for (const g of keys) {
    if (keys.length > 1 || g) body.append(h('div', { class: 'mm-group' }, g ? '#' + g : 'Ungrouped',
      g ? h('button', { onclick: () => openCommandBar('#' + g + ' ') }, 'Order team') : null));
    for (const n of groups[g].sort((a, b) => rank[statusOf(a.id)] - rank[statusOf(b.id)])) {
      const st = statusOf(n.id);
      const a = agentByKey(n.data.agent, S.data.customAgents);
      const L = n.data.loop;
      const isNew = !mmSeen.has(n.id); mmSeen.add(n.id);
      body.append(h('div', { class: 'mm-item' + (st === 'needs' ? ' needs' : '') + (isNew ? ' new' : ''), onclick: () => { select(n.id); flyTo(n); }, title: 'Fly to ' + n.title },
        h('span', { class: 'status-dot ' + st }),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { class: 'mm-name' }, n.title),
          h('div', { class: 'mm-meta' }, `${a.name} · ${STATUS_LABEL[st] || st}${L && L.on ? ` · loop ${L.runs || 0}${L.maxRuns ? '/' + L.maxRuns : ''}` : ''}`))));
    }
  }
  // other workspaces needing attention
  const elsewhere = S.data.workspaces.filter(w => w.id !== ws().id).flatMap(w => w.nodes.filter(n => n.type === 'console' && statusOf(n.id) === 'needs').map(n => ({ n, w })));
  if (elsewhere.length) {
    body.append(h('div', { class: 'mm-group' }, 'Other workspaces'));
    for (const { n, w } of elsewhere) body.append(h('div', { class: 'mm-item needs', onclick: () => { emit('switchWs', w.id); setTimeout(() => flyTo(n), 50); } },
      h('span', { class: 'status-dot needs' }), h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { class: 'mm-name' }, n.title), h('div', { class: 'mm-meta' }, w.name + ' · Needs you'))));
  }
  el.append(body);
}
function cnt(n, st) { return h('div', { class: 'mm-count' }, h('b', {}, String(n)), h('span', {}, h('i', { class: 'status-dot ' + st, style: { width: '7px', height: '7px', animation: 'none' } }), STATUS_LABEL[st])); }

on('status', () => { renderMission(); emit('tabs'); });
on('nodes', renderMission);
on('loop', renderMission);

// ---------- spawn menu ----------
export function spawnMenu(x, y, opts = {}) {
  const items = [{ title: 'Spawn a console' }];
  for (const a of agentList(S.data.customAgents)) {
    const installed = !a.cmd || S.installed[a.cmd];
    const profs = S.data.profiles.filter(p => p.agent === a.key);
    items.push({
      label: a.name, dot: a.color, missing: !installed,
      note: installed ? (a.cmd || 'PowerShell') : (a.install ? 'not installed · install' : 'not found'),
      onClick: () => installed ? spawn(a.key, opts) : offerInstall(a),
    });
    for (const p of profs) items.push({ label: `${a.name} · ${p.name}`, dot: a.color, note: 'profile', onClick: () => spawn(a.key, { ...opts, profile: p.id }) });
  }
  items.push('sep', { label: 'Agents setup…', onClick: openAgentsSetup }, { label: 'Add a custom agent…', onClick: addCustomAgent });
  showMenu(x, y, items);
}

export function spawn(agentKey, opts = {}) {
  const n = addNode('console', { agent: agentKey, profile: opts.profile || null, group: opts.group || '', initialPrompt: opts.prompt || undefined, ...(opts.data || {}) }, opts.at || {});
  return n;
}

async function offerInstall(a) {
  if (!a.install) { toast(`${a.name} is not on your PATH. Install it, then reopen Argon.`, 'warn'); return; }
  const ok = await confirmBox(`Install ${a.name}?`, `Argon will open a terminal and run:  ${a.install}`, 'Open terminal and install', false);
  if (!ok) return;
  const n = addNode('console', { agent: 'shell' }, { title: 'install-' + a.key });
  setTimeout(() => sendTo(n.id, a.install), 1800);
}

async function addCustomAgent() {
  const name = await askText('Custom agent name', { placeholder: 'e.g. My Agent' });
  if (!name || !name.trim()) return;
  const cmd = await askText('Command to run', { placeholder: 'e.g. my-agent --flag', sub: 'Runs inside PowerShell in the workspace folder.' });
  if (!cmd || !cmd.trim()) return;
  S.data.customAgents.push({ id: uid('ca'), name: name.trim(), cmd: cmd.trim() });
  save();
  await detectInstalled();
  toast(`Added ${name.trim()}`);
}

export async function detectInstalled() {
  const cmds = [...new Set(agentList(S.data.customAgents).map(a => a.cmd).filter(Boolean))];
  S.installed = await window.argon.detectAgents(cmds);
}

// ---------- agents setup ----------
export async function openAgentsSetup() {
  const body = h('div', {}, 'Checking…');
  const m = modal({ title: 'Agents setup', sub: 'Argon runs the agent programs on your PC with your own accounts. Each one signs in by itself the first time you open it.', body, wide: true });
  const render = async () => {
    await detectInstalled();
    const auth = await window.argon.agentAuth();
    body.innerHTML = '';
    const table = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
    for (const a of agentList(S.data.customAgents)) {
      if (!a.cmd) continue;
      const installed = !!S.installed[a.cmd];
      const known = a.key in auth;
      const signed = known ? auth[a.key] : null;
      const pill = (txt, color) => h('span', { style: { fontSize: '11.5px', padding: '2px 8px', borderRadius: '99px', border: `1px solid ${color}`, color, whiteSpace: 'nowrap' } }, txt);
      table.append(h('div', { class: 'row', style: { padding: '9px 10px', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: '10px', gap: '10px' } },
        h('span', { class: 'mi-dot', style: { width: '9px', height: '9px', borderRadius: '50%', background: a.color, flex: 'none' } }),
        h('div', { style: { flex: 1 } }, h('div', { style: { fontWeight: 560 } }, a.name), h('div', { style: { fontSize: '11.5px', color: 'var(--dim)', fontFamily: 'var(--mono)' } }, a.cmd)),
        installed ? pill('Installed', 'var(--ok)') : pill('Not installed', 'var(--dim)'),
        !installed ? null : signed === true ? pill('Signed in', 'var(--ok)') : signed === false ? pill('Not signed in', 'var(--needs)') : pill('Sign-in: open to check', 'var(--dim)'),
        !installed && a.install ? h('button', { class: 'btn sm', onclick: () => { m.close(); offerInstall(a); } }, 'Install') : null,
        installed ? h('button', { class: 'btn sm' + (signed === false ? ' primary' : ''), onclick: () => { m.close(); spawn(a.key); } }, signed === false ? 'Sign in' : 'Open') : null));
    }
    body.append(table,
      h('div', { class: 'field' }, h('div', { class: 'hint' },
        'Sign-in is detected by checking whether each tool has saved a login on this PC (Claude Code, Codex and Gemini CLI). Argon never reads or sends your login. ',
        'One plan covers many consoles of that agent; they share its usage limit. Use account profiles in Settings to spread work across accounts.')),
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn sm', onclick: render }, 'Check again')));
  };
  render();
}

// ---------- command bar ----------
let cmdState = null;
export function openCommandBar(prefill = '') {
  const root = document.getElementById('cmdbar');
  root.classList.remove('hidden');
  root.innerHTML = '';
  const input = h('input', { type: 'text', placeholder: 'Message your agents, or type / for commands…', spellcheck: 'false' });
  const targets = h('div', { class: 'cmd-targets' });
  const list = h('div', { class: 'cmd-list' });
  const box = h('div', { class: 'cmd-box' },
    h('div', { class: 'cmd-input' }, h('span', { class: 'cmd-ico' }, '›_'), input),
    targets, list,
    h('div', { class: 'cmd-foot' }, h('span', {}, h('kbd', {}, 'Enter'), ' send'), h('span', {}, h('kbd', {}, 'Tab'), ' complete'), h('span', {}, '@name  #group  @all'), h('span', {}, h('kbd', {}, 'Esc'), ' close')));
  root.append(box);
  glassify(box);
  const trig = document.getElementById('cmd-open');
  if (trig && trig.offsetWidth && !document.body.classList.contains('no-anim')) { box.classList.add('morphing'); morphFrom(trig, box, 480); }
  const sel = (window.__selectedConsole && findNode(window.__selectedConsole)) ? [window.__selectedConsole] : [];
  cmdState = { picked: new Set(sel), active: 0, items: [] };
  root.classList.remove('closing');
  const close = () => {
    cmdState = null;
    root.classList.add('closing');
    setTimeout(() => { root.classList.add('hidden'); root.classList.remove('closing'); root.innerHTML = ''; }, document.body.classList.contains('no-anim') ? 0 : 140);
  };
  root.onpointerdown = (e) => { if (e.target === root) close(); };

  const renderTargets = () => {
    targets.innerHTML = '';
    const cs = consoles();
    if (!cs.length) return;
    const groups = [...new Set(cs.map(c => c.data.group).filter(Boolean))];
    const chip = (label, on, fn) => h('span', { class: 'chip' + (on ? ' on' : ''), onclick: () => { fn(); renderTargets(); input.focus(); } }, label);
    const allOn = cs.every(c => cmdState.picked.has(c.id));
    targets.append(chip('All', allOn, () => { if (allOn) cmdState.picked.clear(); else cs.forEach(c => cmdState.picked.add(c.id)); }));
    for (const g of groups) {
      const mem = cs.filter(c => c.data.group === g);
      const on = mem.every(c => cmdState.picked.has(c.id));
      targets.append(chip('#' + g, on, () => mem.forEach(c => on ? cmdState.picked.delete(c.id) : cmdState.picked.add(c.id))));
    }
    for (const c of cs) targets.append(chip(c.title, cmdState.picked.has(c.id), () => cmdState.picked.has(c.id) ? cmdState.picked.delete(c.id) : cmdState.picked.add(c.id)));
  };

  const renderList = () => {
    const v = input.value;
    const items = suggestions(v);
    cmdState.items = items;
    cmdState.active = Math.min(cmdState.active, Math.max(0, items.length - 1));
    list.innerHTML = '';
    items.forEach((it, i) => list.append(h('div', { class: 'cmd-item' + (i === cmdState.active ? ' active' : ''), onpointerdown: (e) => { e.preventDefault(); cmdState.active = i; runItem(it); } },
      h('span', { class: 'ci' }, it.icon || '›'), h('span', { class: 'cl' }, it.label), it.desc ? h('span', { class: 'cd' }, it.desc) : null)));
  };

  const runItem = async (it) => {
    if (it.complete) { input.value = it.complete; cmdState.active = 0; renderList(); input.focus(); return; }
    if (it.run) { const keep = await it.run(input.value); if (!keep) close(); }
  };

  input.addEventListener('input', () => { cmdState.active = 0; renderList(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); cmdState.active = Math.min(cmdState.items.length - 1, cmdState.active + 1); renderList(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cmdState.active = Math.max(0, cmdState.active - 1); renderList(); }
    else if (e.key === 'Tab') { e.preventDefault(); const it = cmdState.items[cmdState.active]; if (it && it.complete) { input.value = it.complete; renderList(); } }
    else if (e.key === 'Enter') { e.preventDefault(); const it = cmdState.items[cmdState.active]; if (it) runItem(it); }
  });
  input.value = prefill;
  renderTargets(); renderList();
  setTimeout(() => input.focus(), 10);
}

function byName(name) {
  const q = name.toLowerCase();
  const cs = consoles();
  return cs.find(c => c.title.toLowerCase() === q) || cs.find(c => c.title.toLowerCase().startsWith(q));
}

// Parse "@a @b #g message" -> {ids, text}
function parseTargets(v) {
  const ids = new Set();
  let rest = v.trimStart();
  for (;;) {
    const m = rest.match(/^([@#])([^\s]+)\s*/);
    if (!m) break;
    if (m[1] === '@' && m[2].toLowerCase() === 'all') consoles().forEach(c => ids.add(c.id));
    else if (m[1] === '#') consoles().filter(c => (c.data.group || '').toLowerCase() === m[2].toLowerCase()).forEach(c => ids.add(c.id));
    else { const c = byName(m[2]); if (!c) break; ids.add(c.id); }
    rest = rest.slice(m[0].length);
  }
  return { ids: [...ids], text: rest };
}

const COMMANDS = [
  { cmd: '/spawn', args: '<agent> [count]', desc: 'Spawn agent consoles', icon: '›_' },
  { cmd: '/welcome', desc: 'Show the welcome screen again', icon: '✦' },
  { cmd: '/manager', desc: 'Add a Manager that runs your groups and terminals', icon: '◎' },
  { cmd: '/handoff', args: '<from> <to>', desc: 'Hand work from one agent to another', icon: '⇄' },
  { cmd: '/loop', args: '<name>', desc: 'Set up a loop on a console', icon: '↻' },
  { cmd: '/focus', args: '<name>', desc: 'Fly to a console', icon: '◎' },
  { cmd: '/interrupt', args: '<name|all>', desc: 'Press Esc in a console (stops Claude Code / Codex)', icon: '⏹' },
  { cmd: '/memory', desc: 'Push project memory to the picked consoles', icon: '✦' },
  { cmd: '/note', args: '<text>', desc: 'Add a sticky note', icon: '▤' },
  { cmd: '/web', args: '<url or port>', desc: 'Add a web tile', icon: '◍' },
  { cmd: '/kill', args: '<name>', desc: 'Close a console', icon: '✕' },
  { cmd: '/fit', desc: 'Fit the whole board on screen', icon: '⤢' },
  { cmd: '/agents', desc: 'Agents setup: installed and signed in', icon: '☰' },
];

function suggestions(v) {
  const out = [];
  const t = v.trim();
  if (t.startsWith('/')) {
    const [c, ...rest] = t.split(/\s+/);
    const arg = rest.join(' ');
    const exact = COMMANDS.find(x => x.cmd === c);
    if (exact && (rest.length || v.endsWith(' '))) return commandItems(exact, rest, arg);
    for (const x of COMMANDS.filter(x => x.cmd.startsWith(c))) out.push({ label: x.cmd + (x.args ? ' ' + x.args : ''), desc: x.desc, icon: x.icon, complete: x.cmd + ' ', run: !x.args ? () => runCommand(x.cmd, []) : null });
    return out;
  }
  // @mention completion
  const mm = v.match(/(?:^|\s)@([^\s]*)$/);
  if (mm) {
    const q = mm[1].toLowerCase();
    const base = v.slice(0, v.length - mm[1].length);
    out.push({ label: '@all', desc: 'every console on this board', icon: '@', complete: base + 'all ' });
    for (const c of consoles().filter(c => c.title.toLowerCase().startsWith(q))) out.push({ label: '@' + c.title, desc: agentByKey(c.data.agent, S.data.customAgents).name + ' · ' + STATUS_LABEL[statusOf(c.id)], icon: '@', complete: base + c.title + ' ' });
    return out;
  }
  const gm = v.match(/(?:^|\s)#([^\s]*)$/);
  if (gm) {
    const base = v.slice(0, v.length - gm[1].length);
    for (const g of [...new Set(consoles().map(c => c.data.group).filter(Boolean))].filter(g => g.toLowerCase().startsWith(gm[1].toLowerCase()))) out.push({ label: '#' + g, desc: 'team', icon: '#', complete: base + g + ' ' });
    return out;
  }
  const { ids, text } = parseTargets(v);
  const targetIds = ids.length ? ids : [...cmdState.picked];
  if (t) {
    if (targetIds.length) {
      const names = targetIds.map(id => findNode(id)?.node.title).filter(Boolean);
      out.push({ label: `Send to ${names.length > 3 ? names.length + ' agents' : names.join(', ')}`, desc: text.length > 40 ? text.slice(0, 40) + '…' : text, icon: '↵', run: () => { let n = 0; for (const id of targetIds) if (sendTo(id, text)) n++; toast(n ? `Sent to ${n} agent${n > 1 ? 's' : ''}` : 'No running agents to send to', n ? '' : 'warn'); } });
    } else out.push({ label: 'Pick who to send to', desc: 'click a chip above, or start with @name / #team / @all', icon: '?', run: () => true });
  } else {
    for (const x of COMMANDS.slice(0, 6)) out.push({ label: x.cmd + (x.args ? ' ' + x.args : ''), desc: x.desc, icon: x.icon, complete: x.cmd + ' ' });
  }
  return out;
}

function commandItems(x, rest, arg) {
  const names = consoles();
  const filt = (q) => names.filter(c => c.title.toLowerCase().startsWith((q || '').toLowerCase()));
  switch (x.cmd) {
    case '/spawn': {
      const q = (rest[0] || '').toLowerCase();
      const count = Math.min(12, Math.max(1, parseInt(rest[1]) || 1));
      return agentList(S.data.customAgents).filter(a => a.key.startsWith(q) || a.name.toLowerCase().startsWith(q))
        .map(a => ({ label: `Spawn ${count > 1 ? count + '× ' : ''}${a.name}`, desc: a.cmd && !S.installed[a.cmd] ? 'not installed' : '', icon: '›_', run: () => { for (let i = 0; i < count; i++) spawn(a.key); } }));
    }
    case '/focus': case '/loop': case '/kill':
      return filt(rest[0]).map(c => ({ label: `${x.cmd.slice(1)} ${c.title}`, icon: x.icon, run: () => runCommand(x.cmd, [c.title]) }));
    case '/interrupt':
      return [{ label: 'interrupt all', icon: x.icon, run: () => runCommand(x.cmd, ['all']) }, ...filt(rest[0]).map(c => ({ label: `interrupt ${c.title}`, icon: x.icon, run: () => runCommand(x.cmd, [c.title]) }))];
    case '/handoff': {
      if (rest.length <= 1) return filt(rest[0]).map(c => ({ label: `handoff from ${c.title} to…`, icon: x.icon, complete: `/handoff ${c.title} ` }));
      const from = byName(rest[0]);
      const opts = filt(rest[1]).filter(c => c !== from).map(c => ({ label: `${rest[0]} → ${c.title}`, icon: x.icon, run: () => runCommand(x.cmd, [rest[0], c.title]) }));
      return opts.concat(agentList(S.data.customAgents).filter(a => a.cmd && a.key.startsWith(rest[1].toLowerCase())).map(a => ({ label: `${rest[0]} → new ${a.name}`, icon: x.icon, run: () => runCommand(x.cmd, [rest[0], 'new:' + a.key]) })));
    }
    case '/note': case '/web':
      return [{ label: `${x.cmd} ${arg}`, icon: x.icon, run: () => runCommand(x.cmd, rest, arg) }];
    default:
      return [{ label: x.cmd, desc: x.desc, icon: x.icon, run: () => runCommand(x.cmd, rest, arg) }];
  }
}

async function runCommand(cmd, args, arg = '') {
  const w = ws();
  switch (cmd) {
    case '/manager': addNode('manager'); break;
    case '/prompter': addNode('prompter'); break;
    case '/secretary': addNode('secretary'); break;
    case '/welcome': window.__argonOnboard && window.__argonOnboard(); break;
    case '/fit': fitAll(); break;
    case '/agents': openAgentsSetup(); break;
    case '/memory': pushMemory(cmdState ? [...cmdState.picked] : [], w); break;
    case '/note': addNode('note', { text: arg }); break;
    case '/web': addNode('web', { url: arg || 'http://localhost:3000' }); break;
    case '/focus': { const c = byName(args[0]); if (c) { select(c.id); flyTo(c); } break; }
    case '/loop': { const c = byName(args[0]); if (c) openLoopEditor(c); break; }
    case '/kill': { const c = byName(args[0]); if (c) removeNode(c.id); break; }
    case '/interrupt': {
      const list = args[0] === 'all' ? consoles() : [byName(args[0])].filter(Boolean);
      list.forEach(c => window.argon.pty.write(c.id, '\x1b'));
      toast(`Interrupted ${list.length}`);
      break;
    }
    case '/handoff': {
      const from = byName(args[0]);
      if (!from) { toast('No console named ' + args[0], 'warn'); break; }
      let to;
      if (args[1].startsWith('new:')) { const a = agentByKey(args[1].slice(4), S.data.customAgents); to = addNode('console', { agent: a.key, group: from.data.group }, { x: from.x + from.w + 40, y: from.y, w: from.w, h: from.h }); }
      else to = byName(args[1]);
      if (to) startHandoff(from, to, w);
      break;
    }
  }
}

// ---------- loops ----------
export function openLoopEditor(node) {
  const L = node.data.loop || { on: false, mode: 'idle', idleSec: 20, every: 10, prompt: '', maxRuns: 0, goal: '', runs: 0 };
  const mode = h('select', {}, h('option', { value: 'idle' }, 'When the agent goes idle'), h('option', { value: 'interval' }, 'On a schedule'));
  mode.value = L.mode;
  const idle = h('input', { type: 'number', min: 2, value: L.idleSec, style: { width: '90px' } });
  const every = h('input', { type: 'number', min: 0.25, step: 0.25, value: L.every, style: { width: '90px' } });
  const prompt = h('textarea', { rows: 4, placeholder: 'e.g. Run the tests. Fix the first failure. If all tests pass, say ALL GREEN.', style: { width: '100%', resize: 'vertical' } }); prompt.value = L.prompt;
  const goal = h('input', { type: 'text', placeholder: 'e.g. ALL GREEN', value: L.goal });
  const max = h('input', { type: 'number', min: 0, value: L.maxRuns, style: { width: '90px' } });
  const idleRow = h('div', { class: 'field' }, h('label', {}, 'Idle for (seconds)'), idle);
  const everyRow = h('div', { class: 'field' }, h('label', {}, 'Every (minutes)'), every);
  const sync = () => { idleRow.style.display = mode.value === 'idle' ? '' : 'none'; everyRow.style.display = mode.value === 'interval' ? '' : 'none'; };
  mode.onchange = sync;
  const apply = (on) => {
    node.data.loop = { on, mode: mode.value, idleSec: +idle.value || 20, every: +every.value || 10, prompt: prompt.value.trim(), goal: goal.value.trim(), maxRuns: +max.value || 0, runs: on && !L.on ? 0 : (L.runs || 0), lastRun: on && !L.on ? 0 : L.lastRun };
    save(); emit('loop', node.id); m.close();
    toast(on ? `Loop started on ${node.title}` : `Loop stopped on ${node.title}`);
  };
  const m = modal({
    title: `Loop · ${node.title}`, sub: 'Send the same prompt again and again until a goal is met.',
    body: h('div', {},
      h('div', { class: 'field' }, h('label', {}, 'Trigger'), mode), idleRow, everyRow,
      h('div', { class: 'field' }, h('label', {}, 'Prompt'), prompt),
      h('div', { class: 'row', style: { gap: '14px' } },
        h('div', { class: 'field', style: { flex: 1 } }, h('label', {}, 'Stop when the output contains'), goal, h('span', { class: 'hint' }, 'Tell the agent to say this phrase when done.')),
        h('div', { class: 'field' }, h('label', {}, 'Max runs (0 = no limit)'), max)),
      L.on ? h('div', { class: 'hint' }, `Running · ${L.runs || 0} runs so far`) : null),
    foot: [
      L.on ? h('button', { class: 'btn danger', onclick: () => apply(false) }, 'Stop loop') : h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: () => { if (!prompt.value.trim()) { prompt.focus(); return; } apply(true); } }, L.on ? 'Update loop' : 'Start loop')],
  });
  sync();
}

// ---------- handoff ----------
export function openHandoff(node, w) {
  const others = w.nodes.filter(n => n.type === 'console' && n.id !== node.id);
  const sel = h('select', {},
    ...others.map(o => h('option', { value: 'id:' + o.id }, o.title)),
    ...agentList(S.data.customAgents).filter(a => a.cmd).map(a => h('option', { value: 'new:' + a.key }, 'New ' + a.name)));
  const m = modal({
    title: `Hand off from ${node.title}`, sub: `${node.title} writes a brief into .argon/handoffs/, then the next agent is told to read it and carry on.`,
    body: h('div', { class: 'field' }, h('label', {}, 'Hand off to'), sel),
    foot: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => {
      let to;
      if (sel.value.startsWith('new:')) to = addNode('console', { agent: sel.value.slice(4), group: node.data.group }, { x: node.x + node.w + 40, y: node.y, w: node.w, h: node.h });
      else to = findNode(sel.value.slice(3))?.node;
      if (to) startHandoff(node, to, w);
      m.close();
    } }, 'Start handoff')],
  });
}

// ---------- memory ----------
export function pushMemory(ids, w) {
  const mem = [S.data.memory.global, S.data.memory.repos[w.cwd]].filter(s => s && s.trim()).join('\n\n');
  if (!mem) { toast('Project memory is empty. Add some in ✦ Memory.', 'warn'); openMemory(); return; }
  if (!ids.length) { toast('Pick consoles first.', 'warn'); return; }
  let n = 0;
  for (const id of ids) if (sendTo(id, `Project notes for context (no action needed, just remember these):\n${mem}`)) n++;
  toast(`Pushed memory to ${n} console${n === 1 ? '' : 's'}`);
}

export function openMemory() {
  const w = ws();
  const g = h('textarea', { rows: 6, style: { width: '100%', resize: 'vertical' }, placeholder: 'Things every agent should know, on every project.' }); g.value = S.data.memory.global || '';
  const r = h('textarea', { rows: 8, style: { width: '100%', resize: 'vertical' }, placeholder: 'Conventions, commands, gotchas for this repo.' }); r.value = S.data.memory.repos[w.cwd] || '';
  const pick = new Set();
  const chips = h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px' } }, ...consoles(w).map(c => { const ch = h('span', { class: 'chip', onclick: () => { pick.has(c.id) ? pick.delete(c.id) : pick.add(c.id); ch.classList.toggle('on'); } }, c.title); return ch; }));
  const store = () => { S.data.memory.global = g.value; S.data.memory.repos[w.cwd] = r.value; save(); };
  g.oninput = r.oninput = store;
  const m = modal({
    title: 'Project memory', sub: 'Kept on this PC. Nothing reaches a console unless you push it.', wide: true,
    body: h('div', {},
      h('div', { class: 'field' }, h('label', {}, 'Global'), g),
      h('div', { class: 'field' }, h('label', {}, 'This repo · ' + (w.cwd || 'no folder')), r),
      consoles(w).length ? h('div', { class: 'field' }, h('label', {}, 'Push to'), chips) : null),
    foot: [h('button', { class: 'btn', onclick: () => m.close() }, 'Done'), h('button', { class: 'btn primary', onclick: () => { store(); pushMemory([...pick], w); } }, 'Push to selected')],
  });
}

// ---------- usage ----------
export async function openUsage() {
  const body = h('div', {}, 'Reading local session logs…');
  modal({ title: 'Usage and tokens', sub: 'Read from Claude Code and Codex logs on this PC. Nothing is uploaded.', body, wide: true });
  const data = await window.argon.usage(14);
  const days = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000); days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`); }
  const tot = (a, k) => days.reduce((s, d) => s + ((data[d] && data[d][a] && data[d][a][k]) || 0), 0);
  const fmt = (n) => n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
  const dayTotal = (d) => ['claude', 'codex'].reduce((s, a) => s + (data[d] && data[d][a] ? data[d][a].input + data[d][a].output : 0), 0);
  const max = Math.max(1, ...days.map(dayTotal));
  const C = { claude: '#d9a07a', codex: '#8fd1c0' };
  body.innerHTML = '';
  body.append(
    h('div', { class: 'stat-row' },
      h('div', { class: 'stat' }, h('b', {}, fmt(tot('claude', 'input') + tot('claude', 'output'))), h('span', {}, 'Claude Code tokens · 14 days')),
      h('div', { class: 'stat' }, h('b', {}, fmt(tot('codex', 'input') + tot('codex', 'output'))), h('span', {}, 'Codex tokens · 14 days')),
      h('div', { class: 'stat' }, h('b', {}, fmt(tot('claude', 'cache') + tot('codex', 'cache'))), h('span', {}, 'Cached tokens (cheaper)'))),
    h('div', { class: 'usage-chart' }, ...days.map(d => {
      const x = data[d] || {};
      const tip = `${d}\nClaude ${fmt(x.claude ? x.claude.input + x.claude.output : 0)}\nCodex ${fmt(x.codex ? x.codex.input + x.codex.output : 0)}`;
      return h('div', { class: 'ubar', 'data-tip': tip }, ...['claude', 'codex'].map(a => h('i', { style: { height: ((x[a] ? x[a].input + x[a].output : 0) / max * 100) + '%', background: C[a] } })));
    })),
    h('div', { class: 'ulabels' }, ...days.map(d => h('span', {}, d.slice(8)))),
    h('div', { class: 'legend' }, h('span', {}, h('i', { style: { background: C.claude } }), 'Claude Code'), h('span', {}, h('i', { style: { background: C.codex } }), 'Codex'), h('span', { style: { color: 'var(--dim)' } }, 'Input + output, not counting cache reads')),
    h('div', { class: 'field' }, h('div', { class: 'hint' }, 'For your plan’s live limits, type /usage inside a Claude Code console, or /status inside Codex.')));
}

// ---------- settings: every customization, organized in panes ----------
let lastPane = 'look';

function segCtl(options, get, setv) {
  const s = h('div', { class: 'seg' });
  const pill = h('div', { class: 'seg-pill' });
  s.append(pill);
  const place = (instant) => {
    const on = s.querySelector('button.on');
    if (!on || !on.offsetWidth) { pill.style.opacity = '0'; return; }
    pill.style.opacity = '1';
    if (instant) pill.style.transition = 'none';
    pill.style.width = on.offsetWidth + 'px';
    pill.style.transform = `translateX(${on.offsetLeft - 3}px)`;
    pill.style.left = '3px';
    if (instant) { void pill.offsetWidth; pill.style.transition = ''; }
  };
  for (const [val, label] of options) {
    const b = h('button', { class: get() === val ? 'on' : '', onclick: () => { setv(val); s.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); place(false); } }, label);
    s.append(b);
  }
  new ResizeObserver(() => place(true)).observe(s);
  return s;
}

function switchCtl(get, setv) {
  const cb = h('input', { type: 'checkbox', class: 'switch' });
  cb.checked = !!get();
  cb.onchange = () => setv(cb.checked);
  return cb;
}

function rangeCtl(min, max, step, get, setv, fmt = (v) => v, live = true) {
  const val = h('span', { class: 'range-val' });
  const r = h('input', { type: 'range', class: 'slider', min, max, step, value: get() });
  const paint = () => { r.style.setProperty('--pct', ((r.value - min) / (max - min)) * 100 + '%'); val.textContent = fmt(+r.value); };
  let raf = 0;
  r.addEventListener('input', () => {
    paint();
    if (!live) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => setv(+r.value, false));
  });
  r.addEventListener('change', () => setv(+r.value, true));
  paint();
  return h('div', { class: 'sr-ctl' }, r, val);
}

function selectCtl(options, get, setv, fontPreview = false) {
  const s = h('select', { onchange: () => setv(s.value) }, ...options.map(([v, l]) => {
    const o = h('option', { value: v }, l);
    if (fontPreview) o.style.fontFamily = `"${v}"`;
    if (v === get()) o.selected = true;
    return o;
  }));
  return s;
}

const row = (title, desc, ctl) => h('div', { class: 'set-row' }, h('div', { class: 'sr-text' }, h('b', {}, title), desc ? h('span', {}, desc) : null), ctl);
const stackRow = (title, desc, ctl) => h('div', { class: 'set-row stack' }, h('div', { class: 'sr-text' }, h('b', {}, title), desc ? h('span', {}, desc) : null), ctl);
const group = (title, ...rows) => [title ? h('div', { class: 'set-group-title' }, title) : null, h('div', { class: 'set-group' }, ...rows)];

function lookPane(ctx) {
  const L = look();
  const { changed, rerender } = ctx;
  const name = h('input', { type: 'text', value: L.name, placeholder: 'What should Argon call you?', style: { width: '230px' } });
  name.addEventListener('input', () => { L.name = name.value.trim().slice(0, 30); save(); greet(); });

  const looks = h('div', { class: 'card-grid' });
  for (const lk of LOOKS) {
    const t = THEMES[lk.set.theme];
    const c = h('button', { class: 'pick-card', onclick: () => { Object.assign(L, lk.set); changed(); rerender(); toast(`Applied ${lk.name}`); } },
      h('div', { class: 'pc-prev', style: { background: lk.set.bgColor || t.bg2 } },
        h('div', { class: 'mini-bar' }), h('div', { class: 'mini-tile', style: { background: t.panel + 'cc' } }), h('div', { class: 'mini-tile b', style: { background: lk.set.accent } })),
      h('b', {}, lk.name), h('small', {}, `${t.name} · ${lk.set.glass}`));
    looks.append(c);
  }

  const themes = h('div', { class: 'card-grid' });
  for (const [key, t] of Object.entries(THEMES)) {
    const c = h('button', { class: 'pick-card' + (L.theme === key ? ' on' : ''), onclick: () => { L.theme = key; themes.querySelectorAll('.pick-card').forEach(x => x.classList.toggle('on', x === c)); changed(); } },
      h('div', { class: 'pc-prev', style: { background: t.bg } },
        h('div', { class: 'mini-bar', style: { background: t.light ? 'rgba(255,255,255,.8)' : 'rgba(255,255,255,.12)' } }),
        h('div', { class: 'mini-tile', style: { background: t.panel } }), h('div', { class: 'mini-tile b', style: { background: t.panel2 } })),
      h('b', {}, t.name), h('small', {}, t.light ? 'Light' : 'Dark'));
    themes.append(c);
  }

  const sw = h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap' } });
  const custom = h('input', { type: 'color', class: 'color-well', value: L.accent, title: 'Any color' });
  const paintSw = () => sw.querySelectorAll('.swatch').forEach(x => x.classList.toggle('on', x.dataset.hex.toLowerCase() === L.accent.toLowerCase()));
  for (const a of ACCENTS) sw.append(h('button', { class: 'swatch', 'data-hex': a.hex, title: a.name, 'aria-label': a.name, style: { background: a.hex }, onclick: () => { L.accent = a.hex; custom.value = a.hex; paintSw(); changed(); } }));
  custom.addEventListener('input', () => { L.accent = custom.value; paintSw(); applyAppearance(); });
  custom.addEventListener('change', () => { L.accent = custom.value; changed(); });
  sw.append(custom);
  paintSw();

  return [
    h('div', { class: 'pane-title' }, 'Look'), h('div', { class: 'pane-sub' }, 'Pick a ready-made look, or set the theme and accent yourself. Changes apply live.'),
    ...group('', row('Your name', 'Argon greets you on an empty board.', name), row('Greeting', 'Show “Good evening” on empty boards.', switchCtl(() => L.greeting, (v) => { L.greeting = v; changed(); }))),
    h('div', { class: 'set-group-title' }, 'Looks'), looks,
    h('div', { class: 'set-group-title' }, 'Theme'), themes,
    ...group('Accent color', stackRow('Accent', 'Used for highlights, the working glow and buttons.', sw),
      row('Tint the window', 'How much the accent colors the background, panels and lines. 0 keeps the theme neutral.', rangeCtl(0, 100, 1, () => L.accentTint ?? 55, (v, done) => { L.accentTint = v; applyAppearance(); if (done) save(); }, (v) => v + '%'))),
  ];
}

function glassPane({ changed }) {
  const L = look();
  const live = (k) => (v, done) => { L[k] = v; applyAppearance(); if (done) save(); };
  return [
    h('div', { class: 'pane-title' }, 'Liquid glass'), h('div', { class: 'pane-sub' }, 'The material for bars, panels, menus and tiles. Glass bends and blurs whatever is behind it.'),
    ...group('Material',
      stackRow('Style', 'Liquid is clear glass with a thick, lensed rim. Frosted blurs what is behind. Tinted takes on your accent. Solid turns glass off.', segCtl([['liquid', 'Liquid'], ['frosted', 'Frosted'], ['tinted', 'Tinted'], ['solid', 'Solid']], () => L.glass, (v) => { L.glass = v; changed(); })),
      row('Blur', 'Clear glass keeps this low.', rangeCtl(0, 30, 1, () => L.blur, live('blur'), (v) => v + 'px')),
      row('Tint', 'How see-through glass is.', rangeCtl(0, 100, 1, () => L.tint, live('tint'), (v) => v + '%')),
      row('Shadow depth', 'How far panels float above the board.', rangeCtl(0, 100, 1, () => L.shadow, live('shadow'), (v) => v + '%'))),
    ...group('Light',
      row('Refraction', 'Edges bend what is behind the glass like a lens.', switchCtl(() => L.refraction, (v) => { L.refraction = v; changed(); })),
      row('Refraction strength', '', rangeCtl(0, 100, 1, () => L.refractStrength, (v, done) => { if (done) { L.refractStrength = v; changed(); } }, (v) => v + '%', false)),
      row('Chromatic aberration', 'A little red and blue split in what you see through the glass, strongest at the rim.', rangeCtl(0, 100, 1, () => L.aberration, (v, done) => { L.aberration = v; applyAppearance(); if (done) save(); }, (v) => v + '%')),
      row('Highlights', 'Bright rims and a glare that follows your pointer.', switchCtl(() => L.specular, (v) => { L.specular = v; changed(); }))),
    ...group('Where',
      row('Glass tiles', 'Checklists, kanban, calendar, files and git cards become glass too.', switchCtl(() => L.glassTiles, (v) => { L.glassTiles = v; changed(); }))),
  ];
}

function backgroundPane({ changed }) {
  const L = look();
  const sw = h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap' } });
  const custom = h('input', { type: 'color', class: 'color-well', value: L.bgColor || (THEMES[L.theme] || THEMES.midnight).bg2, title: 'Any color' });
  const paint = () => sw.querySelectorAll('.swatch').forEach(x => x.classList.toggle('on', x.dataset.hex.toLowerCase() === (L.bgColor || '').toLowerCase()));
  for (const [hex, label] of BG_COLORS) {
    const fill = hex || (THEMES[L.theme] || THEMES.midnight).bg2;
    sw.append(h('button', { class: 'swatch bg-swatch', 'data-hex': hex, title: label, 'aria-label': label, style: { background: fill }, onclick: () => { L.bgColor = hex; if (hex) custom.value = hex; paint(); changed(); } }, hex ? null : h('span', {}, 'A')));
  }
  custom.addEventListener('input', () => { L.bgColor = custom.value; paint(); applyAppearance(); });
  custom.addEventListener('change', () => { L.bgColor = custom.value; changed(); });
  sw.append(custom);
  paint();
  return [
    h('div', { class: 'pane-title' }, 'Background'), h('div', { class: 'pane-sub' }, 'One solid color behind the board. “A” follows your theme.'),
    ...group('Color', stackRow('Background color', 'Pick a swatch or any color you like.', sw)),
    ...group('Board pattern',
      row('Pattern', 'Faint dots or lines that move with the board. None keeps it a plain solid color.', segCtl([['dots', 'Dots'], ['grid', 'Grid'], ['none', 'None']], () => L.pattern, (v) => { L.pattern = v; changed(); })),
      row('Pattern size', '', rangeCtl(12, 48, 2, () => L.patternSize, (v, done) => { L.patternSize = v; applyView(); if (done) save(); }, (v) => v + 'px'))),
    ...(window.argon && window.argon.backdrop ? group('Window',
      row('Windows blur', 'Let Windows blur your desktop behind the board. Drawn by Windows itself, so it costs Argon nothing. Mica needs Windows 11.', segCtl([['off', 'Off'], ['mica', 'Mica'], ['acrylic', 'Acrylic']], () => L.backdrop || 'off', (v) => { L.backdrop = v; changed(); }))) : []),
  ];
}

function terminalPane({ changed }) {
  const L = look();
  const st = S.data.settings;
  const tl = (k) => (v, done) => { L[k] = v; applyAppearance(); applyTerminalLook(); if (done) save(); };
  const cards = h('div', { class: 'card-grid' });
  const sample = (c) => {
    const sp = (color, txt) => h('span', { style: { color } }, txt);
    return h('div', { class: 'pc-prev term-prev', style: { background: c.background, color: c.foreground } },
      sp(c.green, '❯ '), 'claude', '\n', sp(c.blue, '● '), 'Reading ', sp(c.yellow, 'src/app.js'), '\n', sp(c.magenta, '+ '), sp(c.green, 'added 12 lines'), '\n', sp(c.red, '- '), sp(c.brightBlack, 'removed 3'));
  };
  for (const [key, sc] of Object.entries(TERM_SCHEMES)) {
    const colors = key === 'auto' ? autoTermPreview() : sc;
    const c = h('button', { class: 'pick-card' + (L.termScheme === key ? ' on' : ''), onclick: () => { L.termScheme = key; cards.querySelectorAll('.pick-card').forEach(x => x.classList.toggle('on', x === c)); changed(); } }, sample(colors), h('b', {}, sc.name));
    cards.append(c);
  }
  return [
    h('div', { class: 'pane-title' }, 'Terminal'), h('div', { class: 'pane-sub' }, 'Colors, type and cursor for every agent console.'),
    h('div', { class: 'set-group-title' }, 'Color scheme'), cards,
    ...group('Type',
      row('Font', '', selectCtl(FONTS.map(f => [f, f]), () => L.termFont, (v) => { L.termFont = v; changed(); }, true)),
      row('Size', '', rangeCtl(9, 22, 1, () => st.fontSize || 13, (v, done) => { st.fontSize = v; applyTerminalLook(); if (done) save(); }, (v) => v + 'px')),
      row('Line height', '', rangeCtl(1, 1.8, 0.05, () => L.lineHeight, tl('lineHeight'), (v) => v.toFixed(2))),
      row('Letter spacing', '', rangeCtl(-1, 3, 0.5, () => L.letterSpacing, tl('letterSpacing'), (v) => v + 'px'))),
    ...group('Cursor',
      row('Shape', '', segCtl([['block', 'Block'], ['bar', 'Bar'], ['underline', 'Underline']], () => L.cursor, (v) => { L.cursor = v; changed(); })),
      row('Blink', '', switchCtl(() => L.cursorBlink, (v) => { L.cursorBlink = v; changed(); }))),
    ...group('Surface',
      row('Opacity', 'Below 100%, consoles turn to glass and the backdrop shows through.', rangeCtl(30, 100, 1, () => L.termOpacity, (v, done) => { L.termOpacity = v; applyAppearance(); if (done) save(); }, (v) => v + '%')),
      row('Padding', '', rangeCtl(0, 16, 1, () => L.termPadding, tl('termPadding'), (v) => v + 'px'))),
  ];
}

function layoutPane({ changed }) {
  const L = look();
  const after = () => { changed(); setTimeout(() => { refitAll(); rebuildGlass(); }, 520); };
  return [
    h('div', { class: 'pane-title' }, 'Layout'), h('div', { class: 'pane-sub' }, 'Where things sit and how big they are.'),
    ...group('Bars',
      row('Style', 'Floating bubbles hover over the board. Classic pins bars to the window edges.', segCtl([['floating', 'Floating'], ['classic', 'Classic']], () => L.layout, (v) => { L.layout = v; after(); })),
      row('Dock position', '', segCtl([['left', 'Left'], ['bottom', 'Bottom'], ['right', 'Right']], () => L.dock, (v) => { L.dock = v; after(); })),
      row('Density', '', segCtl([['comfortable', 'Comfortable'], ['compact', 'Compact']], () => L.density, (v) => { L.density = v; after(); }))),
    ...group('Shape and size',
      row('Roundness', 'Corners of tiles, panels and bars.', rangeCtl(0, 26, 1, () => L.radius, (v, done) => { L.radius = v; applyAppearance(); if (done) { save(); rebuildGlass(); } }, (v) => v + 'px')),
      row('Interface size', 'Scales the whole window.', rangeCtl(75, 140, 5, () => L.uiScale, (v, done) => { if (done) { L.uiScale = v; changed(); setTimeout(() => { refitAll(); rebuildGlass(); }, 200); } }, (v) => v + '%', false)),
      row('Interface font', '', selectCtl(UI_FONTS.map(f => [f, f.replace(' Variable Text', '')]), () => L.uiFont, (v) => { L.uiFont = v; changed(); }, true))),
  ];
}

function motionPane({ changed }) {
  const L = look();
  return [
    h('div', { class: 'pane-title' }, 'Motion'), h('div', { class: 'pane-sub' }, 'How Argon moves: springs, glides and morphs.'),
    ...group('',
      row('Animations', 'Panels that grow from their buttons, springy tiles, smooth zoom.', switchCtl(() => L.animations, (v) => { L.animations = v; changed(); })),
      row('Speed', '', segCtl([['relaxed', 'Relaxed'], ['normal', 'Normal'], ['snappy', 'Snappy']], () => L.motion, (v) => { L.motion = v; changed(); })),
      row('Springy bounce', 'A little overshoot, like things have weight. Off for plain easing.', switchCtl(() => L.bounce, (v) => { L.bounce = v; changed(); }))),
  ];
}

function consolesPane() {
  const st = S.data.settings;
  const tog = (key, title, desc) => row(title, desc, switchCtl(() => st[key], async (v) => {
    if (key === 'autoApprove' && v) {
      const ok = await confirmBox('Turn on auto-approve?', 'New agent consoles will start with flags that skip permission prompts (for example --dangerously-skip-permissions). Agents can then edit files and run commands without asking.', 'Turn on');
      if (!ok) { pane.querySelector('[data-k="autoApprove"]').checked = false; return; }
    }
    st[key] = v; save();
  }));
  const pane = h('div');
  const auto = tog('autoApprove', 'Auto-approve agent actions', 'Off by default. Starts agents with their skip-permissions flag and presses Yes on prompts in consoles already running. Commands that delete or force-push still wait for you.');
  auto.querySelector('input').dataset.k = 'autoApprove';
  pane.append(
    h('div', { class: 'pane-title' }, 'Consoles'), h('div', { class: 'pane-sub' }, 'How agent consoles start and report back.'),
    ...group('',
      tog('resumeOnLaunch', 'Resume sessions on launch', 'When Argon reopens, each console relaunches in place and continues its last session.'),
      tog('notify', 'Notify me when an agent needs me', 'Shows a Windows notification when Argon is in the background.'),
      auto,
      row('Answer questions with buttons', 'When an agent asks (Yes / No, numbered choices), a card with buttons and a diff preview pops over its console.', switchCtl(() => st.askButtons !== false, (v) => { st.askButtons = v; save(); })),
      row('Hold Space to talk', 'Hold Space on the board to dictate into the command bar. Falls back to Windows voice typing.', switchCtl(() => st.holdToTalk !== false, (v) => { st.holdToTalk = v; save(); })),
      row('Agents can use the board', 'Agents see the board through .argon/board/BOARD.md in your project and can add notes, checklists and tiles, move things, and group or wire each other.', switchCtl(() => st.boardForAgents !== false, (v) => { st.boardForAgents = v; save(); })),
      row('Idle after', 'Seconds of quiet before a console counts as resting.', rangeCtl(1, 30, 1, () => st.idleSeconds || 4, (v, done) => { st.idleSeconds = v; if (done) save(); }, (v) => v + 's'))));
  return [pane];
}

function accountsPane() {
  const custom = h('div');
  const renderCustom = () => {
    custom.innerHTML = '';
    const rows = S.data.customAgents.map(c => row(c.name, c.cmd, h('button', { class: 'tile-btn danger', title: 'Remove', onclick: () => { S.data.customAgents = S.data.customAgents.filter(x => x !== c); save(); renderCustom(); } }, '✕')));
    custom.append(...group('Custom agents', ...(rows.length ? rows : [row('None yet', 'Add any command-line agent.', h('span'))]), h('div', { class: 'set-row' }, h('span'), h('button', { class: 'btn sm', onclick: async () => { await addCustomAgent(); renderCustom(); } }, '+ Custom agent'))));
  };
  const profs = h('div');
  const renderProfiles = () => {
    profs.innerHTML = '';
    const rows = S.data.profiles.map(p => row(`${agentByKey(p.agent).name} · ${p.name}`, basename(p.dir), h('button', { class: 'tile-btn danger', title: 'Remove', onclick: () => { S.data.profiles = S.data.profiles.filter(x => x !== p); save(); renderProfiles(); } }, '✕')));
    const sel = h('select', {}, ...AGENTS.filter(a => a.profileEnv).map(a => h('option', { value: a.key }, a.name)));
    profs.append(...group('Account profiles', ...(rows.length ? rows : [row('No profiles', 'Run Claude Code or Codex under a second account. Each profile gets its own config folder, and you sign in once inside it.', h('span'))]),
      h('div', { class: 'set-row' }, h('span'), h('div', { class: 'sr-ctl' }, sel, h('button', { class: 'btn sm', onclick: async () => {
        const name = await askText('Profile name', { placeholder: 'e.g. work' });
        if (!name || !name.trim()) return;
        const base = await window.argon.state.dir();
        const dir = `${base}\\profiles\\${sel.value}-${name.trim().replace(/[^\w-]+/g, '-')}`;
        S.data.profiles.push({ id: uid('pf'), name: name.trim(), agent: sel.value, dir });
        save(); renderProfiles();
        toast('Profile added. Spawn it from the + Agent menu and sign in once.');
      } }, '+ Profile')))));
  };
  renderCustom(); renderProfiles();
  return [h('div', { class: 'pane-title' }, 'Agents and accounts'), h('div', { class: 'pane-sub' }, 'Extra accounts and your own agent commands.'), profs, custom,
    ...group('', row('Agents setup', 'See which agents are installed and signed in.', h('button', { class: 'btn sm', onclick: () => openAgentsSetup() }, 'Open')))];
}

function dataPane({ changed, rerender }) {
  const keep = Object.keys(defaults());
  return [
    h('div', { class: 'pane-title' }, 'Data and shortcuts'), h('div', { class: 'pane-sub' }, 'Everything stays on this PC.'),
    ...group('Data',
      row('Data folder', 'Boards are saved as JSON with automatic backups.', h('button', { class: 'btn sm', onclick: async () => window.argon.reveal(await window.argon.state.dir()) }, 'Open folder'))),
    ...group('Appearance',
      row('Copy my look', 'Copies your appearance settings to the clipboard to share or keep.', h('button', { class: 'btn sm', onclick: async () => { const o = { ...look() }; delete o.name; await navigator.clipboard.writeText(JSON.stringify(o)); toast('Look copied'); } }, 'Copy')),
      row('Paste a look', 'Apply appearance settings someone shared with you.', h('button', { class: 'btn sm', onclick: async () => {
        const txt = await askText('Paste a look', { multiline: true, placeholder: '{"theme":"midnight", …}', okLabel: 'Apply' });
        if (!txt) return;
        try { const o = JSON.parse(txt); const L = look(); for (const k of keep) if (k !== 'name' && k in o) L[k] = o[k]; changed(); rerender(); toast('Look applied'); } catch (_) { toast('That doesn’t look like a copied look.', 'err'); }
      } }, 'Paste…')),
      row('Reset appearance', 'Back to Liquid Lavender. Keeps your name.', h('button', { class: 'btn sm danger', onclick: async () => {
        if (!(await confirmBox('Reset appearance?', 'Every look, glass, background, terminal, layout and motion setting goes back to its default.', 'Reset'))) return;
        const n = look().name; S.data.settings.appearance = { ...defaults(), name: n }; changed(); rerender();
      } }, 'Reset'))),
    ...group('Shortcuts', h('div', { class: 'hint', style: { lineHeight: 1.9, padding: '10px 0' } },
      'Ctrl+K command bar · N new agent · Ctrl+M mission map · F fit all · V select · P ink · E eraser · Space+drag or middle-drag to pan · scroll on empty board or Ctrl+scroll to zoom · double-click a title to rename · double-click a header to focus · Delete closes the selected tile · Ctrl+1…9 switch workspace · Ctrl+, settings')),
  ];
}

const PANES = [
  ['look', 'look', 'Look', lookPane], ['glass', 'glass', 'Liquid glass', glassPane], ['background', 'background', 'Background', backgroundPane],
  ['terminal', 'terminal', 'Terminal', terminalPane], ['layout', 'layout', 'Layout', layoutPane], ['motion', 'motion', 'Motion', motionPane],
  ['consoles', 'consoles', 'Consoles', consolesPane], ['accounts', 'agents', 'Agents', accountsPane], ['data', 'data', 'Data', dataPane],
];

export function openSettings(paneKey) {
  if (typeof paneKey === 'string') lastPane = paneKey;
  const nav = h('nav', { class: 'settings-nav' });
  const pill = h('div', { class: 'nav-pill' });
  nav.append(pill);
  const pane = h('div', { class: 'settings-pane' });
  const movePill = (instant) => {
    const on = nav.querySelector('button.on');
    if (!on || !on.offsetHeight) return;
    if (instant) pill.style.transition = 'none';
    pill.style.height = on.offsetHeight + 'px';
    pill.style.transform = `translateY(${on.offsetTop}px)`;
    if (instant) { void pill.offsetWidth; pill.style.transition = ''; }
  };
  const ctx = {
    changed: () => { save(); applyAppearance(); applyTerminalLook(); },
    rerender: () => show(lastPane, true),
  };
  const show = (key, keepScroll) => {
    lastPane = key;
    nav.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === key));
    movePill(false);
    const top = pane.scrollTop;
    pane.innerHTML = '';
    const def = PANES.find(p => p[0] === key) || PANES[0];
    pane.append(...def[3](ctx).filter(Boolean));
    pane.classList.remove('in'); void pane.offsetWidth;
    if (!keepScroll) pane.classList.add('in');
    pane.scrollTop = keepScroll ? top : 0;
  };
  for (const [key, ico, label] of PANES) nav.append(h('button', { 'data-k': key, onclick: () => show(key) }, h('i', {}, iconEl(ico, 16)), label));
  modal({ title: 'Settings', sub: 'Make Argon yours. Everything previews live.', cls: 'settings', peek: true, body: [nav, pane] });
  show(lastPane);
  new ResizeObserver(() => movePill(true)).observe(nav);
}
