// Teamwork: consoles wired to each other (with wire types), team presets, questions as buttons,
// a context gauge for Claude sessions, and hold-Space dictation.
import { S, ws, on, emit, save, uid, h, toast, findNode, allConsoles } from './state.js';
import { rt, statusOf, sendTo, lastLines } from './consoles.js';
import { tileEl, tileHooks, addNode, addGroup, select, fitGroup, groupMembers, groupTag, groupColor } from './tiles.js';
import { showMenu, askText } from './ui.js';
import { agentByKey } from './agents.js';
import { isTyping } from './board.js';
import { openCommandBar } from './panels.js';
import { paced } from './pace.js';
import { startTeamFile, teamIntro, hasQueued } from './teamtalk.js';
import { contextPopover } from './context.js';

const NS = 'http://www.w3.org/2000/svg';
const isPipe = (n) => !!(n && n.data && n.data.space === 'pipe');
const animOn = () => !document.body.classList.contains('no-anim');
const nodeOf = (id) => { const f = findNode(id); return f ? f.node : null; };
// A wire end is a console or a group. A group stands for every agent in it (nested groups too).
const isGroupId = (id) => { const n = nodeOf(id); return !!(n && n.type === 'group'); };
function agentsIn(id) {
  const f = findNode(id); if (!f) return [];
  const n = f.node;
  if (n.type === 'console') return [n];
  if (n.type !== 'group') return [];
  return groupMembers(n, f.ws).flatMap((m) => (m.type === 'group' ? agentsIn(m.id) : m.type === 'console' && m.data.agent !== 'shell' ? [m] : []));
}
// One view over a console or a whole group: a group is working while anyone in it works.
function endState(id) {
  if (!isGroupId(id)) { const r = rt(id); return r ? { alive: r.alive, status: r.status, lastOut: r.lastOut || 0, lastIn: r.lastIn || 0, inp: inputAt(r) } : null; }
  const rs = agentsIn(id).map((a) => rt(a.id)).filter(Boolean);
  if (!rs.length) return null;
  const inps = rs.map(inputAt).filter(Boolean);
  return {
    alive: rs.some((r) => r.alive),
    // a teammate with a message waiting for them still has work to do, so the team isn't done yet
    status: rs.some((r) => r.status === 'working') || agentsIn(id).some((a) => hasQueued(a.id)) ? 'working' : rs.some((r) => r.status === 'needs') ? 'needs' : 'resting',
    lastOut: Math.max(...rs.map((r) => r.lastOut || 0)), lastIn: Math.max(...rs.map((r) => r.lastIn || 0)),
    inp: inps.length ? Math.max(...inps) : 0,
  };
}
const endStatus = (id) => { const s = endState(id); return s ? s.status : 'exited'; };
// What a console said last, or what everyone in a group said.
// An agent that only printed its start-up banner, or only ran a slash command like /clear, has nothing to hand over.
const BANNER_RE = /[▐▛▜▝▘▙▟█▀▄]|Claude Code v\d|OpenAI Codex|Gemini CLI|GitHub Copilot|^\s*(?:~|[A-Za-z]:)?[\\/][^\s]*\s*$|\b(?:Opus|Sonnet|Haiku|Fable)\s+\d[\d.]*\s*·|Claude (?:Pro|Max|Team|Enterprise|API)|^\s*(?:model|directory|workdir|session):|Tips for getting started|To get started|\/init\b|\/help\b|\/status\b|\/model\b|Welcome|^\s*[>❯›]\s*\/[a-z][\w-]*\b.*$|\(no content\)|^\s*⎿\s*$|^\s*⎿\s*(?:Cleared|Compacted)\b/i;
const bannerOnly = (t) => !t.split('\n').some((l) => l.trim() && !BANNER_RE.test(l));
const agentText = (id, max) => { const t = replyText(id, max); return bannerOnly(t) ? '' : t; };
function textOf(id) {
  if (!isGroupId(id)) return agentText(id);
  return agentsIn(id).map((a) => { const t = agentText(a.id, 1400); return t ? `--- ${a.title} ---\n${t}` : ''; }).filter(Boolean).join('\n\n');
}
const titleOf = (id) => { const n = nodeOf(id); return n ? (n.data.role || n.title) : 'an agent'; };

// ====================================================================================
// 1) WIRES between consoles, each with a type
// ====================================================================================
export const MODES = {
  done:    { label: 'When done',            short: 'done',    tip: 'Hands over once the agent finishes a task' },
  reply:   { label: 'Every reply',          short: 'reply',   tip: 'Forwards every reply as soon as it settles' },
  if:      { label: 'Only if it matches…',  short: 'if',      tip: 'Hands over only when the reply matches a word or pattern' },
  review:  { label: 'Review until APPROVED', short: 'review', tip: 'The next agent reviews; fixes go back until it says APPROVED (5 rounds max)' },
  context: { label: 'Shared context (once)', short: 'context', tip: 'Shares the reply once as background, then goes quiet' },
};
const MAX_ROUNDS = 5, MAX_AUTO = 8;
const wiresOf = (w) => (w.wires = w.wires || []);
const inputAt = (r) => Math.max(r.lastIn || 0, r.lastSend || 0);

