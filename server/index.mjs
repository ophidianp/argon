// vibeboard local server: owns the PTYs (they outlive browser reloads),
// receives Claude Code hook events for console status, persists board state.
import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import pty from 'node-pty'
import { AGENTS, agentById } from '../shared/agents.js'
import { createLoops } from './loops.mjs'
import { readConversation, readTranscript } from './transcript.mjs'
import { contextReport } from '../shared/context.js'
import headless from '@xterm/headless'
import { screenOf } from './usage.mjs'
import { isRefusal, parseAsk } from '../shared/prompts.js'
import { describeTool } from '../shared/plain.js'
import { createHelpers } from './helpers.mjs'
import { createUsage } from './usage.mjs'
import { createScans } from './scan.mjs'
import { createDocs } from './docs.mjs'
import { createDiagrams } from './diagrams.mjs'
import * as files from './files.mjs'
import { approved, linkMessage, matches } from '../shared/links.js'

const PORT = Number(process.env.PORT) || 4317
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
// VIBEBOARD_DATA runs a second, separate board (a demo, a test) without touching your real one.
const DATA_DIR = process.env.VIBEBOARD_DATA || path.join(os.homedir(), '.vibeboard')
const STATE_FILE = path.join(DATA_DIR, 'state.json')
const HOOKS_FILE = path.join(DATA_DIR, 'claude-hooks.json')
// One sign-in folder per account profile; the id becomes a path, so it is held to a strict shape.
const PROFILES_DIR = path.join(DATA_DIR, 'profiles')
const PROFILE = /^[\w-]{1,40}$/
const SHELL = process.env.SHELL || '/bin/zsh'
const MAX_BUF = 512 * 1024
const FLUSH_MS = 8 // output is sent in small batches: one message per chunk would flood the page
// The page acknowledges what its terminal has drawn. Past the high mark the process is paused, as a
// real terminal does, so `yes` or a huge `cat` cannot bury the page under minutes of backlog.
const HIGH_WATER = 512 * 1024
const LOW_WATER = 128 * 1024
const STALL_MS = 5000 // a page that stops answering must not freeze the agent for ever
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Yours alone: the board holds your prompts and memories.
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })

// When the server itself is started from a Claude Code terminal, its session variables
// (child-session marker, session id, messaging token) must not leak into the consoles:
// a Claude that thinks it is a child session stops saving transcripts, which breaks resume.
// The desktop app runs this server through its own Electron: tools started in a console must not inherit that.
const STRIP_ENV = /^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_JOB_DIR$|CLAUDE_PID$|ELECTRON_RUN_AS_NODE$)/
const CLEAN_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !STRIP_ENV.test(k)))

// Claude Code gets these hooks through --settings, so the user's global config stays untouched.
const hook = (event) => ({
  type: 'command',
  command: `curl -s -m 2 -X POST -H 'content-type: application/json' --data-binary @- http://127.0.0.1:${PORT}/api/hook/$VIBEBOARD_ID/${event} >/dev/null 2>&1 || true`,
})
fs.writeFileSync(
  HOOKS_FILE,
  JSON.stringify(
    {
      hooks: {
        SessionStart: [{ hooks: [hook('SessionStart')] }],
        UserPromptSubmit: [{ hooks: [hook('UserPromptSubmit')] }],
        PreToolUse: [{ matcher: '*', hooks: [hook('PreToolUse')] }],
        PostToolUse: [{ matcher: '*', hooks: [hook('PostToolUse')] }],
        Notification: [{ hooks: [hook('Notification')] }],
        Stop: [{ hooks: [hook('Stop')] }],
      },
    },
    null,
    2,
  ),
)

// ---------- the board file ----------
const STATE_BACKUP = STATE_FILE + '.bak'
const BACKUP_EVERY_MS = 10 * 60_000
let backedUpAt = 0

// Copied only while the current file is known to read: a backup of a damaged file protects nothing.
function backupState() {
  if (Date.now() - backedUpAt < BACKUP_EVERY_MS || !fs.existsSync(STATE_FILE)) return
  backedUpAt = Date.now()
  try {
    JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    fs.copyFileSync(STATE_FILE, STATE_BACKUP)
  } catch (e) {
    console.error('board backup skipped:', e.message)
  }
}

// A damaged file is set aside, not overwritten, and the last backup takes its place.
function readState() {
  if (!fs.existsSync(STATE_FILE)) return {}
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch (e) {
    console.error('board file damaged:', e.message)
  }
  const kept = `${STATE_FILE}.damaged-${Date.now()}`
  fs.renameSync(STATE_FILE, kept)
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_BACKUP, 'utf8'))
    fs.copyFileSync(STATE_BACKUP, STATE_FILE)
    return { ...saved, recovered: 'backup' }
  } catch {
    return { recovered: 'empty' }
  }
}

// ---------- security: only our own pages may talk to us ----------
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`])
// The Vite dev page only in development: in production another project on :5173 must not drive the consoles.
const ALLOWED_ORIGINS = new Set([
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
  ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173']),
])
// Browsers always send Origin on cross-site WS/POST; curl (the hooks) sends none.
// The Host check blocks DNS-rebinding pages that resolve to 127.0.0.1.
// An image, a script or a link on another site sends no Origin either, only Sec-Fetch-Site: such a
// request never reaches the API (a GET there can make the server fetch a page or look at a port).
const FOREIGN_FETCH = /^(cross|same)-site$/
const isAllowed = (req, api = true) => {
  const origin = req.headers.origin
  if (origin && !ALLOWED_ORIGINS.has(origin)) return false
  if (!origin && api && FOREIGN_FETCH.test(req.headers['sec-fetch-site'] ?? '')) return false
  return ALLOWED_HOSTS.has(req.headers.host)
}

// ---------- sessions ----------
const sessions = new Map() // id -> session
const eventClients = new Set()

const broadcast = (msg) => {
  const s = JSON.stringify(msg)
  for (const c of eventClients) if (c.readyState === 1) c.send(s)
}

const summary = (s) => ({ id: s.id, agent: s.agent.id, status: s.status, statusAt: s.statusAt, cwd: s.cwd, paused: s.paused, pid: s.pty.pid, subagents: [...s.subagents.values()], ask: s.ask, activity: s.activity, started: !!s.started })

// Every console also draws into an invisible screen, so a question from the agent can be read off it
// and offered as buttons. The agents' own menus stay the source of truth.
const readScreen = (s) => new Promise((resolve) => s.screen.write('', () => resolve(parseAsk(screenOf(s.screen)))))

function publishAsk(s, ask) {
  if (ask?.id === s.ask?.id && ask?.selected === s.ask?.selected) return
  const fresh = ask && ask.id !== s.ask?.id
  s.ask = ask
  broadcast({ type: 'ask', id: s.id, ask })
  if (fresh) setStatus(s, 'needs')
}

// Something new is in the transcript: open conversations read it again. The hook can fire a moment
// before the line reaches the disk.
function touchConversation(s, started = false) {
  clearTimeout(s.talkTimer)
  s.talkTimer = setTimeout(() => broadcast({ type: 'conversation', id: s.id, started }), started ? 0 : 200)
}

function setActivity(s, text) {
  if (s.activity === text) return
  s.activity = text
  broadcast({ type: 'activity', id: s.id, text })
}

// Claude's own sub-agents (its Task/Agent tool) appear on its console while they run. PreToolUse
// opens one, PostToolUse closes it; only the last few finished ones are kept.
// ponytail: a background sub-agent's PostToolUse fires at launch, so it shows as done early.
const SUBAGENT_TOOLS = new Set(['Task', 'Agent'])
function trackSubagent(s, action, payload) {
  if (!SUBAGENT_TOOLS.has(payload.tool_name)) return
  const input = payload.tool_input || {}
  const task = String(input.description || input.prompt || '').slice(0, 140)
  const key = String(payload.tool_use_id || task)
  if (!key) return
  if (action === 'PreToolUse') {
    const type = String(input.name || input.subagent_type || 'general-purpose').slice(0, 60)
    s.subagents.set(key, { id: key, type, task, status: 'running', startedAt: Date.now() })
  } else if (action === 'PostToolUse' && s.subagents.has(key)) {
    s.subagents.set(key, { ...s.subagents.get(key), status: 'done', endedAt: Date.now() })
  } else return
  publishSubagents(s)
}

// The turn is over (Stop, or an interrupt noticed by the idle prompt): nothing is still running.
function settleSubagents(s) {
  let changed = false
  for (const [k, a] of s.subagents) {
    if (a.status !== 'running') continue
    s.subagents.set(k, { ...a, status: 'done', endedAt: Date.now() })
    changed = true
  }
  if (changed) publishSubagents(s)
}

function publishSubagents(s) {
  const done = [...s.subagents.values()].filter((a) => a.status === 'done')
  for (const a of done.slice(0, Math.max(0, done.length - 4))) s.subagents.delete(a.id)
  broadcast({ type: 'subagents', id: s.id, subagents: [...s.subagents.values()] })
}

function setStatus(s, status) {
  if (s.status === status) return
  s.status = status
  s.statusAt = Date.now()
  broadcast({ type: 'status', id: s.id, status, at: s.statusAt })
  loops.onStatus(s, status)
}

// No `=` in the bare set: zsh expands a leading `=word` to a command path.
const shq = (v) => (/^[\w@%+:,./-]+$/.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`)

