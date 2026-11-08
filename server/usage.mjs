// Usage: the plan's limits as the CLI's own `/usage` screen shows them, and tokens per agent
// from each agent's local session logs. Nothing leaves the machine.
import { isMainThread, parentPort, Worker } from 'node:worker_threads'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import pty from 'node-pty'
import headless from '@xterm/headless'

const { Terminal } = headless
const COLS = 110
const ROWS = 60

// The /usage screen, rendered: "Current session" / "███  37% used" / "Resets 1:49am (Europe/Rome)",
// then "Last 24h" with lines like "82%  Start fresh when you switch tasks · run /clear".
export function parseUsageScreen(text) {
  const lines = text.split('\n').map((l) => l.trimEnd())
  const limits = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/(\d+(?:\.\d+)?)%\s+used\b/)
    if (!m) continue
    let t = i - 1
    while (t >= 0 && !lines[t].trim()) t--
    const reset = lines.slice(i + 1, i + 3).map((l) => l.trim()).find((l) => /^Resets?\b/i.test(l))
    limits.push({ title: lines[t]?.trim() || 'Limit', pct: Number(m[1]), resets: reset ? reset.replace(/^Resets?\s*/i, '') : null })
  }
  const insights = []
  const start = lines.findIndex((l) => /^\s*Last 24h\b/i.test(l))
  if (start >= 0)
    for (const l of lines.slice(start + 1)) {
      const m = l.match(/^\s*(\d+)%\s{2,}(\S.*)$/)
      if (m) insights.push({ pct: Number(m[1]), text: m[2].trim() })
      else if (insights.length && !l.trim()) break
    }
  return { limits, insights }
}

export const screenOf = (term) => {
  const b = term.buffer.active
  const out = []
  for (let i = 0; i < b.length; i++) out.push(b.getLine(i)?.translateToString(true) ?? '')
  return out.join('\n')
}

const localDay = (ts) => {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// "claude-opus-5-5" -> "Opus 5.5", "claude-sonnet-4-20250514" -> "Sonnet 4", "gpt-5-codex" -> "gpt-5-codex".
export function modelName(id) {
  const m = String(id).match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/)
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : String(id)
}

// One log file, fed a line at a time -> tokens per local day [input, output, cache], requests per
// model, first and last timestamp. Line by line: a transcript can be hundreds of MB.
function claudeLines() {
  const days = {}
  const models = {}
  const seen = new Set() // one line per content block, all carrying the same message usage
  let first = null
  let last = null
  const add = (line) => {
    if (!line.includes('"usage"')) return
    let e
    try {
      e = JSON.parse(line)
    } catch {
      return
    }
    const u = e.message?.usage
    const day = u && e.timestamp && localDay(e.timestamp)
    if (!day) return
    const id = e.message.id || e.requestId
    if (id) {
      if (seen.has(id)) return
      seen.add(id)
    }
    const d = (days[day] ||= [0, 0, 0])
    d[0] += u.input_tokens || 0
    d[1] += u.output_tokens || 0
    d[2] += (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
    if (e.message.model && e.message.model !== '<synthetic>') models[e.message.model] = (models[e.message.model] || 0) + 1
    first ??= e.timestamp
    last = e.timestamp
  }
  return { add, done: () => ({ days, models, first, last }) }
}

// Codex rollouts: `token_count` events carry the turn's usage; cached input is part of input there.
function codexLines() {
  const days = {}
  const models = {}
  let model = null
  let first = null
  let last = null
  const add = (line) => {
    if (!line.includes('"token_count"') && !line.includes('"turn_context"')) return
    let e
    try {
      e = JSON.parse(line)
    } catch {
      return
    }
    if (e.type === 'turn_context' && e.payload?.model) model = e.payload.model
    const u = e.payload?.type === 'token_count' ? e.payload.info?.last_token_usage : null
    const day = u && e.timestamp && localDay(e.timestamp)
    if (!day) return
    const cached = u.cached_input_tokens || 0
    const d = (days[day] ||= [0, 0, 0])
    d[0] += Math.max(0, (u.input_tokens || 0) - cached)
    d[1] += u.output_tokens || 0
    d[2] += cached
    if (model) models[model] = (models[model] || 0) + 1
    first ??= e.timestamp
    last = e.timestamp
  }
  return { add, done: () => ({ days, models, first, last }) }
}

const whole = (make) => (text) => {
  const p = make()
  for (const line of text.split('\n')) p.add(line)
  return p.done()
}
export const claudeLog = whole(claudeLines)
export const codexLog = whole(codexLines)

async function readLog(file, make) {
  const p = make()
  for await (const line of readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })) p.add(line)
  return p.done()
}

