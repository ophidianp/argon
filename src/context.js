// Context: how full each agent's memory is and what fills it, with Compact and Clear; plus the folders
// connected to this project (a second brain, a notes folder) that Claude can reach with --add-dir.
import { S, ws, h, save, toast, findNode, consoles } from './state.js';
import { rt, sendTo } from './consoles.js';
import { contextOf } from './teamwork.js';
import { modal } from './ui.js';
import { agentByKey } from './agents.js';

const k = (n) => (n >= 1000 ? Math.round(n / 1000) + 'K' : String(Math.round(n)));
const base = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || p;

// What fills it, estimated from the transcript since the last compact: about 4 characters a token.
export async function breakdown(node) {
  const v = contextOf(node.id), r = rt(node.id);
  if (!v || !window.argon.claudeTranscript) return v ? { ...v, parts: null } : null;
  const w = (findNode(node.id) || {}).ws || ws();
  const prof = S.data.profiles.find((p) => p.id === node.data.profile);
  let res = null;
  try { res = await window.argon.claudeTranscript({ cwd: node.data.cwd || w.cwd, session: node.data.session || null, file: node.data.session ? null : (r && r.ctxFile) || null, profile: prof && prof.dir, bytes: 4000000 }); } catch (_) {}
  if (!res || !res.ok || !res.text) return { ...v, parts: null };
  let lines = res.text.split('\n');
  const cut = lines.map((l) => l.includes('"isCompactSummary":true') || l.includes('"compact_boundary"')).lastIndexOf(true);
  if (cut >= 0) lines = lines.slice(cut);
  const parts = { replies: 0, messages: 0, files: 0, tools: 0 };
  const byFile = new Map(), reads = new Map();
  for (const raw of lines) {
    if (!raw || raw[0] !== '{') continue;
    let e; try { e = JSON.parse(raw); } catch (_) { continue; }
    if (e.isSidechain || (e.type !== 'user' && e.type !== 'assistant')) continue;
    const content = typeof (e.message && e.message.content) === 'string' ? [{ type: 'text', text: e.message.content }] : (e.message && e.message.content) || [];
    for (const c of content) {
      if (c.type === 'text') parts[e.type === 'assistant' ? 'replies' : 'messages'] += (c.text || '').length / 4;
      else if (c.type === 'tool_use') { parts.replies += JSON.stringify(c.input || {}).length / 4; if (c.name === 'Read') reads.set(c.id, c.input && c.input.file_path); }
      else if (c.type === 'tool_result') {
        const n = JSON.stringify(c.content || '').length / 4;
        if (reads.has(c.tool_use_id)) { parts.files += n; const f = reads.get(c.tool_use_id); byFile.set(f, (byFile.get(f) || 0) + n); }
        else parts.tools += n;
      }
    }
  }
  const counted = parts.replies + parts.messages + parts.files + parts.tools;
  parts.instructions = Math.max(0, v.used - counted);
  const top = [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 4);
  return { ...v, parts, top };
}
const verdict = (p) => (p < 50 ? 'Plenty of room.' : p < 80 ? 'Getting full. Compact when a task ends.' : 'Almost full. Compact or clear it soon.');
const SEG = [['instructions', 'Instructions and tools', 'var(--dim)'], ['replies', 'Claude’s replies', 'var(--accent)'], ['messages', 'Your messages', '#7ea8ec'], ['files', 'Files read', '#6fcfa3'], ['tools', 'Commands and searches', '#e2b15a']];

function card(node, b, onAct) {
  const pct = b.pct, el = h('div', { class: 'ctx-card' });
  el.append(h('div', { class: 'ctx-top' }, h('span', { class: 'ctx-pct' }, pct + '%'), h('span', { class: 'ctx-of' }, h('span', {}, `${k(b.used)} of ${k(b.limit)} tokens`), h('span', { class: 'ctx-verdict' }, verdict(pct)))));
  const bar = h('div', { class: 'ctx-bar' });
  if (b.parts) for (const [key, , color] of SEG) { const n = b.parts[key]; if (n > 0) bar.append(h('i', { style: { width: Math.max(0.6, n / b.limit * 100) + '%', background: color } })); }
  else bar.append(h('i', { style: { width: pct + '%', background: 'var(--accent)' } }));
  el.append(bar);
  if (b.parts) {
    el.append(h('div', { class: 'ctx-legend' }, ...SEG.filter(([key]) => b.parts[key] > 0).map(([key, label, color]) => h('div', { class: 'ctx-row' }, h('i', { style: { background: color } }), h('span', {}, label), h('b', {}, k(b.parts[key]))))));
    if (b.top && b.top.length) el.append(h('div', { class: 'ctx-sub' }, 'Biggest things it read'), ...b.top.map(([f, n]) => h('div', { class: 'ctx-row file', title: f }, h('span', {}, base(f)), h('b', {}, k(n)))));
  }
  el.append(h('div', { class: 'ctx-acts' },
    h('button', { class: 'btn', title: 'Keeps a summary and frees the rest (/compact)', onclick: () => { if (sendTo(node.id, '/compact')) toast(`Compacting ${node.title}`); onAct && onAct(); } }, 'Compact'),
    h('button', { class: 'btn', title: 'Starts a fresh conversation (/clear)', onclick: () => { if (sendTo(node.id, '/clear')) { toast(`Cleared ${node.title}`); const r = rt(node.id); if (r) r.ctxFile = null; } onAct && onAct(); } }, 'Clear')));
  return el;
}

