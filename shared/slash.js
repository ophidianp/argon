// Slash commands the simple view's box offers as you type "/". The built-ins are Claude Code's own (checked
// against the command table in Claude Code 2.1.322; aliases as it lists them). Codex and Gemini CLI get a list
// once one can be checked against an installed copy.

export const CLAUDE_COMMANDS = [
  { name: 'model', description: 'Set the AI model for Claude Code' },
  { name: 'effort', description: 'Set the effort level for model usage' },
  { name: 'clear', description: 'Start a new session with empty context (the old one can be resumed)' },
  { name: 'compact', description: 'Free up context by summarizing the conversation so far' },
  { name: 'context', description: 'Show current context usage as a coloured grid' },
  { name: 'usage', description: 'Show session cost, plan usage and activity stats', aliases: ['cost', 'stats'] },
  { name: 'resume', description: 'Resume a previous conversation', aliases: ['continue'] },
  { name: 'rewind', description: 'Restore the code and/or conversation to a previous point', aliases: ['checkpoint', 'undo'] },
  { name: 'rename', description: 'Rename the current conversation' },
  { name: 'branch', description: 'Create a branch of the conversation at this point' },
  { name: 'btw', description: 'Ask a quick side question without interrupting the main conversation' },
  { name: 'plan', description: 'Turn on plan mode, or view the current plan' },
  { name: 'init', description: 'Initialize a CLAUDE.md file with codebase documentation' },
  { name: 'memory', description: 'Edit CLAUDE.md files and memory settings' },
  { name: 'add-dir', description: 'Add a new working directory' },
  { name: 'permissions', description: 'Manage allow and deny tool permission rules' },
  { name: 'hooks', description: 'View hook configurations for tool events' },
  { name: 'mcp', description: 'Manage MCP servers' },
  { name: 'skills', description: 'List available skills' },
  { name: 'output-style', description: 'List output styles or switch to one' },
  { name: 'export', description: 'Export the conversation to a file or the clipboard' },
  { name: 'copy', description: "Copy Claude's last response to the clipboard" },
  { name: 'status', description: 'Show version, model, account, connectivity and tool status' },
  { name: 'config', description: 'Open settings' },
  { name: 'doctor', description: 'Health-check your setup and fix issues', aliases: ['checkup'] },
  { name: 'statusline', description: "Set up Claude Code's status line" },
  { name: 'release-notes', description: 'View release notes' },
  { name: 'login', description: 'Sign in with your Anthropic account, or switch accounts' },
  { name: 'logout', description: 'Sign out from your Anthropic account' },
  { name: 'help', description: 'Show help and available commands' },
  { name: 'exit', description: 'Exit Claude Code', aliases: ['quit'] },
]

export const BUILTIN_COMMANDS = { claude: CLAUDE_COMMANDS }

// What the menu shows for what is typed so far: names that start with it first, then names (or aliases) that
// contain it. `query` is the text after "/", up to the first space.
export function matchCommands(list, query) {
  const q = query.toLowerCase()
  if (!q) return list
  const starts = [], contains = []
  for (const c of list) {
    const n = c.name.toLowerCase()
    if (n.startsWith(q) || n.split(':').pop().startsWith(q) || c.aliases?.some((a) => a.startsWith(q))) starts.push(c)
    else if (n.includes(q)) contains.push(c)
  }
  return [...starts, ...contains]
}
