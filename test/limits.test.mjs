// Plan-limit normalisers, on samples shaped like the real answers from Anthropic, Codex's logs and gh.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { claudeLimits, codexLimits, normalizeClaude, normalizeCodex, normalizeCopilot } from '../server/limits.mjs'

test('claude: named windows, the limits list and extra usage', () => {
  const r = normalizeClaude(
    {
      five_hour: { utilization: 37, resets_at: '2026-11-09T18:00:00Z' },
      seven_day: { utilization: 24.5, resets_at: '2026-11-14T16:59:00Z' },
      seven_day_opus: null,
      limits: [
        { kind: 'seven_day_sonnet', percent: 12, resets_at: '2026-11-14T16:59:00Z', scope: null },
        { kind: 'weird_new_kind', percent: 140 },
        { kind: 'weekly_scoped', group: 'weekly', percent: 3, scope: { model: { id: null, display_name: 'Fable' }, surface: null } },
      ],
      extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 1250, utilization: null, currency: 'USD' },
    },
    'max',
  )
  assert.equal(r.ok, true)
  assert.equal(r.plan, 'Max')
  assert.deepEqual(
    r.limits.map((l) => [l.title, l.pct]),
    [
      ['Weekly · Sonnet', 12],
      ['Weird new kind', 100],
      ['Weekly · Fable', 3],
      ['5-hour limit', 37],
      ['Weekly · all models', 24.5],
      ['Extra usage · this month', 25],
    ],
  )
  assert.equal(r.limits[3].resetsAt, Date.parse('2026-11-09T18:00:00Z'))
  assert.equal(r.limits[5].sub, '$12.50 of $50.00')
})

test('claude: never returns the token, and reads an expired sign-in as expired', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argon-lim-'))
  const cred = (o) => fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: o }))
  cred({ accessToken: 'sk-secret', subscriptionType: 'pro', expiresAt: Date.now() + 3600_000 })
  let sent
  const fake = async (url, init) => {
    sent = init.headers
    return { ok: true, status: 200, json: async () => ({ five_hour: { utilization: 10, resets_at: null }, token_echo: 'sk-secret' }) }
  }
  const r = await claudeLimits(dir, fake)
  assert.equal(sent.Authorization, 'Bearer sk-secret')
  assert.equal(sent['anthropic-beta'], 'oauth-2025-04-20')
  assert.equal(JSON.stringify(r).includes('sk-secret'), false)
  assert.deepEqual(r.limits, [{ title: '5-hour limit', pct: 10 }])
  cred({ accessToken: 'sk-secret', expiresAt: Date.now() - 1 })
  assert.equal((await claudeLimits(dir, fake)).reason, 'expired')
  fs.rmSync(dir, { recursive: true, force: true })
  assert.equal((await claudeLimits(dir, fake)).ok, false)
})

test('codex: primary and secondary windows, reset from seconds or a timestamp', () => {
  const at = '2026-11-09T10:00:00Z'
  const r = normalizeCodex({ primary: { used_percent: 42, window_minutes: 300, resets_in_seconds: 600 }, secondary: { used_percent: 7, window_minutes: 10080, resets_at: 1763000000 }, plan_type: 'plus' }, at)
  assert.equal(r.plan, 'Plus')
  assert.deepEqual(r.limits[0], { title: '5-hour limit', pct: 42, resetsAt: Date.parse(at) + 600_000 })
  assert.deepEqual(r.limits[1], { title: 'Weekly limit', pct: 7, resetsAt: 1763000000_000 })
  assert.equal(r.asOf, Date.parse(at))
})

test('codex: newest rate_limits line from the session logs', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'argon-cx-'))
  assert.equal(codexLimits(home).reason, 'no-sessions')
  const day = path.join(home, 'sessions', '2026', '11', '09')
  fs.mkdirSync(day, { recursive: true })
  const ev = (pct) => JSON.stringify({ timestamp: '2026-11-09T10:00:00Z', type: 'event_msg', payload: { type: 'token_count', rate_limits: { primary: { used_percent: pct, window_minutes: 300 } } } })
  fs.writeFileSync(path.join(day, 'rollout.jsonl'), [ev(10), '{"type":"other"}', ev(55), ''].join('\n'))
  assert.equal(codexLimits(home).limits[0].pct, 55)
  fs.rmSync(home, { recursive: true, force: true })
})

test('copilot: quotas, unlimited ones and the free plan', () => {
  const r = normalizeCopilot({
    copilot_plan: 'individual',
    access_type_sku: 'free_limited_copilot',
    quota_reset_date: '2026-12-01',
    quota_snapshots: {
      chat: { unlimited: true },
      premium_interactions: { entitlement: 50, remaining: 20, percent_remaining: 40, unlimited: false },
      completions: { percent_remaining: null },
    },
  })
  assert.equal(r.plan, 'Individual (free)')
  assert.deepEqual(r.limits, [
    { title: 'Chat', pct: 0, sub: 'Unlimited' },
    { title: 'Premium requests', pct: 60, resetsAt: Date.parse('2026-12-01T00:00:00Z'), sub: '20 of 50 left' },
  ])
})
