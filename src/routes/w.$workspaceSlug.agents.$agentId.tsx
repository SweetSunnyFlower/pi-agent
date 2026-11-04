import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { AgentWorkspaceProvider } from '#/components/agents/agent-workspace-context'
import { AgentEditDraftGate } from '#/components/agents/agent-edit-draft-gate'
import { AgentWorkspaceShell } from '#/components/agents/agent-workspace-shell'
import { AgentWorkspaceShellSkeleton } from '#/components/loading/page-skeletons'
import {
  getAgentRequest,
  getAuthMe,
  getPublishReadiness,
} from '#/lib/api/platform-client'
import { capabilityCounts, channelLabel } from '#/lib/agents/agent-manifest'
import type { AgentRecord, WorkspaceAccess } from '#/lib/api/platform-client'
import type { AgentChangeStatus } from '#/lib/agents/agent-change'
import { parseAgentWorkspaceMode } from '#/lib/agents/agent-sections'
import type { AgentSectionId } from '#/lib/agents/agent-sections'
import { agentVersionForMode } from '#/lib/agents/agent-workspace-version'

export const Route = createFileRoute('/w/$workspaceSlug/agents/$agentId')({
  component: AgentLayout,
})

function AgentLayout() {
  const { workspaceSlug, agentId } = Route.useParams()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const activeSection = (pathname.split('/').at(-1) ??
    'basic') as AgentSectionId
  const mode = useRouterState({
    select: (state) =>
      parseAgentWorkspaceMode(
        state.location.search,
        activeSection === 'chat' ? 'view' : 'edit',
      ),
  })
  const [data, setData] = useState<{
    workspace: WorkspaceAccess
    agent: AgentRecord
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [changeStatus, setChangeStatus] = useState<AgentChangeStatus>({
    hasChanges: false,
    changedModules: [],
  })
  const [changeStatusLoading, setChangeStatusLoading] = useState(false)

  useEffect(() => {
    let active = true
    getAuthMe()
      .then(async (auth) => {
        const workspace = auth.workspaces.find(
          (item) => item.slug === workspaceSlug,
        )
        if (!workspace) throw new Error('workspace_not_found')
        const agent = await getAgentRequest(workspace.workspaceId, agentId)
        if (active) setData({ workspace, agent })
      })
      .catch(() => {
        if (active) setError('Agent 加载失败，请稍后重试。')
      })
    return () => {
      active = false
    }
  }, [agentId, workspaceSlug])

  const canEdit = Boolean(
    data && ['workspace_admin', 'editor'].includes(data.workspace.role),
  )

  useEffect(() => {
    if (!data || mode !== 'edit' || !canEdit) {
      setChangeStatus({ hasChanges: false, changedModules: [] })
      setChangeStatusLoading(false)
      return
    }

    let active = true
    setChangeStatusLoading(true)
    getPublishReadiness(data.workspace.workspaceId, data.agent.id)
      .then((readiness) => {
        if (active) {
          setChangeStatus({
            hasChanges: readiness.hasChanges,
            changedModules: readiness.changedModules,
          })
          setChangeStatusLoading(false)
        }
      })
      .catch(() => {
        if (active) {
          setChangeStatus({ hasChanges: false, changedModules: [] })
          setChangeStatusLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [canEdit, data, mode])

  if (error) {
    return (
      <div className="agent-workspace-page">
        <div role="alert" className="agent-panel p-6 text-sm text-destructive">
          {error}
        </div>
      </div>
    )
  }

  if (!data) {
    return <AgentWorkspaceShellSkeleton />
  }

  const loadedData = data
  const selectedVersion = agentVersionForMode(loadedData.agent, mode)
  const displayVersion =
    selectedVersion ??
    (mode === 'edit' && loadedData.agent.currentPublishedVersionId
      ? loadedData.agent.versions.find(
          (version) =>
            version.id === loadedData.agent.currentPublishedVersionId,
        )
      : undefined)
  // modelProvider is an internal provider UUID; only the model id is meaningful to users.
  const modelLabel = displayVersion?.modelId || '模型尚未配置'
  const counts = capabilityCounts(displayVersion?.manifestJson)
  const channels = channelLabel(loadedData.agent.enabledChannels ?? ['web'])
  async function refreshAgent() {
    const nextAgent = await getAgentRequest(
      loadedData.workspace.workspaceId,
      loadedData.agent.id,
    )
    setData((current) => (current ? { ...current, agent: nextAgent } : current))
  }

  return (
    <AgentWorkspaceProvider
      value={{
        workspace: loadedData.workspace,
        agent: loadedData.agent,
        mode,
        changeStatus,
        refreshAgent,
      }}
    >
      <AgentWorkspaceShell
        workspaceSlug={workspaceSlug}
        workspaceName={loadedData.workspace.name}
        agentId={agentId}
        agentName={loadedData.agent.name}
        modelLabel={modelLabel}
        activeSection={activeSection}
        isPublished={Boolean(loadedData.agent.currentPublishedVersionId)}
        toolCount={counts.tools}
        skillCount={counts.skills}
        channelLabel={channels}
        mode={mode}
        changeStatus={changeStatus}
        changeStatusLoading={changeStatusLoading}
      >
        <AgentEditDraftGate
          enabled={mode === 'edit'}
          canEdit={canEdit}
          workspaceId={loadedData.workspace.workspaceId}
          agent={loadedData.agent}
          refreshAgent={refreshAgent}
        >
          <Outlet />
        </AgentEditDraftGate>
      </AgentWorkspaceShell>
    </AgentWorkspaceProvider>
  )
}