async function jsonlFiles(dir, out = []) {
  let entries
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) await jsonlFiles(p, out)
    else if (e.name.endsWith('.jsonl')) out.push(p)
  }
  return out
}

// ---------- tokens from local logs (async, cached per file on mtime+size) ----------
const fileCache = new Map()
async function scan(dirs, make) {
  const agg = { days: {}, models: {}, sessions: 0, longestMs: 0, first: null }
  for (const base of dirs) {
    for (const file of await jsonlFiles(base)) {
      let st
      try {
        st = await fs.promises.stat(file)
      } catch {
        continue
      }
      const key = `${st.mtimeMs}:${st.size}`
      let entry = fileCache.get(file)
      if (entry?.key !== key) {
        try {
          entry = { key, ...(await readLog(file, make)) }
        } catch {
          continue // gone or unreadable between the listing and the read
        }
        fileCache.set(file, entry)
      }
      if (!entry.first) continue
      for (const [day, [i, o, c]] of Object.entries(entry.days)) {
        const d = (agg.days[day] ||= [0, 0, 0])
        d[0] += i
        d[1] += o
        d[2] += c
      }
      for (const [m, n] of Object.entries(entry.models)) agg.models[m] = (agg.models[m] || 0) + n
      // A sub-agent's own log is part of its parent's session, not a session of its own.
      if (!file.includes(`${path.sep}subagents${path.sep}`)) {
        agg.sessions++
        agg.longestMs = Math.max(agg.longestMs, Date.parse(entry.last) - Date.parse(entry.first) || 0)
      }
      if (!agg.first || entry.first < agg.first) agg.first = entry.first
    }
  }
  agg.models = Object.fromEntries(Object.entries(agg.models).map(([m, n]) => [modelName(m), n]))
  return agg
}

export function createUsage({ dataDir, env, shell, claudeDirs, codexDirs, profileEnv }) {
  // Parsing a large log takes seconds, and on this thread every terminal would wait for it. One worker
  // keeps its per-file cache for good, and answers overlapping requests together.
  let worker = null
  let running = null
  const tokens = () => {
    if (running) return running
    worker ??= new Worker(new URL(import.meta.url))
    worker.unref()
    running = new Promise((resolve, reject) => {
      const done = () => {
        worker?.off('message', onMessage)
        worker?.off('error', onError)
        running = null
      }
      const onMessage = (r) => {
        done()
        if (r.error) reject(new Error(r.error))
        else resolve(r.result)
      }
      const onError = (e) => {
        done()
        worker = null // the next request starts a fresh one
        reject(e)
      }
      worker.on('message', onMessage)
      worker.on('error', onError)
      worker.postMessage({ claude: claudeDirs(), codex: codexDirs() })
    })
    return running
  }

  // ---------- plan limits from a hidden `claude` running /usage ----------
  // It starts in an empty folder of ours with no user or project settings, so none of the user's
  // hooks, plugins or MCP servers run, and no conversation is created (no prompt is sent).
  const limitsCache = new Map() // profile -> { at, data }
  const inflight = new Map()
  function readLimits(profile) {
    const dir = path.join(dataDir, 'usage-probe')
    fs.mkdirSync(dir, { recursive: true })
    return new Promise((resolve, reject) => {
      const term = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true })
      const p = pty.spawn(shell, ['-lic', 'exec claude --setting-sources local --strict-mcp-config'], {
        name: 'xterm-256color',
        cols: COLS,
        rows: ROWS,
        cwd: dir,
        env: { ...env, ...profileEnv(profile), TERM_PROGRAM: 'vibeboard' },
      })
      let done = false
      let sent = false
      const t0 = Date.now()
      p.onData((d) => !done && term.write(d))
      const finish = (err, data) => {
        if (done) return
        done = true
        clearInterval(tick)
        // Claude Code ignores SIGHUP.
        for (const sig of ['SIGTERM', 'SIGKILL'])
          setTimeout(() => {
            try {
              process.kill(-p.pid, sig)
            } catch {}
            try {
              p.kill(sig)
            } catch {}
          }, sig === 'SIGTERM' ? 0 : 2000)
        term.dispose()
        err ? reject(err) : resolve(data)
      }
      p.onExit(() => finish(new Error(sent ? 'claude closed before showing usage' : 'claude did not start')))
      const tick = setInterval(() => {
        const screen = screenOf(term)
        if (/Do you trust the files|trust this folder/i.test(screen)) return finish(new Error('claude asks to trust its folder'))
        if (/Select login method|Please run \/login|Not logged in|Let's get started|Choose the text style/i.test(screen)) return finish(new Error('this account is not signed in yet'))
        if (!sent && /❯/.test(screen)) {
          sent = true
          p.write('/usage')
          setTimeout(() => p.write('\r'), 400)
          return
        }
        const ready = /% used/.test(screen) && !/Scanning local sessions|Refreshing…/.test(screen)
        if (ready || Date.now() - t0 > 30_000) {
          const data = parseUsageScreen(screen)
          if (data.limits.length) finish(null, data)
          else finish(new Error(sent ? 'no limits on the /usage screen (an API-key sign-in has none)' : 'claude did not start'))
        }
      }, 500)
    })
  }
  async function limits(profile, fresh) {
    const key = profile || ''
    const hit = limitsCache.get(key)
    if (hit && !fresh && Date.now() - hit.at < 60_000) return hit
    if (!inflight.has(key))
      inflight.set(
        key,
        readLimits(profile)
          .then((data) => {
            const entry = { at: Date.now(), ...data }
            limitsCache.set(key, entry)
            return entry
          })
          .finally(() => inflight.delete(key)),
      )
    return inflight.get(key)
  }

  return { tokens, limits }
}

