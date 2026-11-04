import { createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'

import { AgentPageHeader } from '#/components/agents/agent-page-header'
import { ProviderPageSkeleton } from '#/components/loading/page-skeletons'
import { ProviderManagement } from '#/components/providers/provider-management'
import { getAuthMe } from '#/lib/api/platform-client'
import type { WorkspaceAccess } from '#/lib/api/platform-client'

export const Route = createFileRoute('/w/$workspaceSlug/providers')({
  component: ProvidersPage,
})

function ProvidersPage() {
  const { workspaceSlug } = Route.useParams()
  const [workspace, setWorkspace] = useState<WorkspaceAccess | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    getAuthMe()
      .then((auth) => {
        if (!active) return
        const match = auth.workspaces.find(
          (candidate) => candidate.slug === workspaceSlug,
        )
        if (!match) {
          setError('当前账号无权访问该工作区。')
          return
        }
        if (
          match.role !== 'platform_admin' &&
          match.role !== 'workspace_admin'
        ) {
          setError('只有工作区管理员可以管理 AI 供应商。')
          return
        }
        setWorkspace(match)
      })
      .catch(() => {
        if (active) setError('工作区加载失败，请稍后重试。')
      })
    return () => {
      active = false
    }
  }, [workspaceSlug])

  if (!workspace && !error) {
    return <ProviderPageSkeleton />
  }

  return (
    <main className="agent-workspace-page max-w-[1180px]">
      <a
        href="/"
        className="mb-6 inline-flex items-center gap-2 text-xs font-semibold text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]"
      >
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        返回工作区
      </a>

      <AgentPageHeader
        eyebrow="Workspace settings"
        title="AI 供应商"
        description="管理 OpenAI 兼容模型服务的 Base URL、加密 Token 和可用状态。多个供应商的模型会统一出现在 Agent 模型选择中。"
      />

      {error ? (
        <div
          role="alert"
          className="agent-panel flex min-h-48 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-destructive"
        >
          <ShieldAlert aria-hidden="true" className="size-6" />
          {error}
        </div>
      ) : null}

      {workspace ? (
        <ProviderManagement workspaceId={workspace.workspaceId} />
      ) : null}
    </main>
  )
}
