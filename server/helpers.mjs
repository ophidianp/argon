// A lead console's own team. A Claude console started as a lead gets these tools over MCP
// (JSON-RPC at /mcp/<lead id>): it creates helper consoles that appear on the user's board next
// to it, gives them work and collects their answers. Helpers get no tools of their own, so a team
// never multiplies by itself.
import { randomUUID } from 'node:crypto'

const MAX_HELPERS = 6
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function until(done, ms) {
  const t0 = Date.now()
  while (!done()) {
    if (Date.now() - t0 >= ms) return false
    await sleep(250)
  }
  return true
}

const INSTRUCTIONS = [
  'You lead a small team on the user\'s vibeboard board. When a job splits into parts that can run side by side',
  '(build and test, front end and back end, several files to review), create a helper for each part with create_helper:',
  'each one is a real coding agent the user watches on the board. Helpers do not see your conversation, so give each',
  'a complete, self-contained task, and separate files so they do not edit the same ones. Then call wait_for_helpers,',
  'check what they did and combine it. Keep the team small (2-4). Small jobs you can do yourself.',
].join(' ')

const STATUS = {
  done: 'finished',
  idle: 'idle, waiting for a task',
  needs: 'waiting for the user (a permission or a question): tell the user to look at it on the board',
  working: 'still working',
}