const LEAD_PROMPT =
  'You run inside vibeboard, a board where the user watches every agent. You are the lead: when a job splits into ' +
  'parts that can run side by side, bring in helpers with the vibeboard create_helper tool instead of sub-agents or ' +
  'other agent launchers, so the user sees each one on the board. Small jobs you do yourself.'

// Folders outside the project the person connected: the agent may work in them and knows they are there.
const foldersPrompt = (dirs) => `The user connected these folders of their own, outside this project: ${dirs.join(', ')}. Look there when they mention their notes or earlier work.`

function commandFor(agent, { id, sessionId, resume, yolo, lead, dirs = [] }) {
  const parts = [agent.cmd]
  if (agent.addDir) for (const d of dirs) parts.push(agent.addDir, d)
  if (agent.id === 'claude') {
    if (resume && UUID.test(resume)) parts.push('--resume', resume)
    else if (sessionId && UUID.test(sessionId)) parts.push('--session-id', sessionId)
    parts.push('--settings', HOOKS_FILE)
    // A lead gets the team tools (helpers.mjs), pre-approved: asking leave for each helper defeats the point.
    // The system-prompt line is what makes it reach for them unprompted, over other ways to run agents.
    if (lead) {
      const config = { mcpServers: { vibeboard: { type: 'http', url: `http://127.0.0.1:${PORT}/mcp/${id}` } } }
      parts.push('--mcp-config', JSON.stringify(config), '--allowedTools', 'mcp__vibeboard')
    }
    const told = [lead && LEAD_PROMPT, dirs.length && foldersPrompt(dirs)].filter(Boolean).join('\n\n')
    if (told) parts.push('--append-system-prompt', told)
    if (yolo) parts.push('--dangerously-skip-permissions')
  } else if (agent.id === 'codex' && yolo) {
    parts.push('--dangerously-bypass-approvals-and-sandbox')
  }
  return parts.map(shq).join(' ')
}

function flushOutput(s) {
  clearTimeout(s.flushTimer)
  s.flushTimer = null
  if (!s.outbox) return
  const data = s.outbox
  s.outbox = ''
  s.screen.write(data)
  for (const c of s.clients) {
    if (c.readyState !== 1) continue
    c.send(data)
    s.unacked.set(c, (s.unacked.get(c) ?? 0) + data.length)
  }
  holdOutput(s)
}

// Follows the slowest page that is attached.
function holdOutput(s) {
  const most = Math.max(0, ...s.unacked.values())
  if (!s.paused_output && most > HIGH_WATER) {
    s.paused_output = true
    s.pty.pause()
    s.lastAckAt = Date.now()
    s.stallTimer = setInterval(() => {
      if (Date.now() - s.lastAckAt < STALL_MS) return
      s.unacked.clear()
      holdOutput(s)
    }, 1000)
  } else if (s.paused_output && most < LOW_WATER) {
    s.paused_output = false
    clearInterval(s.stallTimer)
    if (sessions.get(s.id) === s) s.pty.resume()
  }
}

function spawnSession({ id, agentId, cwd, cols, rows, sessionId, resume, yolo, lead, profile, dirs }) {
  const agent = agentById(agentId)
  if (!agent) throw new Error(`unknown agent ${agentId}`)
  // A project folder that has gone away must not quietly become $HOME (maybe in YOLO).
  if (cwd && !isDir(cwd)) throw new Error(`folder not found: ${cwd}`)
  if (profile && !PROFILE.test(profile)) throw new Error(`bad profile name: ${profile}`)
  const dir = cwd || os.homedir()
  // A profile's first run finds an empty folder, and the CLI asks to sign in right there in the console.
  const account = profile && agent.configEnv ? { [agent.configEnv]: path.join(PROFILES_DIR, profile) } : {}
  for (const d of Object.values(account)) fs.mkdirSync(d, { recursive: true })
  // Agents run through a login+interactive shell so they see the same PATH as iTerm.
  const args = agent.cmd ? ['-lic', `exec ${commandFor(agent, { id, sessionId, resume, yolo, lead, dirs })}`] : ['-l']
  const p = pty.spawn(SHELL, args, {
    name: 'xterm-256color',
    cols: cols || 100,
    rows: rows || 30,
    cwd: dir,
    env: { ...CLEAN_ENV, ...account, VIBEBOARD_ID: id, COLORTERM: 'truecolor', TERM_PROGRAM: 'vibeboard' },
  })
  const screen = new headless.Terminal({ cols: cols || 100, rows: rows || 30, scrollback: 0, allowProposedApi: true })
  const s = { id, agent, cwd: dir, yolo: !!yolo, profile, pty: p, screen, ask: null, activity: null, outbox: '', flushTimer: null, unacked: new Map(), paused_output: false, stallTimer: null, buf: '', status: 'idle', statusAt: Date.now(), clients: new Set(), paused: false, idleTimer: null, quietUntil: 0, lastInputAt: 0, lastOutputAt: 0, subagents: new Map() }
  p.onData((d) => {
    s.buf = s.buf.length + d.length > MAX_BUF ? (s.buf + d).slice(-MAX_BUF) : s.buf + d
    s.lastOutputAt = Date.now()
    s.outbox += d
    s.flushTimer ??= setTimeout(() => flushOutput(s), FLUSH_MS)
    // A plain shell has no questions to answer: its programs' menus are its own business.
    if (agent.cmd) {
      clearTimeout(s.askTimer)
      s.askTimer = setTimeout(() => {
        if (sessions.get(id) !== s) return
        readScreen(s).then((ask) => {
          // A CLI that does not redraw leaves an answered menu on screen. It only counts again
          // once the screen has moved on and the same question comes back.
          if (!ask) s.answered = null
          publishAsk(s, ask?.id === s.answered ? null : ask)
        })
      }, 150)
    }
    // A repaint after a resize is not activity: it would flip status and re-match output triggers.
    if (Date.now() < s.quietUntil) return
    loops.onOutput(s, d)
    // Agents without hooks: status from output activity.
    if (!agent.hooks) {
      setStatus(s, 'working')
      clearTimeout(s.idleTimer)
      s.idleTimer = setTimeout(() => setStatus(s, 'idle'), 2500)
    }
  })
  p.onExit(({ exitCode }) => {
    clearTimeout(s.idleTimer)
    clearTimeout(s.askTimer)
    clearTimeout(s.talkTimer)
    flushOutput(s) // the last words go out before the sockets close
    clearInterval(s.stallTimer)
    screen.dispose()
    sessions.delete(id)
    loops.onExit(s)
    helpers.forget(id)
    for (const c of s.clients) c.close(4000, 'exit')
    broadcast({ type: 'exit', id, code: exitCode })
  })
  sessions.set(id, s)
  broadcast({ type: 'spawn', session: summary(s) })
  return s
}

