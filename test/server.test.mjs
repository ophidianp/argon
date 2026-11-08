// End-to-end check of the local server: run with `npm test`.
// Starts its own server on another port with a throwaway HOME, so real state is never touched.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { readConversation, readTranscript } from '../server/transcript.mjs'
import { parseAsk } from '../shared/prompts.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PORT = 4399
const BASE = `http://127.0.0.1:${PORT}`
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'vibeboard-test-'))
let server

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const api = (method, url, body, headers = {}) =>
  fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body) })
const sessions = async () => (await api('GET', '/api/sessions')).json()
const plain = (text) => text.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')
const until = async (fn, ms = 8000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await fn()) return true
    await sleep(150)
  }
  return false
}
const openShell = (id, cwd = HOME) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/pty?id=${id}&agent=shell&cwd=${encodeURIComponent(cwd)}&cols=80&rows=24`, { origin: 'http://localhost:5173' })
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
const tail = async (id) => (await (await api('POST', `/api/pty/${id}/tail`, { chars: 4000 })).json()).text

before(async () => {
  // Pretend the server was launched from inside a Claude Code session. Consoles run zsh, the Mac's own
  // shell, whatever shell the tests run from: bash 3.2 (CI) cannot take a pasted multi-line brief.
  const SHELL = fs.existsSync('/bin/zsh') ? '/bin/zsh' : process.env.SHELL
  const env = { ...process.env, SHELL, PORT: String(PORT), HOME, CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1', VIBEBOARD_NO_LLM: '1' }
  server = spawn(process.execPath, [path.join(ROOT, 'server/index.mjs')], { env, stdio: 'ignore' })
  assert.ok(await until(async () => (await fetch(BASE + '/api/sessions').catch(() => null))?.ok), 'server did not start')
})

after(async () => {
  // The server and its shells write to HOME until they are gone: removing it earlier races them.
  const gone = new Promise((r) => server.once('exit', r))
  server.kill('SIGTERM')
  await gone
  fs.rmSync(HOME, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

// A raw request: fetch() would not let a test set Sec-Fetch-Site, as no page can.
const status = (method, url, headers) =>
  new Promise((resolve, reject) => http.request(BASE + url, { method, headers }, (res) => (res.resume(), resolve(res.statusCode))).on('error', reject).end())

test('rejects foreign origins and hosts', async () => {
  assert.equal((await api('GET', '/api/sessions', undefined, { origin: 'https://evil.example' })).status, 403)
  // An <img> on another site: no Origin, only Sec-Fetch-Site.
  assert.equal(await status('GET', '/api/page-title?url=http://10.0.0.1/', { 'sec-fetch-site': 'cross-site' }), 403)
  assert.equal(await status('GET', '/api/ports', { 'sec-fetch-site': 'same-site' }), 403)
  assert.equal(await status('GET', '/api/sessions', { 'sec-fetch-site': 'same-origin' }), 200)
  assert.equal(await status('GET', '/api/sessions', {}), 200) // the hooks' curl sends neither
  assert.equal(await status('GET', '/', { 'sec-fetch-site': 'cross-site' }) === 403, false) // the page itself may be linked to
  assert.equal(await status('GET', '/api/pty/nope/stop', {}), 404)
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/pty?id=x&agent=shell`, { origin: 'https://evil.example' })
  const err = await new Promise((r) => ws.on('error', r))
  assert.ok(err)
})

test('malformed URLs and hostile WebSocket messages do not take the server down', async () => {
  const get = (p) => new Promise((resolve) => http.get({ host: '127.0.0.1', port: PORT, path: p }, (res) => resolve(res.statusCode)).on('error', () => resolve(0)))
  assert.equal(await get('/%'), 400)
  assert.ok((await get('//')) >= 400)
  const ws = await openShell('t-hostile')
  await sleep(500)
  ws.send('null')
  ws.send('[1]')
  ws.send(JSON.stringify({ t: 'r', cols: -5, rows: 'x' }))
  // Re-attach to the live session with nonsense dimensions.
  const again = new WebSocket(`ws://127.0.0.1:${PORT}/ws/pty?id=t-hostile&agent=shell&cols=-5&rows=0`, { origin: 'http://localhost:5173' })
  await new Promise((r) => again.on('open', r))
  await sleep(300)
  assert.ok((await sessions()).some((s) => s.id === 't-hostile'), 'server died or lost the console')
  await api('DELETE', '/api/pty/t-hostile')
  ws.close()
  again.close()
})