// The gauge on a console opens this, on the page (never clipped by the console, same size at any zoom).
let pop = null;
export async function contextPopover(node, x, y) {
  closePop();
  const b = await breakdown(node);
  if (!b) { toast(`${node.title} has not used any context yet`); return; }
  pop = h('div', { class: 'ctx-pop' }, card(node, b, closePop));
  document.body.append(pop);
  const r = pop.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x - 20)) + 'px';
  pop.style.top = Math.max(8, Math.min(innerHeight - r.height - 8, y + 14)) + 'px';
  setTimeout(() => { addEventListener('pointerdown', away, true); addEventListener('keydown', escKey, true); }, 0);
}
const away = (e) => { if (pop && !pop.contains(e.target)) closePop(); };
const escKey = (e) => { if (e.key === 'Escape') closePop(); };
function closePop() { if (pop) pop.remove(); pop = null; removeEventListener('pointerdown', away, true); removeEventListener('keydown', escKey, true); }

// ---------- the panel ----------
export function openContext() {
  const w = ws();
  const body = h('div', { class: 'ctx-panel' });
  const agents = h('div', { class: 'ctx-agents' });
  const paintAgents = async () => {
    agents.replaceChildren();
    const list = consoles(w).filter((c) => c.data.agent === 'claude');
    if (!list.length) { agents.append(h('p', { class: 'muted' }, 'No Claude agents on this board yet. Each one shows here with how full its memory is.')); return; }
    for (const n of list) {
      const b = await breakdown(n);
      const a = agentByKey(n.data.agent, S.data.customAgents);
      agents.append(h('div', { class: 'ctx-agent' },
        h('div', { class: 'ctx-name' }, h('span', { class: 'agent-mark', style: { '--ac': a.color } }, '✳'), n.title, n.data.roleNote ? h('span', { class: 'muted' }, ' · ' + n.data.roleNote) : null),
        b ? card(n, b, () => setTimeout(paintAgents, 1500)) : h('p', { class: 'muted' }, 'Nothing used yet.')));
    }
  };
  // connected folders
  const folders = h('div', { class: 'ctx-folders' });
  const paintFolders = () => {
    const L = (w.folders = w.folders || []);
    folders.replaceChildren(...L.map((f, i) => h('div', { class: 'ctx-folder' }, h('span', { class: 'f-name' }, base(f)), h('span', { class: 'f-path', title: f }, f),
      h('button', { class: 'tile-btn', title: 'Disconnect this folder', onclick: () => { L.splice(i, 1); save(); paintFolders(); } }, '✕'))));
    if (!L.length) folders.append(h('p', { class: 'muted' }, 'None yet. Connect a notes folder or a second brain that lives outside this project.'));
  };
  const add = h('button', { class: 'btn', onclick: async () => {
    const p = await window.argon.pickFolder(); if (!p) return;
    const L = (w.folders = w.folders || []);
    if (!L.includes(p)) { L.push(p); save(); paintFolders(); toast(`Connected ${base(p)}. Claude agents started from now on can read it; restart a running one to give it access.`, 'ok'); }
  } }, '+ Connect a folder');
  body.append(
    h('h3', {}, 'Memory'), h('p', { class: 'muted' }, 'How full each agent is, and what fills it.'), agents,
    h('h3', {}, 'Folders'), h('p', { class: 'muted' }, 'Claude gets these with --add-dir when it starts. For other agents, tell them the path.'), folders, add);
  modal({ title: 'Context', sub: w.name, body, wide: true });
  paintAgents(); paintFolders();
}
