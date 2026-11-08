// Argon — renderer entry: state, workspaces, dock, shortcuts.
import { S, ws, save, emit, on, h, toast, defaultState, newWorkspace, basename, findNode, consoles } from './state.js';
import { initBoard, applyView, renderInk, setTool, fitAll, flyTo, tool, isTyping, cycleInk, INK_COLORS, INK_WIDTHS, inkColor, inkWidth, setInk } from './board.js';
import { addNode, addGroup, removeNode, showWorkspace, mountAll, initDrops, select, selectedId } from './tiles.js';
import { startTicking, statusOf, disposeConsole, refitAll } from './consoles.js';
import { renderMission, spawnMenu, openCommandBar, openUsage, openMemory, openSettings, detectInstalled, openAgentsSetup } from './panels.js';
import { askText, confirmBox } from './ui.js';
import { applyAppearance, look, greet } from './appearance.js';
import { glassify, initGlassFx, attachLens } from './glass.js';
import { initManager } from './manager.js';
import { initTeamwork, presetMenu } from './teamwork.js';
import { initMissionMap, openMissionMap } from './missionmap.js';
import { initFlowDots } from './flowdots.js';
import { initBoardApi } from './boardapi.js';
import { initPace } from './pace.js';
import { paintIcons } from './icons.js';
import { openOnboarding } from './onboarding.js';
import { initPipeline, afterMount, applyMode, setMode, inPipe, toggleRun, addStage, pipeSpawnOpts, dropWorkspace } from './pipeline.js';
import { setMorphSource } from './ui.js';

async function boot() {
  const home = await window.argon.home();
  let data = await window.argon.state.load();
  if (!data || !Array.isArray(data.workspaces) || !data.workspaces.length) data = defaultState(home);
  const def = defaultState(home);
  data.settings = { ...def.settings, ...(data.settings || {}) };
  data.customAgents = data.customAgents || [];
  data.profiles = data.profiles || [];
  data.memory = data.memory || { global: '', repos: {} };
  data.memory.repos = data.memory.repos || {};
  for (const w of data.workspaces) { w.nodes = w.nodes || []; w.ink = w.ink || []; w.view = w.view || { x: 80, y: 60, z: 1 }; }
  S.data = data;
  const L = look();
  if (data.settings.showGrid === false && L.bg === 'dots') { L.bg = 'plain'; delete data.settings.showGrid; }
  applyAppearance();
  setInterval(greet, 10 * 60000);
  for (const id of ['topbar', 'dock', 'mission', 'zoomctl']) glassify(document.getElementById(id));
  glassify(document.getElementById('empty-hint'), { refract: false });
  initGlassFx();
  attachLens(document.getElementById('dock'), 'button');
  attachLens(document.querySelector('#topbar .top-actions'), 'button');
  attachLens(document.getElementById('zoomctl'), 'button');

  await detectInstalled();
  initBoard();
  initDrops();
  initManager();   // registers the Manager tile before anything mounts
  for (const w of S.data.workspaces) if (w.mode === 'pipe') { w.mode = 'board'; if (w.views && w.views.board) w.view = w.views.board; } // Pipeline mode was removed
  initPipeline();  // still provides the report helpers and tile hooks
  wireUi();
  mountAll();      // starts every console on every workspace (they keep running in the background)
  afterMount();
  switchWs(ws().id);
  startTicking();
  paintIcons();
  initTeamwork();  // console wires, presets, question buttons, context gauge, dictation
  initMissionMap();
  initPace();
  initFlowDots();
  initBoardApi();
  renderMission();

  // First run (and once for anyone who has not seen it yet): the welcome screen. /welcome brings it back.
  window.__argonOnboard = () => openOnboarding({ onFolder: newWs, onAgents: openAgentsSetup });
  if (!S.data.settings.onboarded) setTimeout(window.__argonOnboard, 400);
}

function switchWs(id) {
  S.data.activeWorkspace = id;
  const w = ws();
  showWorkspace(w);
  applyMode(w);
  applyView();
  renderInk();
  renderTabs();
  renderMission();
  save();
}
on('switchWs', switchWs);
on('view', applyView);
on('tabs', () => renderTabs());
on('fly', (id) => { const f = findNode(id); if (f) { if (f.ws.id !== ws().id) switchWs(f.ws.id); flyTo(f.node); } });