// Pull the agent's reply off the screen, minus the TUI chrome (input box, hints, spinners).
const CHROME_RE = /(for shortcuts|esc to interrupt|auto-accept|bypass permissions|accept edits|context left|ctrl\+[a-z] to|\? for help|tokens? used|Tip:|⏵⏵|shift\+tab)/i;
export function replyText(id, max = 2000) {
  const raw = lastLines(id, 70).split('\n').map((l) => l.replace(/^\s*[│┃|]\s?/, '').replace(/\s?[│┃|]\s*$/, '').trimEnd());
  // drop the trailing input box: everything from the last box top (╭ or ─── rule) down
  let end = raw.length;
  for (let i = raw.length - 1; i >= Math.max(0, raw.length - 14); i--) if (/^\s*[╭┌]|^\s*[─━]{8,}/.test(raw[i])) { end = i; }
  const keep = raw.slice(0, end).filter((l) => l.trim() && !/^[\s─━═╭╮╰╯┌┐└┘│┃]+$/.test(l) && !CHROME_RE.test(l) && !/^\s*[>❯]\s*$/.test(l) && !/^\s*[✻✽✶✳✢·*]\s+\w+…/.test(l));
  return keep.slice(-30).join('\n').slice(-max).trim();
}

function brief(w, wire, text) {
  const from = titleOf(wire.from), to = titleOf(wire.to);
  const dn = nodeOf(wire.to), role = dn && dn.type === 'console' && dn.data.roleNote ? `Your role: ${to}, ${dn.data.roleNote.charAt(0).toLowerCase() + dn.data.roleNote.slice(1)}.\n\n` : '';
  return role + briefText(w, wire, text, from, to);
}
function briefText(w, wire, text, from, to) {
  if (wire.mode === 'review') return `You are the reviewer (${to}). Review this work from ${from}. If it is good, reply with the single word APPROVED. Otherwise list the exact fixes needed.\n\n--- ${from} said ---\n${text}`;
  if (wire.mode === 'context') return `For context only (no action needed yet), here is what ${from} has been working on:\n\n${text}\n\nReply "ok".`;
  return `${from} finished and handed this to you (${to}):\n\n${text}\n\nContinue from here.`;
}

// Tasks the Prompter left for agents further down a chain: they ride along with the first handoff that reaches them.
const briefs = new Map();
export function setBrief(id, text) { briefs.set(id, text); }
export function clearBriefs(ids) { for (const id of ids) briefs.delete(id); }

function deliver(w, wire, toId, text) {
  const dst = endState(toId);
  if (!dst || !dst.alive) { toast(`${titleOf(toId)} is not running, so the handoff waits`, 'warn'); wire.pending = { to: toId, text }; return; }
  if (dst.status === 'working' || dst.status === 'needs') { wire.pending = { to: toId, text }; return; }
  wire.pending = null;
  const team = isGroupId(toId) ? agentsIn(toId) : null;
  const ids = team ? team.map((a) => a.id) : [toId];
  // A handoff into a group goes to a team. Unless the Prompter already set them up, give them a fresh team file
  // (kept during review fix rounds) and the rules for working together.
  const g = team && team.length > 1 ? nodeOf(toId) : null;
  const prompted = ids.some((id) => briefs.has(id));
  if (g && !prompted) startTeamFile(w, g, { fresh: !(wire.mode === 'review' && toId === wire.from) });
  for (const id of ids) {
    let t = text;
    const b = briefs.get(id); if (b) { briefs.delete(id); t = `${b}\n\n${t}`; }
    else if (g) t = `${teamIntro(w, g, nodeOf(id))}\n\n${t}`;
    sendTo(id, t);
  }
  packet(w, wire, toId === wire.from);
  emit('handoff', wire.from, wire.to, wire.mode);
}

function fire(w, wire, now) {
  const text = textOf(wire.from);
  if (!text) return;
  if (wire.mode === 'if') {
    let ok = false;
    try { ok = new RegExp(wire.pattern || '.', 'i').test(text); } catch (_) { ok = text.toLowerCase().includes(String(wire.pattern || '').toLowerCase()); }
    if (!ok) return;
  }
  wire.autoCount = (wire.autoCount || 0) + 1;
  if (wire.autoCount > MAX_AUTO) { wire.paused = true; toast(`Paused ${titleOf(wire.from)} → ${titleOf(wire.to)}: it fired ${MAX_AUTO} times without you. Click its chip to resume.`, 'warn'); save(); return; }
  if (wire.mode === 'context') wire.used = true;
  if (wire.mode === 'review') { wire.waiting = 'reviewer'; wire.state = 'reviewing'; }
  else wire.handed = true; // the source finished and handed its work over: the wire turns green
  deliver(w, wire, wire.to, brief(w, wire, text));
  save();
}

// The reviewer answered: APPROVED ends it, anything else goes back to the author.
function reviewed(w, wire) {
  const text = textOf(wire.to);
  wire.waiting = null;
  if (/\bAPPROVED\b/.test(text)) { wire.state = 'approved'; toast(`${titleOf(wire.to)} approved ${titleOf(wire.from)}'s work`, 'ok'); save(); return; }
  wire.rounds = (wire.rounds || 0) + 1;
  if (wire.rounds >= MAX_ROUNDS) { wire.state = 'stuck'; toast(`Review stopped after ${MAX_ROUNDS} rounds without APPROVED`, 'warn'); save(); return; }
  wire.state = 'fixing';
  deliver(w, wire, wire.from, `${titleOf(wire.to)} reviewed your work (round ${wire.rounds} of ${MAX_ROUNDS}) and asked for these fixes:\n\n${text}\n\nMake the fixes, then summarize what you changed.`);
  save();
}

