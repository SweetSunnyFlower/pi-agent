import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { AgentPageHeader } from '#/components/agents/agent-page-header'
import { AgentToolsForm } from '#/components/agents/agent-tools-form'
import { useAgentWorkspace } from '#/components/agents/agent-workspace-context'
import { AgentFormSkeleton } from '#/components/loading/page-skeletons'
import { getAgentTools, getAgentVersionTools } from '#/lib/api/platform-client'
import type { ToolCatalogItem } from '#/lib/api/platform-client'
import { agentVersionForMode } from '#/lib/agents/agent-workspace-version'

export const Route = createFileRoute('/w/$workspaceSlug/agents/$agentId/tools')(
  { component: ToolsPage },
)

function ToolsPage() {
  const { workspace, agent, refreshAgent, mode } = useAgentWorkspace()
  const readOnly = mode === 'view'
  const version = agentVersionForMode(agent, mode)
  const [tools, setTools] = useState<ToolCatalogItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!version) {
      setTools(null)
      return
    }
    let active = true
    const request = readOnly
      ? getAgentVersionTools(workspace.workspaceId, agent.id, version.id)
      : getAgentTools(workspace.workspaceId, agent.id)
    request
      .then((result) => {
        if (active) setTools(result)
      })
      .catch(() => {
        if (active) setError('工具目录加载失败，请稍后重试。')
      })
    return () => {
      active = false
    }
  }, [agent.id, readOnly, version, workspace.workspaceId])

  return (
    <section>
      <AgentPageHeader
        eyebrow="03 · 工具"
        title={readOnly ? '已发布的工具能力' : '为 Agent 添加可执行能力'}
        description={
          readOnly
            ? '查看当前发布版本绑定的工具与接口信息。'
            : '选择内置工具，或通过 HTTP、OpenAPI、MCP 注册和发现能力；工具只在当前 Agent 草稿中启用。'
        }
      />
      {error ? (
        <div role="alert" className="agent-panel p-6 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {!error && version && !tools ? (
        <AgentFormSkeleton variant="tools" />
      ) : null}
      {tools && version ? (
        <AgentToolsForm
          workspaceId={workspace.workspaceId}
          agentId={agent.id}
          initialTools={tools}
          onSaved={refreshAgent}
          readOnly={readOnly}
        />
      ) : null}
      {!version ? (
        <div className="agent-panel p-6 text-sm text-[var(--sea-ink-soft)]">
          {readOnly
            ? '该 Agent 尚未发布，暂无可查看的工具配置。'
            : '当前 Agent 没有可编辑的草稿版本。'}
        </div>
      ) : null}
    </section>
  )
}
