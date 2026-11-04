import { createFileRoute } from '@tanstack/react-router'

import { AgentBasicForm } from '#/components/agents/agent-basic-form'
import { AgentPageHeader } from '#/components/agents/agent-page-header'
import { useAgentWorkspace } from '#/components/agents/agent-workspace-context'

export const Route = createFileRoute('/w/$workspaceSlug/agents/$agentId/basic')(
  {
    component: BasicPage,
  },
)

function BasicPage() {
  const { agent, workspace, mode, refreshAgent } = useAgentWorkspace()
  const readOnly = mode === 'view'
  const metadata = [
    ['工作区', workspace.name],
    ['Agent ID', agent.id],
    [
      '状态',
      agent.status === 'draft'
        ? '草稿'
        : agent.status === 'active'
          ? '已启用'
          : '已停用',
    ],
  ]

  return (
    <section>
      <AgentPageHeader
        eyebrow="01 · 基本信息"
        title={readOnly ? '身份与访问范围' : '编辑 Agent 身份'}
        description={
          readOnly
            ? '查看已发布 Agent 的身份、描述和访问范围。'
            : '修改名称、描述和可见范围，保存后会标记为当前草稿的未发布变更。'
        }
      />
      {readOnly ? (
        <dl className="agent-panel overflow-hidden">
          {[
            ['Agent 名称', agent.name],
            ['描述', agent.description || '尚未填写描述'],
            [
              '可见范围',
              agent.visibility === 'workspace' ? '工作区可见' : '指定成员',
            ],
            ...metadata,
          ].map(([label, value]) => (
            <div
              key={label}
              className="grid gap-1 border-b border-[var(--line)] px-6 py-5 last:border-b-0 sm:grid-cols-[180px_1fr]"
            >
              <dt className="text-xs font-bold tracking-[0.1em] text-[var(--kicker)] uppercase">
                {label}
              </dt>
              <dd
                className={
                  ['Agent ID', '状态'].includes(label)
                    ? 'font-mono text-sm text-[var(--sea-ink-soft)]'
                    : 'text-sm text-[var(--sea-ink)]'
                }
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="grid gap-5">
          <AgentBasicForm
            workspaceId={workspace.workspaceId}
            agentId={agent.id}
            initialName={agent.name}
            initialDescription={agent.description}
            initialVisibility={agent.visibility}
            canManageAccess={
              workspace.role === 'workspace_admin' ||
              workspace.role === 'platform_admin'
            }
            onSaved={refreshAgent}
          />
          <dl className="agent-panel overflow-hidden">
            {metadata.map(([label, value]) => (
              <div
                key={label}
                className="grid gap-1 border-b border-[var(--line)] px-6 py-5 last:border-b-0 sm:grid-cols-[180px_1fr]"
              >
                <dt className="text-xs font-bold tracking-[0.1em] text-[var(--kicker)] uppercase">
                  {label}
                </dt>
                <dd
                  className={
                    ['Agent ID', '状态'].includes(label)
                      ? 'font-mono text-sm text-[var(--sea-ink-soft)]'
                      : 'text-sm text-[var(--sea-ink)]'
                  }
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  )
}