// The agent's own process group plus every group its descendants live in: Claude's Bash tool
// and the dev servers it starts sit in groups of their own, out of reach of `kill(-pid)`.
function groupsOf(s, into = new Set()) {
  into.add(s.pty.pid)
  try {
    const kids = new Map()
    for (const line of execFileSync('ps', ['-A', '-o', 'pid=,ppid=,pgid='], { encoding: 'utf8' }).split('\n')) {
      const [pid, ppid, pgid] = line.trim().split(/\s+/).map(Number)
      if (pid) kids.set(ppid, [...(kids.get(ppid) || []), { pid, pgid }])
    }
    const todo = [s.pty.pid]
    while (todo.length) {
      for (const k of kids.get(todo.pop()) || []) {
        into.add(k.pgid)
        todo.push(k.pid)
      }
    }
  } catch (e) {
    console.error('ps failed, signalling the agent group only:', e.message)
  }
  return into
}

const signalGroups = (groups, sig) => {
  for (const g of groups) {
    try {
      process.kill(-g, sig)
    } catch {}
  }
}

// Claude Code ignores SIGHUP, so escalate until the exit handler has removed the session.
// Groups are collected up front: once the agent dies its children reparent to launchd.
function kill(s) {
  const groups = groupsOf(s)
  signalGroups(groups, 'SIGCONT')
  signalGroups(groups, 'SIGHUP')
  setTimeout(() => sessions.get(s.id) === s && signalGroups(groupsOf(s, groups), 'SIGTERM'), 1500)
  setTimeout(() => sessions.get(s.id) === s && signalGroups(groups, 'SIGKILL'), 4000)
}

function signal(s, sig) {
  signalGroups(groupsOf(s), sig)
  s.paused = sig === 'SIGSTOP'
  broadcast({ type: 'paused', id: s.id, paused: s.paused })
}

// The process can exit between the check and the write, and a prompt queue must survive that.
const writeTo = (s, text) => {
  if (sessions.get(s.id) === s) s.pty.write(text)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Multi-line text goes in as a bracketed paste so each newline doesn't submit on its own;
// the Enter follows after a beat, or the TUI folds it into the paste. Prompts queue per
// console: two writers inside that beat would otherwise fuse into one prompt.
// A CLI that is still drawing its start (plugins, tips) can drop the Return: the text then sits in its
// box. Claude says when a prompt is taken (its UserPromptSubmit hook); without that, and only while our
// text is still there at the bottom of the screen, Return goes once more. Never with a question on
// screen (Return would answer it), and never over something else the person may be typing.
const SUBMIT_WAIT_MS = 1500
const INPUT_LINES = 8
const stillTyped = (s, text) =>
  new Promise((resolve) => s.screen.write('', () => resolve(screenOf(s.screen).split('\n').slice(-INPUT_LINES).join('\n').includes(text.trim().slice(0, 20)))))

function sendPrompt(s, text) {
  const busy = s.status === 'working' // a busy Claude queues the prompt: no hook until it gets to it
  s.queue = (s.queue || Promise.resolve()).then(async () => {
    const taken = s.submits || 0
    writeTo(s, text.includes('\n') ? `\x1b[200~${text}\x1b[201~` : text)
    await sleep(120)
    writeTo(s, '\r')
    await sleep(150)
    if (!s.agent.hooks || busy || text.includes('\n')) return // a pasted block shows as "[Pasted text]", not as itself
    await sleep(SUBMIT_WAIT_MS)
    if (sessions.get(s.id) === s && (s.submits || 0) === taken && !s.ask && (await stillTyped(s, text))) writeTo(s, '\r')
  })
  return s.queue
}

const dim = (v, max, fallback) => {
  const n = Number(v) | 0
  return n > 1 ? Math.min(max, n) : fallback
}

function resize(s, cols, rows) {
  if (sessions.get(s.id) !== s) return // node-pty's resize throws on a dead pty
  s.quietUntil = Date.now() + 1000
  s.pty.resize(cols, rows)
  s.screen.resize(cols, rows)
}

const loops = createLoops({ sessions, sendPrompt, broadcast, run: runCommand })
const launchCli = (command, cwd) => spawn(SHELL, ['-lic', command], { cwd, env: CLEAN_ENV, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
const scans = createScans({ broadcast, launch: launchCli })
const docs = createDocs({ dir: path.join(DATA_DIR, 'docs'), broadcast, launch: launchCli })
const diagrams = createDiagrams({ broadcast, launch: launchCli })

// What a helper said last: its final reply when there is a transcript, otherwise its screen.
const lastWords = (s) => {
  const { context, lastReply } = conversationText(s)
  return (lastReply || context.slice(-3000)).trim()
}
const helpers = createHelpers({
  sessions,
  spawn: spawnSession,
  sendPrompt,
  setStatus,
  broadcast,
  lastWords,
  hasWindow: () => [...eventClients].some((c) => c.readyState === 1),
  agentIds: AGENTS.map((a) => a.id),
})

// ---------- helpers ----------
function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000, maxBuffer: 4 * 1024 * 1024, env: CLEAN_ENV, ...opts }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }),
    )
  })
}

let installed = null
async function detectAgents() {
  const cmds = AGENTS.filter((a) => a.cmd).map((a) => a.cmd)
  const script = `for c in ${cmds.join(' ')}; do command -v $c >/dev/null 2>&1 && echo $c; done; true`
  const { code, stdout } = await runCommand(SHELL, ['-lic', script], { timeout: 10000 })
  const found = new Set(stdout.split('\n').map((l) => l.trim()))
  const ids = AGENTS.filter((a) => !a.cmd || found.has(a.cmd)).map((a) => a.id)
  if (code === 0) installed = ids // a slow .zshrc that timed out gets another try next time
  return ids
}

// `claude -p --output-format json` ends with one JSON line; anything before it is shell-rc noise.
async function askClaude(model, prompt, opts) {
  const r = await runCommand(SHELL, ['-lic', `claude -p --model ${model} --output-format json ${shq(prompt)}`], opts)
  let out
  try {
    out = JSON.parse(r.stdout.trim().split('\n').pop())
  } catch {
    throw new Error(r.code === 0 ? 'claude gave no reply' : `claude exited with ${r.code}`)
  }
  if (out.is_error || typeof out.result !== 'string') throw new Error(`claude failed: ${String(out.result ?? out.subtype).slice(0, 200)}`)
  return out.result
}

// ---------- web tiles: which dev servers are up, and what a page is called ----------
const DEV_PORTS = [3000, 3001, 4200, 5173, 8000, 8080]
// Live means something accepts a TCP connection there.
const probePort = (port) =>
  new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port })
    const done = (live) => {
      sock.destroy()
      resolve({ port, live })
    }
    sock.setTimeout(300, () => done(false))
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
  })

// A tile's iframe can't read a cross-origin page's title, so the server reads the <title> instead.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' }
async function pageTitle(raw) {
  const u = new URL(raw)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('only http and https pages have a title')
  const res = await fetch(u, { signal: AbortSignal.timeout(4000), headers: { accept: 'text/html' } })
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let html = ''
  while (html.length < 256 * 1024 && !/<\/title>/i.test(html)) {
    const { done, value } = await reader.read()
    if (done) break
    html += decoder.decode(value, { stream: true })
  }
  reader.cancel().catch(() => {}) // the rest of the page is not needed
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  return m ? m[1].replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, k) => ENTITIES[k]).trim().slice(0, 200) : ''
}

