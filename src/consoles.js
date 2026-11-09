// Agent consoles: real terminals (xterm.js + node-pty), live status, loops, handoffs.
import { S, ws, save, emit, findNode, toast, allConsoles } from './state.js';
import { agentByKey, buildCommand } from './agents.js';
import { terminalOptions } from './appearance.js';

const NEEDS_RE = /(\(y\/n\)|\[y\/n\]|\by\/N\b|\bY\/n\b|Do you want to|Do you trust|Allow (this|once|always)|Yes, (allow|and don't ask)|Approve\?|approve this|Press Enter to continue|Continue\?|Waiting for (your )?(input|approval)|Select (a |your )?(login method|option|model)|Press Enter to|❯\s*\d+\.\s)/i;
const ANSI_RE = /\x1b\[[0-9;?<>=]*[ -\/]*[@-~]|\x1b[()][0-9A-Za-z]|\x1b[=>78DEHM]|\r/g;
const OSC_RE = /\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g;
// Data xterm sends by itself: focus events, CSI reports (device attributes, cursor position, status, window size, modes), OSC and DCS replies.
const TERM_REPLY_RE = /^(?:\x1b\[[IO]|\x1b\[[?>=]?[\d;]*(?:\$y|[cRnt])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1bP[^\x1b]*\x1b\\)+$/;

export const rt = (id) => S.runtime.get(id);

export function statusOf(id) {
  const r = rt(id);
  return r ? r.status : 'exited';
}

function strip(s) { return s.replace(OSC_RE, '').replace(ANSI_RE, ''); }

export function mountConsole(node, body, w) {
  let r = rt(node.id);
  if (r) { // already running (e.g. re-render) -> move the terminal element
    body.append(r.host);
    r.body = body;
    queueFit(node.id);
    return r;
  }
  const host = document.createElement('div');
  host.style.height = '100%';
  body.append(host);

  const term = new window.Terminal({
    ...terminalOptions(),
    scrollback: 4000,
    allowProposedApi: true,
    allowTransparency: true,
    macOptionIsMeta: true,
  });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  try { term.loadAddon(new window.WebLinksAddon.WebLinksAddon((_e, url) => window.argon.openExternal(url))); } catch (_) {}
  term.open(host);

  r = {
    id: node.id, term, fit, host, body, status: 'starting', alive: false,
    lastOut: 0, lastIn: 0, tail: '', sinceRun: '', changedAt: Date.now(), hadOutput: false,
  };
  S.runtime.set(node.id, r);

  // Ctrl+Shift+C / Ctrl+Shift+V copy-paste, Ctrl+C copies if there is a selection.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    if (e.ctrlKey && (e.key === 'c' || e.key === 'C') && term.hasSelection()) { navigator.clipboard.writeText(term.getSelection()); term.clearSelection(); return false; }
    if (e.ctrlKey && e.shiftKey && (e.key === 'V' || e.key === 'v')) { navigator.clipboard.readText().then(t => term.paste(t)); return false; }
    if (e.ctrlKey && e.key === 'v') { navigator.clipboard.readText().then(t => term.paste(t)); return false; }
    if (e.ctrlKey && e.key.toLowerCase() === 'k') return false; // command bar
    return true;
  });
  // The terminal's own automatic replies (focus in/out, cursor and device reports) are not you typing.
  term.onData((d) => { if (!TERM_REPLY_RE.test(d)) r.lastIn = Date.now(); window.argon.pty.write(node.id, d); });

  window.argon.pty.onData(node.id, (data) => {
    term.write(data);
    const now = Date.now();
    const clean = strip(data);
    if (data.replace(OSC_RE, '').includes('\x07')) r.bell = now;
    // ignore plain echo of what the user just typed
    if (now - Math.max(r.lastIn, r.lastSend || 0) > 250 || clean.length > 40) r.lastOut = now;
    r.hadOutput = true;
    r.tail = (r.tail + clean).slice(-3000);
    r.sinceRun = (r.sinceRun + clean).slice(-20000);
  });
  window.argon.pty.onExit(node.id, () => {
    r.alive = false;
    setStatus(r, 'exited');
    showOverlay(node, r);
  });

  const ro = new ResizeObserver(() => queueFit(node.id));
  ro.observe(host);
  r.ro = ro;

  startPty(node, w, r);
  return r;
}

async function startPty(node, w, r, { fresh = false } = {}) {
  const agent = agentByKey(node.data.agent, S.data.customAgents);
  let resume = !fresh && node.data.started && S.data.settings.resumeOnLaunch && !!agent.resume;
  const prof = S.data.profiles.find(p => p.id === node.data.profile);
  let extra = node.data.args || '';
  // Claude gets its own session id, so Argon reads exactly this console's transcript (the Simple view, the
  // context gauge, hand-offs) and resumes exactly this conversation, not the newest one in the folder.
  if (agent.key === 'claude' && !/--(session-id|resume|continue)\b/.test(extra)) {
    let exists = false;
    if (!fresh && node.data.session && window.argon.claudeTranscript) {
      try { exists = !!(await window.argon.claudeTranscript({ cwd: node.data.cwd || w.cwd, session: node.data.session, profile: prof && prof.dir, bytes: 10000 })).ok; } catch (_) {}
    }
    const back = resume && exists;
    // a session id that already has a conversation can only be resumed, never started again
    if (!back && (fresh || !node.data.session || exists)) node.data.session = crypto.randomUUID();
    extra = (back ? `--resume ${node.data.session}` : `--session-id ${node.data.session}`) + (extra ? ' ' + extra : '');
    for (const f of (w.folders || [])) if (f && !/'/.test(f)) extra += ` --add-dir '${f}'`;
    resume = false; r.session = node.data.session; save();
  }
  const command = buildCommand(agent, { resume, autoApprove: S.data.settings.autoApprove, extra });
  const env = {};
  if (prof && agent.profileEnv) env[agent.profileEnv] = prof.dir;
  try { r.fit.fit(); } catch (_) {}
  const res = await window.argon.pty.spawn({
    id: node.id, command, cwd: node.data.cwd || w.cwd, cols: r.term.cols, rows: r.term.rows, env,
  });
  if (!res.ok) {
    r.term.write(`\r\n\x1b[31mCould not start terminal: ${res.error}\x1b[0m\r\n`);
    setStatus(r, 'exited');
    return;
  }
  r.alive = true;
  if (resume) r.term.write('\x1b[38;2;154;131;212m↻ Resuming previous session…\x1b[0m\r\n');
  if (!node.data.started) { node.data.started = true; save(); }
  setStatus(r, 'resting');
  // Initial prompt (from Composer) once the agent has drawn its UI.
  if (node.data.initialPrompt) {
    const p = node.data.initialPrompt;
    delete node.data.initialPrompt; save();
    waitReady(r, 25000).then(() => sendTo(node.id, p));
  }
}

export function restartConsole(node, fresh = true) {
  const f = findNode(node.id); if (!f) return;
  const r = rt(node.id); if (!r) return;
  r.overlay && r.overlay.remove(); r.overlay = null;
  window.argon.pty.kill(node.id).then(() => {
    r.term.reset();
    r.tail = ''; r.sinceRun = '';
    startPty(node, f.ws, r, { fresh });
  });
}

function showOverlay(node, r) {
  if (r.overlay || !r.body) return;
  const o = document.createElement('div');
  o.className = 'console-overlay';
  o.innerHTML = `<div><div style="font-weight:600;font-size:14px">Session ended</div><div style="color:var(--muted);margin-top:4px">The terminal process exited.</div></div>`;
  const b = document.createElement('button');
  b.className = 'btn primary'; b.textContent = 'Restart';
  b.onclick = () => restartConsole(node, true);
  o.firstChild.append(document.createElement('br'), b);
  r.body.append(o);
  r.overlay = o;
}

export function disposeConsole(id) {
  const r = rt(id);
  window.argon.pty.kill(id);
  window.argon.pty.off(id);
  if (r) { try { r.ro.disconnect(); r.term.dispose(); } catch (_) {} r.host.remove(); }
  S.runtime.delete(id);
}

const fitQueue = new Set();
let fitRaf = 0;
export function queueFit(id) {
  fitQueue.add(id);
  cancelAnimationFrame(fitRaf);
  fitRaf = requestAnimationFrame(() => {
    for (const fid of fitQueue) {
      const r = rt(fid);
      if (!r || !r.host.offsetWidth || !r.host.offsetHeight) continue;
      try {
        r.fit.fit();
        if (r.alive) window.argon.pty.resize(fid, r.term.cols, r.term.rows);
      } catch (_) {}
    }
    fitQueue.clear();
  });
}

export function refitAll() { for (const id of S.runtime.keys()) queueFit(id); }

export function setFontSize(px) {
  for (const r of S.runtime.values()) { r.term.options.fontSize = px; }
  refitAll();
}

// Re-apply colors, font and cursor to every open terminal (after a personalization change).
export function applyTerminalLook() {
  const o = terminalOptions();
  for (const r of S.runtime.values()) Object.assign(r.term.options, o);
  refitAll();
}

function setStatus(r, st) {
  if (r.status === st) return;
  const prev = r.status;
  r.status = st;
  r.changedAt = Date.now();
  emit('status', r.id, st, prev);
  if (st === 'needs' && prev !== 'needs' && S.data.settings.notify !== false && !document.hasFocus()) {
    const f = findNode(r.id);
    try { new Notification('Argon: ' + (f ? f.node.title : 'An agent') + ' needs you', { body: 'Waiting for your input or approval.', silent: false }); } catch (_) {}
  }
}

// Resolves once the agent has printed something and gone quiet.
export function waitReady(r, timeout = 20000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const quiet = Date.now() - r.lastOut > 1500;
      if ((r.hadOutput && quiet && Date.now() - t0 > 2000) || Date.now() - t0 > timeout) { clearInterval(iv); resolve(); }
    }, 300);
  });
}

