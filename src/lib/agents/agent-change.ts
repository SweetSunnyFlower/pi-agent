import type { AgentSectionId } from './agent-sections'

export type AgentChangeModule = 'prompt' | 'tools' | 'skills' | 'channels'

export type AgentChangeStatus = {
  hasChanges: boolean
  changedModules: AgentChangeModule[]
}

const sectionModules: Partial<Record<AgentSectionId, AgentChangeModule>> = {
  prompt: 'prompt',
  tools: 'tools',
  skills: 'skills',
  channels: 'channels',
}

export function hasAgentSectionChanges(
  section: AgentSectionId,
  status: AgentChangeStatus,
): boolean {
  if (section === 'publish') return status.hasChanges
  const module = sectionModules[section]
  return module ? status.changedModules.includes(module) : false
}
