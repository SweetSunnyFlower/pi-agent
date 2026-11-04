import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'

import { AgentCreateForm } from '#/components/agents/agent-create-form'
import { AgentPageHeader } from '#/components/agents/agent-page-header'
import { CreateAgentPageSkeleton } from '#/components/loading/page-skeletons'
import { ApiError, getAuthMe } from '#/lib/api/platform-client'
import type { WorkspaceAccess } from '#/lib/api/platform-client'

export const Route = createFileRoute('/w/$workspaceSlug/agents/new')({
  component: CreateAgentPage,
})

function CreateAgentPage() {
  const { workspaceSlug } = Route.useParams()
  const navigate = useNavigate()
  const [workspace, setWorkspace] = useState<WorkspaceAccess | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    getAuthMe()
      .then((result) => {
        if (!active) return
        const match = result.workspaces.find(
          (item) => item.slug === workspaceSlug,
        )
        if (!match) {
          setError('当前账号无权访问该工作区。')
          return
        }
        setWorkspace(match)
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(
          reason instanceof ApiError && reason.status === 401
            ? '登录状态已失效，请通过零信任网关重新登录。'
            : '工作区加载失败，请稍后重试。',
        )
      })
    return () => {
      active = false
    }
  }, [workspaceSlug])

  if (!workspace && !error) {
    return <CreateAgentPageSkeleton />
  }

  return (
    <div className="agent-workspace-page max-w-[1160px]">
      <button
        type="button"
        onClick={() => window.history.back()}
        className="mb-6 inline-flex items-center gap-2 text-xs font-semibold text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]"
      >
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        返回
      </button>

      <AgentPageHeader
        eyebrow="新建 Agent"
        title="创建专属 Agent"
        description="先填写基础信息。配置提示词、工具、技能和渠道期间，Agent 会保持为私有草稿。"
      />

      {error ? (
        <div role="alert" className="agent-panel p-6 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {workspace ? (
        <AgentCreateForm
          workspaceId={workspace.workspaceId}
          onCreated={(agent) =>
            navigate({
              to: '/w/$workspaceSlug/agents/$agentId/basic',
              params: { workspaceSlug, agentId: agent.id },
            })
          }
          onCancel={() => navigate({ to: '/' })}
        />
      ) : null}
    </div>
  )
}
