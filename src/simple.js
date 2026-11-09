// The Simple view: a Claude console shown as a plain conversation instead of a terminal.
// The real terminal keeps running underneath, one click away (Simple | Terminal in the header).
// Argon reads Claude's own transcript (~/.claude/projects/<folder>/<session>.jsonl) for what was asked,
// what it replied and each step it took; a question on screen becomes a card with buttons; the write box
// never locks: a message written while the agent is busy waits for its turn and can be taken back.
import { S, h, on, emit, save, toast, findNode, allConsoles } from './state.js';
import { tileEl, tileHooks } from './tiles.js';
import { rt, statusOf, sendTo, lastLines } from './consoles.js';
import { parseQuestion, contextOf } from './teamwork.js';
import { renderMarkdown, wireLinks } from './markdown.js';
import { agentByKey } from './agents.js';

const views = new Map(); // node id -> view state
const isClaude = (n) => n && n.type === 'console' && n.data.agent === 'claude';
export const viewOf = (n) => (isClaude(n) ? n.data.view || (S.data.settings.simpleDefault === false ? 'terminal' : 'simple') : 'terminal');
const base = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || String(p || '');
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// ---------- status in plain words ----------
export function statusWord(id) {
  const st = statusOf(id), r = rt(id);
  if (st === 'working') return ['working', 'Working'];
  if (st === 'needs') return ['needs', 'Needs you'];
  if (st === 'starting') return ['starting', 'Starting'];
  if (st === 'exited' || !r || !r.alive) return ['exited', 'Stopped'];
  const asked = Math.max(r.lastSend || 0, r.lastIn || 0);
  return asked && r.lastOut > asked + 400 && r.sawWork ? ['done', 'Done'] : ['ready', 'Ready'];
}

// ---------- the transcript as a conversation ----------
function describe(name, input = {}) {
  const f = base(input.file_path || input.path || input.notebook_path || '');
  const cmd = clip(input.command || '', 90);
  switch (name) {
    case 'Read': return [`Reading ${f}`, `Read ${f}`];
    case 'Write': return [`Writing ${f}`, `Wrote ${f}`];
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return [`Editing ${f}`, `Edited ${f}`];
    case 'Bash': case 'PowerShell': return [`Running ${cmd}`, `Ran ${cmd}`];
    case 'Grep': return [`Searching for "${clip(input.pattern, 40)}"`, `Searched for "${clip(input.pattern, 40)}"`];
    case 'Glob': return [`Looking for ${clip(input.pattern, 40)}`, `Looked for ${clip(input.pattern, 40)}`];
    case 'WebFetch': { let host = ''; try { host = new URL(input.url).host; } catch (_) {} return [`Reading ${host || 'a web page'}`, `Read ${host || 'a web page'}`]; }
    case 'WebSearch': return [`Searching the web for "${clip(input.query, 40)}"`, `Searched the web for "${clip(input.query, 40)}"`];
    case 'Task': case 'Agent': return [`Asking a helper: ${clip(input.description || input.prompt, 50)}`, `Asked a helper: ${clip(input.description || input.prompt, 50)}`];
    case 'TodoWrite': return ['Updating its to-do list', 'Updated its to-do list'];
    default: return [`Using ${name}`, `Used ${name}`];
  }
}
const NOT_TYPED = /^(<(command-|local-command|system-reminder|bash-|task-notification|user-prompt)|Caveat:)/;
// What Argon itself adds to a message (the board hint) stays out of the bubble.
const ARGON_HINT = /^\[Argon\] You share a live whiteboard with the user\.[^\n]*\n*/;
export function readConversation(jsonl, limit = 220) {
  const items = [], tools = new Map();
  let usage = null;
  for (const raw of String(jsonl).split('\n')) {
    if (!raw || raw[0] !== '{') continue;
    let e; try { e = JSON.parse(raw); } catch (_) { continue; }
    if ((e.type !== 'user' && e.type !== 'assistant') || e.isMeta || e.isSidechain || e.isCompactSummary || e.isVisibleInTranscriptOnly) continue;
    if (e.type === 'assistant' && e.message && e.message.usage) usage = { u: e.message.usage, model: e.message.model || '' };
    const content = typeof (e.message && e.message.content) === 'string' ? [{ type: 'text', text: e.message.content }] : (e.message && e.message.content) || [];
    for (const c of content) {
      if (c.type === 'tool_use') {
        const [doing, done] = describe(c.name, c.input);
        const step = { k: 'step', text: doing, pending: true };
        items.push(step); tools.set(c.id, { step, doing, done });
      } else if (c.type === 'tool_result' && tools.has(c.tool_use_id)) {
        const t = tools.get(c.tool_use_id);
        t.step.pending = false; t.step.text = t.done;
        if (c.is_error) {
          const why = JSON.stringify(c.content || '');
          t.step.text = (/doesn't want|rejected|denied/i.test(why) ? 'You said no: ' : /interrupted/i.test(why) ? 'Stopped: ' : 'Failed: ') + t.doing.charAt(0).toLowerCase() + t.doing.slice(1);
          t.step.failed = true;
        }
      } else if (c.type === 'text' && c.text && c.text.trim()) {
        const text = c.text.trim();
        if (e.type === 'assistant') items.push({ k: 'agent', text });
        else if (text.startsWith('[Request interrupted')) items.push({ k: 'note', text: 'Stopped here' });
        else if (!NOT_TYPED.test(text)) items.push({ k: 'user', text: text.replace(ARGON_HINT, '') });
      }
    }
  }
  return { items: items.slice(-limit), usage };
}

// ---------- the question on screen ----------
// The lines above the question inside Claude's box: "Edit file", the path and the change, or the command.
function questionDetail(screen, q) {
  const lines = screen.split('\n').map((l) => l.replace(/^\s*[│┃|]\s?/, '').replace(/\s?[│┃|]\s*$/, ''));
  let at = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim() === q) { at = i; break; }
  if (at < 0) return [];
  const out = [];
  for (let i = at - 1; i >= Math.max(0, at - 24); i--) {
    const l = lines[i];
    if (/^\s*[╭┌╰└]|^\s*[─━╌┄]{6,}/.test(l)) break;
    out.unshift(l.replace(/\s+$/, ''));
  }
  while (out.length && !out[0].trim()) out.shift();
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.slice(-18);
}