function engine() {
  const now = Date.now(), idle = (S.data.settings.idleSeconds || 4) * 1000;
  for (const w of S.data.workspaces) {
    for (const wire of wiresOf(w)) {
      if (wire.pending) { deliver(w, wire, wire.pending.to, wire.pending.text); continue; }
      const src = endState(wire.from), dst = endState(wire.to);
      if (!src || !src.alive || !dst) continue;
      // a real keystroke from you resets the loop guard and a finished review
      if ((src.lastIn || 0) > (wire.firedAt || 0) && wire.autoCount) { wire.autoCount = 0; if (wire.state === 'approved' || wire.state === 'stuck') { wire.state = null; wire.rounds = 0; } }
      if (wire.paused) continue;
      // reviewer finished its review
      if (wire.mode === 'review' && wire.waiting === 'reviewer') {
        if (dst.status === 'resting' && now - dst.lastOut > idle && dst.lastOut > (wire.firedAt || 0) + 500) reviewed(w, wire);
        continue;
      }
      if (wire.mode === 'review' && (wire.state === 'approved' || wire.state === 'stuck')) continue;
      if (wire.mode === 'context' && wire.used) continue;
      const inp = src.inp;
      if (!inp || src.status !== 'resting' || src.lastOut <= inp) continue;
      const settle = wire.mode === 'reply' ? 1800 : idle;
      if (now - src.lastOut < settle) continue;
      if (wire.mode === 'reply' ? src.lastOut <= (wire.firedAt || 0) : inp <= (wire.firedAt || 0)) continue;
      wire.firedAt = now;
      fire(w, wire, now);
    }
  }
}

export function addWire(w, from, to, mode = 'done') {
  if (from === to) return null;
  const ex = wiresOf(w).find((x) => x.from === from && x.to === to);
  if (ex) return ex;
  const wire = { id: uid('wr'), from, to, mode, pattern: '', firedAt: Date.now() };
  wiresOf(w).push(wire); save(); emit('nodes');
  return wire;
}
function removeWire(w, wire) { w.wires = wiresOf(w).filter((x) => x !== wire); save(); emit('nodes'); }

function wireMenu(w, wire, x, y) {
  const items = [{ title: `${titleOf(wire.from)} → ${titleOf(wire.to)}` }];
  for (const [k, m] of Object.entries(MODES)) items.push({ label: m.label, note: wire.mode === k ? '✓' : '', tip: m.tip, onClick: async () => {
    if (k === 'if') { const p = await askText('Only hand over if the reply matches', { value: wire.pattern || '', placeholder: 'e.g. DONE or tests? (pass|fail)', sub: 'A word or a regular expression. Case does not matter.' }); if (p == null || !p.trim()) return; wire.pattern = p.trim(); }
    wire.mode = k; wire.used = false; wire.state = null; wire.rounds = 0; wire.waiting = null; wire.paused = false; wire.autoCount = 0; wire.firedAt = Date.now();
    save(); emit('nodes'); toast(`${MODES[k].label}: ${MODES[k].tip.toLowerCase()}`);
  } });
  items.push('sep');
  if (wire.paused) items.push({ label: 'Resume', onClick: () => { wire.paused = false; wire.autoCount = 0; save(); emit('nodes'); } });
  items.push({ label: 'Hand over now', note: 'send the latest reply', onClick: () => { wire.firedAt = Date.now(); wire.paused = false; wire.autoCount = 0; wire.used = false; fire(w, wire, Date.now()); } });
  items.push({ label: 'Remove wire', onClick: () => removeWire(w, wire) });
  showMenu(x, y, items);
}

