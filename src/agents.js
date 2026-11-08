// Catalog of agent CLIs Argon knows how to launch.
// cmd: executable on PATH. resume: args that continue the last session.
// yolo: args for the optional auto-approve mode (off unless turned on in Settings).
export const AGENTS = [
  { key: 'shell',    name: 'Terminal',     cmd: null,           color: '#8f86a8', resume: null,            yolo: null, install: null },
  { key: 'claude',   name: 'Claude Code',  cmd: 'claude',       color: '#d9a07a', resume: '--continue',    yolo: '--dangerously-skip-permissions', install: 'npm install -g @anthropic-ai/claude-code', profileEnv: 'CLAUDE_CONFIG_DIR' },
  { key: 'codex',    name: 'Codex',        cmd: 'codex',        color: '#8fd1c0', resume: 'resume --last', yolo: '--full-auto', install: 'npm install -g @openai/codex', profileEnv: 'CODEX_HOME' },
  { key: 'gemini',   name: 'Gemini CLI',   cmd: 'gemini',       color: '#7fa8f0', resume: null,            yolo: '--yolo', install: 'npm install -g @google/gemini-cli' },
  { key: 'copilot',  name: 'Copilot CLI',  cmd: 'copilot',      color: '#b0b8c8', resume: '--continue',    yolo: '--allow-all-tools', install: 'npm install -g @github/copilot' },
  { key: 'opencode', name: 'OpenCode',     cmd: 'opencode',     color: '#e0c36a', resume: null,            yolo: null, install: 'npm install -g opencode-ai' },
  { key: 'qwen',     name: 'Qwen Code',    cmd: 'qwen',         color: '#a58cf0', resume: null,            yolo: '--yolo', install: 'npm install -g @qwen-code/qwen-code' },
  { key: 'amp',      name: 'Amp',          cmd: 'amp',          color: '#f08f8f', resume: null,            yolo: null, install: 'npm install -g @sourcegraph/amp' },
  { key: 'aider',    name: 'Aider',        cmd: 'aider',        color: '#7fd18a', resume: '--restore-chat-history', yolo: '--yes-always', install: 'python -m pip install aider-install; aider-install' },
  { key: 'cursor',   name: 'Cursor CLI',   cmd: 'cursor-agent', color: '#c8c8d8', resume: 'resume',        yolo: null, install: null },
  { key: 'goose',    name: 'Goose',        cmd: 'goose',        color: '#d8b48f', resume: 'session --resume', yolo: null, install: null },
  { key: 'crush',    name: 'Crush',        cmd: 'crush',        color: '#e89bd0', resume: null,            yolo: '--yolo', install: 'npm install -g @charmland/crush' },
];

export function agentList(customAgents = []) {
  return AGENTS.concat(customAgents.map(c => ({
    key: 'custom:' + c.id, name: c.name, cmd: c.cmd.split(/\s+/)[0], fullCmd: c.cmd,
    color: c.color || '#9b84d6', resume: null, yolo: null, install: null, custom: true,
  })));
}

export function agentByKey(key, customAgents = []) {
  return agentList(customAgents).find(a => a.key === key) || AGENTS[0];
}

// Build the command line typed into PowerShell for this console.
export function buildCommand(agent, { resume = false, autoApprove = false, extra = '' } = {}) {
  if (!agent.cmd) return extra || '';
  let line = agent.fullCmd || agent.cmd;
  if (resume && agent.resume) line += ' ' + agent.resume;
  if (autoApprove && agent.yolo) line += ' ' + agent.yolo;
  if (extra) line += ' ' + extra;
  return line;
}