test('a console for a folder that is gone is refused, not opened in $HOME', { timeout: 5000 }, async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/pty?id=t-gone&agent=shell&cwd=${encodeURIComponent(path.join(HOME, 'no-such-dir'))}`, { origin: 'http://localhost:5173' })
  let text = ''
  ws.on('message', (d) => (text += d))
  await new Promise((r) => ws.on('close', r))
  assert.match(text, /folder not found/)
  assert.ok(!(await sessions()).some((s) => s.id === 't-gone'))
})

test('an account profile name cannot point outside the profiles folder', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/pty?id=t-prof&agent=shell&cwd=${encodeURIComponent(HOME)}&profile=..%2F..%2Fetc`, { origin: 'http://localhost:5173' })
  let said = ''
  ws.on('message', (m) => (said += m))
  await new Promise((r) => ws.on('close', r))
  assert.match(said, /bad profile name/)
  assert.ok(!(await sessions()).some((s) => s.id === 't-prof'))
})

test('prompts sent back to back reach the console as separate prompts', async () => {
  const ws = await openShell('t-queue')
  await sleep(800)
  await Promise.all([api('POST', '/api/pty/t-queue/input', { prompt: 'echo QA_$((1+1))' }), api('POST', '/api/pty/t-queue/input', { prompt: 'echo QB_$((2+2))' })])
  assert.ok(await until(async () => /QA_2\s[\s\S]*QB_4/.test(await tail('t-queue'))), 'both prompts should run')
  assert.ok(!(await tail('t-queue')).includes('QA_2echo'), 'prompts fused into one line')
  assert.equal(await status('GET', '/api/pty/t-queue/input', {}), 405, 'a GET never types into a console')
  assert.equal(await status('GET', '/api/pty/t-queue/stop', {}), 405)
  await api('DELETE', '/api/pty/t-queue')
  ws.close()
})

test('loop input is validated', async () => {
  const bad = [
    { instruction: 'x', trigger: { type: 'idle' }, target: { ids: [] } }, // empty pick must not mean "everyone"
    { instruction: 'x', trigger: { type: 'schedule', everyMs: null } },
    { instruction: 'x', trigger: { type: 'output', pattern: '(' } },
    { instruction: 'fix the failed tests', trigger: { type: 'output', pattern: 'failed' } }, // would re-fire on its own echo
  ]
  for (const loop of bad) assert.equal((await api('POST', '/api/loops', loop)).status, 400, JSON.stringify(loop))
})

test('serves the built app and refuses path traversal', { skip: !fs.existsSync(path.join(ROOT, 'dist/index.html')) && 'run npm run build first' }, async () => {
  assert.match(await (await fetch(BASE + '/')).text(), /<div id="root">/)
  assert.match(await (await fetch(BASE + '/some/client/route')).text(), /<div id="root">/, 'SPA fallback')
  // A plain ".." is normalised by the URL parser; "..%2f" survives it and only becomes "../" once decoded.
  const status = await new Promise((resolve) =>
    http.get({ host: '127.0.0.1', port: PORT, path: '/..%2fdist-evil/x' }, (res) => resolve(res.statusCode)),
  )
  assert.equal(status, 403)
})

test('state round-trips and garbage is refused', async () => {
  assert.equal((await api('PUT', '/api/state', { projects: [], active: null })).status, 200)
  assert.deepEqual(await (await api('GET', '/api/state')).json(), { projects: [], active: null })
  const bad = await fetch(BASE + '/api/state', { method: 'PUT', body: '{not json' })
  assert.equal(bad.status, 500)
  assert.deepEqual(await (await api('GET', '/api/state')).json(), { projects: [], active: null })
})