// ---- drawing: an SVG layer of curves plus an HTML chip on each wire ----
function layerOf(w) { return document.querySelector(`.ws-layer[data-ws="${w.id}"]`); }
function svgOf(w) {
  const L = layerOf(w); if (!L) return null;
  let s = L.querySelector(':scope > .hand-wires');
  if (!s) { s = document.createElementNS(NS, 'svg'); s.setAttribute('class', 'hand-wires'); L.prepend(s); }
  return s;
}
const box = (id) => { const el = tileEl(id); if (!el || !el.isConnected || el.offsetParent === null) return null; return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }; };
function ends(a, b) {
  const ra = a.x + a.w, lb = b.x;
  if (lb >= ra - 20) return [[ra, a.y + 34], [lb, b.y + 34], 1];
  if (b.x + b.w <= a.x + 20) return [[a.x, a.y + 34], [b.x + b.w, b.y + 34], -1];
  return [[a.x + a.w / 2, a.y + a.h], [b.x + b.w / 2, b.y], 0];
}
function curve(p1, p2, dir) {
  const [x1, y1] = p1, [x2, y2] = p2;
  if (dir === 0) { const c = Math.max(40, Math.abs(y2 - y1) / 2); return `M${x1},${y1} C${x1},${y1 + c} ${x2},${y2 - c} ${x2},${y2}`; }
  const c = Math.max(60, Math.abs(x2 - x1) / 2) * dir;
  return `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`;
}
const colorOf = (id) => { const n = nodeOf(id); return !n ? 'var(--accent)' : n.type === 'group' ? groupColor(n.data.color) : agentByKey(n.data.agent, S.data.customAgents).color; };
const chipText = (wire) => {
  const m = MODES[wire.mode] || MODES.done;
  if (wire.paused) return '⏸ paused';
  if (wire.mode === 'review') return wire.state === 'approved' ? '✓ approved' : wire.state === 'stuck' ? 'review ✕' : wire.rounds ? `review · ${wire.rounds}/${MAX_ROUNDS}` : 'review';
  if (wire.mode === 'if') return 'if /' + (wire.pattern || '…').slice(0, 14) + '/';
  if (wire.mode === 'context') return wire.used ? 'context ✓' : 'context';
  return m.short;
};
function draw() {
  const w = ws(); if (!w) return;
  const s = svgOf(w); if (!s) return;
  const L = s.parentNode, keep = new Set();
  for (const wire of wiresOf(w)) {
    const a = box(wire.from), b = box(wire.to);
    if (!a || !b) continue;
    keep.add(wire.id);
    let p = s.querySelector(`path[data-w="${wire.id}"]`);
    if (!p) { p = document.createElementNS(NS, 'path'); p.dataset.w = wire.id; s.append(p); }
    const [p1, p2, dir] = ends(a, b), d = curve(p1, p2, dir);
    if (p.getAttribute('d') !== d) p.setAttribute('d', d);
    const working = endStatus(wire.from) === 'working';
    if (working && wire.handed) wire.handed = false; // started on something new
    // Orange and quick while the source works; green once it has handed over (dots keep moving until the handoff lands).
    const ok = wire.state === 'approved' || ((wire.handed || wire.pending) && !working);
    const busy = wire.waiting || working || (ok && wire.pending);
    p.setAttribute('class', 'hwire m-' + wire.mode + (busy ? ' flow' : '') + (wire.paused ? ' paused' : '') + (ok ? ' ok' : ''));
    p.style.setProperty('--wc', ok ? 'var(--ok)' : colorOf(wire.from));
    let chip = L.querySelector(`:scope > .wire-chip[data-w="${wire.id}"]`);
    if (!chip) {
      chip = h('button', { class: 'wire-chip', 'data-w': wire.id, title: 'Wire type: click to change' });
      chip.addEventListener('pointerdown', (e) => e.stopPropagation());
      chip.onclick = (e) => { e.stopPropagation(); const wr = wiresOf(ws()).find((x) => x.id === chip.dataset.w); if (wr) wireMenu(ws(), wr, e.clientX, e.clientY); };
      L.append(chip);
    }
    const t = chipText(wire); if (chip.textContent !== t) chip.textContent = t;
    chip.className = 'wire-chip m-' + wire.mode + (wire.state === 'approved' ? ' ok' : '') + (wire.paused ? ' paused' : '');
    const len = p.getTotalLength(), mid = p.getPointAtLength(len / 2);
    chip.style.transform = `translate(${mid.x}px, ${mid.y}px) translate(-50%, -50%)`;
  }
  s.querySelectorAll('path[data-w]').forEach((p) => { if (!keep.has(p.dataset.w)) p.remove(); });
  L.querySelectorAll(':scope > .wire-chip').forEach((c) => { if (!keep.has(c.dataset.w)) c.remove(); });
}

function packet(w, wire, back) {
  if (!animOn()) return;
  const s = svgOf(w), p = s && s.querySelector(`path[data-w="${wire.id}"]`); if (!p) return;
  const c = colorOf(back ? wire.to : wire.from), g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'packet');
  const halo = document.createElementNS(NS, 'circle'); halo.setAttribute('r', 13); halo.setAttribute('fill', c); halo.setAttribute('opacity', '.25');
  const dot = document.createElementNS(NS, 'circle'); dot.setAttribute('r', 6); dot.setAttribute('fill', c);
  g.append(halo, dot); s.append(g);
  const len = p.getTotalLength(), t0 = performance.now(), dur = 950;
  const step = (now) => { const k = Math.min(1, (now - t0) / dur), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2, pt = p.getPointAtLength(len * (back ? 1 - e : e)); g.setAttribute('transform', `translate(${pt.x},${pt.y})`); if (k < 1) requestAnimationFrame(step); else g.remove(); };
  requestAnimationFrame(step);
}

// Drag from the dot on a console's right edge onto another console.
function dragWire(w, node, e) {
  e.preventDefault(); e.stopPropagation();
  const s = svgOf(w); if (!s) return;
  const tmp = document.createElementNS(NS, 'path'); tmp.setAttribute('class', 'hwire temp'); s.append(tmp);
  const L = s.parentNode, z = w.view.z;
  let hot = null;
  const hit = (m) => {
    for (const el of document.elementsFromPoint(m.clientX, m.clientY)) {
      const t = el.closest && el.closest('.tile.console, .tile.group');
      if (!t || t.dataset.id === node.id) continue;
      const n = w.nodes.find((x) => x.id === t.dataset.id);
      if (!n || isPipe(n)) continue;
      if (n.type === 'group' && agentsIn(n.id).some((a) => a.id === node.id)) continue; // a console can't wire into its own group
      if (node.type === 'group' && agentsIn(node.id).some((a) => a.id === n.id)) continue; // nor a group into its own members
      return n;
    }
    // A group's frame lets clicks through to the board, so the mouse can't "see" it: check its outline instead.
    let best = null, area = Infinity;
    for (const n of w.nodes) {
      if (n.type !== 'group' || n.id === node.id || isPipe(n)) continue;
      const el = tileEl(n.id); if (!el) continue;
      const r = el.getBoundingClientRect();
      if (m.clientX < r.left - 12 || m.clientX > r.right + 12 || m.clientY < r.top - 12 || m.clientY > r.bottom + 12) continue;
      if (agentsIn(n.id).some((a) => a.id === node.id)) continue;
      if (r.width * r.height < area) { area = r.width * r.height; best = n; }
    }
    return best;
  };
  const move = (m) => {
    const a = box(node.id); if (!a) return;
    const r = L.getBoundingClientRect(), x = (m.clientX - r.left) / z, y = (m.clientY - r.top) / z;
    tmp.setAttribute('d', curve([a.x + a.w, a.y + 34], [x, y], x >= a.x + a.w ? 1 : -1));
    const n = hit(m);
    if (n !== hot) { hot && tileEl(hot.id)?.classList.remove('wire-hot'); hot = n; hot && tileEl(hot.id)?.classList.add('wire-hot'); }
  };
  const up = (m) => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    tmp.remove(); document.body.classList.remove('dragging');
    if (!hot) return;
    tileEl(hot.id)?.classList.remove('wire-hot');
    const wire = addWire(w, node.id, hot.id, 'done');
    if (wire) { toast(`Wired ${titleOf(node.id)} → ${titleOf(hot.id)}. Click the chip on the wire to change its type.`); setTimeout(() => wireMenu(w, wire, m.clientX + 8, m.clientY + 8), 30); }
  };
  document.body.classList.add('dragging');
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up); move(e);
}

