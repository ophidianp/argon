export type Agent = {
  id: string
  name: string
  sub: string
  cmd: string
  color: string
  hooks?: boolean
  resume?: boolean
  configEnv?: string
}
export const AGENTS: Agent[]
export const agentById: (id: string) => Agent | undefined
