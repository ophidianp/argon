// Plan limits: how much of each agent's plan is left, for the Usage window and the top-bar pill.
// Claude: Anthropic's usage endpoint with Claude Code's own sign-in. Codex: the limits its last turn wrote
// to its session logs. Copilot: the quotas GitHub reports to the signed-in gh CLI.
// Everything is normalised here, so the sign-in token and the raw answers never leave the server.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Claude limit kinds -> plain names. Unknown kinds get a readable version of their own name.
export const CLAUDE_KIND = {
  session: '5-hour limit',
  five_hour: '5-hour limit',
  weekly_all: 'Weekly · all models',
  seven_day: 'Weekly · all models',
  weekly_opus: 'Weekly · Opus',
  seven_day_opus: 'Weekly · Opus',
  weekly_sonnet: 'Weekly · Sonnet',
  seven_day_sonnet: 'Weekly · Sonnet',
  weekly_oauth_apps: 'Weekly · other apps',
  seven_day_oauth_apps: 'Weekly · other apps',
  weekly_cowork: 'Weekly · Cowork',
  seven_day_cowork: 'Weekly · Cowork',
}
const COPILOT_Q = { premium_interactions: 'Premium requests', chat: 'Chat', completions: 'Code completions' }
const PLAN = { pro: 'Pro', max: 'Max', team: 'Team', enterprise: 'Enterprise', free: 'Free' }

export const planName = (p) => (p ? PLAN[String(p).toLowerCase()] || String(p)[0].toUpperCase() + String(p).slice(1) : undefined)
export const humanize = (k) =>
  String(k)
    .replace(/^seven_day_?/, 'weekly_')
    .split('_')
    .filter(Boolean)
    .map((w, i) => (i ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ')
    .replace(/^Weekly /, 'Weekly · ')
const clampPct = (n) => Math.max(0, Math.min(100, Number(n) || 0))
const ms = (v) => {
  if (v == null || v === '') return undefined
  const n = typeof v === 'number' ? (v > 1e12 ? v : v * 1000) : Date.parse(v)
  return Number.isFinite(n) ? n : undefined
}
const limit = (title, pct, resetsAt, sub) => ({ title, pct: clampPct(pct), ...(resetsAt ? { resetsAt } : {}), ...(sub ? { sub } : {}) })

// ---------- normalisers (pure; tested in test/limits.test.mjs) ----------
export function normalizeClaude(d, plan) {
  const limits = []
  const seen = new Set()
  const add = (title, pct, reset, sub) => {
    if (seen.has(title)) return
    seen.add(title)
    limits.push(limit(title, pct, ms(reset), sub))
  }
  // A scoped limit names what it covers, e.g. { model: { display_name: 'Fable' } } -> "Weekly · Fable".
  const scopeName = (sc) =>
    typeof sc === 'string' ? sc : sc && typeof sc === 'object' ? sc.model?.display_name || sc.surface?.display_name || (typeof sc.surface === 'string' ? sc.surface : '') : ''
  if (Array.isArray(d?.limits))
    for (const l of d.limits) {
      if (!l || l.percent == null) continue
      const scope = scopeName(l.scope)
      const base = CLAUDE_KIND[l.kind] || humanize(scope && l.group ? l.group : l.kind || l.group || 'limit')
      add(scope ? `${base.replace(/ · .*$/, '')} · ${scope}` : base, l.percent, l.resets_at)
    }
  // Older answers (or limits the list left out): the named windows.
  for (const k of Object.keys(CLAUDE_KIND)) {
    const v = d?.[k]
    if (v && typeof v === 'object' && v.utilization != null) add(CLAUDE_KIND[k], v.utilization, v.resets_at)
  }
  const x = d?.extra_usage
  if (x && x.is_enabled) {
    const div = 10 ** (x.decimal_places ?? 2)
    const money = (n) => (n == null ? '?' : (n / div).toLocaleString('en-US', { style: 'currency', currency: x.currency || 'USD' }))
    const sub = `${money(x.used_credits)} of ${money(x.monthly_limit)}`
    const pct = x.utilization ?? (x.monthly_limit ? (x.used_credits / x.monthly_limit) * 100 : 0)
    add('Extra usage · this month', pct, undefined, sub)
  }
  return { ok: true, plan: planName(plan), limits }
}

export function normalizeCodex(rl, at) {
  const atMs = ms(at) ?? Date.now()
  const win = (w) => {
    const m = Number(w?.window_minutes)
    return m === 300 ? '5-hour limit' : m === 10080 ? 'Weekly limit' : m ? (m % 1440 === 0 ? `${m / 1440}-day limit` : `${Math.round(m / 60)}-hour limit`) : 'Limit'
  }
  const reset = (w) => (w.resets_at ? ms(w.resets_at) : w.resets_in_seconds != null ? atMs + w.resets_in_seconds * 1000 : undefined)
  const limits = []
  for (const key of ['primary', 'secondary']) {
    const w = rl?.[key]
    if (w && w.used_percent != null) limits.push(limit(win(w), w.used_percent, reset(w)))
  }
  return { ok: true, plan: planName(rl?.plan_type), limits, asOf: atMs }
}

export function normalizeCopilot(j) {
  const resetsAt = j?.quota_reset_date ? ms(`${j.quota_reset_date}T00:00:00Z`) : undefined
  const limits = []
  for (const [k, q] of Object.entries(j?.quota_snapshots || {})) {
    if (!q || typeof q !== 'object') continue
    const title = COPILOT_Q[k] || humanize(k)
    if (q.unlimited) {
      limits.push(limit(title, 0, undefined, 'Unlimited'))
      continue
    }
    if (q.percent_remaining == null) continue
    const counts = q.entitlement ? `${Math.round(q.remaining ?? q.quota_remaining ?? 0)} of ${q.entitlement} left` : undefined
    limits.push(limit(title, 100 - q.percent_remaining, resetsAt, counts))
  }
  const free = j?.access_type_sku && /free|edu/i.test(j.access_type_sku)
  const plan = planName(j?.copilot_plan)
  return { ok: true, plan: plan && free ? `${plan} (free)` : plan, limits }
}

// ---------- readers ----------
export async function claudeLimits(dir, fetchImpl = fetch) {
  let o = null
  try {
    o = JSON.parse(fs.readFileSync(path.join(dir, '.credentials.json'), 'utf8')).claudeAiOauth
  } catch {}
  if (!o || typeof o !== 'object') return { ok: false, reason: process.env.ANTHROPIC_API_KEY ? 'api-key' : 'signed-out', limits: [] }
  const plan = planName(o.subscriptionType)
  if (!o.accessToken) return { ok: false, reason: 'signed-out', plan, limits: [] }
  if (o.expiresAt && o.expiresAt < Date.now()) return { ok: false, reason: 'expired', plan, limits: [] }
  let r
  try {
    r = await fetchImpl('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: `Bearer ${o.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'Argon' },
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    return { ok: false, reason: 'offline', plan, limits: [] }
  }
  if (r.status === 401 || r.status === 403) return { ok: false, reason: 'expired', plan, limits: [] }
  if (!r.ok) return { ok: false, reason: 'http', detail: `error ${r.status}`, plan, limits: [] }
  try {
    return { ...normalizeClaude(await r.json(), o.subscriptionType), asOf: Date.now() }
  } catch {
    return { ok: false, reason: 'unreadable', plan, limits: [] }
  }
}

function jsonlFiles(dir, out = [], depth = 0) {
  if (depth > 6) return out
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) jsonlFiles(p, out, depth + 1)
    else if (e.name.endsWith('.jsonl')) out.push(p)
  }
  return out
}

// The rate limits Codex's last turn reported: the newest `rate_limits` line in its newest session logs.
export function codexLimits(dir) {
  const mt = (f) => {
    try {
      return fs.statSync(f).mtimeMs
    } catch {
      return 0
    }
  }
  const files = jsonlFiles(path.join(dir, 'sessions'))
  if (!files.length) return { ok: false, reason: 'no-sessions', limits: [] }
  files.sort((a, b) => mt(b) - mt(a))
  for (const f of files.slice(0, 8)) {
    let text
    try {
      const size = fs.statSync(f).size
      const len = Math.min(size, 2_000_000)
      const fd = fs.openSync(f, 'r')
      const buf = Buffer.alloc(len)
      fs.readSync(fd, buf, 0, len, size - len)
      fs.closeSync(fd)
      text = buf.toString('utf8')
    } catch {
      continue
    }
    const lines = text.split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"rate_limits"')) continue
      let j
      try {
        j = JSON.parse(lines[i])
      } catch {
        continue
      }
      const rl = j.payload?.rate_limits ?? j.payload?.info?.rate_limits
      if (rl && typeof rl === 'object') return normalizeCodex(rl, j.timestamp ?? mt(f))
    }
  }
  return { ok: false, reason: 'no-limits', limits: [] }
}