// Type text into a console and press Enter.
function leadHint(node, w) {
  const s = window.argon.platform === 'win32' ? '\\' : '/', base = (window.argon.platform === 'win32' ? String(w.cwd).replace(/\//g, '\\') : w.cwd).replace(/[\\/]+$/, '');
  const inbox = `${base}${s}.argon${s}board${s}inbox`;
  return `[Argon] You are ${node.title}, the LEAD. When this job splits into parts that can run at the same time, bring in helpers on the board instead of doing everything yourself: write a file ending in .json into ${inbox} containing {"do":"spawn","from":"${node.title}","helpers":[{"name":"helper-1","task":"the part this helper does, with every detail it needs"}]} (up to 4 helpers per file). Each helper starts in this folder with its task, works in a group with you, and messages you when it is done. Then combine their work, check it, and report back.`;
}
export function sendTo(id, text, submit = true) {
  const r = rt(id);
  if (!r || !r.alive) return false;
  if (!r.boardHinted && submit && !/^\s*\//.test(text) && S.data.settings.boardForAgents !== false) {
    const f = findNode(id), w = f && f.ws;
    if (w && w.cwd && f.node.data.agent && f.node.data.agent !== 'shell') {
      r.boardHinted = true;
      const s = window.argon.platform === 'win32' ? '\\' : '/', base = (window.argon.platform === 'win32' ? w.cwd.replace(/\//g, '\\') : w.cwd).replace(/[\\/]+$/, '');
      text = `[Argon] You share a live whiteboard with the user. To see it, or to add notes, checklists and tiles, move things, group or wire agents, read ${base}${s}.argon${s}board${s}BOARD.md and follow it.\n\n${text}`;
    }
  }
  if (submit && !r.leadHinted && !/^\s*\//.test(text)) {
    const f = findNode(id);
    if (f && f.node.data.lead) { r.leadHinted = true; text = `${leadHint(f.node, f.ws)}\n\n${text}`; }
  }
  const bp = r.term.modes && r.term.modes.bracketedPasteMode;
  const body = bp ? `\x1b[200~${text}\x1b[201~` : text.replace(/\r?\n/g, ' ');
  window.argon.pty.write(id, body);
  r.sinceRun = '';
  r.lastSend = Date.now();
  r.lastOut = Date.now(); // count as busy right away
  if (submit) setTimeout(() => window.argon.pty.write(id, '\r'), 140);
  return true;
}

export function lastLines(id, n = 60) {
  const r = rt(id); if (!r) return '';
  const buf = r.term.buffer.active;
  const lines = [];
  for (let i = Math.max(0, buf.length - n); i < buf.length; i++) {
    const l = buf.getLine(i); if (l) lines.push(l.translateToString(true));
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- status + loops + handoffs tick ----------
export const handoffs = []; // {from, to, file, rel, started, asked}

function tick() {
  const now = Date.now();
  const idleMs = (S.data.settings.idleSeconds || 4) * 1000;
  for (const { node, ws: w } of allConsoles()) {
    const r = rt(node.id); if (!r) continue;
    if (!r.alive) { if (r.status !== 'exited' && r.status !== 'starting') setStatus(r, 'exited'); continue; }
    const quietFor = now - r.lastOut;
    let st;
    const recent = r.tail.slice(-500);
    if ((r.bell && now - r.bell < 60000 && quietFor > 800 && r.bell > r.lastIn) || (quietFor > 700 && NEEDS_RE.test(recent) && now - r.lastIn > 1200)) st = 'needs';
    else if (quietFor < 1600) st = 'working';
    else st = 'resting';
    if (st === 'needs' && now - r.lastIn < 1200) st = 'resting';
    if (r.lastIn > r.lastOut && st === 'needs') st = 'resting';
    setStatus(r, st);
    r.idleFor = st === 'resting' ? quietFor : 0;
    runLoop(node, r, now, idleMs);
  }
  for (const ho of handoffs.slice()) stepHandoff(ho, now);
}

function runLoop(node, r, now, idleMs) {
  const L = node.data.loop;
  if (!L || !L.on || !L.prompt) return;
  // goal reached?
  if (L.goal && L.runs > 0 && r.sinceRun.toLowerCase().includes(L.goal.toLowerCase()) && r.status !== 'working') {
    L.on = false; save(); emit('loop', node.id);
    toast(`Loop on “${node.title}” finished: goal met.`);
    return;
  }
  if (L.maxRuns && L.runs >= L.maxRuns) {
    if (r.status !== 'working') { L.on = false; save(); emit('loop', node.id); toast(`Loop on “${node.title}” finished: ${L.runs} runs.`); }
    return;
  }
  if (r.status === 'working' || r.status === 'needs') return;
  let fire = false;
  if (L.mode === 'interval') fire = now - (L.lastRun || 0) >= Math.max(0.25, +L.every || 10) * 60000;
  else fire = r.status === 'resting' && (now - r.lastOut) >= Math.max(2, +L.idleSec || 20) * 1000 && (r.lastOut > (L.lastRun || 0) || !L.lastRun);
  if (fire) {
    L.lastRun = now; L.runs = (L.runs || 0) + 1; save();
    sendTo(node.id, L.prompt);
    emit('loop', node.id);
  }
}

async function stepHandoff(ho, now) {
  if (now - ho.started > 15 * 60000) { handoffs.splice(handoffs.indexOf(ho), 1); toast('Handoff timed out.', 'warn'); return; }
  const from = rt(ho.from), to = rt(ho.to);
  if (!to) return;
  if (ho.busy) return;
  ho.busy = true;
  try {
    const exists = await window.argon.fs.exists(ho.file);
    const fromDone = !from || from.status !== 'working';
    if (exists && fromDone && to.alive && to.hadOutput && now - to.lastOut > 1500) {
      handoffs.splice(handoffs.indexOf(ho), 1);
      const fname = findNode(ho.from)?.node.title || 'another agent';
      sendTo(ho.to, `You are taking over work from ${fname}. Read the handoff brief at ${ho.rel} and continue from where it left off.`);
      toast('Handoff delivered.');
      emit('handoff', ho);
    }
  } finally { ho.busy = false; }
}

export function startHandoff(fromNode, toNode, w) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const safe = fromNode.title.replace(/[^\w-]+/g, '-').toLowerCase();
  const rel = `.argon/handoffs/${safe}-${stamp}.md`;
  const base = (fromNode.data.cwd || w.cwd || '').replace(/[\\/]+$/, '');
  const file = base + (window.argon.platform === 'win32' ? '\\' + rel.replace(/\//g, '\\') : '/' + rel);
  sendTo(fromNode.id, `Another agent is taking over your work. Write a concise handoff brief covering: the goal, what is done, what is left, key files, and any gotchas. Save it as ${rel} (create the folder if needed). Then stop.`);
  handoffs.push({ from: fromNode.id, to: toNode.id, file, rel, started: Date.now() });
  toast(`Asked ${fromNode.title} for a handoff brief…`);
}

export function startTicking() { setInterval(tick, 500); }