// ---------- the view ----------
function build(node, el, w) {
  const body = el.querySelector('.tile-body');
  const old = views.get(node.id);
  if (old && old.el === el) return old;
  if (!body) return old;
  if (old) { old.root.remove(); views.delete(node.id); } // the tile was rebuilt: start over, keep what was waiting
  const name = () => node.title || 'Claude';
  const strip = h('div', { class: 'sv-strip' }, h('span', { class: 'd' }), h('span', { class: 't' }));
  const list = h('div', { class: 'sv-list' });
  const ask = h('div', { class: 'sv-ask', hidden: true });
  const held = h('div', { class: 'sv-held', hidden: true });
  const input = h('textarea', { rows: 1, spellcheck: 'true' });
  const stopB = h('button', { class: 'sv-stop', title: 'Stop what it is doing (Esc)', hidden: true, type: 'button' }, h('i'));
  const sendB = h('button', { class: 'sv-send', title: 'Send (Enter). Shift+Enter for a new line', type: 'button' }, '↑');
  const box = h('div', { class: 'sv-box' }, input, stopB, sendB);
  const root = h('div', { class: 'sv' }, strip, list, ask, held, box);
  root.addEventListener('pointerdown', (e) => { if (!e.target.closest('.sv-list') || e.target.closest('a, button, summary')) e.stopPropagation(); });
  root.addEventListener('wheel', (e) => { if (e.target.closest('.sv-list, .sv-ask, textarea') && !e.ctrlKey) e.stopPropagation(); }, { passive: true });
  wireLinks(list);
  body.append(root);
  const v = { node, w, el, root, strip, list, ask, held, input, stopB, sendB, items: [], sig: '', size: null, file: null, pinned: true, queue: old ? old.queue : [], optimistic: [], askSig: '' };
  views.set(node.id, v);

  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(140, input.scrollHeight) + 'px'; };
  const submit = () => {
    const t = input.value.trim(); if (!t) return;
    input.value = ''; grow();
    deliver(v, t);
  };
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    if (e.key === 'Escape') { input.blur(); }
  });
  sendB.addEventListener('click', (e) => { e.stopPropagation(); submit(); });
  stopB.addEventListener('click', (e) => { e.stopPropagation(); window.argon.pty.write(node.id, '\x1b'); toast(`Asked ${name()} to stop`); });
  list.addEventListener('scroll', () => { v.pinned = list.scrollHeight - list.scrollTop - list.clientHeight < 40; });
  paintChrome(v); paintHeld(v);
  return v;
}

