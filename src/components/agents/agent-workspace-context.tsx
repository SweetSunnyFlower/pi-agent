import { createContext, useContext } from 'react'

import type { AgentRecord, WorkspaceAccess } from '#/lib/api/platform-client'
import type { AgentChangeStatus } from '#/lib/agents/agent-change'
import type { AgentWorkspaceMode } from '#/lib/agents/agent-sections'

type AgentWorkspaceContextValue = {
  workspace: WorkspaceAccess
  agent: AgentRecord
  mode: AgentWorkspaceMode
  changeStatus: AgentChangeStatus
  refreshAgent: () => Promise<void>
}

const AgentWorkspaceContext = createContext<AgentWorkspaceContextValue | null>(
  null,
)

export const AgentWorkspaceProvider = AgentWorkspaceContext.Provider

export function useAgentWorkspace(): AgentWorkspaceContextValue {
  const value = useContext(AgentWorkspaceContext)
  if (!value) {
    throw new Error(
      'useAgentWorkspace must be used inside AgentWorkspaceProvider',
    )
  }
  return value
}