// ---------- hand-off: one agent's work, summarised, becomes the next agent's prompt ----------
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-B]|[\x00-\x08\x0b-\x1f]/g
// Where Claude keeps transcripts: the default sign-in plus one folder per account profile.
const claudeProjectDirs = () => [
  path.join(os.homedir(), '.claude', 'projects'),
  ...(isDir(PROFILES_DIR) ? fs.readdirSync(PROFILES_DIR).map((p) => path.join(PROFILES_DIR, p, 'projects')) : []),
]

// What the outgoing agent did. Claude's own transcript is clean text; any other CLI only has its
// screen, so that is used with the escape codes stripped (and has no final reply to quote).
// The path comes from the hook's payload, so it must lie inside Claude's own folders.
function transcriptFile(s) {
  const file = s.transcript && path.resolve(s.transcript)
  return file && claudeProjectDirs().some((d) => file.startsWith(d + path.sep)) && file.endsWith('.jsonl') && fs.existsSync(file) ? file : null
}

// The end of a transcript, which can run to many megabytes, from the first whole line.
function transcriptTail(file, bytes = 2 * 1024 * 1024) {
  const fd = fs.openSync(file, 'r')
  try {
    const { size } = fs.fstatSync(fd)
    const start = Math.max(0, size - bytes)
    const buf = Buffer.alloc(size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    const text = buf.toString('utf8')
    return start ? text.slice(text.indexOf('\n') + 1) : text
  } finally {
    fs.closeSync(fd)
  }
}

function conversationOf(s) {
  const file = transcriptFile(s)
  if (!file) return []
  const { size } = fs.statSync(file)
  if (s.talk?.file === file && s.talk.size === size) return s.talk.items
  const items = readConversation(transcriptTail(file))
  s.talk = { file, size, items }
  return items
}

function contextOf(s) {
  const file = transcriptFile(s)
  if (!file) return null
  const { size } = fs.statSync(file)
  // The same 2 MB tail as the conversation: on a 189 MB transcript 8 MB took 17 ms a read, 2 MB takes 5.
  if (s.memo?.file !== file || s.memo.size !== size) s.memo = { file, size, report: contextReport(transcriptTail(file)) }
  return s.memo.report
}

function conversationText(s, max = 15000) {
  const file = transcriptFile(s)
  if (file) {
    const { lines, lastReply } = readTranscript(fs.readFileSync(file, 'utf8').split('\n').slice(-400).join('\n'))
    if (lines.length) return { context: lines.join('\n').slice(-max), lastReply: lastReply.slice(0, 6000) }
  }
  return { context: s.buf.replace(ANSI, '').replace(/\n{3,}/g, '\n\n').slice(-max), lastReply: '' }
}

// The summary gives the next agent the story; the final reply goes in verbatim, because that is
// usually the deliverable itself (the plan, the findings) and a summary would paraphrase it away.
async function handoffBrief(s) {
  const { context, lastReply } = conversationText(s)
  const withReply = (brief) => (lastReply ? `${brief}\n\nTheir last message, word for word:\n\n${lastReply}` : brief)
  if (process.env.VIBEBOARD_NO_LLM) return withReply(context.slice(-2000)) // tests: no model call
  const prompt =
    'One coding agent is handing its work to another. From the session below, write the brief the next agent needs: ' +
    'the goal, what was done (files touched), the current state, open problems and the next steps. ' +
    'At most 180 words, plain text, no preamble.\n\nSession:\n' +
    context
  try {
    return withReply((await askClaude('haiku', prompt, { cwd: s.cwd, timeout: 120_000 })).trim())
  } catch (e) {
    console.error('hand-off summary failed, sending the raw tail:', e.message)
    return withReply(context.slice(-2000))
  }
}

const recentHandoffs = new Map() // `${from}>${to}` -> ts: two open tabs must not hand off twice

// The model may wrap its JSON in prose or a ```json fence.
function parseJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  for (const candidate of [text, fenced?.[1], text.slice(text.search(/[[{]/))]) {
    if (!candidate) continue
    try {
      return JSON.parse(candidate.trim())
    } catch {}
  }
  throw new Error('no JSON in agent reply')
}
detectAgents()

const readBody = (req, limit = 20 * 1024 * 1024) =>
  new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })

const json = (res, code, data) => {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(data))
}

const isDir = (p) => typeof p === 'string' && path.isAbsolute(p) && fs.existsSync(p) && fs.statSync(p).isDirectory()

async function gitInfo(cwd) {
  if (!isDir(cwd)) return null
  if ((await runCommand('git', ['-C', cwd, 'rev-parse', '--git-dir'])).code !== 0) return null
  // symbolic-ref also names a branch with no commits yet (a new repo); a detached HEAD falls back to its hash.
  let branch = await runCommand('git', ['-C', cwd, 'symbolic-ref', '--short', '-q', 'HEAD'])
  if (branch.code !== 0) branch = await runCommand('git', ['-C', cwd, 'rev-parse', '--short', 'HEAD'])
  const [status, log, remote, counts, numstat, top] = await Promise.all([
    runCommand('git', ['-C', cwd, 'status', '--porcelain', '-z', '--untracked-files=all']),
    runCommand('git', ['-C', cwd, 'log', '-n', '15', '--format=%h%x1f%s%x1f%an%x1f%cr']),
    runCommand('git', ['-C', cwd, 'remote', 'get-url', 'origin']),
    runCommand('git', ['-C', cwd, 'rev-list', '--left-right', '--count', '@{u}...HEAD']),
    runCommand('git', ['-C', cwd, 'diff', 'HEAD', '--numstat', '-z', '--no-renames']),
    runCommand('git', ['-C', cwd, 'rev-parse', '--show-toplevel']),
  ])
  const files = changedFiles(status.stdout)
  const [behind, ahead] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0]
  // Lines added/removed per file: tracked ones from the diff, a new file counts all its lines.
  const lines = new Map()
  for (const rec of numstat.stdout.split('\0')) {
    const [add, del, p] = rec.split('\t')
    if (p) lines.set(p, [Number(add) || 0, Number(del) || 0])
  }
  for (const f of files.slice(0, 200)) {
    if (f.code !== '??') continue
    try {
      const file = path.join(top.stdout.trim(), f.path)
      if (fs.statSync(file).size < 512 * 1024) lines.set(f.path, [fs.readFileSync(file, 'utf8').split('\n').filter((l, i, a) => l || i < a.length - 1).length, 0])
    } catch {}
  }
  return {
    branch: branch.stdout.trim(),
    changes: files.length,
    files: files.slice(0, 200).map((f) => ({ ...f, add: lines.get(f.path)?.[0] ?? 0, del: lines.get(f.path)?.[1] ?? 0 })),
    upstream: counts.code === 0, // false: never pushed, so the first push sets it up
    ahead,
    behind,
    remote: remote.code === 0 ? remote.stdout.trim() : null,
    commits: log.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [hash, subject, author, when] = l.split('\x1f')
        return { hash, subject, author, when }
      }),
  }
}

// `git status --porcelain -z`: "XY path\0", and a rename or copy carries its old path as the next field.
function changedFiles(out) {
  const recs = out.split('\0')
  const files = []
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i]
    if (r.length < 4) continue
    const code = r.slice(0, 2).trim()
    const f = { code, path: r.slice(3) }
    if (/[RC]/.test(r.slice(0, 2))) f.orig = recs[++i]
    files.push(f)
  }
  return files
}