let tabsTimer = 0;
function renderTabs() {
  clearTimeout(tabsTimer);
  tabsTimer = setTimeout(() => {
    const nav = document.getElementById('tabs');
    nav.innerHTML = '';
    S.data.workspaces.forEach((w, i) => {
      const sts = w.nodes.filter(n => n.type === 'console').map(n => statusOf(n.id));
      const dotCls = sts.includes('needs') ? 'needs' : sts.includes('working') ? 'working' : '';
      const tab = h('button', { class: 'tab' + (w.id === ws().id ? ' active' : ''), title: (w.cwd || '') + (i < 9 ? `  (Ctrl+${i + 1})` : ''),
        onclick: () => switchWs(w.id),
        ondblclick: async () => { const t = await askText('Rename workspace', { value: w.name }); if (t && t.trim()) { w.name = t.trim(); save(); renderTabs(); } } },
        h('span', { class: 'tab-dot ' + dotCls }), w.name,
        S.data.workspaces.length > 1 ? h('span', { class: 'tab-x', title: 'Close workspace', onclick: (e) => { e.stopPropagation(); closeWs(w); } }, '✕') : null);
      nav.append(tab);
    });
  }, 30);
}

async function closeWs(w) {
  const running = w.nodes.filter(n => n.type === 'console').length;
  const ok = await confirmBox(`Close workspace “${w.name}”?`, running ? `This stops ${running} console${running > 1 ? 's' : ''} and removes the board.` : 'This removes the board and everything on it.', 'Close workspace');
  if (!ok) return;
  for (const n of w.nodes) if (n.type === 'console') disposeConsole(n.id);
  document.querySelector(`.ws-layer[data-ws="${w.id}"]`)?.remove();
  dropWorkspace(w);
  S.data.workspaces = S.data.workspaces.filter(x => x !== w);
  if (S.data.activeWorkspace === w.id) S.data.activeWorkspace = S.data.workspaces[0].id;
  switchWs(S.data.activeWorkspace);
}

async function newWs() {
  const dir = await window.argon.pickFolder();
  if (!dir) return;
  const existing = S.data.workspaces.find(w => w.cwd === dir);
  if (existing) { switchWs(existing.id); return; }
  const w = newWorkspace(basename(dir), dir);
  S.data.workspaces.push(w);
  switchWs(w.id);
  toast(`Opened ${w.name}`);
}

// ---------- pen palette: pops up beside the pen while it's the active tool ----------
let inkPal = null;
function closeInkPalette() { if (inkPal) { inkPal.remove(); inkPal = null; } }
function inkPalette(btn, toggle) {
  if (inkPal) { if (toggle) { closeInkPalette(); return; } closeInkPalette(); }
  const pal = inkPal = h('div', { class: 'ink-pal nodrag' });
  const paint = () => {
    pal.querySelectorAll('.ink-c').forEach((x) => x.classList.toggle('on', x.dataset.c === inkColor));
    pal.querySelectorAll('.ink-w').forEach((x) => x.classList.toggle('on', +x.dataset.w === inkWidth));
    btn.style.color = inkColor;
  };
  for (const c of INK_COLORS) pal.append(h('button', { class: 'ink-c', 'data-c': c, title: c.startsWith('var') ? 'Accent' : c, style: { background: c }, onclick: () => { setInk(c); paint(); } }));
  const custom = h('input', { type: 'color', class: 'ink-custom', title: 'Any color', value: inkColor.startsWith('#') ? inkColor : '#b9a6ec' });
  custom.addEventListener('input', () => { setInk(custom.value); paint(); });
  pal.append(custom, h('span', { class: 'ink-sep' }));
  for (const wd of INK_WIDTHS) pal.append(h('button', { class: 'ink-w', 'data-w': wd, title: ['Thin', 'Medium', 'Thick'][INK_WIDTHS.indexOf(wd)], onclick: () => { setInk(null, wd); paint(); } }, h('i', { style: { width: wd * 2 + 'px', height: wd * 2 + 'px' } })));
  document.body.append(pal);
  const r = btn.getBoundingClientRect(), pr = pal.getBoundingClientRect();
  const dockBottom = r.top > innerHeight * 0.6, dockRight = r.left > innerWidth * 0.6;
  pal.style.left = Math.max(8, Math.min(innerWidth - pr.width - 8, dockBottom ? r.left + r.width / 2 - pr.width / 2 : dockRight ? r.left - pr.width - 10 : r.right + 10)) + 'px';
  pal.style.top = Math.max(8, dockBottom ? r.top - pr.height - 10 : r.top + r.height / 2 - pr.height / 2) + 'px';
  paint();
}

