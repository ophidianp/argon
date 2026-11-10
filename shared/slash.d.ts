export type SlashCommand = { name: string; description: string; aliases?: string[]; source?: 'built-in' | 'project' | 'user' | 'plugin' }
export const CLAUDE_COMMANDS: SlashCommand[]
export const BUILTIN_COMMANDS: Record<string, SlashCommand[]>
export function matchCommands(list: SlashCommand[], query: string): SlashCommand[]
