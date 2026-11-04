import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { AgentPageHeader } from '#/components/agents/agent-page-header'
import { AgentPromptForm } from '#/components/agents/agent-prompt-form'
import { useAgentWorkspace } from '#/components/agents/agent-workspace-context'
import { AgentFormSkeleton } from '#/components/loading/page-skeletons'
import { getModelConfig } from '#/lib/api/platform-client'
import type { ModelConfigResponse } from '#/lib/api/platform-client'
import { agentVersionForMode } from '#/lib/agents/agent-workspace-version'

export const Route = createFileRoute(
  '/w/$workspaceSlug/agents/$agentId/prompt',
)({ component: PromptPage })

function PromptPage() {
  const { workspace, agent, mode, refreshAgent } = useAgentWorkspace()
  const version = agentVersionForMode(agent, mode)
  const readOnly = mode === 'view'
  const [modelConfig, setModelConfig] = useState<ModelConfigResponse | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!readOnly) return
    setModelConfig(null)
    setError(null)
  }, [readOnly])

  useEffect(() => {
    if (readOnly) return
    let active = true
    getModelConfig(workspace.workspaceId)
      .then((config) => {
        if (active) setModelConfig(config)
      })
      .catch(() => {
        if (active) setError('模型配置加载失败，请稍后重试。')
      })
    return () => {
      active = false
    }
  }, [readOnly, workspace.workspaceId])

  return (
    <section>
      <AgentPageHeader
        eyebrow="02 · 提示词与模型"
        title={readOnly ? '已发布的思考方式' : '定义 Agent 的思考方式'}
        description={
          readOnly
            ? '查看当前发布版本的提示词、模型和思考等级。'
            : '在这里编辑提示词、模型、思考等级和响应策略。'
        }
      />
      {error ? (
        <div role="alert" className="agent-panel p-6 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {!readOnly && !error && !modelConfig ? (
        <AgentFormSkeleton variant="prompt" />
      ) : null}
      {version && (readOnly || modelConfig) ? (
        <AgentPromptForm
          workspaceId={workspace.workspaceId}
          agentId={agent.id}
          initialInstructions={version.instructions}
          initialProvider={version.modelProvider || undefined}
          initialModelId={version.modelId || undefined}
          initialThinkingLevel={version.thinkingLevel}
          modelOptions={modelConfig?.options ?? []}
          readOnly={readOnly}
          onSaved={refreshAgent}
        />
      ) : null}
      {(readOnly || modelConfig) && !version ? (
        <div className="agent-panel p-6 text-sm text-[var(--sea-ink-soft)]">
          {readOnly
            ? '该 Agent 尚未发布，暂无可查看的版本。'
            : '当前 Agent 没有可编辑的草稿版本。'}
        </div>
      ) : null}
    </section>
  )
}
