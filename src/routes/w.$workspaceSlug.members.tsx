import { createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'

import { AgentPageHeader } from '#/components/agents/agent-page-header'
import { ProviderPageSkeleton } from '#/components/loading/page-skeletons'
import { WorkspaceMembers } from '#/components/workspace/workspace-members'
import { getAuthMe } from '#/lib/api/platform-client'
import type { WorkspaceAccess } from '#/lib/api/platform-client'

export const Route = createFileRoute('/w/$workspaceSlug/members')({
  component: WorkspaceMembersPage,
})

function WorkspaceMembersPage() {
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
          setError('只有工作区管理员可以管理成员。')
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
        eyebrow="Workspace access"
        title="成员与角色"
        description="管理工作区成员，并设置其平台角色。普通使用者可被指定访问受限 Agent。"
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
        <div className="mt-8">
          <WorkspaceMembers workspaceId={workspace.workspaceId} />
        </div>
      ) : null}
    </main>
  )
}
