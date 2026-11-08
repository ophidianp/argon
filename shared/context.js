// What fills a Claude session's memory, read from its transcript. The total is Claude's own count
// (the usage on its last reply); the split is an estimate from the size of each piece, about 4
// characters to a token, and whatever is left over is its instructions and tools.
const CHARS_PER_TOKEN = 4
const SMALL_WINDOW = 200_000
const LARGE_WINDOW = 1_000_000
const MAX_BIGGEST = 5

const size = (v) => (typeof v === 'string' ? v.length : JSON.stringify(v ?? '').length)
const tokens = (chars) => Math.round(chars / CHARS_PER_TOKEN)

const WHAT = {
  Read: 'Files read',
  Edit: 'Edits',
  Write: 'Edits',
  MultiEdit: 'Edits',
  NotebookEdit: 'Edits',
  Bash: 'Commands',
  Grep: 'Searches',
  Glob: 'Searches',
  WebFetch: 'Web',
  WebSearch: 'Web',
  Task: 'Helpers',
  Agent: 'Helpers',
}
const short = (p) => String(p).split('/').slice(-2).join('/')
const nameOf = (tool, input) => (tool === 'Bash' ? String(input?.command ?? 'command').slice(0, 60) : input?.file_path ? short(input.file_path) : tool)

// -> null before Claude has replied, or { used, window, model, parts: [{ label, tokens }], biggest: [{ label, tokens }] }
export function contextReport(jsonl) {
  let entries = []
  for (const raw of String(jsonl).split('\n')) {
    let e
    try {
      e = JSON.parse(raw)
    } catch {
      continue
    }
    if (e.isSidechain) continue
    if (e.type === 'system' && e.subtype === 'compact_boundary') entries = [] // compacting forgets all that came before
    else if (e.type === 'user' || e.type === 'assistant') entries.push(e)
  }
  const parts = new Map()
  const biggest = []
  const tools = new Map()
  const add = (label, chars) => parts.set(label, (parts.get(label) ?? 0) + chars)
  let usage = null
  let model = ''
  for (const e of entries) {
    if (e.type === 'assistant' && e.message?.usage) {
      usage = e.message.usage
      model = e.message.model || model
    }
    const content = typeof e.message?.content === 'string' ? [{ type: 'text', text: e.message.content }] : e.message?.content || []
    for (const c of content) {
      if (c.type === 'text') add(e.type === 'user' ? 'Your messages' : 'Claude’s replies', size(c.text))
      else if (c.type === 'tool_use') {
        tools.set(c.id, c)
        add(WHAT[c.name] ?? 'Other tools', size(c.input))
      } else if (c.type === 'tool_result') {
        const use = tools.get(c.tool_use_id)
        const chars = size(c.content)
        add(WHAT[use?.name] ?? 'Other tools', chars)
        if (use) biggest.push({ label: nameOf(use.name, use.input), tokens: tokens(chars) })
      }
    }
  }
  if (!usage) return null
  const used = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.output_tokens ?? 0)
  const shares = [...parts].map(([label, chars]) => ({ label, tokens: tokens(chars) })).filter((p) => p.tokens > 0)
  const counted = shares.reduce((n, p) => n + p.tokens, 0)
  if (used > counted) shares.push({ label: 'Instructions and tools', tokens: used - counted })
  return {
    used,
    // ponytail: the transcript does not say which window the session has; past 200k it must be the large one.
    window: used > SMALL_WINDOW ? LARGE_WINDOW : SMALL_WINDOW,
    model,
    parts: shares.sort((a, b) => b.tokens - a.tokens),
    biggest: biggest.sort((a, b) => b.tokens - a.tokens).slice(0, MAX_BIGGEST),
  }
}

// In the same words the panel uses: what the number means, and what to do about it.
export function contextAdvice(share) {
  if (share < 0.5) return 'Plenty of room.'
  if (share < 0.8) return 'Filling up. Fine for now.'
  return 'Nearly full. Compact it soon, or it will forget details on its own.'
}
