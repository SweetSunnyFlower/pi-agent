import { createFileRoute } from '@tanstack/react-router'
import { LockKeyhole } from 'lucide-react'

import { AgentChatPanel } from '#/components/agents/agent-chat-panel'
import { AgentPageHeader } from '#/components/agents/agent-page-header'
import { useAgentWorkspace } from '#/components/agents/agent-workspace-context'

export const Route = createFileRoute('/w/$workspaceSlug/agents/$agentId/chat')({
  component: ChatPage,
})

function ChatPage() {
  const { workspace, agent } = useAgentWorkspace()
  const published = Boolean(agent.currentPublishedVersionId)
  const publishedVersion = agent.versions.find(
    (version) => version.id === agent.currentPublishedVersionId,
  )

  return (
    <section>
      <AgentPageHeader
        eyebrow="06 · 对话"
        title={`与 ${agent.name} 对话`}
        description=""
      />
      {published ? (
        <AgentChatPanel
          workspaceId={workspace.workspaceId}
          agentId={agent.id}
          agentName={agent.name}
          versionId={publishedVersion?.id}
          defaultProvider={publishedVersion?.modelProvider}
          defaultModelId={publishedVersion?.modelId}
        />
      ) : (
        <div className="agent-panel flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
          <span className="grid size-12 place-items-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--lagoon-deep)]">
            <LockKeyhole aria-hidden="true" className="size-5" />
          </span>
          <h2 className="mt-4 text-sm font-semibold">Agent 尚未发布</h2>
          <p className="mt-2 max-w-md text-xs leading-5 text-[var(--sea-ink-soft)]">
            完成配置并发布一个不可变版本后，才能开始持久化对话。
          </p>
        </div>
      )}
    </section>
  )
}