// ====================================================================================
// 2) TEAM PRESETS
// ====================================================================================
const BUILTIN = [
  { name: 'Plan → Build → Review', note: '3 agents', roles: ['Planner', 'Builder', 'Reviewer'], wires: [[0, 1, 'done'], [1, 2, 'review']] },
  { name: 'Build → Review', note: '2 agents', roles: ['Builder', 'Reviewer'], wires: [[0, 1, 'review']] },
  { name: 'Fix → Test', note: '2 agents, loops on failures', roles: ['Fixer', 'Tester'], wires: [[0, 1, 'done'], [1, 0, 'if', 'fail|error|✗']] },
  { name: 'Research → Write', note: '2 agents', roles: ['Researcher', 'Writer'], wires: [[0, 1, 'done']] },
  { name: 'Manager + team of 3', note: 'Manager runs 3 builders', roles: ['Builder 1', 'Builder 2', 'Builder 3'], wires: [], manager: true },
];
export function defaultAgent() {
  for (const k of ['claude', 'codex', 'gemini', 'copilot']) { const a = agentByKey(k, S.data.customAgents); if (a && a.key === k && (!a.cmd || S.installed[a.cmd])) return k; }
  return 'shell';
}
export function presetMenu(x, y) {
  const saved = (S.data.settings.presets = S.data.settings.presets || []);
  const ag = defaultAgent(), an = agentByKey(ag, S.data.customAgents).name;
  const items = [{ title: `Start a team · ${an}` }];
  for (const p of BUILTIN) items.push({ label: p.name, note: p.note, onClick: () => spawnTeam(p, ag) });
  if (saved.length) { items.push('sep', { title: 'Your presets' }); for (const p of saved) items.push({ label: p.name, note: `${p.roles.length} agents`, onClick: () => spawnTeam(p) }); }
  items.push('sep', { label: 'Tip: right-click a group → Save as preset', onClick: () => {} });
  showMenu(x, y, items);
}
export function spawnTeam(p, agentKey) {
  const w = ws(); if (w.mode === 'pipe') { toast('Switch to Board to start a team', 'warn'); return null; }
  const v = w.view, cx = (innerWidth / 2 - v.x) / v.z, cy = (innerHeight / 2 - v.y) / v.z;
  const cw = 560, chh = 400, gap = 80, n = p.roles.length, total = n * cw + (n - 1) * gap;
  const nodes = p.roles.map((role, i) => {
    const agent = (p.agents && p.agents[i]) || agentKey || defaultAgent();
    return addNode('console', { agent, role, roleNote: (p.notes && p.notes[i]) || '' }, { x: Math.round(cx - total / 2 + i * (cw + gap)), y: Math.round(cy - chh / 2), w: cw, h: chh, title: role });
  });
  select(nodes[0].id);
  const g = addGroup();
  if (g) {
    g.title = p.name.replace(/[→]/g, '›');
    const te = tileEl(g.id)?.querySelector('.tile-title'); if (te) te.textContent = g.title;
    const tag = groupTag(g);
    for (const c of nodes) { c.data.groupId = g.id; c.data.group = tag; emit('consoleMeta', c.id); }
    g.data.tile = false; fitGroup(g, w);
  }
  for (const [a, b, mode, pattern] of p.wires) { const wr = addWire(w, nodes[a].id, nodes[b].id, mode); if (wr && pattern) wr.pattern = pattern; }
  if (p.manager && g) {
    const m = addNode('prompter', {}, { x: g.x - 520, y: g.y });
    m.data.links = [g.id];
    const sec = addNode('secretary', {}, { x: g.x + g.w + 60, y: g.y });
    sec.data.source = m.id; save(); emit('nodes');
  }
  save(); emit('nodes');
  toast(`Started ${p.name}. Give the first agent a task and the wires do the rest.`, 'ok');
  return { group: g, nodes };
}
function savePreset(g, w) {
  const members = groupMembers(g, w).filter((n) => n.type === 'console').sort((a, b) => a.x - b.x || a.y - b.y);
  if (!members.length) { toast('Put some consoles in this group first'); return; }
  const idx = new Map(members.map((n, i) => [n.id, i]));
  const wires = wiresOf(w).filter((x) => idx.has(x.from) && idx.has(x.to)).map((x) => [idx.get(x.from), idx.get(x.to), x.mode, x.pattern || '']);
  const p = { name: g.title, roles: members.map((n) => n.data.role || n.title), notes: members.map((n) => n.data.roleNote || ''), agents: members.map((n) => n.data.agent), wires };
  const list = (S.data.settings.presets = S.data.settings.presets || []);
  const at = list.findIndex((x) => x.name === p.name);
  if (at >= 0) list[at] = p; else list.push(p);
  save(); toast(`Saved "${p.name}" as a preset (${members.length} agents, ${wires.length} wires)`, 'ok');
}

