import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { AgentApiTokensPanel } from '#/components/agents/agent-api-tokens-panel'
import { AgentChannelsForm } from '#/components/agents/agent-channels-form'
import { AgentPageHeader } from '#/components/agents/agent-page-header'
import { useAgentWorkspace } from '#/components/agents/agent-workspace-context'
import { AgentFormSkeleton } from '#/components/loading/page-skeletons'
import { getAgentChannels } from '#/lib/api/platform-client'
import type { AgentChannelsResponse } from '#/lib/api/platform-client'

export const Route = createFileRoute(
  '/w/$workspaceSlug/agents/$agentId/channels',
)({ component: ChannelsPage })

function ChannelsPage() {
  const { workspace, agent, refreshAgent, mode } = useAgentWorkspace()
  const readOnly = mode === 'view'
  const canManageTokens =
    workspace.role === 'workspace_admin' || workspace.role === 'platform_admin'
  const [config, setConfig] = useState<AgentChannelsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    getAgentChannels(workspace.workspaceId, agent.id)
      .then((result) => {
        if (active) setConfig(result)
      })
      .catch(() => {
        if (active) setError('渠道配置加载失败，请稍后重试。')
      })
    return () => {
      active = false
    }
  }, [agent.id, workspace.workspaceId])

  return (
    <section>
      <AgentPageHeader
        eyebrow="05 · 渠道"
        title={readOnly ? '已配置的响应渠道' : '选择 Agent 的响应渠道'}
        description={
          readOnly
            ? '查看 Web 与如流渠道的启用状态和机器人配置。'
            : 'Web 默认启用；如流采用一个 Agent 对应一个专属机器人，凭据加密存储。'
        }
      />
      {error ? (
        <div role="alert" className="agent-panel p-6 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {!error && !config ? <AgentFormSkeleton variant="channels" /> : null}
      {config ? (
        <AgentChannelsForm
          workspaceId={workspace.workspaceId}
          agentId={agent.id}
          initialConfig={config}
          onSaved={refreshAgent}
          readOnly={readOnly}
        />
      ) : null}
      {canManageTokens ? (
        <div className="mt-4">
          <AgentApiTokensPanel
            workspaceId={workspace.workspaceId}
            agentId={agent.id}
          />
        </div>
      ) : null}
    </section>
  )
}