// What the git panel shows besides the summary: one file's changes, one commit, the local branches.
async function gitView(cwd, what, q) {
  if (!isDir(cwd)) throw new Error('not a directory')
  const git = (...args) => runCommand('git', ['-C', cwd, ...args], { env: CLEAN_ENV, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 })
  const MAX = 600_000 // a huge diff is cut rather than freezing the panel
  if (what === 'diff') {
    const p = String(q.get('path') ?? '')
    const f = changedFiles((await git('status', '--porcelain', '-z', '--untracked-files=all')).stdout).find((x) => x.path === p)
    if (!f) throw new Error(`${p.slice(0, 120)} has no changes`)
    if (f.code === '??') {
      const file = path.join((await git('rev-parse', '--show-toplevel')).stdout.trim(), f.path)
      if (fs.statSync(file).size > 512 * 1024) return { path: p, text: '', note: 'This new file is too big to show here' }
      const body = fs.readFileSync(file)
      if (body.includes(0)) return { path: p, text: '', note: 'A new binary file' }
      const lines = body.toString('utf8').split('\n')
      if (lines.at(-1) === '') lines.pop()
      return { path: p, text: `@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}` }
    }
    const spec = [`:(top,literal)${f.path}`, ...(f.orig ? [`:(top,literal)${f.orig}`] : [])]
    const r = await git('diff', 'HEAD', '--no-color', '--no-ext-diff', '-M', '--', ...spec)
    return { path: p, text: r.stdout.slice(0, MAX), cut: r.stdout.length > MAX }
  }
  if (what === 'show') {
    const hash = String(q.get('hash') ?? '')
    if (!/^[0-9a-f]{4,40}$/i.test(hash)) throw new Error('not a commit')
    const r = await git('show', '--no-color', '--no-ext-diff', '-M', '--format=%H%x1f%s%x1f%an%x1f%cr%x1f%b%x1e', hash)
    if (r.code !== 0) throw new Error(r.stderr.trim().split('\n')[0] || 'no such commit')
    const cut = r.stdout.indexOf('\x1e')
    const [full, subject, author, when, body] = r.stdout.slice(0, cut).split('\x1f')
    const text = r.stdout.slice(cut + 1)
    return { hash: full, subject, author, when, body: body.trim(), text: text.slice(0, MAX), cut: text.length > MAX }
  }
  if (what === 'branches') return { branches: (await git('branch', '--format=%(refname:short)')).stdout.split('\n').filter(Boolean) }
  throw new Error(`unknown git view ${what}`)
}

// The git panel's buttons. Arguments go to git directly (no shell), a credential prompt fails
// instead of hanging, and pull only fast-forwards: a merge with conflicts is not a button's job.
async function gitAction(cwd, action, message, picked, branch) {
  if (!isDir(cwd)) throw new Error('not a directory')
  const env = { ...CLEAN_ENV, GIT_TERMINAL_PROMPT: '0' }
  const git = (...args) => runCommand('git', ['-C', cwd, ...args], { env, timeout: 60_000 })
  const check = (r) => {
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ') || `git exited with ${r.code}`)
    return r
  }
  // Only files git itself reports as changed may be named: nothing else reaches the command line.
  let paths = []
  if (Array.isArray(picked)) {
    const changed = changedFiles((await git('status', '--porcelain', '-z', '--untracked-files=all')).stdout)
    const byPath = new Map(changed.map((f) => [f.path, f]))
    for (const p of picked) {
      const f = byPath.get(String(p))
      if (!f) throw new Error(`${String(p).slice(0, 120)} has no changes`)
      paths.push(f.path, ...(f.orig ? [f.orig] : []))
    }
    if (!paths.length) throw new Error('pick at least one file')
  }
  if (action === 'commit') {
    if (!String(message || '').trim()) throw new Error('write a message first')
    // Status paths are relative to the repo root (cwd may be a subfolder); literal: a name like `*` is no glob.
    const spec = paths.map((p) => `:(top,literal)${p}`)
    check(await git('add', '-A', ...(spec.length ? ['--', ...spec] : [])))
    check(await git('commit', '-m', String(message).trim().slice(0, 2000), ...(spec.length ? ['--', ...spec] : [])))
  } else if (action === 'push') {
    const tracked = (await git('rev-parse', '--abbrev-ref', '@{u}')).code === 0
    check(await (tracked ? git('push') : git('push', '-u', 'origin', 'HEAD')))
  } else if (action === 'pull') check(await git('pull', '--ff-only'))
  else if (action === 'discard') {
    // Back to the last commit: tracked files are restored, new ones removed (the panel asks first).
    if (!paths.length) throw new Error('pick the files to discard')
    const top = check(await git('rev-parse', '--show-toplevel')).stdout.trim()
    const changed = new Map(changedFiles((await git('status', '--porcelain', '-z', '--untracked-files=all')).stdout).map((f) => [f.path, f]))
    for (const p of paths) {
      const f = changed.get(p)
      if (!f) continue // a rename's old path, restored together with the new one
      const spec = [`:(top,literal)${f.path}`, ...(f.orig ? [`:(top,literal)${f.orig}`] : [])]
      if (f.code === '??') {
        const file = path.resolve(top, f.path)
        if (!file.startsWith(top + path.sep)) throw new Error(`${f.path} is outside the repository`)
        fs.rmSync(file, { force: true })
      } else if (f.code.includes('A')) check(await git('rm', '-f', '-q', '--', ...spec))
      else check(await git('restore', '--source=HEAD', '--staged', '--worktree', '--', ...spec))
    }
  } else if (action === 'branch') {
    const name = String(branch?.name ?? '').trim()
    if (!name || (await git('check-ref-format', '--branch', name)).code !== 0) throw new Error(`${name.slice(0, 80)} is not a valid branch name`)
    check(await git('switch', ...(branch?.create ? ['-c', name] : [name])))
  } else if (action === 'init') {
    if ((await git('rev-parse', '--git-dir')).code === 0) throw new Error('this folder is already a git repository')
    check(await git('init', '-q'))
  }
  else if (action === 'message') {
    const only = paths.length ? ['--', ...paths.map((p) => `:(top,literal)${p}`)] : []
    const [stat, diff, untracked] = await Promise.all([git('diff', 'HEAD', '--stat', ...only), git('diff', 'HEAD', ...only), git('ls-files', '--others', '--exclude-standard', ...only)])
    const changes = `${stat.stdout}\nNew files:\n${untracked.stdout}\n${diff.stdout}`.slice(0, 12000)
    if (!stat.stdout.trim() && !untracked.stdout.trim()) throw new Error('nothing to commit')
    const prompt = 'Write a git commit message for these changes: one line, at most 72 characters, conventional-commit style (feat:, fix:, docs:...), no quotes, no preamble.\n\n' + changes
    return { message: (await askClaude('haiku', prompt, { cwd, timeout: 120_000 })).trim().split('\n')[0] }
  } else throw new Error(`unknown git action ${action}`)
  return { ok: true }
}

const profileDirs = (sub) => (isDir(PROFILES_DIR) ? fs.readdirSync(PROFILES_DIR).map((p) => path.join(PROFILES_DIR, p, sub)) : [])
const usage = createUsage({
  dataDir: DATA_DIR,
  env: CLEAN_ENV,
  shell: SHELL,
  claudeDirs: claudeProjectDirs,
  codexDirs: () => [path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions'), ...profileDirs('sessions')],
  profileEnv: (profile) => (profile && PROFILE.test(profile) ? { CLAUDE_CONFIG_DIR: path.join(PROFILES_DIR, profile) } : {}),
})

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json' }

function serveStatic(url, res) {
  const dist = path.join(ROOT, 'dist')
  let file = path.normalize(path.join(dist, decodeURIComponent(url.pathname)))
  if (file !== dist && !file.startsWith(dist + path.sep)) return json(res, 403, { error: 'forbidden' })
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html')
  if (!fs.existsSync(file)) return json(res, 404, { error: 'run npm run build first' })
  const type = MIME[path.extname(file)] || 'application/octet-stream'
  res.writeHead(200, type === 'text/html' ? { 'content-type': type, 'content-security-policy': CSP } : { 'content-type': type })
  // The file can vanish between the check and the open while `npm run build` rewrites dist.
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res)
}