test('shell console runs commands and hooks drive status', async () => {
  const ws = await openShell('t-shell')
  await sleep(800)
  ws.send(JSON.stringify({ t: 'i', d: 'echo VB_$((40+2))_[$CLAUDECODE$CLAUDE_CODE_CHILD_SESSION]\r' }))
  assert.ok(await until(async () => (await tail('t-shell')).includes('VB_42_[]')), 'echo output missing or Claude session env leaked into the console')

  const status = async () => (await sessions()).find((s) => s.id === 't-shell')?.status
  await sleep(2700) // let the shell's own output-activity timer settle first
  await api('POST', '/api/hook/t-shell/UserPromptSubmit', {})
  await api('POST', '/api/hook/t-shell/SessionStart', { source: 'compact' })
  assert.equal(await status(), 'working', 'auto-compact happens mid-turn: still working')
  await api('POST', '/api/hook/t-shell/Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' })
  assert.equal(await status(), 'idle', 'the idle notice unsticks a working console after an Esc interrupt')
  // Shell has no hooks of its own; activity may flip it, so only check the hook-driven transitions.
  await api('POST', '/api/hook/t-shell/Notification', { notification_type: 'permission_prompt', message: 'needs permission' })
  assert.equal(await status(), 'needs')
  await api('POST', '/api/hook/t-shell/Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' })
  assert.equal(await status(), 'needs', 'idle_prompt must not change status')
  await api('POST', '/api/hook/t-shell/Stop', {})
  assert.equal(await status(), 'done')
  ws.close()
})

test("Claude's sub-agents show on their console while they run", async () => {
  const ws = await openShell('t-subs')
  await sleep(300)
  const subs = async () => (await sessions()).find((s) => s.id === 't-subs')?.subagents ?? []
  const task = { tool_name: 'Agent', tool_use_id: 'toolu_1', tool_input: { description: 'Find the auth code', subagent_type: 'Explore', prompt: '...' } }
  await api('POST', '/api/hook/t-subs/PreToolUse', task)
  await api('POST', '/api/hook/t-subs/PreToolUse', { ...task, tool_use_id: 'toolu_2', tool_input: { description: 'Write tests' } })
  await api('POST', '/api/hook/t-subs/PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_3', tool_input: { command: 'ls' } })
  assert.deepEqual((await subs()).map((a) => [a.type, a.task, a.status]), [
    ['Explore', 'Find the auth code', 'running'],
    ['general-purpose', 'Write tests', 'running'],
  ])
  await api('POST', '/api/hook/t-subs/PostToolUse', task)
  assert.deepEqual((await subs()).map((a) => a.status), ['done', 'running'])
  await api('POST', '/api/hook/t-subs/Stop', {}) // the turn is over: nothing is left running
  assert.ok((await subs()).every((a) => a.status === 'done'))
  await api('DELETE', '/api/pty/t-subs')
  ws.close()
})

test('a hand-off carries one console\'s work to another as a prompt', async () => {
  const a = await openShell('t-from')
  const b = await openShell('t-to')
  await sleep(800)
  a.send(JSON.stringify({ t: 'i', d: 'echo WORK_$((20+3))_DONE\r' }))
  assert.ok(await until(async () => (await tail('t-from')).includes('WORK_23_DONE')))
  const handoff = (body) => api('POST', '/api/handoff', { from: 't-from', to: 't-to', fromName: 'Maya', toName: 'Otto', ...body })
  assert.equal((await handoff({})).status, 200)
  // The brief arrives as one bracketed paste; the shell echoes it back.
  // Read as text: a zsh that highlights pasted text puts a colour code between every letter.
  const arrived = await until(async () => /Hand-off from Maya[\s\S]*WORK_23_DONE/.test(plain(await tail('t-to'))))
  assert.ok(arrived, `brief never reached the next console. It shows: ${JSON.stringify(plain(await tail('t-to')).slice(-500))}`)
  assert.equal((await (await handoff({})).json()).duplicate, true, 'a second tab firing the same hand-off is ignored')
  assert.equal((await handoff({ to: 'nope', toName: 'Ghost' })).status, 409)
  // Other kinds of wire: a condition that does not match sends nothing, one that matches does;
  // forwarding sends what A said word for word; a reviewer that approved sends no feedback back.
  assert.equal((await (await handoff({ mode: 'reply', pattern: 'NOT_THERE' })).json()).sent, false)
  assert.equal((await (await handoff({ mode: 'reply', pattern: 'work_23' })).json()).sent, true)
  assert.ok(await until(async () => /Maya just replied:[\s\S]*WORK_23_DONE/.test(plain(await tail('t-to')))), 'forwarded reply never arrived')
  a.send(JSON.stringify({ t: 'i', d: 'echo APPROVED\r' }))
  assert.ok(await until(async () => /\nAPPROVED/.test(await tail('t-from'))))
  assert.equal((await (await handoff({ mode: 'feedback' })).json()).approved, true)
  await api('DELETE', '/api/pty/t-from')
  await api('DELETE', '/api/pty/t-to')
  a.close()
  b.close()
})

