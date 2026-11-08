// One non-interactive CLI run whose answer streams in: Memory scans, Documents and Diagrams use it.
// Claude streams JSON events (text as it is typed, tool use, a final result); any other CLI is read as
// plain text from stdout.

const q = (v) => `'${v.replace(/'/g, `'\\''`)}'`

// The command line for a one-off, read-only run of each CLI in the repo folder.
// ponytail: only the Claude line is tried on this machine; the others follow each CLI's documented one-shot mode.
export function commandFor(agent, prompt, model = 'sonnet') {
  const lines = {
    claude: () =>
      `claude -p ${q(prompt)} --model ${model} --output-format stream-json --verbose --include-partial-messages ` +
      '--no-session-persistence --setting-sources local --strict-mcp-config --allowedTools Read Glob Grep --disallowedTools Bash Edit Write NotebookEdit',
    codex: () => `codex exec --sandbox read-only --skip-git-repo-check ${q(prompt)}`,
    gemini: () => `gemini -p ${q(prompt)}`,
    grok: () => `grok -p ${q(prompt)}`,
    opencode: () => `opencode run ${q(prompt)}`,
  }
  return lines[agent]?.() ?? null
}

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\r/g

/**
 * Runs `command` and reports as it goes.
 *   onText(text)  everything written so far (Claude: text deltas; others: stdout)
 *   onStep(step)  1 reading the repo, 2 writing, 3 wrapping up
 *   onEnd({ text, error, code })  once; `text` is Claude's own final answer when it gave one
 * Returns { stop } (the run ends with onEnd({ stopped: true })).
 */
export function runCli({ command, claude, cwd, launch, timeoutMs = 5 * 60_000, onText = () => {}, onStep = () => {}, onEnd = () => {} }) {
  let text = ''
  let pending = ''
  let final = null
  let failure = null
  let errTail = ''
  let step = 0
  let stopped = false
  const advance = (n) => n > step && ((step = n), onStep(n))
  const child = launch(command, cwd)
  const kill = () => {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      // the group already exited
    }
  }
  const timer = setTimeout(() => {
    failure = `no answer after ${Math.round(timeoutMs / 60_000)} minutes`
    kill()
  }, timeoutMs)
  const onEvent = (e) => {
    if (e.type === 'stream_event' && e.event?.type === 'content_block_start' && e.event.content_block?.type === 'text') text += '\n'
    else if (e.type === 'stream_event' && e.event?.delta?.type === 'text_delta') {
      text += e.event.delta.text
      advance(2)
      onText(text)
    } else if (e.type === 'assistant' && e.message?.content?.some((c) => c.type === 'tool_use')) advance(1)
    else if (e.type === 'result') {
      if (e.is_error) failure = String(e.result ?? e.subtype).slice(0, 300)
      else final = String(e.result ?? '')
      advance(3)
    }
  }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    if (stopped) return
    if (claude) {
      const lines = (pending + chunk).split('\n')
      pending = lines.pop()
      for (const line of lines) {
        if (!line.startsWith('{')) continue // shell rc noise
        try {
          onEvent(JSON.parse(line))
        } catch {
          // a stray line that is not an event
        }
      }
    } else {
      text += chunk.replace(ANSI, '')
      advance(1)
      onText(text)
    }
  })
  child.stderr.on('data', (chunk) => (errTail = (errTail + chunk).slice(-2000)))
  child.on('error', (e) => (failure = e.message))
  child.on('close', (code) => {
    clearTimeout(timer)
    if (stopped) return onEnd({ text, stopped: true, code })
    advance(3)
    const answer = final?.trim() ? final : text
    const error = failure || (code && !answer.trim() ? errTail.replace(ANSI, '').trim().split('\n').pop() || `the CLI exited with ${code}` : null)
    onEnd({ text: answer, error, code })
  })
  return {
    stop: () => {
      stopped = true
      kill()
    },
  }
}