// A message goes in now if the agent can take it, otherwise it waits (and can be taken back).
function deliver(v, text, quiet = false) {
  const st = statusOf(v.node.id);
  if (st === 'exited') { if (!quiet) toast(`${v.node.title} isn't running. Restart it from the ⋯ menu`, 'warn'); return false; }
  if (st === 'working' || st === 'needs' || st === 'starting' || v.queue.length) { v.queue.push(text); paintHeld(v); return true; }
  return send(v, text);
}
function send(v, text) {
  if (!sendTo(v.node.id, text)) { toast(`${v.node.title} isn't running`, 'warn'); return false; }
  const r = rt(v.node.id); if (r) r.sawWork = false;
  v.optimistic.push({ k: 'user', text, pending: true, at: Date.now() });
  v.pinned = true; paintList(v, true);
  return true;
}
function paintHeld(v) {
  v.held.replaceChildren();
  v.held.hidden = !v.queue.length;
  v.queue.forEach((t, i) => v.held.append(h('div', { class: 'sv-held-row' },
    h('span', { class: 'sv-held-t' }, `Waits for its turn: ${clip(t, 90)}`),
    h('button', { type: 'button', onclick: (e) => { e.stopPropagation(); const [back] = v.queue.splice(i, 1); paintHeld(v); if (!v.input.value.trim()) { v.input.value = back; v.input.dispatchEvent(new Event('input')); v.input.focus(); } } }, 'Take back'))));
}
function pump(v) {
  if (!v.queue.length) return;
  const st = statusOf(v.node.id);
  if (st !== 'resting') return;
  const r = rt(v.node.id); if (r && Date.now() - (r.lastOut || 0) < 900) return; // let the screen settle
  const t = v.queue.shift(); paintHeld(v); send(v, t);
}

function paintChrome(v) {
  const id = v.node.id, [cls, word] = statusWord(id), st = statusOf(id), name = v.node.title || 'Claude';
  const last = [...v.items].reverse().find((x) => x.k === 'step' && x.pending);
  const line = st === 'working' ? (last ? last.text : 'Thinking…')
    : st === 'needs' ? 'Waiting for your answer'
    : st === 'starting' ? 'Starting Claude…'
    : cls === 'exited' ? 'Stopped. Restart it from the ⋯ menu'
    : cls === 'done' ? 'Finished. Tell it what to do next'
    : 'Ready for your instructions';
  v.strip.className = 'sv-strip ' + cls;
  v.strip.querySelector('.t').textContent = line;
  v.input.placeholder = st === 'needs' ? 'Write now, it goes after your answer' : st === 'working' ? `Write now, it goes when ${name} is free` : `Tell ${name} what to do…`;
  v.stopB.hidden = st !== 'working';
  v.sendB.classList.toggle('wait', st === 'working' || st === 'needs');
  paintAsk(v);
}

function stepsEl(steps, open) {
  const ul = h('ul');
  for (const s of steps) ul.append(h('li', { class: s.failed ? 'failed' : s.pending ? 'pending' : '' }, h('i'), s.text));
  if (steps.length < 4) return h('div', { class: 'sv-steps' }, ul);
  const d = h('details', { class: 'sv-steps' }, h('summary', {}, `${steps.length} steps`), ul);
  if (open) d.open = true;
  return d;
}
function paintList(v, force) {
  // what you sent shows at once, until the transcript has it
  v.optimistic = v.optimistic.filter((o) => Date.now() - o.at < 120000 && !v.items.some((x) => x.k === 'user' && x.text.trim().slice(0, 60) === o.text.trim().slice(0, 60)));
  const all = v.items.concat(v.optimistic);
  const sig = all.length + '|' + all.map((x) => x.k[0] + (x.pending ? 'p' : '') + (x.failed ? 'f' : '') + x.text.length).join(',');
  if (!force && sig === v.sig) return;
  v.sig = sig;
  const list = v.list, working = statusOf(v.node.id) === 'working';
  const frag = document.createDocumentFragment();
  if (!all.length) {
    frag.append(h('div', { class: 'sv-empty' }, `Tell ${v.node.title || 'Claude'} what to do, in your own words. It works in this folder and tells you what it did.`));
  } else {
    let run = null;
    all.forEach((it, i) => {
      if (it.k === 'step') { (run = run || []).push(it); if (all[i + 1] && all[i + 1].k === 'step') return; frag.append(stepsEl(run, working && i === all.length - 1)); run = null; return; }
      if (it.k === 'user') frag.append(h('div', { class: 'sv-user' + (it.pending ? ' pending' : '') }, it.text));
      else if (it.k === 'note') frag.append(h('div', { class: 'sv-note' }, it.text));
      else { const d = h('div', { class: 'sv-agent md' }); d.innerHTML = renderMarkdown(it.text); frag.append(d); }
    });
  }
  list.replaceChildren(frag);
  if (v.pinned) list.scrollTop = list.scrollHeight;
}