// ====================================================================================
// 3) QUESTIONS AS BUTTONS
// ====================================================================================
export function parseQuestion(text) {
  const lines = text.split('\n').map((l) => l.replace(/^\s*[│┃|]\s?/, '').replace(/\s?[│┃|]\s*$/, ''));
  const opts = [];
  let first = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^\s*[❯›>]?\s*(\d)[.)]\s+(.+?)\s*$/);
    if (m) { opts.unshift({ key: m[1], label: m[2].replace(/\s*\((esc|shift\+tab|tab)\)\s*$/i, ''), cur: /^\s*[❯›>]/.test(lines[i]) }); first = i; }
    else if (opts.length && lines[i].trim()) break;
  }
  let q = '', qi = first;
  if (opts.length) {
    for (let i = first - 1; i >= Math.max(0, first - 8); i--) if (lines[i].trim()) { q = lines[i].trim(); qi = i; if (/[?:]$/.test(q)) break; }
  } else {
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 12); i--) {
      const l = lines[i];
      if (/\(y\/n\)|\[y\/n\]|\by\/N\b|\bY\/n\b/i.test(l)) { q = l.trim(); qi = i; opts.push({ key: 'y', label: 'Yes', enter: true }, { key: 'n', label: 'No', enter: true }); break; }
      if (/Press Enter/i.test(l)) { q = l.trim(); qi = i; opts.push({ key: '\r', label: 'Continue' }); break; }
    }
  }
  if (!opts.length) return null;
  const diff = [];
  for (let i = Math.max(0, qi - 40); i < qi; i++) { const l = lines[i]; if (/^\s*\d+\s+[+-]\s*\S/.test(l) && !/^\s*[-+]{3}/.test(l)) diff.push(l.replace(/^\s+/, '')); }
  return { q: q || 'The agent is asking:', opts: opts.slice(0, 6), diff: diff.slice(-8) };
}
function askCard(node) {
  const el = tileEl(node.id), body = el && el.querySelector('.tile-body'); if (!body) return;
  body.querySelector('.ask-card')?.remove();
  if (S.data.settings.askButtons === false) return;
  const parsed = parseQuestion(lastLines(node.id, 40)); if (!parsed) return;
  const press = (o) => {
    // the screen must still show the same question, or the click would land somewhere else
    const now = parseQuestion(lastLines(node.id, 40));
    if (!now || now.q !== parsed.q) { card.remove(); toast('That question already went away'); return; }
    window.argon.pty.write(node.id, o.key);
    if (o.enter) setTimeout(() => window.argon.pty.write(node.id, '\r'), 80);
    const r = rt(node.id); if (r) r.lastIn = Date.now();
    card.classList.add('gone'); setTimeout(() => card.remove(), 220);
  };
  const card = h('div', { class: 'ask-card' },
    h('div', { class: 'ask-q' }, h('span', { class: 'ask-ico' }, '?'), parsed.q),
    parsed.diff.length ? h('pre', { class: 'ask-diff' }, ...parsed.diff.map((l) => h('div', { class: /^\d*\s*\+/.test(l) ? 'add' : 'del' }, l))) : null,
    h('div', { class: 'ask-btns' }, ...parsed.opts.map((o, i) => h('button', { class: 'ask-b' + (i === 0 ? ' primary' : '') + (/^no\b/i.test(o.label) ? ' no' : ''), title: o.key === '\r' ? 'Enter' : 'Key ' + o.key, onclick: (e) => { e.stopPropagation(); press(o); } }, h('kbd', {}, o.key === '\r' ? '↵' : o.key), o.label))),
    h('button', { class: 'ask-x', title: 'Hide (answer in the terminal)', onclick: (e) => { e.stopPropagation(); card.remove(); } }, '✕'));
  card.addEventListener('pointerdown', (e) => e.stopPropagation());
  body.append(card);
  // Auto-approve: press the first "Yes" for you, unless the request looks destructive.
  if (S.data.settings.autoApprove) {
    const screen = lastLines(node.id, 40);
    const yes = parsed.opts.find((o) => /^(yes|y\b|allow|approve|continue|proceed)/i.test(o.label));
    if (yes && !RISKY_RE.test(screen)) {
      card.classList.add('auto');
      card.querySelector('.ask-q').append(h('span', { class: 'ask-auto' }, 'auto-approving…'));
      setTimeout(() => { if (card.isConnected && statusOf(node.id) === 'needs') press(yes); }, 900);
    } else if (yes) card.querySelector('.ask-q').append(h('span', { class: 'ask-auto risky' }, 'needs you: looks risky'));
  }
}
const RISKY_RE = /(rm\s+-rf?\b|Remove-Item\b.*-Recurse|\brmdir\b|\bdel\s+\/[sq]|git\s+push\b.*(--force|-f\b)|git\s+reset\s+--hard|git\s+clean\s+-[a-z]*f|drop\s+(table|database)|truncate\s+table|mkfs|format\s+[a-z]:|--no-verify|chmod\s+-R\s+777|curl\b[^|\n]*\|\s*(sh|bash|iex)|iwr\b[^|\n]*\|\s*iex)/i;

