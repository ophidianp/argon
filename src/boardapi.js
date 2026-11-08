// The board as a shared whiteboard for agents.
// Argon keeps <project>/.argon/board/BOARD.md up to date: every tile with its id, place and contents, the
// groups, agents and wires, plus how to change things. An agent changes the board by writing a JSON file
// into .argon/board/inbox/. Argon applies it within a couple of seconds, deletes it, and writes what happened
// to .argon/board/results/<same name>. The first message Argon sends an agent points it at BOARD.md.
import { S, ws, save, emit, on, toast } from './state.js';
import { addNode, removeNode, fitGroup, groupMembers, groupTag, remountTile, retagAll, place } from './tiles.js';
import { statusOf, sendTo } from './consoles.js';
import { agentByKey } from './agents.js';
import { sendTeamMessage, teamFile, teamOf } from './teamtalk.js';

const win = () => window.argon.platform === 'win32';
const sep = () => (win() ? '\\' : '/');
const dirOf = (w) => { const c = (w.cwd || '').replace(/[\\/]+$/, ''); if (!c) return null; const s = sep(); return (win() ? c.replace(/\//g, '\\') : c) + s + '.argon' + s + 'board'; };
export const boardFile = (w) => { const d = dirOf(w); return d && d + sep() + 'BOARD.md'; };
const enabled = () => S.data.settings.boardForAgents !== false;

const ADDABLE = ['note', 'checklist', 'text', 'kanban', 'web', 'files', 'calendar'];
const one = (s, n = 400) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const nameOf = (w, n) => (n.type === 'group' ? `group "${n.title}"` : n.title);

function describe(w, n) {
  const at = `at (${Math.round(n.x)}, ${Math.round(n.y)}) ${Math.round(n.w)}×${Math.round(n.h)}`;
  const g = n.data.groupId && w.nodes.find((x) => x.id === n.data.groupId);
  const inG = g ? `, in group "${g.title}"` : '';
  const d = n.data || {};
  switch (n.type) {
    case 'note': return `- note \`${n.id}\` ${at}${inG}: "${one(d.text)}"`;
    case 'text': return `- text \`${n.id}\` ${at}${inG}: "${one(d.text)}"`;
    case 'checklist': return `- checklist \`${n.id}\` "${n.title}" ${at}${inG}:\n` + (d.items || []).map((it, i) => `    ${i}. [${it.done ? 'x' : ' '}] ${one(it.t, 200)}`).join('\n');
    case 'kanban': return `- kanban \`${n.id}\` "${n.title}" ${at}${inG}:\n` + (d.cols || []).map((c) => `    ${c.name}: ${c.cards.map((k) => `"${one(k.t, 120)}"`).join(', ') || '(empty)'}`).join('\n');
    case 'web': return `- web preview \`${n.id}\` ${at}${inG}: ${d.url}`;
    case 'files': return `- files \`${n.id}\` ${at}${inG}: ${d.root || w.cwd}`;
    case 'calendar': return `- calendar \`${n.id}\` ${at}${inG}`;
    case 'git': return `- git card \`${n.id}\` ${at}${inG}`;
    case 'image': return `- image \`${n.id}\` ${at}${inG}`;
    case 'prompter': return `- prompter \`${n.id}\` "${n.title}" ${at}: prompt "${one(d.goal, 200)}"`;
    case 'manager': case 'secretary': return `- ${n.type} \`${n.id}\` "${n.title}" ${at}`;
    default: return `- ${n.type} \`${n.id}\` ${at}${inG}`;
  }
}

function snapshot(w) {
  const inbox = dirOf(w) + sep() + 'inbox', results = dirOf(w) + sep() + 'results';
  const tiles = w.nodes.filter((n) => !['console', 'group'].includes(n.type) && !(n.data && n.data.space === 'pipe'));
  const cons = w.nodes.filter((n) => n.type === 'console' && !(n.data && n.data.space === 'pipe'));
  const groups = w.nodes.filter((n) => n.type === 'group');
  const title = (id) => { const n = w.nodes.find((x) => x.id === id); return n ? nameOf(w, n) : id; };
  return [
    `# Argon board: ${w.name}`,
    '',
    'This is the live whiteboard in Argon, the app you are running in. The user sees the same board and can change it too.',
    'Argon rewrites this file whenever the board changes, so read it again before acting on it.',
    '',
    '## How to change the board',
    `Write a JSON file (any name ending in .json) into: ${inbox}`,
    `Argon applies it within a couple of seconds, deletes it, and writes what happened to: ${results}`,
    'The file holds one action or a list of actions:',
    '```json',
    '{"do":"add","type":"note","text":"Remember to bump the version","x":100,"y":200}',
    '{"do":"add","type":"checklist","title":"Release","items":["Tests","Changelog"],"group":"Research"}',
    '{"do":"add","type":"text","text":"Phase 2","x":0,"y":-80}',
    '{"do":"add","type":"kanban","title":"Plan","columns":{"To do":["Spec"],"Doing":[],"Done":[]}}',
    '{"do":"add","type":"web","url":"http://localhost:3000"}',
    '{"do":"add","type":"files","path":"C:\\\\path\\\\to\\\\folder"}',
    '{"do":"edit","id":"<id>","text":"new text","title":"new title"}',
    '{"do":"edit","id":"<checklist id>","items":["a","b"],"check":[0],"uncheck":[1]}',
    '{"do":"move","id":"<id>","x":400,"y":120,"w":320,"h":240}',
    '{"do":"group","ids":["<id>","<id>"],"title":"Research"}',
    '{"do":"wire","from":"<console or group id>","to":"<console or group id>","mode":"done"}',
    '{"do":"say","from":"<your console name>","to":"<console name or id>","text":"a message or a task for that agent"}',
    '{"do":"delete","id":"<id>"}',
    '```',
    'Types you can add: ' + ADDABLE.join(', ') + '. Positions are board pixels: x grows to the right, y grows down.',
    'Put new tiles next to related ones and do not cover other tiles. Agent consoles cannot be added or deleted this way.',
    'Wire modes: done (hand over when finished), reply (every reply), if (only if the reply matches "pattern"), review (until APPROVED), context (share once).',
    'A "say" message waits until that agent is free, then it is typed in, so it never cuts into their work. Always fill in "from".',
    '',
    `## Tiles (${tiles.length})`,
    ...(tiles.length ? tiles.map((n) => describe(w, n)) : ['(none)']),
    '',
    `## Agent consoles (${cons.length})`,
    ...(cons.length ? cons.map((n) => { const g = n.data.groupId && w.nodes.find((x) => x.id === n.data.groupId); return `- ${n.title} \`${n.id}\` ${agentByKey(n.data.agent, S.data.customAgents).name}, ${statusOf(n.id)}, at (${Math.round(n.x)}, ${Math.round(n.y)})${g ? `, in group "${g.title}"` : ''}`; }) : ['(none)']),
    '',
    `## Groups (${groups.length})`,
    ...(groups.length ? groups.map((g) => `- "${g.title}" \`${g.id}\` #${groupTag(g)}: ${groupMembers(g, w).map((m) => m.title).join(', ') || '(empty)'}`) : ['(none)']),
    '',
    `## Teams`,
    'Everyone in a group is one team: they work TOGETHER, split the work in their team file, and hand tasks to each other with "say" messages.',
    ...(groups.filter((g) => teamOf(w, g).length > 1).map((g) => `- #${groupTag(g)}: ${teamOf(w, g).map((m) => m.title).join(', ')}. Team file: ${teamFile(w, g)}`)),
    ...(groups.some((g) => teamOf(w, g).length > 1) ? [] : ['(no group has two or more agents)']),
    '',
    `## Wires (${(w.wires || []).length})`,
    ...((w.wires || []).length ? w.wires.map((x) => `- ${title(x.from)} → ${title(x.to)} (${x.mode}${x.paused ? ', paused' : ''})`) : ['(none)']),
    '',
  ].join('\n');
}

// ---------- applying what agents ask for ----------
const findIn = (w, ref) => w.nodes.find((n) => n.id === ref) || w.nodes.find((n) => n.title === ref) || w.nodes.find((n) => n.type === 'group' && groupTag(n) === String(ref).replace(/^#/, ''));
const num = (v, d) => (Number.isFinite(+v) ? +v : d);

function apply(w, a) {
  const what = String(a.do || a.action || '').toLowerCase();
  if (what === 'add') {
    const type = String(a.type || 'note').toLowerCase();
    if (!ADDABLE.includes(type)) throw new Error(`can't add a "${type}". Types: ${ADDABLE.join(', ')}`);
    const data = {};
    if (type === 'note' || type === 'text') data.text = String(a.text ?? '');
    if (type === 'checklist') data.items = (a.items || ['']).map((t) => (typeof t === 'object' ? { t: String(t.t ?? t.text ?? ''), done: !!t.done } : { t: String(t), done: false }));
    if (type === 'kanban' && a.columns) data.cols = Object.entries(a.columns).map(([name, cards]) => ({ name, cards: (cards || []).map((t) => ({ t: String(t) })) }));
    if (type === 'web') data.url = String(a.url || 'http://localhost:3000');
    if (type === 'files' && a.path) data.root = String(a.path);
    const opts = { ws: w, quiet: true };
    if (a.x != null) { opts.x = num(a.x, 0); opts.y = num(a.y, 0); }
    if (a.w) opts.w = num(a.w); if (a.h) opts.h = num(a.h);
    if (a.title) opts.title = String(a.title).slice(0, 80);
    const n = addNode(type, data, opts);
    if (a.group) { const g = findIn(w, a.group); if (g && g.type === 'group') { n.data.groupId = g.id; fitGroup(g, w); retagAll(w); } }
    return { ok: true, id: n.id, did: `added ${type} ${n.id}` };
  }
  const n = a.id != null ? findIn(w, a.id) : null;
  if (what === 'edit') {
    if (!n) throw new Error(`no tile "${a.id}"`);
    if (a.title != null) n.title = String(a.title).slice(0, 80);
    if (a.text != null && 'text' in n.data) n.data.text = String(a.text);
    if (a.url != null && n.type === 'web') n.data.url = String(a.url);
    if (n.type === 'checklist') {
      if (Array.isArray(a.items)) n.data.items = a.items.map((t) => (typeof t === 'object' ? { t: String(t.t ?? t.text ?? ''), done: !!t.done } : { t: String(t), done: false }));
      if (Array.isArray(a.add)) n.data.items.push(...a.add.map((t) => ({ t: String(t), done: false })));
      for (const i of a.check || []) if (n.data.items[i]) n.data.items[i].done = true;
      for (const i of a.uncheck || []) if (n.data.items[i]) n.data.items[i].done = false;
    }
    if (n.type === 'kanban' && a.columns) n.data.cols = Object.entries(a.columns).map(([name, cards]) => ({ name, cards: (cards || []).map((t) => ({ t: String(t) })) }));
    if (n.type === 'console' || n.type === 'group') { const el = document.querySelector(`.tile[data-id="${n.id}"] .tile-title`); if (el) el.textContent = n.title; }
    else remountTile(n, w);
    return { ok: true, did: `edited ${n.id}` };
  }
  if (what === 'move') {
    if (!n) throw new Error(`no tile "${a.id}"`);
    n.x = num(a.x, n.x); n.y = num(a.y, n.y); n.w = Math.max(120, num(a.w, n.w)); n.h = Math.max(60, num(a.h, n.h));
    place(n); const g = n.data.groupId && w.nodes.find((x) => x.id === n.data.groupId); if (g) fitGroup(g, w);
    return { ok: true, did: `moved ${n.id}` };
  }
  if (what === 'group') {
    const ms = (a.ids || []).map((id) => findIn(w, id)).filter((m) => m && m.type !== 'group');
    if (!ms.length) throw new Error('no tiles to group');
    const x = Math.min(...ms.map((m) => m.x)) - 26, y = Math.min(...ms.map((m) => m.y)) - 76;
    const g = addNode('group', {}, { ws: w, quiet: true, x, y, w: Math.max(...ms.map((m) => m.x + m.w)) - x + 26, h: Math.max(...ms.map((m) => m.y + m.h)) - y + 26, title: String(a.title || 'Group').slice(0, 60) });
    for (const m of ms) m.data.groupId = g.id;
    fitGroup(g, w); retagAll(w);
    return { ok: true, id: g.id, did: `grouped ${ms.length} tiles as ${g.id}` };
  }
  if (what === 'wire') {
    const f = findIn(w, a.from), t = findIn(w, a.to);
    if (!f || !t) throw new Error('both ends of a wire must be consoles or groups');
    if (!['console', 'group'].includes(f.type) || !['console', 'group'].includes(t.type)) throw new Error('wires join consoles or groups');
    const wire = window.__argonTeam.addWire(w, f.id, t.id, ['done', 'reply', 'if', 'review', 'context'].includes(a.mode) ? a.mode : 'done');
    if (wire && a.pattern) wire.pattern = String(a.pattern);
    return { ok: !!wire, did: `wired ${f.title} → ${t.title}` };
  }
  if (what === 'say') {
    const t = findIn(w, a.to);
    if (!t || t.type !== 'console') throw new Error(`no console "${a.to}"`);
    if (statusOf(t.id) === 'exited') throw new Error(`${t.title} is not running`);
    const how = sendTeamMessage(w, t, a.from, String(a.text || ''));
    return { ok: true, did: how === 'sent' ? `sent to ${t.title}` : `message for ${t.title} (it reaches them as soon as they're free)` };
  }
  if (what === 'delete') {
    if (!n) throw new Error(`no tile "${a.id}"`);
    if (n.type === 'console') throw new Error("agent consoles can't be deleted from here");
    removeNode(n.id, false);
    return { ok: true, did: `deleted ${n.id}` };
  }
  throw new Error(`unknown action "${what}"`);
}

// ---------- the loop: write BOARD.md when the board changes, read the inbox ----------
const last = new Map(); let busy = false, dirty = true;
async function writeBoard(w) {
  const f = boardFile(w); if (!f) return;
  const text = snapshot(w);
  if (last.get(w.id) === text) return;
  if (await window.argon.fs.write(f, text)) last.set(w.id, text);
}
async function readInbox(w) {
  const d = dirOf(w); if (!d) return;
  const items = await window.argon.fs.list(d + sep() + 'inbox');
  for (const it of items) {
    if (it.dir || !/\.json$/i.test(it.name)) continue;
    const r = await window.argon.fs.read(it.path);
    let out;
    try {
      const actions = JSON.parse(r && r.ok ? r.text : 'null');
      const list = Array.isArray(actions) ? actions : [actions];
      out = list.map((a) => { try { return apply(w, a || {}); } catch (e) { return { ok: false, error: e.message }; } });
    } catch (e) { out = [{ ok: false, error: 'not valid JSON: ' + e.message }]; }
    await window.argon.fs.write(d + sep() + 'results' + sep() + it.name, JSON.stringify(out, null, 2));
    await window.argon.fs.remove(it.path);
    const did = out.filter((o) => o.ok).length;
    if (did) { save(); emit('nodes'); if (w === ws()) toast(`An agent changed the board: ${out.filter((o) => o.ok).map((o) => o.did).join(', ').slice(0, 120)}`); }
    dirty = true;
  }
}
async function tick() {
  if (busy || !enabled()) return; busy = true;
  try {
    for (const w of S.data.workspaces) {
      if (!w.cwd) continue;
      await readInbox(w);
      if (dirty) await writeBoard(w);
    }
    dirty = false;
  } catch (e) { console.error(e); } finally { busy = false; }
}

export function initBoardApi() {
  const mark = () => { dirty = true; };
  on('nodes', mark); on('status', mark); on('consoleMeta', mark); on('handoff', mark);
  // text typed into notes and checklists saves without an event: catch it on the slower beat
  setInterval(() => { dirty = true; }, 8000);
  setInterval(tick, 1500);
  setTimeout(tick, 1200);
}
