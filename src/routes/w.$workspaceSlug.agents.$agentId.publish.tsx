import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { AgentPageHeader } from '#/components/agents/agent-page-header'
import { AgentPublishPanel } from '#/components/agents/agent-publish-panel'
import { useAgentWorkspace } from '#/components/agents/agent-workspace-context'
import { AgentFormSkeleton } from '#/components/loading/page-skeletons'
import { getPublishReadiness } from '#/lib/api/platform-client'
import type { PublishReadiness } from '#/lib/api/platform-client'
import { agentSectionHref } from '#/lib/agents/agent-sections'

export const Route = createFileRoute(
  '/w/$workspaceSlug/agents/$agentId/publish',
)({ component: PublishPage })

function PublishPage() {
  const { mode } = useAgentWorkspace()
  if (mode === 'view') return <PublishReadOnlyNotice />
  return <EditablePublishPage />
}

function PublishReadOnlyNotice() {
  const { workspace, agent } = useAgentWorkspace()

  return (
    <section>
      <AgentPageHeader
        eyebrow="查看模式"
        title="当前为只读查看"
        description="检查与发布仅在编辑视图中提供。"
      />
      <div className="agent-panel flex min-h-52 flex-col items-center justify-center px-6 py-10 text-center">
        <h2 className="text-sm font-semibold">这里不提供发布操作</h2>
        <p className="mt-2 max-w-md text-xs leading-5 text-[var(--sea-ink-soft)]">
          返回首页的配置入口，或切换到编辑视图后检查并发布 Agent。
        </p>
        <a
          className="mt-4 text-xs font-semibold text-[var(--lagoon-deep)] underline-offset-4 hover:underline"
          href={agentSectionHref(workspace.slug, agent.id, 'publish', 'edit')}
        >
          进入编辑视图
        </a>
      </div>
    </section>
  )
}

function EditablePublishPage() {
  const { workspace, agent, refreshAgent } = useAgentWorkspace()
  const [readiness, setReadiness] = useState<PublishReadiness | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function loadReadiness() {
    setReadiness(await getPublishReadiness(workspace.workspaceId, agent.id))
  }

  useEffect(() => {
    let active = true
    getPublishReadiness(workspace.workspaceId, agent.id)
      .then((result) => {
        if (active) setReadiness(result)
      })
      .catch(() => {
        if (active) setError('发布检查加载失败，请稍后重试。')
      })
    return () => {
      active = false
    }
  }, [agent.id, workspace.workspaceId])

  async function handleChanged() {
    await Promise.all([refreshAgent(), loadReadiness()])
  }

  return (
    <section>
      <AgentPageHeader
        eyebrow="06 · 检查与发布"
        title="发布前完成检查"
        description="检查通过后生成不可变版本；现有对话继续使用原先绑定的版本。"
      />
      {error ? (
        <div role="alert" className="agent-panel p-6 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {!error && !readiness ? (
        <AgentFormSkeleton variant="publish" />
      ) : null}
      {readiness ? (
        <AgentPublishPanel
          workspaceId={workspace.workspaceId}
          workspaceSlug={workspace.slug}
          agentId={agent.id}
          readiness={readiness}
          onChanged={handleChanged}
        />
      ) : null}
    </section>
  )
}