// ---------- HTTP API ----------
const ACTS = new Set(['input', 'choose', 'stop', 'signal'])
// The app's own page runs only its own scripts: markdown and agent output stay text even if
// something got past DOMPurify. Web tiles may show any page.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src * data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ws://127.0.0.1:${PORT} ws://localhost:${PORT}`,
  'frame-src http: https:',
  "object-src 'none'",
  "base-uri 'none'",
].join('; ')
const server = http.createServer(async (req, res) => {
  if (!isAllowed(req, /^\/(api|mcp)\//.test(req.url ?? ''))) return json(res, 403, { error: 'forbidden' })
  // Everything below runs inside the try: a malformed URL from any page (`/%`, `//`) must cost
  // one 400/500, not the process and every console it owns.
  try {
    const url = new URL(req.url, 'http://x')
    const parts = url.pathname.split('/').filter(Boolean) // ['api', ...]
    // A lead's team tools (MCP over plain JSON replies: no event stream, so GET is refused).
    if (parts[0] === 'mcp' && parts[1]) {
      if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
      const msg = JSON.parse(await readBody(req, 1024 * 1024))
      const out = Array.isArray(msg) ? (await Promise.all(msg.map((m) => helpers.handle(parts[1], m)))).filter(Boolean) : await helpers.handle(parts[1], msg)
      if (!out || (Array.isArray(out) && !out.length)) return res.writeHead(202).end()
      return json(res, 200, out)
    }
    if (parts[0] !== 'api') return serveStatic(url, res)
    const [, route, id, action] = parts
    if (route === 'state' && req.method === 'GET') {
      return json(res, 200, readState())
    }
    if (route === 'state' && req.method === 'PUT') {
      const body = await readBody(req)
      JSON.parse(body) // reject garbage before it overwrites good state
      backupState()
      fs.writeFileSync(STATE_FILE + '.tmp', body)
      fs.renameSync(STATE_FILE + '.tmp', STATE_FILE)
      return json(res, 200, { ok: true })
    }
    if (route === 'sessions') return json(res, 200, [...sessions.values()].map(summary))
    if (route === 'agents') return json(res, 200, (!url.searchParams.has('refresh') && installed) || (await detectAgents()))
    if (route === 'hook' && req.method === 'POST') {
      const payload = JSON.parse((await readBody(req, 1024 * 1024)) || '{}')
      const s = sessions.get(id) // after the body: the console may have exited meanwhile
      if (s) {
        const idlePrompt = payload.notification_type === 'idle_prompt' || /waiting for your input/i.test(payload.message || '')
        if (payload.transcript_path) s.transcript = String(payload.transcript_path)
        if (action === 'SessionStart') s.started = true // its TUI takes input now (helpers wait for this)
        if (action === 'UserPromptSubmit') s.submits = (s.submits || 0) + 1
        trackSubagent(s, action, payload)
        if (action === 'PreToolUse') setActivity(s, describeTool(payload.tool_name, payload.tool_input).doing)
        else if (action !== 'PostToolUse') setActivity(s, null)
        touchConversation(s, action === 'SessionStart')
        if (action === 'Stop') setTimeout(() => sessions.get(s.id) === s && touchConversation(s), 1200)
        if (action === 'UserPromptSubmit' || action === 'PreToolUse' || action === 'PostToolUse') setStatus(s, 'working')
        else if (action === 'Stop') {
          setStatus(s, 'done')
          settleSubagents(s)
        }
        // Auto-compact restarts the session mid-turn: the agent is still working.
        else if (action === 'SessionStart' && payload.source !== 'compact') setStatus(s, 'idle')
        else if (action === 'Notification' && !idlePrompt) setStatus(s, 'needs')
        // Esc interrupts fire no Stop; the 60s idle notice is what unsticks "working".
        else if (action === 'Notification' && s.status === 'working') {
          setStatus(s, 'idle')
          settleSubagents(s)
        }
        // `prompted` marks a conversation worth resuming: it has at least one prompt on disk.
        if (payload.session_id) broadcast({ type: 'session-id', id: s.id, sessionId: payload.session_id, prompted: action === 'UserPromptSubmit' })
      }
      return json(res, 200, { ok: true })
    }
    if (route === 'handoff' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req, 64 * 1024))
      const fromName = String(body.fromName || 'the previous agent').slice(0, 80)
      const toName = String(body.toName || 'the next agent').slice(0, 80)
      const from = sessions.get(body.from)
      const to = sessions.get(body.to)
      if (!from) return json(res, 409, { error: `${fromName} is not running` })
      if (!to) return json(res, 409, { error: `${toName} is not running` })
      if (from === to) return json(res, 400, { error: 'an agent cannot hand off to itself' })
      const mode = ['brief', 'reply', 'review', 'feedback', 'context'].includes(body.mode) ? body.mode : 'brief'
      // Forwarding and conditions look at what A said last: Claude's transcript reply, or its screen.
      const said = () => {
        const { context, lastReply } = conversationText(from)
        return lastReply || context.slice(-3000)
      }
      if (body.pattern && !matches(said(), String(body.pattern))) return json(res, 200, { ok: true, sent: false })
      if (mode === 'feedback' && approved(said())) return json(res, 200, { ok: true, sent: false, approved: true })
      const key = `${from.id}>${to.id}:${mode}`
      if (Date.now() - (recentHandoffs.get(key) || 0) < 20_000) return json(res, 200, { ok: true, duplicate: true })
      recentHandoffs.set(key, Date.now())
      broadcast({ type: 'handoff', from: from.id, to: to.id, state: 'summarizing' })
      const needsBrief = mode === 'brief' || mode === 'review' || mode === 'context'
      const brief = needsBrief ? await handoffBrief(from) : ''
      if (sessions.get(to.id) !== to) {
        broadcast({ type: 'handoff', from: from.id, to: to.id, state: 'failed' })
        return json(res, 409, { error: `${toName} stopped before the hand-off arrived` })
      }
      sendPrompt(to, linkMessage(mode, { fromName, brief, reply: needsBrief ? '' : said(), role: typeof body.role === 'string' ? body.role : '' }))
      setStatus(to, 'working')
      broadcast({ type: 'handoff', from: from.id, to: to.id, state: 'sent' })
      return json(res, 200, { ok: true, sent: true })
    }
    if (route === 'pty' && id) {
      const s = sessions.get(id)
      if (!s) return json(res, 404, { error: 'no such console' })
      if (req.method === 'DELETE') {
        kill(s)
        return json(res, 200, { ok: true })
      }
      // What acts on the console only ever comes as a POST.
      if (ACTS.has(action) && req.method !== 'POST') return json(res, 405, { error: 'POST only' })
      const body = JSON.parse((await readBody(req, 1024 * 1024)) || '{}')
      if (action === 'input') {
        if (body.prompt) {
          sendPrompt(s, String(body.prompt))
          setStatus(s, 'working') // not idle: that would let an idle loop type over this prompt
        } else {
          writeTo(s, String(body.data ?? ''))
          if (s.status === 'done') setStatus(s, 'idle')
        }
        return json(res, 200, { ok: true })
      }
      // A button pressed on a question. The screen is read again first, and again after moving to the
      // option: a click that arrives late must never answer a different question, or pick another option.
      if (action === 'choose') {
        const index = Number(body.index)
        const before = await readScreen(s)
        if (!before || before.id !== body.askId) return json(res, 409, { error: 'the question has changed' })
        if (!Number.isInteger(index) || !before.options[index]) return json(res, 400, { error: 'no such option' })
        const moves = index - before.selected
        for (let i = 0; i < Math.abs(moves); i++) {
          writeTo(s, moves > 0 ? '\x1b[B' : '\x1b[A')
          await sleep(60)
        }
        let now = await readScreen(s)
        for (let tries = 0; moves && now?.id === body.askId && now.selected !== index && tries < 8; tries++) {
          await sleep(100)
          now = await readScreen(s)
        }
        if (!now || now.id !== body.askId || now.selected !== index) return json(res, 409, { error: 'the question has changed' })
        writeTo(s, '\r')
        s.answered = body.askId
        publishAsk(s, null)
        setStatus(s, isRefusal(before.options[index].label) ? 'idle' : 'working')
        return json(res, 200, { ok: true })
      }
      // Esc interrupts an agent, but Claude fires no hook for it: look for its note in the transcript,
      // or the console would keep saying "Running" until the 60s idle notice.
      if (action === 'stop') {
        writeTo(s, '\x1b')
        if (s.agent.hooks) {
          for (const ms of [1200, 3500]) {
            setTimeout(() => {
              if (sessions.get(s.id) !== s || s.status !== 'working' || conversationOf(s).at(-1)?.kind !== 'note') return
              setStatus(s, 'idle')
              setActivity(s, null)
              settleSubagents(s)
              touchConversation(s)
            }, ms)
          }
        }
        return json(res, 200, { ok: true })
      }
      if (action === 'signal' && (body.signal === 'SIGSTOP' || body.signal === 'SIGCONT')) {
        signal(s, body.signal)
        return json(res, 200, { ok: true })
      }
      if (action === 'tail') return json(res, 200, { text: s.buf.slice(-(Number(body.chars) || 8000)) })
      if (action === 'conversation') {
        return json(res, 200, { items: conversationOf(s) })
      }
      if (action === 'context') return json(res, 200, { report: contextOf(s) })
    }
    if (route === 'ls') {
      const dir = url.searchParams.get('path') || os.homedir()
      if (!isDir(dir)) return json(res, 400, { error: 'not a directory' })
      const dirs = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b))
      return json(res, 200, { path: dir, parent: path.dirname(dir), home: os.homedir(), dirs, isRepo: fs.existsSync(path.join(dir, '.git')) })
    }
    if (route === 'claude-session' && id && UUID.test(id)) {
      const exists = claudeProjectDirs().some((base) => isDir(base) && fs.readdirSync(base).some((d) => fs.existsSync(path.join(base, d, `${id}.jsonl`))))
      return json(res, 200, { exists })
    }
    if (route === 'reveal' && req.method === 'POST') {
      const { cwd } = JSON.parse(await readBody(req, 64 * 1024))
      if (!isDir(cwd)) return json(res, 400, { error: 'not a directory' })
      // `open X.app` launches the app; a folder with an extension may be a bundle, so reveal it instead.
      await runCommand('open', path.extname(cwd) ? ['-R', cwd] : [cwd])
      return json(res, 200, { ok: true })
    }
    if (route === 'scan' && req.method === 'POST') {
      const { cwd, agent } = JSON.parse(await readBody(req, 64 * 1024))
      if (!isDir(cwd)) return json(res, 400, { error: 'not a directory' })
      try {
        return json(res, 200, scans.start(cwd, String(agent || 'claude')))
      } catch (e) {
        return json(res, 400, { error: e.message })
      }
    }
    if (route === 'scan' && req.method === 'DELETE') {
      scans.clear(url.searchParams.get('cwd'))
      return json(res, 200, { ok: true })
    }
    if (route === 'diagram' && req.method === 'POST') {
      const { cwd, agent, focus } = JSON.parse(await readBody(req, 64 * 1024))
      if (!isDir(cwd)) return json(res, 400, { error: 'not a directory' })
      try {
        return json(res, 200, diagrams.start(cwd, String(agent || 'claude'), String(focus ?? '')))
      } catch (e) {
        return json(res, 400, { error: e.message })
      }
    }
    if (route === 'diagram' && req.method === 'DELETE') {
      diagrams.clear(url.searchParams.get('cwd'))
      return json(res, 200, { ok: true })
    }
    if (route === 'docs') {
      const cwd = url.searchParams.get('cwd')
      try {
        if (req.method === 'POST') {
          const body = JSON.parse(await readBody(req, 64 * 1024))
          if (!isDir(body.cwd)) return json(res, 400, { error: 'not a directory' })
          return json(res, 200, docs.start(body.cwd, body))
        }
        if (req.method === 'DELETE') return (docs.clear(cwd), json(res, 200, { ok: true }))
        if (id === 'read') return json(res, 200, docs.read(cwd, url.searchParams.get('id')))
        return json(res, 200, docs.library(cwd))
      } catch (e) {
        return json(res, 400, { error: e.message })
      }
    }
    if (route === 'plan' && req.method === 'POST') {
      const { command, board } = JSON.parse(await readBody(req, 512 * 1024))
      const prompt = [
        'You are the planner of a visual board of coding-agent consoles. Turn the user command into board actions.',
        `Board: ${JSON.stringify(board)}`,
        `Command: ${JSON.stringify(String(command))}`,
        'Reply with ONLY a JSON object: {"reply": "<one short sentence to say back, in the language of the command>", "actions": [...]}.',
        'Allowed actions:',
        '{"type":"send","to":["<console name, group label, or all>"],"text":"<prompt to type into those consoles>"}',
        '{"type":"spawn","agent":"<one of board.agents>","count":<1-12>,"group":"<optional new group label>"}',
        '{"type":"group","names":["<console names>"],"label":"<group label>"}',
        '{"type":"frame","names":["<console names or group labels>"]}',
        '{"type":"handoff","from":"<console name>","to":"<console name>"}  (summarise one agent\'s work and give it to another)',
        '{"type":"diagram","focus":"<optional: the part of the repo to draw>"}  (draw a diagram of the project\'s code on the board)',
        '{"type":"pause"}  {"type":"resume"}',
        'There is no action to stop or delete a console: if asked, say it needs the close button. If the command is unclear, return no actions and ask in "reply".',
      ].join('\n')
      try {
        const plan = parseJSON(await askClaude('haiku', prompt, { cwd: os.homedir(), timeout: 120_000 }))
        if (!plan || typeof plan.reply !== 'string' || !Array.isArray(plan.actions)) throw new Error('planner reply has the wrong shape')
        return json(res, 200, plan)
      } catch (e) {
        return json(res, 502, { error: e.message })
      }
    }
    if (route === 'git' && id && req.method === 'POST') {
      const { cwd, message, files, branch } = JSON.parse(await readBody(req, 256 * 1024))
      try {
        return json(res, 200, await gitAction(cwd, id, message, files, branch))
      } catch (e) {
        return json(res, 400, { error: e.message })
      }
    }
    if (route === 'git' && id) {
      try {
        return json(res, 200, await gitView(url.searchParams.get('cwd'), id, url.searchParams))
      } catch (e) {
        return json(res, 400, { error: e.message })
      }
    }
    if (route === 'git') return json(res, 200, await gitInfo(url.searchParams.get('cwd')))
    if (route === 'files') {
      try {
        if (req.method === 'POST' && id === 'write') {
          const { root, path: rel, text, create } = JSON.parse(await readBody(req, 2 * 1024 * 1024))
          if (!isDir(root)) throw new Error('not a directory')
          return json(res, 200, files.write(root, rel, text, !!create))
        }
        const root = url.searchParams.get('root')
        if (!isDir(root)) throw new Error('not a directory')
        if (id === 'tree') return json(res, 200, files.tree(root, url.searchParams.get('only') === 'md' ? /\.(md|mdx|markdown)$/i : undefined))
        if (id === 'read') return json(res, 200, files.read(root, url.searchParams.get('path')))
        if (id === 'links') return json(res, 200, files.links(root))
        throw new Error('unknown files call')
      } catch (e) {
        return json(res, 400, { error: e.message })
      }
    }
    if (route === 'ports') {
      const asked = (url.searchParams.get('ports') ?? '').split(',').map(Number).filter((p) => Number.isInteger(p) && p > 0 && p < 65536)
      return json(res, 200, await Promise.all((asked.length ? asked.slice(0, 20) : DEV_PORTS).map(probePort)))
    }
    if (route === 'page-title') {
      try {
        return json(res, 200, { title: await pageTitle(url.searchParams.get('url') ?? '') })
      } catch (e) {
        return json(res, 400, { error: e.message })
      }
    }
    if (route === 'usage' && id === 'limits') {
      try {
        return json(res, 200, await usage.limits(url.searchParams.get('profile') || '', url.searchParams.get('fresh') === '1'))
      } catch (e) {
        return json(res, 502, { error: e.message })
      }
    }
    if (route === 'usage') return json(res, 200, await usage.tokens())
    if (route === 'visible' && req.method === 'POST') {
      const { ids } = JSON.parse(await readBody(req, 256 * 1024))
      loops.setVisible(Array.isArray(ids) ? ids : [])
      return json(res, 200, { ok: true })
    }
    if (route === 'loops') {
      if (req.method === 'GET') return json(res, 200, loops.list())
      if (req.method === 'DELETE' && id) return json(res, 200, loops.remove(id))
      const input = JSON.parse((await readBody(req, 1024 * 1024)) || '{}')
      try {
        if (req.method === 'POST' && !id) return json(res, 200, loops.add(input))
        if (req.method === 'PUT' && id) return json(res, 200, loops.update(id, input))
        if (req.method === 'POST' && action === 'run') return json(res, 200, loops.runNow(id))
        if (req.method === 'POST' && action === 'active') return json(res, 200, loops.setActive(id, !!input.on))
      } catch (e) {
        return json(res, 400, { error: e.message })
      }
    }
    return json(res, 404, { error: 'not found' })
  } catch (e) {
    console.error(e)
    if (res.headersSent) return res.destroy()
    return json(res, e instanceof URIError ? 400 : 500, { error: e instanceof URIError ? 'bad url' : 'server error' })
  }
})