// `node server/usage.mjs`: checks the parsers on samples shaped like the real screen and logs.
if (!isMainThread) {
  parentPort.on('message', async ({ claude, codex }) => {
    try {
      parentPort.postMessage({ result: { claude: await scan(claude, claudeLines), codex: await scan(codex, codexLines), scannedAt: Date.now() } })
    } catch (e) {
      parentPort.postMessage({ error: e.message })
    }
  })
}

if (isMainThread && import.meta.url === `file://${process.argv[1]}`) {
  const assert = (await import('node:assert/strict')).default
  const screen = [
    '  Current session',
    '  ██████████████████▌                                37% used',
    '  Resets 1:49am (Europe/Rome)',
    '',
    '  Current week (all models)',
    '  ████████████                                       24% used',
    '  Resets Oct 31 at 4:59pm (Europe/Rome)',
    '',
    '  Last 24h · shares overlap',
    '',
    '  82%  Start fresh when you switch tasks · run /clear',
    '  28%  Run fewer sessions at once · up to 10 at once',
    '',
    '  MCP servers             % of usage',
    '  claude-in-chrome               10%',
  ].join('\n')
  assert.deepEqual(parseUsageScreen(screen), {
    limits: [
      { title: 'Current session', pct: 37, resets: '1:49am (Europe/Rome)' },
      { title: 'Current week (all models)', pct: 24, resets: 'Oct 31 at 4:59pm (Europe/Rome)' },
    ],
    insights: [
      { pct: 82, text: 'Start fresh when you switch tasks · run /clear' },
      { pct: 28, text: 'Run fewer sessions at once · up to 10 at once' },
    ],
  })
  assert.equal(modelName('claude-opus-5-5'), 'Opus 5.5')
  assert.equal(modelName('claude-sonnet-4-20250514'), 'Sonnet 4')
  const line = (id, ts, u) => JSON.stringify({ timestamp: ts, message: { id, model: 'claude-opus-5-5', usage: u } })
  const c = claudeLog([line('a', '2026-10-01T10:00:00Z', { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 100 }), line('a', '2026-10-01T10:00:00Z', { input_tokens: 5, output_tokens: 7 }), line('b', '2026-10-01T11:00:00Z', { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 9 })].join('\n'))
  assert.deepEqual(Object.values(c.days), [[6, 8, 109]], 'a message split over several lines counts once')
  assert.deepEqual(c.models, { 'claude-opus-5-5': 2 })
  const x = codexLog(
    [
      JSON.stringify({ timestamp: '2026-10-01T10:00:00Z', type: 'turn_context', payload: { model: 'gpt-5-codex' } }),
      JSON.stringify({ timestamp: '2026-10-01T10:00:01Z', type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 8 } } } }),
    ].join('\n'),
  )
  assert.deepEqual(Object.values(x.days), [[40, 8, 60]], 'cached input is split out of the input')
  console.log('usage parsers ok')
}