function paintAsk(v) {
  const id = v.node.id;
  if (statusOf(id) !== 'needs' || S.data.settings.askButtons === false) { if (!v.ask.hidden) { v.ask.hidden = true; v.ask.replaceChildren(); v.askSig = ''; } return; }
  const screen = lastLines(id, 60), parsed = parseQuestion(screen);
  if (!parsed) { v.ask.hidden = true; return; }
  const detail = questionDetail(screen, parsed.q);
  const sig = parsed.q + '|' + parsed.opts.map((o) => o.label).join('|') + '|' + detail.length;
  if (sig === v.askSig && !v.ask.hidden) return;
  v.askSig = sig;
  const press = (o) => {
    const now = parseQuestion(lastLines(id, 60));
    if (!now || now.q !== parsed.q) { toast('That question already went away'); v.askSig = ''; paintAsk(v); return; }
    // the option you press is the key you would type, nothing more
    window.argon.pty.write(id, o.key);
    if (o.enter) setTimeout(() => window.argon.pty.write(id, '\r'), 80);
    const r = rt(id); if (r) r.lastIn = Date.now();
    v.ask.classList.add('gone');
    setTimeout(() => { v.ask.classList.remove('gone'); v.ask.hidden = true; v.askSig = ''; }, 220);
  };
  v.ask.replaceChildren(
    h('div', { class: 'q' }, parsed.q),
    detail.length ? h('pre', {}, ...detail.map((l) => h('div', { class: /^\s*\d+\s*\+/.test(l) ? 'add' : /^\s*\d+\s*-/.test(l) ? 'del' : '' }, l || ' '))) : null,
    ...parsed.opts.map((o, i) => h('button', { type: 'button', class: 'opt' + (i === 0 ? ' primary' : ''), title: o.key === '\r' ? 'Presses Enter' : `Presses ${o.key}`, onclick: (e) => { e.stopPropagation(); press(o); } }, o.label)),
    h('button', { type: 'button', class: 'opt term', title: 'Answer in the real terminal', onclick: (e) => { e.stopPropagation(); setView(v.node, 'terminal'); } }, h('span', { class: 'ti' }, '›_'), 'Terminal'));
  v.ask.hidden = false;
  if (v.pinned) requestAnimationFrame(() => { v.list.scrollTop = v.list.scrollHeight; });
}

// ---------- reading ----------
async function refresh(v) {
  const n = v.node, r = rt(n.id);
  if (!r || !window.argon.claudeTranscript) return;
  const session = n.data.session || null, file = session ? null : r.ctxFile || null;
  if (!session && !file) return;
  const prof = S.data.profiles.find((p) => p.id === n.data.profile);
  let res;
  try { res = await window.argon.claudeTranscript({ cwd: n.data.cwd || v.w.cwd, session, file, profile: prof && prof.dir, known: v.size }); } catch (_) { return; }
  if (!res || !res.ok || res.same) return;
  v.size = res.size; v.file = res.file;
  const { items } = readConversation(res.text || '');
  v.items = items;
  if (items.some((x) => x.k === 'step' || x.k === 'agent')) r.sawWork = true;
  paintList(v);
}