// Copilot: we ask gh; we never touch its token.
export function copilotLimits() {
  return new Promise((resolve) => {
    execFile('gh', ['api', 'copilot_internal/user'], { windowsHide: true, timeout: 20_000 }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') return resolve({ ok: false, reason: 'no-gh', limits: [] })
      if (err) {
        const detail = String(stderr || err.message || '').split('\n')[0].slice(0, 200)
        const low = detail.toLowerCase()
        const reason = err.killed ? 'gh-error' : /auth login|not logged/.test(low) ? 'gh-signed-out' : /404|not found/.test(low) ? 'no-copilot' : 'gh-error'
        return resolve({ ok: false, reason, detail: err.killed ? 'gh took too long to answer' : detail, limits: [] })
      }
      try {
        resolve({ ...normalizeCopilot(JSON.parse(stdout)), asOf: Date.now() })
      } catch {
        resolve({ ok: false, reason: 'unreadable', limits: [] })
      }
    })
  })
}

/** Where each agent keeps its sign-in: the profile's folder, or the CLI's own default. */
export function createLimits({ profilesDir, profileOk }) {
  const prof = (p) => (p && profileOk(p) ? path.join(profilesDir, p) : null)
  const claudeDir = (p) => prof(p) || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  const codexDir = (p) => prof(p) || process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
  const cache = new Map()
  const cached = (key, fresh, run) => {
    const hit = cache.get(key)
    if (hit && !fresh && Date.now() - hit.at < 60_000) return hit.p
    const p = Promise.resolve(run()).catch(() => ({ ok: false, reason: 'error', limits: [] }))
    cache.set(key, { at: Date.now(), p })
    return p
  }
  return {
    plan(agent, profile, fresh) {
      if (agent === 'claude') return cached(`claude:${profile || ''}`, fresh, () => claudeLimits(claudeDir(profile)))
      if (agent === 'codex') return cached(`codex:${profile || ''}`, fresh, () => codexLimits(codexDir(profile)))
      if (agent === 'copilot') return cached('copilot', fresh, copilotLimits)
      return Promise.resolve({ ok: false, reason: 'unsupported', limits: [] })
    },
  }
}
