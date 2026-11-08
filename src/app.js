// Argon — renderer entry: state, workspaces, dock, shortcuts.
import { S, ws, save, emit, on, h, toast, defaultState, newWorkspace, basename, findNode, consoles } from './state.js';
import { initBoard, applyView, renderInk, setTool, fitAll, flyTo, tool, isTyping, cycleInk } from './board.js';
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
  attachLens(document.getElementById('mode-seg'), 'button');
  glassify(document.getElementById('empty-hint'), { refract: false });
  initGlassFx();
  attachLens(document.getElementById('dock'), 'button');
  attachLens(document.querySelector('#topbar .top-actions'), 'button');
  attachLens(document.getElementById('zoomctl'), 'button');

  await detectInstalled();
  initBoard();
  initDrops();
  initManager();   // registers the Manager tile before anything mounts
  initPipeline();  // stage nodes first, so docked agents have somewhere to mount
  wireUi();
  mountAll();      // starts every console on every workspace (they keep running in the background)
  afterMount();
  switchWs(ws().id);
  startTicking();
  initTeamwork();  // console wires, presets, question buttons, context gauge, dictation
  initMissionMap();
  initFlowDots();
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

function wireUi() {
  document.getElementById('tab-add').onclick = newWs;
  document.getElementById('cmd-open').onclick = () => openCommandBar();
  document.getElementById('mission-toggle').onclick = openMissionMap;
  document.querySelectorAll('[data-panel]').forEach(b => b.onclick = () => (setMorphSource(b), { usage: openUsage, memory: openMemory, settings: openSettings })[b.dataset.panel]());
  document.querySelectorAll('#dock [data-tool]').forEach(b => b.onclick = () => {
    if (b.dataset.tool === 'pen' && tool === 'pen') { const c = cycleInk(); b.style.color = c; return; }
    setTool(b.dataset.tool);
  });
  document.querySelectorAll('#dock [data-add]').forEach(b => b.onclick = (e) => {
    const t = b.dataset.add;
    if (t === 'console') { const r = b.getBoundingClientRect(); spawnMenu(r.right + 8, r.top, inPipe() ? pipeSpawnOpts() : {}); }
    else if (t === 'manager') addNode('manager');
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
    if (e.ctrlKey && e.key === '.') { e.preventDefault(); setMode(inPipe() ? 'board' : 'pipe'); return; }
    if (e.ctrlKey && e.key === 'Enter' && inPipe() && !isTyping(e)) { e.preventDefault(); toggleRun(); return; }
    if (e.ctrlKey && /^[1-9]$/.test(e.key)) { const w = S.data.workspaces[+e.key - 1]; if (w) { e.preventDefault(); switchWs(w.id); } return; }
    if (e.ctrlKey && e.key.toLowerCase() === 'z' && !isTyping(e) && (tool === 'pen' || tool === 'erase')) { ws().ink.pop(); renderInk(); save(); return; }
    if (isTyping(e) || e.ctrlKey || e.altKey || e.metaKey) return;
    if (document.querySelector('.modal-back') || !document.getElementById('cmdbar').classList.contains('hidden')) return;
    const k = e.key.toLowerCase();
    if (k === 'n') { e.preventDefault(); const r = document.getElementById('board').getBoundingClientRect(); spawnMenu(r.left + 20, r.top + 20, inPipe() ? pipeSpawnOpts() : {}); }
    else if (k === 'f') fitAll();
    else if (k === 'g' && !inPipe()) addGroup();
    else if (k === 's' && inPipe()) addStage();
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