function wireUi() {
  document.getElementById('tab-add').onclick = newWs;
  document.getElementById('cmd-open').onclick = () => openCommandBar();
  document.getElementById('mission-toggle').onclick = openMissionMap;
  document.querySelectorAll('[data-panel]').forEach(b => b.onclick = () => (setMorphSource(b), { usage: openUsage, memory: openMemory, settings: openSettings })[b.dataset.panel]());
  document.querySelectorAll('#dock [data-tool]').forEach(b => b.onclick = () => {
    if (b.dataset.tool === 'pen' && tool === 'pen') { inkPalette(b, true); return; }
    setTool(b.dataset.tool);
  });
  // the pen palette shows while the pen is the tool, however it was picked (click or P)
  addEventListener('argon-tool', (e) => { if (e.detail === 'pen') { if (!inkPal) inkPalette(document.querySelector('#dock [data-tool="pen"]')); } else closeInkPalette(); });
  document.querySelectorAll('#dock [data-add]').forEach(b => b.onclick = (e) => {
    const t = b.dataset.add;
    if (t === 'console') { const r = b.getBoundingClientRect(); spawnMenu(r.right + 8, r.top, inPipe() ? pipeSpawnOpts() : {}); }
    else if (t === 'manager' || t === 'prompter' || t === 'secretary') addNode(t);
    else if (t === 'presets') { const r = b.getBoundingClientRect(); presetMenu(r.right + 8, r.top); }
    else if (t === 'group') addGroup();
    else addNode(t);
  });
  document.getElementById('fit-all').onclick = fitAll;
  document.querySelectorAll('#dock [data-pipe]').forEach(b => b.onclick = () => (b.dataset.pipe === 'run' ? toggleRun() : addStage()));

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); openCommandBar(); return; }
    if (e.ctrlKey && e.key.toLowerCase() === 'm') { e.preventDefault(); openMissionMap(); return; }
    if (e.ctrlKey && e.key === ',') { e.preventDefault(); if (!document.querySelector('.modal.settings')) { setMorphSource(document.querySelector('[data-panel="settings"]')); openSettings(); } return; }
    if (e.ctrlKey && /^[1-9]$/.test(e.key)) { const w = S.data.workspaces[+e.key - 1]; if (w) { e.preventDefault(); switchWs(w.id); } return; }
    if (e.ctrlKey && e.key.toLowerCase() === 'z' && !isTyping(e) && (tool === 'pen' || tool === 'erase')) { ws().ink.pop(); renderInk(); save(); return; }
    if (isTyping(e) || e.ctrlKey || e.altKey || e.metaKey) return;
    if (document.querySelector('.modal-back') || !document.getElementById('cmdbar').classList.contains('hidden')) return;
    const k = e.key.toLowerCase();
    if (k === 'n') { e.preventDefault(); const r = document.getElementById('board').getBoundingClientRect(); spawnMenu(r.left + 20, r.top + 20, inPipe() ? pipeSpawnOpts() : {}); }
    else if (k === 'f') fitAll();
    else if (k === 'g' && !inPipe()) addGroup();
    else if (k === 'v' || k === 'escape') { setTool('select'); if (k === 'escape') select(null); }
    else if (k === 'p' && !inPipe()) setTool('pen');
    else if (k === 'e' && !inPipe()) setTool('erase');
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) removeNode(selectedId);
  });

  window.addEventListener('beforeunload', () => save(true));
  window.addEventListener('focus', () => detectInstalled());
}

function toggleMission() {
  S.data.settings.showMission = !S.data.settings.showMission;
  save(); renderMission();
  setTimeout(() => { applyView(); refitAll(); }, 340); // after the panel finishes gliding
}

boot().catch(err => {
  console.error(err);
  document.body.append(h('pre', { style: { position: 'fixed', inset: '60px 20px auto', color: '#e0727c', zIndex: 9999 } }, 'Argon failed to start:\n' + (err && err.stack || err)));
});
