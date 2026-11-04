import { CircleAlert, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { AgentFormSkeleton } from '#/components/loading/page-skeletons'
import { Button } from '#/components/ui/button'
import { createNextVersionRequest } from '#/lib/api/platform-client'
import type { AgentRecord } from '#/lib/api/platform-client'

export function AgentEditDraftGate({
  enabled,
  canEdit,
  workspaceId,
  agent,
  refreshAgent,
  children,
}: {
  enabled: boolean
  canEdit: boolean
  workspaceId: string
  agent: AgentRecord
  refreshAgent: () => Promise<void>
  children: React.ReactNode
}) {
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const pendingRequest = useRef<Promise<void> | null>(null)
  const hasDraft = agent.versions.some((version) => version.status === 'draft')
  const requiresDraft =
    enabled && Boolean(agent.currentPublishedVersionId) && !hasDraft

  useEffect(() => {
    if (!requiresDraft || !canEdit) return

    let active = true
    setError(null)
    if (!pendingRequest.current) {
      pendingRequest.current = createNextVersionRequest(workspaceId, agent.id)
        .then(() => refreshAgent())
        .finally(() => {
          pendingRequest.current = null
        })
    }
    pendingRequest.current.catch(() => {
      if (active) setError('无法自动准备编辑草稿，请稍后重试。')
    })

    return () => {
      active = false
    }
  }, [agent.id, attempt, canEdit, refreshAgent, requiresDraft, workspaceId])

  if (!requiresDraft) return children

  if (!canEdit) {
    return (
      <div role="alert" className="agent-panel p-6 text-sm text-destructive">
        当前账号没有编辑该 Agent 的权限。
      </div>
    )
  }

  if (error) {
    return (
      <div
        role="alert"
        className="agent-panel flex min-h-52 flex-col items-center justify-center px-6 py-10 text-center"
      >
        <CircleAlert aria-hidden="true" className="size-5 text-destructive" />
        <p className="mt-3 text-sm font-semibold">无法自动准备编辑草稿</p>
        <p className="mt-1 text-xs text-[var(--sea-ink-soft)]">{error}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => {
            setError(null)
            setAttempt((current) => current + 1)
          }}
        >
          <RefreshCw aria-hidden="true" />
          重试
        </Button>
      </div>
    )
  }

  return <AgentFormSkeleton variant="prompt" />
}