let busy = false;
async function tick() {
  if (busy) return; busy = true;
  try {
    const hidden = document.hidden || !document.hasFocus();
    for (const v of views.values()) {
      if (!v.el.isConnected) { views.delete(v.node.id); continue; }
      paintChrome(v); pump(v);
      if (v.el.offsetParent === null || viewOf(v.node) !== 'simple') continue;
      const r = rt(v.node.id); if (!r) continue;
      const due = hidden ? 4000 : statusOf(v.node.id) === 'working' ? 800 : 2000;
      if (Date.now() - (v.readAt || 0) < due && !(r.lastOut > (v.readAt || 0))) continue;
      v.readAt = Date.now();
      await refresh(v);
    }
  } finally { busy = false; }
}

// ---------- header: Simple | Terminal, the status in words, the size ----------
export function setView(node, view) {
  node.data.view = view; save();
  const el = tileEl(node.id); if (!el) return;
  el.classList.toggle('simple', view === 'simple');
  el.querySelectorAll('.view-seg button').forEach((b) => b.classList.toggle('on', b.dataset.v === view));
  const r = rt(node.id);
  if (view === 'terminal' && r) { setTimeout(() => { try { r.fit.fit(); r.term.focus(); } catch (_) {} }, 30); }
  if (view === 'simple') { const v = views.get(node.id); if (v) { v.readAt = 0; v.sig = ''; setTimeout(() => v.input.focus(), 30); } }
}

function decorate(node, el, w) {
  if (node.type !== 'console' || (node.data && node.data.space === 'pipe')) return;
  const head = el.querySelector('.tile-head'), title = head && head.querySelector('.tile-title');
  if (!head || head.querySelector('.st-pill')) return;
  const agent = agentByKey(node.data.agent, S.data.customAgents);
  const mark = h('span', { class: 'agent-mark', title: agent.name, style: { '--ac': agent.color } }, agent.key === 'claude' ? '✳' : agent.key === 'shell' ? '›' : agent.name.charAt(0));
  head.prepend(mark);
  const note = h('span', { class: 'role-note', title: node.data.roleNote || '' }, node.data.roleNote || '');
  title.after(note);
  const size = h('span', { class: 'size-tag', title: 'Exact size: right-click the header to pick one' });
  const pill = h('span', { class: 'st-pill' });
  const extras = title.parentNode.querySelector('.row');
  if (isClaude(node)) {
    const seg = h('span', { class: 'view-seg seg' },
      h('button', { type: 'button', 'data-v': 'simple', title: 'Show it as a conversation' }, 'Simple'),
      h('button', { type: 'button', 'data-v': 'terminal', title: 'Show the real terminal' }, 'Terminal'));
    seg.addEventListener('pointerdown', (e) => e.stopPropagation());
    seg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { e.stopPropagation(); setView(node, b.dataset.v); } });
    (extras || head).append(size, seg, pill);
    build(node, el, w);
    setView(node, viewOf(node));
  } else (extras || head).append(size, pill);
  const paint = () => {
    const [cls, word] = statusWord(node.id);
    pill.className = 'st-pill ' + cls; pill.textContent = word;
    el.dataset.st = cls;
    size.textContent = `${Math.round(node.w)} × ${Math.round(node.h)}`;
    note.textContent = node.data.roleNote || ''; note.title = node.data.roleNote || '';
  };
  paint();
  el._svPaint = paint;
}

export function initSimple() {
  const prev = tileHooks.decorate;
  tileHooks.decorate = (node, el, w) => { if (prev) prev(node, el, w); decorate(node, el, w); };
  for (const { node, ws: w } of allConsoles()) { const el = tileEl(node.id); if (el) decorate(node, el, w); }
  on('status', (id) => { const el = tileEl(id); if (el && el._svPaint) el._svPaint(); const v = views.get(id); if (v) { if (statusOf(id) === 'working') { const r = rt(id); if (r) r.sawWork = true; } paintChrome(v); } });
  on('nodes', () => { for (const { node } of allConsoles()) { const el = tileEl(node.id); if (el && el._svPaint) el._svPaint(); } });
  on('consoleMeta', (id) => { const el = tileEl(id); if (el && el._svPaint) el._svPaint(); });
  setInterval(tick, 400);
  window.__argonSimple = { views, readConversation, setView, statusWord, deliver };
}
