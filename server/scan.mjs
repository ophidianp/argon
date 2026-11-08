// Repo scan: a throwaway, read-only CLI session in the repo folder proposes memory entries.
// Facts arrive one JSON object per line, so they land in the panel while the CLI writes them;
// nothing is saved until the user accepts them. One scan per repo; it outlives the panel.
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { commandFor, runCli } from './stream.mjs'

export const KINDS = ['Context', 'Architecture', 'Structure', 'Commands', 'Conventions', 'Gotchas']

export const PROMPT =
  'Describe this repository for a coding agent that is about to work in it: what the project is, how it is built, ' +
  'where things live, the commands, the conventions and the traps. Look at the file tree, the README and the docs first. ' +
  'Then write 8 to 14 facts, one per line, each line one JSON object ' +
  `{"kind": one of ${KINDS.map((k) => `"${k}"`).join(', ')}, "title": a few words, "text": 1-3 specific sentences}. ` +
  'Output only those lines: no prose, no numbering, no code fences.'

// The fact lines in `text`. Until the run ends the last line may be half written, so it waits.
export function parseFacts(text, final = false) {
  const lines = text.split('\n')
  if (!final) lines.pop()
  const facts = []
  for (const raw of lines) {
    const line = raw.trim().replace(/^[-*]\s+/, '').replace(/,$/, '')
    if (!line.startsWith('{')) continue // prose around the facts
    let f
    try {
      f = JSON.parse(line)
    } catch {
      continue // a line that only looks like JSON is not a fact either
    }
    if (typeof f?.title !== 'string' || typeof f?.text !== 'string' || !f.title.trim() || !f.text.trim()) continue
    facts.push({ kind: KINDS.includes(f.kind) ? f.kind : 'Context', title: f.title.trim().slice(0, 120), text: f.text.trim().slice(0, 1500) })
  }
  return facts
}

// Steps shown in the panel: 0 launch, 1 read the repo, 2 write facts, 3 wrap up.
// `command(agent, prompt)` is the CLI line; tests swap it for a fake.
export function createScans({ broadcast, launch, command = commandFor, timeoutMs = 5 * 60_000 }) {
  const jobs = new Map() // repo path -> job
  const view = (j) => ({ id: j.id, cwd: j.cwd, agent: j.agent, startedAt: j.startedAt, step: j.step, facts: j.facts, status: j.status, error: j.error })
  const list = () => [...jobs.values()].map(view)
  const emit = () => broadcast({ type: 'scans', scans: list() })

  function start(cwd, agent) {
    const line = command(agent, PROMPT)
    if (!line) throw new Error(`${agent} cannot scan a repo yet`)
    if (jobs.get(cwd)?.status === 'running') throw new Error('this repo is already being scanned')
    const job = { id: crypto.randomUUID(), cwd, agent, startedAt: Date.now(), step: 0, facts: [], status: 'running', error: null }
    jobs.set(cwd, job)
    const advance = (step) => step > job.step && ((job.step = step), true)
    const refresh = (text, isFinal = false) => {
      const facts = parseFacts(text, isFinal)
      const changed = facts.length !== job.facts.length
      if (changed) job.facts = facts
      return (facts.length > 0 && advance(2)) || changed
    }
    job.run = runCli({
      command: line,
      claude: agent === 'claude',
      cwd,
      launch,
      timeoutMs,
      onStep: (step) => step !== 2 && advance(step) && emit(),
      onText: (text) => refresh(text) && emit(),
      onEnd: ({ text, error, code, stopped }) => {
        delete job.run
        if (stopped) return
        refresh(text, true)
        job.step = 3
        job.status = job.facts.length ? 'done' : 'failed'
        if (!job.facts.length) job.error = error || `${agent} exited with ${code} and proposed nothing`
        emit()
      },
    })
    emit()
    return view(job)
  }

  // Cancel a running scan or drop its proposals once reviewed.
  function clear(cwd) {
    const job = jobs.get(cwd)
    if (!job) return
    job.run?.stop()
    jobs.delete(cwd)
    emit()
  }

  return { list, start, clear }
}

// `node server/scan.mjs`: checks the parser and a whole run against a fake Claude.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const assert = (await import('node:assert/strict')).default
  const fact = (title, kind = 'Commands') => JSON.stringify({ kind, title, text: `about ${title}` })
  assert.deepEqual(parseFacts(`Here you go\n${fact('a')}\n${fact('b', 'Weird')}\n{"kind":"Gotchas","ti`).map((f) => [f.kind, f.title]), [
    ['Commands', 'a'],
    ['Context', 'b'],
  ])
  assert.equal(parseFacts(`${fact('a')}\n${fact('c')}`, true).length, 2)

  const q = (v) => `'${v.replace(/'/g, `'\\''`)}'`
  const ev = (o) => JSON.stringify(o)
  const delta = (t) => ev({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } } })
  const stream = [
    'shell noise',
    ev({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] } }),
    ev({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text' } } }),
    delta(fact('one').slice(0, 10)),
    delta(fact('one').slice(10) + '\n' + fact('two')),
    ev({ type: 'result', is_error: false, result: `${fact('one')}\n${fact('two')}` }),
  ]
  const seen = []
  const scans = createScans({
    broadcast: (m) => seen.push(m.scans[0] && { ...m.scans[0] }),
    command: (agent) => ({ claude: `printf '%s\\n' ${stream.map(q).join(' ')}`, slow: 'sleep 30' })[agent],
    launch: (cmd, cwd) => spawn('/bin/sh', ['-c', cmd], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }),
  })
  scans.start(process.cwd(), 'claude')
  assert.throws(() => scans.start(process.cwd(), 'claude'), /already being scanned/)
  await new Promise((r) => setTimeout(r, 1500))
  const done = scans.list()[0]
  assert.equal(done.status, 'done')
  assert.deepEqual(done.facts.map((f) => f.title), ['one', 'two'])
  assert.equal(done.step, 3)
  assert.ok(seen.length >= 2) // started, then streamed or finished

  scans.start('/tmp', 'slow')
  scans.clear('/tmp')
  assert.equal(scans.list().length, 1)
  console.log('scan parsers ok')
}
