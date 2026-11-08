// Single catalog shared by server (command lines) and client (labels, colors).
// `cmd` is the binary looked up on the user's login-shell PATH; '' means a plain shell.
// `configEnv` names the variable that moves the CLI's sign-in folder: what lets two accounts run side by side.
export const AGENTS = [
  { id: 'claude', name: 'Claude', sub: 'Anthropic', cmd: 'claude', color: '#e8643c', hooks: true, resume: true, configEnv: 'CLAUDE_CONFIG_DIR', addDir: '--add-dir' },
  { id: 'codex', name: 'Codex', sub: 'OpenAI', cmd: 'codex', color: '#6170f5', configEnv: 'CODEX_HOME' },
  { id: 'gemini', name: 'Gemini', sub: 'Google', cmd: 'gemini', color: '#4b8bf5' },
  { id: 'aider', name: 'Aider', sub: 'aider', cmd: 'aider', color: '#3fb862' },
  { id: 'cursor', name: 'Cursor', sub: 'cursor-agent', cmd: 'cursor-agent', color: '#d8d8d8' },
  { id: 'qwen', name: 'Qwen Code', sub: 'qwen', cmd: 'qwen', color: '#7d5cf5' },
  { id: 'opencode', name: 'OpenCode', sub: 'opencode', cmd: 'opencode', color: '#c9c3bb' },
  { id: 'grok', name: 'Grok', sub: 'grok', cmd: 'grok', color: '#bfbfbf' },
  { id: 'amp', name: 'Amp', sub: 'amp', cmd: 'amp', color: '#f25f4c' },
  { id: 'goose', name: 'Goose', sub: 'goose', cmd: 'goose', color: '#e6e6e6' },
  { id: 'copilot', name: 'Copilot CLI', sub: 'copilot', cmd: 'copilot', color: '#a371f7' },
  { id: 'droid', name: 'Droid', sub: 'droid', cmd: 'droid', color: '#f0883e' },
  { id: 'crush', name: 'Crush', sub: 'crush', cmd: 'crush', color: '#f472d0' },
  { id: 'kimi', name: 'Kimi CLI', sub: 'kimi', cmd: 'kimi', color: '#5aa9ff' },
  { id: 'auggie', name: 'Auggie', sub: 'auggie', cmd: 'auggie', color: '#46c2a8' },
  { id: 'cline', name: 'Cline', sub: 'cline', cmd: 'cline', color: '#9aa4b2' },
  { id: 'kilocode', name: 'Kilo Code', sub: 'kilocode', cmd: 'kilocode', color: '#f5d547' },
  { id: 'codebuff', name: 'Codebuff', sub: 'codebuff', cmd: 'codebuff', color: '#34d399' },
  { id: 'continue', name: 'Continue', sub: 'cn', cmd: 'cn', color: '#e5e5e5' },
  { id: 'shell', name: 'Shell', sub: 'Default', cmd: '', color: '#9a948c' },
]

export const agentById = (id) => AGENTS.find((a) => a.id === id)