// ====================================================================================
// 4) CONTEXT GAUGE for Claude consoles
// ====================================================================================
const ctx = new Map(); // node id -> {used, limit, pct, file}
export const contextOf = (id) => ctx.get(id) || null;
async function pollContext() {
  if (!window.argon.claudeContext) return;
  const byCwd = new Map();
  for (const { node, ws: w } of allConsoles()) {
    if (node.data.agent !== 'claude') continue;
    const r = rt(node.id); if (!r || !r.alive || !r.hadOutput) continue;
    const cwd = node.data.cwd || w.cwd; (byCwd.get(cwd) || byCwd.set(cwd, []).get(cwd)).push({ node, r });
  }
  for (const [cwd, list] of byCwd) {
    let files = [];
    try { files = await window.argon.claudeContext(cwd, list.length + 3); } catch (_) {}
    const claimed = new Set();
    // a console started with its own session id owns that transcript, no guessing
    for (const c of list) { const s = c.node.data.session; const f = s && files.find((x) => String(x.file).replace(/\\/g, '/').endsWith('/' + s + '.jsonl')); if (f) c.r.ctxFile = f.file; }
    for (const c of list) if (c.r.ctxFile && files.some((f) => f.file === c.r.ctxFile)) claimed.add(c.r.ctxFile);
    // newest-active console gets the newest unclaimed transcript
    for (const c of list.filter((c) => !c.r.ctxFile || !claimed.has(c.r.ctxFile)).sort((a, b) => b.r.lastOut - a.r.lastOut)) {
      const f = files.find((f) => !claimed.has(f.file) && f.mtime > (c.r.startedAt || 0) - 5000 && Math.abs(f.mtime - c.r.lastOut) < 120000);
      if (f) { c.r.ctxFile = f.file; claimed.add(f.file); }
    }
    for (const c of list) {
      const f = files.find((f) => f.file === c.r.ctxFile);
      if (!f) continue;
      const limit = /\[1m\]|1m/i.test(f.model) || f.used > 200000 ? 1000000 : 200000;
      const v = { used: f.used, limit, pct: Math.min(100, Math.round(f.used / limit * 100)), model: f.model };
      const old = ctx.get(c.node.id);
      ctx.set(c.node.id, v);
      if (!old || old.pct !== v.pct) paintGauge(c.node);
    }
  }
}
function gaugeEl(node) {
  const el = tileEl(node.id); if (!el) return null;
  let g = el.querySelector('.ctx-gauge');
  if (!g) {
    g = h('button', { class: 'ctx-gauge', title: 'Context used' });
    g.innerHTML = '<svg viewBox="0 0 20 20"><circle class="bg" cx="10" cy="10" r="8"/><circle class="fg" cx="10" cy="10" r="8" pathLength="100"/></svg><span></span>';
    g.addEventListener('pointerdown', (e) => e.stopPropagation());
    g.onclick = (e) => { e.stopPropagation(); contextPopover(node, e.clientX, e.clientY); };
    el.querySelector('.tile-head .agent-badge')?.before(g);
  }
  return g;
}
function paintGauge(node) {
  const v = ctx.get(node.id), g = v && gaugeEl(node); if (!g) return;
  g.hidden = false;
  g.querySelector('.fg').style.strokeDasharray = `${v.pct} 100`;
  g.querySelector('span').textContent = v.pct + '%';
  g.classList.toggle('warn', v.pct >= 60 && v.pct < 85); g.classList.toggle('hot', v.pct >= 85);
  g.title = `Context: ${Math.round(v.used / 1000)}k of ${v.limit / 1000}k tokens (${v.pct}%). Click to compact or clear.`;
  emit('consoleMeta', node.id);
}
function gaugeMenu(node, x, y) {
  const v = ctx.get(node.id);
  showMenu(x, y, [
    { title: v ? `Context · ${Math.round(v.used / 1000)}k / ${v.limit / 1000}k` : 'Context' },
    { label: 'Compact', note: '/compact keeps a summary', onClick: () => { if (sendTo(node.id, '/compact')) toast(`Compacting ${node.title}`); } },
    { label: 'Clear', note: '/clear starts fresh', onClick: () => { if (sendTo(node.id, '/clear')) { toast(`Cleared ${node.title}`); const r = rt(node.id); if (r) r.ctxFile = null; ctx.delete(node.id); const g = tileEl(node.id)?.querySelector('.ctx-gauge'); if (g) g.hidden = true; } } },
  ]);
}

