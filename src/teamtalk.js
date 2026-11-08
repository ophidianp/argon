// Teams that talk. Everyone in a group is one team: they share a team file
// (<project>/.argon/team/<tag>.md) where they split the work and keep track of it, and they hand tasks to each
// other with team messages. A message waits until its teammate is free, so it never cuts into their work.
import { S, save, findNode } from './state.js';
import { groupMembers, groupTag } from './tiles.js';
import { statusOf, sendTo } from './consoles.js';

const win = () => window.argon.platform === 'win32';
const sep = () => (win() ? '\\' : '/');
const base = (w) => { const c = (w.cwd || '').replace(/[\\/]+$/, ''); return win() ? c.replace(/\//g, '\\') : c; };
export const inboxDir = (w) => base(w) + sep() + ['.argon', 'board', 'inbox'].join(sep());
export const teamFile = (w, g) => base(w) + sep() + ['.argon', 'team', groupTag(g) + '.md'].join(sep());

// Every agent in a group (nested groups too), plain terminals left out.
export function teamOf(w, g) {
  return groupMembers(g, w).flatMap((m) => (m.type === 'group' ? teamOf(w, m) : m.type === 'console' && m.data.agent !== 'shell' ? [m] : []));
}
// The team a console belongs to: the group it sits in, or the outermost group around it.
export function groupOf(w, n) {
  let g = n && n.data && n.data.groupId && w.nodes.find((x) => x.id === n.data.groupId);
  while (g && g.data.groupId) { const up = w.nodes.find((x) => x.id === g.data.groupId); if (!up) break; g = up; }
  return g || null;
}

const stamp = () => new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// A fresh team file for a new piece of work. fresh=false keeps one that's already there (a later handoff in the same run).
export async function startTeamFile(w, g, { goal = '', task = '', fresh = true } = {}) {
  if (!w.cwd) return null;
  const f = teamFile(w, g), team = teamOf(w, g);
  if (!fresh && (await window.argon.fs.exists(f))) return f;
  const text = [
    `# Team #${groupTag(g)} (${g.title})`,
    '',
    `Members: ${team.map((a) => a.title).join(', ')}`,
    goal ? `Goal: ${goal}` : '',
    task ? `Team task: ${task}` : '',
    `Started: ${stamp()}`,
    '',
    'You work on this TOGETHER. Split the work below before anyone starts, hand tasks to each other with team messages, and tick things off here as you finish them. The team is done only when every part is done.',
    '',
    "## Who's doing what",
    ...team.map((a) => `- ${a.title}: (not claimed yet: write your part and the files you'll touch)`),
    '',
    '## Decisions',
    '- ',
    '',
    '## Messages',
    '(Argon adds every team message here.)',
    '',
  ].filter((l, i, arr) => l !== '' || arr[i - 1] !== '').join('\n');
  await window.argon.fs.write(f, text);
  return f;
}

// The instructions every team member gets, said plainly and loudly.
export function teamIntro(w, g, me) {
  const team = teamOf(w, g), others = team.filter((a) => a.id !== me.id).map((a) => a.title);
  const tag = '#' + groupTag(g), f = teamFile(w, g), inbox = inboxDir(w);
  const mate = others[0] || 'teammate';
  if (!others.length) return `You are ${me.title}, the only agent in team ${tag} right now. Keep track of your work in ${f}.`;
  return [
    `=== YOU ARE ON A TEAM: ${tag} ===`,
    `You are ${me.title}. Your teammates: ${others.join(', ')}. You are NOT working alone. You all got this same task at the same time, in the same folder, and you are supposed to do it TOGETHER: split it up, hand tasks to each other, and help each other finish.`,
    `1. SPLIT THE WORK FIRST. Before you change anything, open the team file ${f}. Read what your teammates already claimed, then write your own line under "Who's doing what": which part you take and which files you will touch. Never edit a file a teammate claimed. Message them instead.`,
    `2. HAND TASKS TO EACH OTHER. When you need a teammate to do something, when you finish a piece they're waiting on, or when you find work that's in their part, send them a team message. To send one, write a file ending in .json into ${inbox} containing: {"do":"say","from":"${me.title}","to":"${mate}","text":"what you need or what you finished"}. It reaches them as soon as they're free.`,
    `3. ANSWER YOUR TEAMMATES. Their messages reach you starting with "[Team ${tag}] Message from". Doing what they ask is part of your job, and reply the same way when they need an answer.`,
    `4. KEEP THE TEAM FILE CURRENT. Tick off what you finished and write down decisions, so everyone sees where things stand.`,
    `5. FINISH TOGETHER. Before you stop, read the team file. If any part is unclaimed or unfinished, take it or message whoever owns it. The team's work goes on to the next step only once all of you are done.`,
    `=== END OF TEAM RULES ===`,
  ].join('\n');
}

// ---------- team messages ----------
// Held until the teammate is free (not working, not waiting on a permission prompt), then typed in.
const queue = []; // { w, to, from, text, at }
export const hasQueued = (id) => queue.some((m) => m.to === id);

export function sendTeamMessage(w, to, from, text) {
  const g = groupOf(w, to), fromNode = typeof from === 'string' ? w.nodes.find((n) => n.title === from || n.id === from) : from;
  const sameTeam = g && fromNode && groupOf(w, fromNode) === g;
  const who = fromNode ? fromNode.title : (from || 'another agent');
  const head = sameTeam ? `[Team #${groupTag(g)}] Message from ${who} (your teammate):` : `[Argon] Message from ${who}:`;
  const tail = sameTeam ? `\n\n(Reply with a team message if they need an answer. Team file: ${teamFile(w, g)})` : '';
  queue.push({ w, to: to.id, text: `${head}\n${text}${tail}`, at: Date.now() });
  if (sameTeam) logMessage(w, g, who, to.title, text);
  pump();
  return hasQueued(to.id) ? 'queued' : 'sent';
}

function pump() {
  for (let i = 0; i < queue.length; i++) {
    const m = queue[i], st = statusOf(m.to);
    if (st === 'exited') { queue.splice(i--, 1); continue; }
    if (st === 'working' || st === 'needs') continue;
    // one message per agent per beat, so a burst doesn't get typed in on top of itself
    if (queue.slice(0, i).some((x) => x.to === m.to)) continue;
    if (sendTo(m.to, m.text)) queue.splice(i--, 1);
  }
}

const writing = new Map();
function logMessage(w, g, from, to, text) {
  const f = teamFile(w, g);
  const prev = writing.get(f) || Promise.resolve();
  const next = prev.then(async () => {
    const r = await window.argon.fs.read(f);
    const cur = r && r.ok ? r.text : `# Team #${groupTag(g)}\n\n## Messages\n`;
    const line = `- ${stamp()} ${from} → ${to}: ${String(text).replace(/\s+/g, ' ').trim()}`;
    await window.argon.fs.write(f, cur.replace(/\s*$/, '') + '\n' + line + '\n');
  }).catch(() => {});
  writing.set(f, next);
}

export function initTeamTalk() { setInterval(pump, 1000); }