export function createHelpers({ sessions, spawn, sendPrompt, setStatus, broadcast, lastWords, hasWindow, agentIds }) {
  const teams = new Map() // lead id -> Map(helper name -> console id)
  const teamOf = (lead) => teams.get(lead.id) || teams.set(lead.id, new Map()).get(lead.id)

  const TOOLS = [
    {
      name: 'create_helper',
      description:
        "Create a helper: a new coding agent console that appears on the user's board next to you and starts on the task " +
        'right away. It does not see your conversation, so the task must say everything it needs. Returns at once; ' +
        'call wait_for_helpers for its answer.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short name shown on the board, e.g. "Tester"' },
          task: { type: 'string', description: 'The complete, self-contained task' },
          role: { type: 'string', description: 'Optional: what this helper is for, in one line' },
          agent: { type: 'string', enum: agentIds, description: 'Which CLI runs it (default claude)' },
        },
        required: ['name', 'task'],
      },
    },
    {
      name: 'message_helper',
      description: 'Send one of your helpers a follow-up message (more work, a correction, an answer to its question).',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' }, text: { type: 'string' } },
        required: ['name', 'text'],
      },
    },
    {
      name: 'wait_for_helpers',
      description:
        'Wait until the named helpers (default: all of yours) stop working, then return what each one said last. ' +
        'Returns early when one needs the user. timeout_seconds 0 checks without waiting.',
      inputSchema: {
        type: 'object',
        properties: {
          names: { type: 'array', items: { type: 'string' } },
          timeout_seconds: { type: 'number', description: 'Default 300, at most 900' },
        },
      },
    },
    {
      name: 'list_helpers',
      description: 'List your helpers and what each one is doing.',
      inputSchema: { type: 'object', properties: {} },
    },
  ]

  const helperId = (lead, name) => {
    const id = teamOf(lead).get(String(name))
    if (!id) throw new Error(`You have no helper called ${name}. Your helpers: ${[...teamOf(lead).keys()].join(', ') || 'none yet'}.`)
    return id
  }

  const report = (name, id) => {
    const h = sessions.get(id)
    if (!h) return `${name}: has exited.`
    const words = lastWords(h)
    return `${name}: ${STATUS[h.status] || h.status}.${words ? `\n${words}` : ''}`
  }

  // A fresh agent swallows keys typed before its TUI is up. Claude says so through its SessionStart
  // hook; for the rest, output going quiet is the best sign there is.
  async function ready(h) {
    if (h.agent.hooks) await until(() => h.started || sessions.get(h.id) !== h, 30_000)
    else await until(() => (h.lastOutputAt && Date.now() - h.lastOutputAt > 1500) || sessions.get(h.id) !== h, 15_000)
    await sleep(500)
  }

  async function call(lead, tool, args) {
    const team = teamOf(lead)
    if (tool === 'create_helper') {
      const task = String(args.task || '').trim()
      if (!task) throw new Error('task is empty')
      const agent = args.agent || 'claude'
      if (!agentIds.includes(agent)) throw new Error(`unknown agent ${agent}; use one of ${agentIds.join(', ')}`)
      if ([...team.values()].filter((id) => sessions.has(id)).length >= MAX_HELPERS)
        throw new Error(`You already have ${MAX_HELPERS} helpers running. Wait for them, or give one more work with message_helper.`)
      if (!hasWindow()) throw new Error('The vibeboard window is closed, so the user could not see a helper. Ask them to open it.')
      const base = String(args.name || 'Helper').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 30) || 'Helper'
      let name = base
      for (let n = 2; team.has(name); n++) name = `${base} ${n}`
      const role = String(args.role || '').trim().slice(0, 300)
      const id = `c-${randomUUID().slice(0, 8)}`
      const h = spawn({ id, agentId: agent, cwd: lead.cwd, yolo: lead.yolo, profile: lead.profile }) // same account as the lead
      team.set(name, id)
      broadcast({ type: 'helper', parent: lead.id, id, name, agent, role, cwd: h.cwd, yolo: !!lead.yolo })
      await ready(h)
      if (sessions.get(id) !== h) throw new Error(`${name} exited while starting: ${lastWords(h).slice(-300)}`)
      await sendPrompt(
        h,
        `You are ${name}, a helper on a team.${role ? ` Your role: ${role}` : ''}\n\n${task}\n\n` +
          'When you are done, end with a short summary of what you did and found: it goes back to your lead.',
      )
      setStatus(h, 'working')
      return `${name} is on the board and working on it. Call wait_for_helpers to get its answer.`
    }
    if (tool === 'message_helper') {
      const name = String(args.name)
      const h = sessions.get(helperId(lead, name))
      if (!h) throw new Error(`${name} has exited`)
      if (h.status === 'needs') throw new Error(`${name} is waiting for the user to answer a question on the board; typing now would answer it for them.`)
      await sendPrompt(h, String(args.text || ''))
      setStatus(h, 'working')
      return `Sent to ${name}.`
    }
    if (tool === 'wait_for_helpers') {
      const names = Array.isArray(args.names) && args.names.length ? args.names.map(String) : [...team.keys()]
      if (!names.length) return 'You have no helpers yet. Create one with create_helper.'
      const ids = names.map((n) => helperId(lead, n))
      const ms = Math.min(900, Math.max(0, Number(args.timeout_seconds ?? 300) || 0)) * 1000
      const settled = () => ids.every((id) => sessions.get(id)?.status !== 'working') || ids.some((id) => sessions.get(id)?.status === 'needs')
      await until(() => settled() || sessions.get(lead.id) !== lead, ms)
      return names.map((n, i) => report(n, ids[i])).join('\n\n---\n\n')
    }
    if (tool === 'list_helpers') {
      if (!team.size) return 'No helpers yet.'
      return [...team].map(([n, id]) => `${n}: ${sessions.get(id) ? STATUS[sessions.get(id).status] || sessions.get(id).status : 'has exited'}`).join('\n')
    }
    throw new Error(`unknown tool ${tool}`)
  }

  // One JSON-RPC message in, its reply out (null for a notification, which gets no reply).
  async function handle(leadId, msg) {
    const { id, method, params } = msg && typeof msg === 'object' ? msg : {}
    if (id === undefined || id === null) return null
    const reply = (result) => ({ jsonrpc: '2.0', id, result })
    if (method === 'initialize')
      return reply({
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'vibeboard', version: '0.1.0' },
        instructions: INSTRUCTIONS,
      })
    if (method === 'ping') return reply({})
    if (method === 'tools/list') return reply({ tools: TOOLS })
    if (method === 'tools/call') {
      try {
        const lead = sessions.get(leadId)
        if (!lead) throw new Error('this console is not running')
        return reply({ content: [{ type: 'text', text: await call(lead, params?.name, params?.arguments || {}) }] })
      } catch (e) {
        return reply({ content: [{ type: 'text', text: e.message }], isError: true })
      }
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method ${method}` } }
  }

  return { handle, forget: (id) => teams.delete(id) }
}