// ---------- WebSockets ----------
const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  if (!isAllowed(req)) return socket.destroy()
  socket.on('error', () => socket.destroy())
  wss.handleUpgrade(req, socket, head, (ws) => {
    // A broken frame emits 'error'; without a listener that throws and takes the server down.
    ws.on('error', () => ws.terminate())
    let url
    try {
      url = new URL(req.url, 'http://x')
    } catch {
      return ws.close()
    }
    if (url.pathname === '/ws/events') return attachEvents(ws)
    if (url.pathname === '/ws/pty') return attachPty(ws, url.searchParams)
    ws.close()
  })
})

// Terminal queries (device attributes, cursor and status reports, colour and mode queries) in a
// replayed buffer would be answered again by the fresh xterm, and the answers would reach the
// agent as keystrokes long after it asked.
const QUERIES =
  /\x1b\[[>=]?0?c|\x1b\[\??[0-9]*n|\x1b\[>[0-9]*q|\x1b\[\?u|\x1b\[\??[0-9;]*\$p|\x1b\[1[468]t|\x1bP\$q[^\x1b]*\x1b\\|\x1b\](?:1[0-2]|4;[0-9]+);\?(?:\x07|\x1b\\)/g

function attachEvents(ws) {
  eventClients.add(ws)
  ws.send(JSON.stringify({ type: 'sessions', sessions: [...sessions.values()].map(summary) }))
  ws.send(JSON.stringify({ type: 'loops', loops: loops.list() }))
  ws.send(JSON.stringify({ type: 'scans', scans: scans.list() }))
  ws.send(JSON.stringify({ type: 'docs', docs: docs.list() }))
  ws.send(JSON.stringify({ type: 'diagrams', diagrams: diagrams.list() }))
  ws.on('close', () => eventClients.delete(ws))
}

// A connected folder that has gone away (an unplugged disk) must not stop the agent from starting.
function connectedFolders(raw) {
  if (!raw) return []
  try {
    const dirs = JSON.parse(raw)
    return Array.isArray(dirs) ? dirs.filter(isDir) : []
  } catch {
    return []
  }
}

function attachPty(ws, q) {
  const id = q.get('id')
  if (!id || !/^[\w-]{1,64}$/.test(id)) return ws.close()
  const cols = dim(q.get('cols'), 500, 100)
  const rows = dim(q.get('rows'), 300, 30)
  let s = sessions.get(id)
  if (!s) {
    try {
      s = spawnSession({
        id,
        agentId: q.get('agent') || 'shell',
        cwd: q.get('cwd'),
        cols,
        rows,
        sessionId: q.get('sessionId'),
        resume: q.get('resume'),
        yolo: q.get('yolo') === '1',
        lead: q.get('lead') === '1',
        profile: q.get('profile') || undefined,
        dirs: connectedFolders(q.get('dirs')),
      })
    } catch (e) {
      ws.send(`\r\n\x1b[31m${e.message}\x1b[0m\r\n`)
      return ws.close(4001, e.message.slice(0, 120))
    }
  } else if (s.buf) {
    ws.send(s.buf.replace(QUERIES, ''))
  }
  s.clients.add(ws)
  // Nudge full-screen TUIs to repaint for the freshly attached view.
  resize(s, cols, Math.max(2, rows - 1))
  resize(s, cols, rows)
  ws.on('message', (raw) => {
    if (sessions.get(s.id) !== s) return // a message that arrives after the exit
    let m
    try {
      m = JSON.parse(String(raw))
    } catch {
      return
    }
    if (!m || typeof m !== 'object') return
    if (m.t === 'a' && Number.isFinite(m.n)) {
      s.unacked.set(ws, Math.max(0, (s.unacked.get(ws) ?? 0) - m.n))
      s.lastAckAt = Date.now()
      holdOutput(s)
    } else if (m.t === 'i' && typeof m.d === 'string') {
      s.pty.write(m.d)
      s.lastInputAt = Date.now()
      if (s.status === 'done') setStatus(s, 'idle')
    } else if (m.t === 'r') {
      const c = dim(m.cols, 500, 0)
      const r = dim(m.rows, 300, 0)
      if (c && r) resize(s, c, r)
    }
  })
  ws.on('close', () => {
    s.clients.delete(ws)
    s.unacked.delete(ws)
    if (sessions.get(s.id) === s) holdOutput(s)
  })
}

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `port ${PORT} is in use by another program` : e)
  process.exit(1)
})
server.listen(PORT, '127.0.0.1', () => console.log(`vibeboard server on http://127.0.0.1:${PORT}`))

// Give agents up to 3s to close their own tool shells, then kill whatever is left,
// so no console outlives the server that owns its PTY.
let stopping = false
const shutdown = () => {
  if (stopping) return
  stopping = true
  const groups = new Set()
  for (const s of sessions.values()) groupsOf(s, groups)
  signalGroups(groups, 'SIGCONT')
  signalGroups(groups, 'SIGHUP')
  signalGroups(groups, 'SIGTERM')
  const t0 = Date.now()
  const tick = setInterval(() => {
    if (sessions.size && Date.now() - t0 < 3000) return
    clearInterval(tick)
    signalGroups(groups, 'SIGKILL')
    process.exit(0)
  }, 100)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
// Last resort: an unexpected throw still takes the consoles down with us instead of orphaning them.
process.on('uncaughtException', (e) => {
  console.error('fatal:', e)
  shutdown()
})
process.on('unhandledRejection', (e) => {
  console.error('fatal:', e)
  shutdown()
})
