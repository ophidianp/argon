// Documents studio: what each template asks the CLI to write, and how long it may take.

/** @type {{ id: string, title: string, sub: string, ask: string }[]} */
export const TEMPLATES = [
  { id: 'overview', title: 'Project overview', sub: 'What this repo is, at a glance', ask: 'what the project is, the problem it solves, its main features, the stack and how the pieces fit together' },
  { id: 'onboarding', title: 'Onboarding guide', sub: 'Get a new contributor productive', ask: 'how to set up, run, test and change the project on day one, where to start reading, and the conventions to follow' },
  { id: 'architecture', title: 'Architecture', sub: 'Modules, layers and data flow', ask: 'the modules and layers, how data and requests flow through them, the key decisions and their trade-offs' },
  { id: 'readme', title: 'README', sub: 'A polished front-page README', ask: 'a front-page README: a one-line pitch, features, install, usage with examples, configuration, development and license' },
  { id: 'api', title: 'API reference', sub: 'Public surface and how to call it', ask: 'the public API (HTTP routes, exported functions, CLI commands or events), with parameters, return values and short examples' },
  { id: 'data-model', title: 'Data model', sub: 'Entities, fields and relationships', ask: 'the entities and their fields, how they relate, where they are stored and how they change over time' },
  { id: 'security', title: 'Security overview', sub: 'Trust boundaries and risks', ask: 'the trust boundaries, how input, secrets and permissions are handled, the risks you can see in the code and what mitigates them' },
]

/** @type {{ id: 'quick' | 'balanced' | 'thorough', label: string, model: string, words: number }[]} */
export const DEPTHS = [
  { id: 'quick', label: 'Quick', model: 'haiku', words: 500 },
  { id: 'balanced', label: 'Balanced', model: 'sonnet', words: 1200 },
  { id: 'thorough', label: 'Thorough', model: 'opus', words: 2500 },
]

/** The prompt for one document; `ask` is the template's subject or the user's own request. */
export function docPrompt(ask, words) {
  return (
    `Write a Markdown document about this repository covering: ${ask}. ` +
    'Read the README, the docs, the file tree and the key source files first, and stay specific to this code: name real files, modules and commands, and never invent any. ' +
    'Start with one "# " title that names the project, then "## " sections with short paragraphs, bullet lists, tables where they help and `inline code` for paths and commands. ' +
    'Add one or two callouts as blockquotes that start with "[!NOTE]" or "[!TIP]". ' +
    `Aim for about ${words} words. Output only the document: no preamble, no closing remarks, no code fence around it.`
  )
}

/** The document inside a CLI's answer: from its "# " title on, without a fence wrapped around it. */
export function docBody(text) {
  const t = text.replace(/^\s*```(?:markdown|md)?\n([\s\S]*?)\n```\s*$/, '$1')
  const i = t.search(/^# /m)
  return (i > 0 ? t.slice(i) : t).trim()
}

export const countWords = (text) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length
export const readMinutes = (words) => Math.max(1, Math.round(words / 230))