test('a lead creates a helper on the board, gives it work and gets its answer back', { timeout: 30000 }, async () => {
  const lead = await openShell('t-lead')
  const rpc = (body) => api('POST', '/mcp/t-lead', { jsonrpc: '2.0', ...body })
  const mcp = async (method, params) => (await (await rpc({ id: 1, method, params })).json()).result
  const call = (name, args) => mcp('tools/call', { name, arguments: args })
  assert.equal((await mcp('initialize', { protocolVersion: '2025-06-18' })).serverInfo.name, 'vibeboard')
  assert.equal((await rpc({ method: 'notifications/initialized' })).status, 202)
  assert.ok((await mcp('tools/list')).tools.some((t) => t.name === 'create_helper'))

  const unseen = await call('create_helper', { name: 'Echo', task: 'x', agent: 'shell' })
  assert.ok(unseen.isError && /window is closed/.test(unseen.content[0].text), 'with no window open nobody would see the helper')

  const events = new WebSocket(`ws://127.0.0.1:${PORT}/ws/events`, { origin: 'http://localhost:5173' })
  const seen = []
  events.on('message', (m) => seen.push(JSON.parse(String(m))))
  await new Promise((r) => events.on('open', r))
  const made = await call('create_helper', { name: 'Echo', task: 'echo HELPER_$((40+2))', agent: 'shell' })
  assert.ok(!made.isError, made.content[0].text)
  const helper = seen.find((e) => e.type === 'helper')
  assert.deepEqual([helper?.parent, helper?.name], ['t-lead', 'Echo'], 'the board is told where to draw it')
  const answer = await call('wait_for_helpers', { timeout_seconds: 15 })
  assert.match(answer.content[0].text, /^Echo: idle[\s\S]*HELPER_42/)
  assert.ok((await call('message_helper', { name: 'Nobody', text: 'hi' })).isError)
  await api('DELETE', `/api/pty/${helper.id}`)
  await api('DELETE', '/api/pty/t-lead')
  events.close()
  lead.close()
})

