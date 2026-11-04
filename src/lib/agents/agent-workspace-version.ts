import type { AgentRecord, AgentVersionRecord } from '#/lib/api/platform-client'
import type { AgentWorkspaceMode } from './agent-sections'

export function agentVersionForMode(
  agent: AgentRecord,
  mode: AgentWorkspaceMode,
): AgentVersionRecord | undefined {
  if (mode === 'view') {
    if (!agent.currentPublishedVersionId) return undefined
    return agent.versions.find(
      (version) => version.id === agent.currentPublishedVersionId,
    )
  }

  return agent.versions.find((version) => version.status === 'draft')
}