// ====================================================================================
// 5) HOLD SPACE TO DICTATE
// ====================================================================================
let holdT = 0, holding = false, rec = null;
function inputBox() { return document.querySelector('#cmdbar input') || document.querySelector('#askbar textarea'); }
export async function dictate() {
  if (!inputBox()) openCommandBar('');
  const input = inputBox(); if (!input) return;
  input.focus();
  document.getElementById('cmdbar')?.classList.add('listening');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR && S.data.settings.dictation !== 'windows') {
    try {
      rec = new SR(); rec.interimResults = true; rec.continuous = true; rec.lang = navigator.language || 'en-US';
      const base = input.value ? input.value + ' ' : '';
      rec.onresult = (ev) => { let t = ''; for (const r of ev.results) t += r[0].transcript; input.value = base + t; input.dispatchEvent(new Event('input', { bubbles: true })); };
      rec.onerror = async (ev) => { rec = null; if (ev.error === 'network' || ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { S.data.settings.dictation = 'windows'; save(); await winDictate(input); } };
      rec.onend = () => { rec = null; document.getElementById('cmdbar')?.classList.remove('listening'); };
      rec.start();
      return;
    } catch (_) { rec = null; }
  }
  await winDictate(input);
}
async function winDictate(input) {
  input.focus();
  const ok = window.argon.dictateWin && await window.argon.dictateWin();
  if (ok) toast('Speak now. Windows voice typing is writing into the bar. Press Enter to send.');
  else { document.getElementById('cmdbar')?.classList.remove('listening'); toast('Dictation is not available here. On Windows, press Win+H in any text box.', 'warn'); }
}
function stopDictate() { if (rec) { try { rec.stop(); } catch (_) {} } }
function initDictation() {
  addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat || isTyping(e) || S.data.settings.holdToTalk === false) return;
    clearTimeout(holdT);
    holdT = setTimeout(() => { holding = true; document.body.classList.remove('space-pan'); dictate(); }, 450);
  }, true);
  const cancel = () => clearTimeout(holdT);
  addEventListener('pointerdown', cancel, true);
  addEventListener('keyup', (e) => { if (e.code !== 'Space') return; clearTimeout(holdT); if (holding) { holding = false; stopDictate(); } }, true);
  addEventListener('blur', cancel);
}

// ====================================================================================
// wiring it all in
// ====================================================================================
function decorate(node, el, w) {
  if (node.type === 'group' && !isPipe(node)) {
    if (!el.querySelector(':scope > .wire-dot')) {
      const dot = h('div', { class: 'wire-dot', title: 'Drag onto a console or another group: everyone in this group hands over together' });
      dot.addEventListener('pointerdown', (e) => { if (e.button === 0) dragWire(w, node, e); });
      el.append(dot);
    }
    return;
  }
  if (node.type !== 'console' || isPipe(node)) return;
  if (!el.querySelector(':scope > .wire-dot')) {
    const dot = h('div', { class: 'wire-dot', title: 'Drag onto another console to hand work over' });
    dot.addEventListener('pointerdown', (e) => { if (e.button === 0) dragWire(w, node, e); });
    el.append(dot);
  }
  if (!el.querySelector(':scope > .tell')) {
    // A box to give this console a task without clicking into the terminal.
    const inp = h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false' });
    const bar = h('form', { class: 'tell' }, inp, h('button', { type: 'submit', title: 'Send (Enter)', 'aria-label': 'Send' }, '↵'));
    const name = () => node.title || node.data.agent || 'this console';
    const paint = () => { inp.placeholder = node.data.agent === 'shell' ? `Run a command in ${name()}…` : `Tell ${name()} what to do…`; inp.setAttribute('aria-label', inp.placeholder); };
    paint(); inp.addEventListener('focus', paint);
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    bar.addEventListener('submit', (e) => {
      e.preventDefault(); const v = inp.value.trim(); if (!v) return;
      if (!sendTo(node.id, v)) { toast(`${name()} isn't running. Restart it first`); return; }
      inp.value = '';
      const out = (w.wires || []).filter((x) => x.from === node.id).map((x) => findNode(x.to)?.node.title).filter(Boolean);
      if (out.length) toast(`Sent. When ${name()} finishes, its wire hands off to ${out.join(' and ')}`);
    });
    el.append(bar);
  }
  if (node.data.agent === 'claude' && ctx.has(node.id)) paintGauge(node);
}

export function initTeamwork() {
  const prev = tileHooks.decorate;
  tileHooks.decorate = (node, el, w) => { if (prev) prev(node, el, w); decorate(node, el, w); };
  const prevItems = tileHooks.groupItems;
  tileHooks.groupItems = (g, w) => [...(prevItems ? prevItems(g, w) : []), { label: 'Save as preset', note: 'team + wires', onClick: () => savePreset(g, w) }];
  // decorate tiles that mounted before we got here
  for (const w of S.data.workspaces) for (const n of w.nodes) { const el = tileEl(n.id); if (el) decorate(n, el, w); }
  // forget wires whose consoles were closed
  on('nodes', () => { for (const w of S.data.workspaces) if (w.wires && w.wires.length) { const ids = new Set(w.nodes.map((n) => n.id)); const keep = w.wires.filter((x) => ids.has(x.from) && ids.has(x.to)); if (keep.length !== w.wires.length) { w.wires = keep; save(); } } });
  on('status', (id, st) => {
    const f = findNode(id); if (!f || f.node.type !== 'console') return;
    if (st === 'needs') setTimeout(() => statusOf(id) === 'needs' && askCard(f.node), 250);
    else tileEl(id)?.querySelector('.ask-card')?.remove();
  });
  setInterval(engine, 500);
  setInterval(pollContext, 5000); setTimeout(pollContext, 1500);
  paced(draw);
  initDictation();
  const pb = document.querySelector('#dock [data-add="presets"]');
  if (pb) pb.onclick = () => { if (window.__argonChrome) window.__argonChrome.openTeams(); else { const r = pb.getBoundingClientRect(); presetMenu(r.right + 8, r.top); } };
  window.__argonTeam = { addWire, spawnTeam, parseQuestion, replyText, dictate, contextOf, BUILTIN };
}
