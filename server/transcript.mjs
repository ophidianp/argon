import { describeTool } from '../shared/plain.js'

// Reads a Claude Code transcript (.jsonl). Returns the conversation as plain lines, and the agent's
// final reply word for word: the text it wrote after its last tool call, which is usually the
// deliverable (a plan, a list of findings) and must not be lost in a summary.
export function readTranscript(jsonl) {
  const lines = []
  let last = []
  for (const raw of jsonl.split('\n')) {
    let e
    try {
      e = JSON.parse(raw)
    } catch {
      continue
    }
    if (e.type !== 'user' && e.type !== 'assistant') continue
    const content = typeof e.message?.content === 'string' ? [{ type: 'text', text: e.message.content }] : e.message?.content || []
    if (e.type === 'user') last = [] // a new prompt or a tool result: whatever came before was not the final word
    for (const c of content) {
      if (c.type === 'text' && c.text?.trim()) {
        lines.push(`${e.type === 'user' ? 'User' : 'Agent'}: ${c.text.trim()}`)
        if (e.type === 'assistant') last.push(c.text.trim())
      } else if (c.type === 'tool_use') {
        lines.push(`[${c.name} ${JSON.stringify(c.input).slice(0, 160)}]`)
        last = []
      }
    }
  }
  return { lines, lastReply: last.join('\n\n') }
}

// What Claude writes for itself in the transcript as if the person had typed it.
const NOT_TYPED = /^(<(command-|local-command|system-reminder|bash-|task-notification)|Caveat:)/
const parsed = (raw) => {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// The same transcript as a conversation to read: what the person asked, what the agent replied, and
// each tool it used as one plain line. Sub-agents' own conversations and bookkeeping stay out.
export function readConversation(jsonl, limit = 200) {
  const items = []
  const tools = new Map()
  for (const raw of jsonl.split('\n')) {
    const e = parsed(raw)
    if (!e || (e.type !== 'user' && e.type !== 'assistant')) continue
    if (e.isMeta || e.isSidechain || e.isCompactSummary || e.isVisibleInTranscriptOnly) continue
    const content = typeof e.message?.content === 'string' ? [{ type: 'text', text: e.message.content }] : e.message?.content || []
    for (const c of content) {
      if (c.type === 'tool_use') {
        // Not "Ran" yet: it may still be waiting for the person's answer.
        const { doing, done } = describeTool(c.name, c.input)
        const step = { kind: 'step', text: doing, pending: true }
        items.push(step)
        tools.set(c.id, { step, doing, done })
      } else if (c.type === 'tool_result' && tools.has(c.tool_use_id)) {
        const { step, doing, done } = tools.get(c.tool_use_id)
        delete step.pending
        step.text = done
        if (c.is_error) {
          const why = JSON.stringify(c.content ?? '')
          const verdict = /doesn't want|rejected|denied/i.test(why) ? 'You said no' : /interrupted/i.test(why) ? 'Stopped' : 'Failed'
          step.text = `${verdict}: ${doing[0].toLowerCase()}${doing.slice(1)}`
          step.failed = true
        }
      } else if (c.type === 'text' && c.text?.trim()) {
        const text = c.text.trim()
        if (e.type === 'assistant') items.push({ kind: 'agent', text })
        else if (text.startsWith('[Request interrupted')) items.push({ kind: 'note', text: 'Stopped here' })
        else if (!NOT_TYPED.test(text)) items.push({ kind: 'user', text })
      }
    }
  }
  return items.slice(-limit)
}
