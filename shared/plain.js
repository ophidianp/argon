// What an agent is doing, in words for someone who has never seen a terminal.
const base = (p) => String(p ?? '').split('/').filter(Boolean).pop() || 'a file'
const clip = (text, max = 60) => {
  const line = String(text ?? '').trim().split('\n')[0]
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}
const host = (url) => {
  try {
    return new URL(url).host
  } catch {
    return 'a web page'
  }
}

// -> { doing: 'Reading auth.ts', done: 'Read auth.ts' }
export function describeTool(name, input = {}) {
  switch (name) {
    case 'Read':
      return { doing: `Reading ${base(input.file_path)}`, done: `Read ${base(input.file_path)}` }
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { doing: `Editing ${base(input.file_path ?? input.notebook_path)}`, done: `Edited ${base(input.file_path ?? input.notebook_path)}` }
    case 'Write':
      return { doing: `Writing ${base(input.file_path)}`, done: `Wrote ${base(input.file_path)}` }
    case 'Bash':
      return { doing: `Running ${clip(input.command)}`, done: `Ran ${clip(input.command)}` }
    case 'Grep':
      return { doing: `Searching for “${clip(input.pattern, 40)}”`, done: `Searched for “${clip(input.pattern, 40)}”` }
    case 'Glob':
      return { doing: 'Looking for files', done: 'Looked for files' }
    case 'Task':
    case 'Agent':
      return { doing: `Working with a helper: ${clip(input.description ?? input.prompt, 50)}`, done: `A helper worked on: ${clip(input.description ?? input.prompt, 50)}` }
    case 'WebFetch':
      return { doing: `Reading ${host(input.url)}`, done: `Read ${host(input.url)}` }
    case 'WebSearch':
      return { doing: `Searching the web for “${clip(input.query, 40)}”`, done: `Searched the web for “${clip(input.query, 40)}”` }
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return { doing: 'Updating its to-do list', done: 'Updated its to-do list' }
    default:
      return { doing: `Using ${clip(name, 40)}`, done: `Used ${clip(name, 40)}` }
  }
}

// The one sentence at the top of a console.
export function statusLine(status, activity) {
  if (status === 'working') return activity || 'Thinking…'
  if (status === 'needs') return 'Waiting for your answer'
  if (status === 'done') return 'Finished. Tell it what to do next'
  if (status === 'paused') return 'Paused'
  if (status === 'stopped') return 'Stopped'
  return 'Ready for your instructions'
}
