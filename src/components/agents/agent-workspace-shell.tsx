import { Link } from '@tanstack/react-router'
import {
  BookOpenText,
  Boxes,
  CheckCircle2,
  ChevronRight,
  MessageCircle,
  MessageSquareText,
  Rocket,
  Settings2,
  Sparkles,
} from 'lucide-react'

import { hasAgentSectionChanges } from '#/lib/agents/agent-change'
import type { AgentChangeStatus } from '#/lib/agents/agent-change'
import {
  agentSectionHref,
  agentSectionsForMode,
} from '#/lib/agents/agent-sections'
import type {
  AgentSectionId,
  AgentWorkspaceMode,
} from '#/lib/agents/agent-sections'
import { cn } from '#/lib/utils'

const sectionIcons = {
  basic: Settings2,
  prompt: BookOpenText,
  tools: Boxes,
  skills: Sparkles,
  channels: MessageSquareText,
  publish: Rocket,
  chat: MessageCircle,
} satisfies Record<AgentSectionId, typeof Settings2>

export function AgentWorkspaceShell({
  workspaceSlug,
  workspaceName,
  agentId,
  agentName,
  modelLabel,
  activeSection,
  isPublished,
  toolCount,
  skillCount,
  channelLabel,
  mode,
  changeStatus,
  changeStatusLoading,
  children,
}: {
  workspaceSlug: string
  workspaceName: string
  agentId: string
  agentName: string
  modelLabel: string
  activeSection: AgentSectionId
  isPublished: boolean
  toolCount: number
  skillCount: number
  channelLabel: string
  mode: AgentWorkspaceMode
  changeStatus: AgentChangeStatus
  changeStatusLoading: boolean
  children: React.ReactNode
}) {
  const monogram = agentName.trim().slice(0, 2).toUpperCase()
  const isView = mode === 'view'
  const visibleSections = agentSectionsForMode(mode)

  return (
    <div className="agent-workspace-page">
      <div className="mb-5 flex items-center gap-2 text-xs text-[var(--sea-ink-soft)]">
        <Link className="hover:text-[var(--sea-ink)]" to="/">
          工作区
        </Link>
        <ChevronRight aria-hidden="true" className="size-3" />
        <span>{workspaceName}</span>
        <ChevronRight aria-hidden="true" className="size-3" />
        <span className="text-[var(--sea-ink)]">{agentName}</span>
      </div>

      <div className="agent-workspace-grid">
        <aside className="agent-rail">
          <div className="flex items-start gap-3">
            <div className="display-title grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--sea-ink)] text-sm font-semibold text-white shadow-sm">
              {monogram}
            </div>
            <div className="min-w-0">
              <p className="display-title text-lg leading-tight font-semibold text-[var(--sea-ink)]">
                {agentName}
              </p>
              <span className="mt-2 inline-flex rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2 py-0.5 font-mono text-[9px] tracking-[0.12em] uppercase">
                {isPublished ? '已发布' : '草稿'}
              </span>
            </div>
          </div>

          <div className="my-5 h-px bg-[var(--line)]" />

          <p className="agent-rail-label">模型</p>
          <p
            className="truncate font-mono text-xs text-[var(--sea-ink-soft)]"
            title={modelLabel}
          >
            {modelLabel}
          </p>

          <nav
            aria-label={isView ? 'Agent 查看导航' : 'Agent 编辑导航'}
            className="mt-6"
          >
            <ol className="space-y-1">
              {visibleSections.map((section) => {
                const Icon = sectionIcons[section.id]
                const active = section.id === activeSection
                const changed =
                  !isView &&
                  !changeStatusLoading &&
                  hasAgentSectionChanges(section.id, changeStatus)
                return (
                  <li key={section.id}>
                    <a
                      href={agentSectionHref(
                        workspaceSlug,
                        agentId,
                        section.id,
                        mode,
                      )}
                      aria-current={active ? 'page' : undefined}
                      className="agent-nav-link"
                      data-active={active || undefined}
                    >
                      <Icon aria-hidden="true" className="size-4" />
                      <span>{section.label}</span>
                      {changed ? (
                        <span
                          aria-label={`${section.label}有未发布变更`}
                          title="有未发布变更"
                          className="ml-auto flex size-4 items-center justify-center"
                        >
                          <span className="size-1.5 rounded-full bg-amber-500" />
                        </span>
                      ) : null}
                    </a>
                  </li>
                )
              })}
            </ol>
          </nav>
        </aside>

        <main className="min-w-0">{children}</main>

        <aside className="agent-status-rail">
          <p className="agent-rail-label">
            {isView ? '当前发布版本' : '配置状态'}
          </p>
          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm font-semibold text-[var(--sea-ink)]">
              {isPublished ? '已发布' : '草稿编辑中'}
            </span>
            {isPublished ? (
              <CheckCircle2
                aria-label="已发布"
                className="size-4 text-[var(--palm)]"
              />
            ) : null}
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
            <div
              className="h-full rounded-full bg-[var(--lagoon)] transition-[width] duration-200"
              style={{ width: isPublished ? '100%' : '42%' }}
            />
          </div>
          {!isView ? (
            <p
              className={cn(
                'mt-3 text-xs font-semibold',
                changeStatus.hasChanges
                  ? 'text-amber-700'
                  : 'text-[var(--sea-ink-soft)]',
              )}
            >
              {changeStatusLoading
                ? '正在检查配置变更…'
                : changeStatus.hasChanges
                  ? `${changeStatus.changedModules.length} 个模块有未发布变更`
                  : '当前草稿与发布版本一致'}
            </p>
          ) : null}

          <dl className="mt-6 space-y-4 text-sm">
            <div>
              <dt className="agent-rail-label">工具</dt>
              <dd className="mt-1 text-[var(--sea-ink-soft)]">
                {toolCount > 0 ? `${toolCount} 个已启用` : '尚未配置'}
              </dd>
            </div>
            <div>
              <dt className="agent-rail-label">技能</dt>
              <dd className="mt-1 text-[var(--sea-ink-soft)]">
                {skillCount > 0 ? `${skillCount} 个已启用` : '尚未配置'}
              </dd>
            </div>
            <div>
              <dt className="agent-rail-label">渠道</dt>
              <dd className="mt-1 text-[var(--sea-ink-soft)]">
                {channelLabel}
              </dd>
            </div>
          </dl>

          <div className="mt-7 border-t border-[var(--line)] pt-5">
            <p className="text-xs leading-5 text-[var(--sea-ink-soft)]">
              {isView
                ? '当前页面展示已发布的不可变配置；对话会固定使用该版本。'
                : changeStatusLoading
                  ? '正在比对当前草稿与发布版本的 MD5 指纹。'
                  : changeStatus.hasChanges
                    ? '侧栏圆点标记了有变更的模块；检查与发布页面可生成新版本。'
                    : '修改任一模块并保存后，才能发布新版本。'}
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