test("a hand-off quotes the agent's final reply, not just a summary of it", () => {
  const jsonl = [
    { type: 'user', message: { content: 'Write a 3-line plan' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Let me look first.' }, { type: 'tool_use', name: 'Read', input: { file: 'a.js' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: '1. add.js\n2. export add\n3. test it' }] } },
    'not json',
  ]
    .map((e) => (typeof e === 'string' ? e : JSON.stringify(e)))
    .join('\n')
  const { lines, lastReply } = readTranscript(jsonl)
  assert.equal(lastReply, '1. add.js\n2. export add\n3. test it')
  assert.equal(lines.length, 4)
  assert.equal(readTranscript(jsonl + '\n' + JSON.stringify({ type: 'user', message: { content: 'next' } })).lastReply, '', 'a newer prompt has no reply yet')
})

test('the git panel saves a snapshot, publishes the branch and pulls', async () => {
  const sh = (cwd, ...args) => new Promise((r) => spawn('git', args, { cwd, stdio: 'ignore' }).on('exit', r))
  const remote = path.join(HOME, 'remote.git')
  const repo = path.join(HOME, 'repo')
  const other = path.join(HOME, 'other')
  await sh(HOME, 'init', '-q', '--bare', remote)
  await sh(HOME, 'clone', '-q', remote, repo)
  await sh(repo, 'config', 'user.email', 't@t')
  await sh(repo, 'config', 'user.name', 't')
  const git = (action, message, files) => api('POST', `/api/git/${action}`, { cwd: repo, message, files })
  const info = async () => (await api('GET', `/api/git?cwd=${encodeURIComponent(repo)}`)).json()
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one')
  assert.deepEqual((await info()).files, [{ code: '??', path: 'a.txt', add: 1, del: 0 }])
  assert.equal((await git('commit', '  ')).status, 400, 'a snapshot needs a note')
  assert.equal((await git('commit', 'add a')).status, 200)
  // Only the ticked files go into the commit; a path git does not report is refused.
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n')
  fs.writeFileSync(path.join(repo, 'c d.txt'), 'x\n')
  assert.equal((await git('commit', 'sneaky', ['../outside'])).status, 400)
  assert.equal((await git('commit', 'add c', ['c d.txt'])).status, 200)
  assert.deepEqual((await info()).files, [{ code: 'M', path: 'a.txt', add: 2, del: 1 }])
  assert.equal((await git('commit', 'grow a')).status, 200)
  assert.equal((await info()).upstream, false)
  assert.equal((await git('push')).status, 200, 'first push publishes the branch')
  assert.deepEqual([(await info()).upstream, (await info()).ahead], [true, 0])
  // Someone else pushes; pull brings it in.
  await sh(HOME, 'clone', '-q', remote, other)
  await sh(other, 'config', 'user.email', 'o@o')
  await sh(other, 'config', 'user.name', 'o')
  fs.writeFileSync(path.join(other, 'b.txt'), 'two')
  await sh(other, 'add', '-A')
  await sh(other, 'commit', '-qm', 'add b')
  await sh(other, 'push', '-q')
  assert.equal((await git('pull')).status, 200)
  assert.ok(fs.existsSync(path.join(repo, 'b.txt')))
  assert.equal((await git('rebase')).status, 400, 'only the panel actions exist')

  // Seeing the changes: one file's diff, a brand new file, a commit; then branches and discard.
  const view = async (what, q) => (await api('GET', `/api/git/${what}?cwd=${encodeURIComponent(repo)}&${q}`)).json()
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\nTWO\n')
  fs.writeFileSync(path.join(repo, 'new.txt'), 'fresh\n')
  assert.match((await view('diff', 'path=a.txt')).text, /-two\n\+TWO/)
  assert.equal((await view('diff', 'path=new.txt')).text, '@@ -0,0 +1,1 @@\n+fresh')
  assert.ok((await view('diff', 'path=nothere.txt')).error, 'only changed files have a diff')
  const head = (await info()).commits[0]
  const shown = await view('show', `hash=${head.hash}`)
  assert.equal(shown.subject, head.subject)
  assert.match(shown.text, /diff --git/)
  assert.ok((await view('show', 'hash=;rm')).error, 'a commit is a hash, nothing else')
  assert.equal((await git('discard', undefined, ['a.txt', 'new.txt'])).status, 200)
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'one\ntwo\n')
  assert.ok(!fs.existsSync(path.join(repo, 'new.txt')))
  const branch = (b) => api('POST', '/api/git/branch', { cwd: repo, branch: b })
  assert.equal((await branch({ name: 'feat/try it' })).status, 400, 'git rules for branch names hold')
  assert.equal((await branch({ name: 'feat/try', create: true })).status, 200)
  assert.equal((await info()).branch, 'feat/try')
  assert.ok((await view('branches', '')).branches.includes('feat/try'))
  // A folder that is not a repository yet can become one.
  const plain = fs.mkdtempSync(path.join(HOME, 'plain-'))
  assert.equal(await (await api('GET', `/api/git?cwd=${encodeURIComponent(plain)}`)).json(), null)
  assert.equal((await api('POST', '/api/git/init', { cwd: plain })).status, 200)
  assert.equal((await api('POST', '/api/git/init', { cwd: plain })).status, 400, 'already a repository')
})

test('kill escalates past processes that ignore SIGHUP', async () => {
  const ws = await openShell('t-stubborn')
  await sleep(800)
  // exec: the PTY's own process becomes one that ignores SIGHUP and SIGTERM, exactly like Claude Code.
  ws.send(JSON.stringify({ t: 'i', d: `exec node -e "process.on('SIGHUP',()=>{});process.on('SIGTERM',()=>{});setInterval(()=>{},1e3)"\r` }))
  await sleep(1200)
  await api('DELETE', '/api/pty/t-stubborn')
  assert.ok(await until(async () => !(await sessions()).some((s) => s.id === 't-stubborn'), 9000), 'console survived kill')
  ws.close()
})

test('idle loop fires once and retires at its run limit', async () => {
  const ws = await openShell('t-loop')
  await sleep(3500) // let the shell settle to idle
  const loop = await (await api('POST', '/api/loops', { instruction: 'echo LOOP_FIRED', trigger: { type: 'idle' }, target: { ids: ['t-loop'] }, stop: { runs: 1 } })).json()
  ws.send(JSON.stringify({ t: 'i', d: 'echo poke\r' })) // activity -> working -> idle triggers the loop
  assert.ok(await until(async () => (await tail('t-loop')).includes('LOOP_FIRED'), 10000), 'loop never fired')
  const loops = await (await api('GET', '/api/loops')).json()
  const l = loops.find((x) => x.id === loop.id)
  assert.equal(l.active, false)
  assert.equal(l.finishedReason, 'run limit')
  // An in-flight flag on disk would freeze the loop forever after a restart.
  assert.ok(!fs.readFileSync(path.join(HOME, '.vibeboard', 'loops.json'), 'utf8').includes('"firing"'), 'runtime state persisted')
  await api('DELETE', `/api/loops/${loop.id}`)
  await api('DELETE', '/api/pty/t-loop')
  ws.close()
})

test('a loop that stays with its tab waits out of view, catches up, runs now and switches off', async () => {
  const ws = await openShell('t-view')
  await sleep(3500)
  await api('POST', '/api/visible', { ids: [] })
  const loop = await (await api('POST', '/api/loops', { instruction: 'echo VIEW_FIRE', trigger: { type: 'idle' }, target: { ids: ['t-view'] }, stop: {}, background: false })).json()
  assert.equal(loop.name, 'echo VIEW_FIRE', 'a loop without a name is named from its instruction')
  assert.equal((await api('POST', `/api/loops/${loop.id}/run`, {})).status, 400, 'nothing in view to run into')
  ws.send(JSON.stringify({ t: 'i', d: 'echo poke\r' })) // goes idle out of view: the round is owed
  await sleep(4000)
  assert.ok(!(await tail('t-view')).includes('VIEW_FIRE'), 'fired into a tab nobody is looking at')
  await api('POST', '/api/visible', { ids: ['t-view'] })
  assert.ok(await until(async () => (await tail('t-view')).includes('VIEW_FIRE'), 8000), 'owed round never caught up')
  await api('POST', `/api/loops/${loop.id}/active`, { on: false })
  assert.equal((await api('POST', `/api/loops/${loop.id}/run`, {})).status, 400, 'a loop switched off does not run')
  const back = await (await api('POST', `/api/loops/${loop.id}/active`, { on: true })).json()
  assert.equal(back.active, true)
  assert.equal((await api('POST', `/api/loops/${loop.id}/run`, {})).status, 200)
  await api('DELETE', `/api/loops/${loop.id}`)
  await api('DELETE', '/api/pty/t-view')
  ws.close()
})

test('an "all consoles" loop stays inside its own project', async () => {
  const other = fs.mkdtempSync(path.join(HOME, 'other-'))
  const mine = await openShell('t-mine')
  const theirs = await openShell('t-theirs', other)
  await sleep(3500)
  const loop = await (await api('POST', '/api/loops', { instruction: 'echo SCOPED_FIRE', trigger: { type: 'idle' }, target: {}, scope: HOME, stop: { runs: 2 } })).json()
  mine.send(JSON.stringify({ t: 'i', d: 'echo poke\r' }))
  theirs.send(JSON.stringify({ t: 'i', d: 'echo poke\r' }))
  assert.ok(await until(async () => (await tail('t-mine')).includes('SCOPED_FIRE'), 10000), 'loop never reached its own project')
  // The console goes idle again inside the 10s cooldown: that trigger must be deferred, not dropped.
  const finished = async () => (await (await api('GET', '/api/loops')).json()).find((x) => x.id === loop.id)?.finishedReason === 'run limit'
  assert.ok(await until(finished, 16000), 'second run never came: trigger inside the cooldown was dropped')
  assert.ok(!(await tail('t-theirs')).includes('SCOPED_FIRE'), 'loop leaked into another project')
  await api('DELETE', `/api/loops/${loop.id}`)
  await api('DELETE', '/api/pty/t-mine')
  await api('DELETE', '/api/pty/t-theirs')
  mine.close()
  theirs.close()
})

test('web tiles: dev ports that are listening and a page title', async () => {
  const page = http.createServer((_, res) => res.end('<html><head><title>Hello &amp; tile</title></head><body>hi</body></html>'))
  await new Promise((r) => page.listen(0, '127.0.0.1', r))
  const port = page.address().port
  const probed = await (await api('GET', `/api/ports?ports=${port},1`)).json()
  assert.deepEqual(probed, [
    { port, live: true },
    { port: 1, live: false },
  ])
  const { title } = await (await api('GET', `/api/page-title?url=${encodeURIComponent(`http://127.0.0.1:${port}/`)}`)).json()
  assert.equal(title, 'Hello & tile')
  assert.equal((await api('GET', `/api/page-title?url=${encodeURIComponent('file:///etc/passwd')}`)).status, 400, 'only web pages')
  page.close()
})

test('studios read and write files only inside the project', async () => {
  const root = fs.mkdtempSync(path.join(HOME, 'proj-'))
  fs.mkdirSync(path.join(root, 'src'))
  fs.mkdirSync(path.join(root, 'node_modules'))
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a = 1\n')
  fs.writeFileSync(path.join(root, 'README.md'), '# hi\n')
  fs.writeFileSync(path.join(HOME, 'secret.txt'), 'nope')
  fs.symlinkSync(HOME, path.join(root, 'escape'))
  const q = (what, p = '') => api('GET', `/api/files/${what}?root=${encodeURIComponent(root)}&path=${encodeURIComponent(p)}`)
  const write = (body) => api('POST', '/api/files/write', { root, ...body })
  const tree = await (await q('tree')).json()
  assert.deepEqual(tree.entries.map((e) => e.name).sort(), ['README.md', 'src'], 'node_modules and links are left out')
  assert.equal((await (await q('read', 'src/a.ts')).json()).text, 'export const a = 1\n')
  for (const bad of ['../secret.txt', path.join(HOME, 'secret.txt'), 'escape/secret.txt']) assert.equal((await q('read', bad)).status, 400, bad)
  assert.equal((await write({ path: 'escape/new.txt', text: 'x', create: true })).status, 400, 'no writing through a link')
  assert.equal((await write({ path: 'src/b.ts', text: 'b', create: true })).status, 200)
  assert.equal((await write({ path: 'src/b.ts', text: 'again', create: true })).status, 400, 'create never overwrites')
  assert.equal((await write({ path: 'src/b.ts', text: 'saved' })).status, 200)
  assert.equal(fs.readFileSync(path.join(root, 'src', 'b.ts'), 'utf8'), 'saved')
  const md = await (await api('GET', `/api/files/tree?root=${encodeURIComponent(root)}&only=md`)).json()
  assert.deepEqual(md.entries.map((e) => e.name), ['README.md'])
})

test('a question is only answered while it is still the one on screen', async () => {
  const ws = await openShell('choose-1')
  const answer = (askId, index) => api('POST', '/api/pty/choose-1/choose', { askId, index })
  assert.equal((await answer('nothing-asked', 0)).status, 409) // no menu on screen

  const menu = 'Do you want to proceed?\\n❯ 1. Yes\\n  2. No\\n'
  ws.send(JSON.stringify({ t: 'i', d: `clear; printf '${menu}'; cat >/dev/null\r` }))
  const ask = parseAsk('Do you want to proceed?\n❯ 1. Yes\n  2. No\n')
  assert.ok(await until(async () => (await tail('choose-1')).includes('2. No'))) // printed, before going further
  await sleep(300)

  assert.equal((await answer('another-question', 0)).status, 409)
  assert.equal((await answer(ask.id, 9)).status, 400)
  // A printed menu does not move with the arrows: the option cannot be confirmed, so no Enter is sent.
  assert.equal((await answer(ask.id, 1)).status, 409)
  assert.doesNotMatch(await tail('choose-1'), /\^\[\[B\r?\n/)
  assert.equal((await answer(ask.id, 0)).status, 200) // the highlighted one needs no move
  ws.close()
  await api('DELETE', '/api/pty/choose-1')
})

test('a damaged board file is set aside and the backup takes over', async () => {
  const dir = path.join(HOME, '.vibeboard')
  const good = { projects: [], settings: { fontSize: 13 }, marker: 'good' }
  const put = (body) => api('PUT', '/api/state', body)
  assert.equal((await put(good)).status, 200)
  // The first save of a run has no earlier file to copy; backups happen on later saves of a good file.
  fs.copyFileSync(path.join(dir, 'state.json'), path.join(dir, 'state.json.bak'))
  fs.writeFileSync(path.join(dir, 'state.json'), '{"projects": [broken')
  const restored = await (await api('GET', '/api/state')).json()
  assert.equal(restored.marker, 'good')
  assert.equal(restored.recovered, 'backup')
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('state.json.damaged-')))
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).marker, 'good')

  fs.writeFileSync(path.join(dir, 'state.json'), 'nonsense')
  fs.rmSync(path.join(dir, 'state.json.bak'))
  assert.equal((await (await api('GET', '/api/state')).json()).recovered, 'empty')
})

test('a flooding console is paused until the page catches up, and never for ever', async () => {
  const ws = await openShell('flood-1')
  let got = 0
  let ack = false
  ws.on('message', (m) => {
    got += m.length
    if (ack) ws.send(JSON.stringify({ t: 'a', n: m.length }))
  })
  await sleep(300)
  ws.send(JSON.stringify({ t: 'i', d: 'yes xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\r' }))
  // No acknowledgement: output stops near the high mark instead of growing without limit.
  await sleep(1500)
  const held = got
  assert.ok(held > 100_000, `it should have started (${held})`)
  assert.ok(held < 3_000_000, `it should be paused (${held})`)
  await sleep(600)
  assert.ok(got - held < 400_000, `still flowing while unacknowledged (${got - held})`)
  // The page stays silent past the stall limit: the agent is let go.
  await sleep(6500)
  assert.ok(got > held + 300_000, 'a silent page must not freeze the process')
  ack = true
  ws.send(JSON.stringify({ t: 'i', d: '\x03' }))
  await sleep(300)
  ws.close()
  await api('DELETE', '/api/pty/flood-1')
})

test('a transcript reads as a conversation, without the bookkeeping', () => {
  const line = (o) => JSON.stringify(o)
  const jsonl = [
    line({ type: 'user', message: { content: 'fix the test' } }),
    line({ type: 'user', isMeta: true, message: { content: 'hidden meta' } }),
    line({ type: 'user', message: { content: '<command-name>/clear</command-name>' } }),
    line({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'a helper talking' }] } }),
    line({ type: 'assistant', message: { content: [{ type: 'text', text: 'On it.' }, { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/a/auth.ts' } }] } }),
    line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }),
    line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'rm x' } }, { type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'npm test' } }] } }),
    line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: "The user doesn't want to proceed" }, { type: 'tool_result', tool_use_id: 't3', is_error: true, content: 'exit code 1' }] } }),
    line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't4', name: 'Read', input: { file_path: '/a/b.ts' } }] } }),
    line({ type: 'user', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } }),
    'not json',
    line({ type: 'summary', summary: 'x' }),
  ].join('\n')
  assert.deepEqual(readConversation(jsonl), [
    { kind: 'user', text: 'fix the test' },
    { kind: 'agent', text: 'On it.' },
    { kind: 'step', text: 'Edited auth.ts' },
    { kind: 'step', text: 'You said no: running rm x', failed: true },
    { kind: 'step', text: 'Failed: running npm test', failed: true },
    { kind: 'step', text: 'Reading b.ts', pending: true },
    { kind: 'note', text: 'Stopped here' },
  ])
  assert.equal(readConversation(Array(5).fill(line({ type: 'user', message: { content: 'x' } })).join('\n'), 3).length, 3)
})
