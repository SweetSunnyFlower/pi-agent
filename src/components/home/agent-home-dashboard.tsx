import {
  ArrowRight,
  Bot,
  Boxes,
  CheckCircle2,
  CircleDashed,
  FolderKanban,
  Globe2,
  MessageCircle,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  AgentCardGridSkeleton,
  HomePageSkeleton,
} from '#/components/loading/page-skeletons'
import { Button } from '#/components/ui/button'
import {
  ApiError,
  getAuthMe,
  listAgentsRequest,
} from '#/lib/api/platform-client'
import type { AgentRecord, AuthMeResponse } from '#/lib/api/platform-client'
import { capabilityCounts, channelLabel } from '#/lib/agents/agent-manifest'
import { agentSectionHref } from '#/lib/agents/agent-sections'

type LoadState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; agents: AgentRecord[] }
  | { state: 'error'; message: string }

function modelLabel(agent: AgentRecord): string {
  if (agent.versions.length === 0) return '模型待配置'
  const published = agent.versions.find(
    (version) => version.id === agent.currentPublishedVersionId,
  )
  const draft =
    agent.versions.find((version) => version.status === 'draft') ??
    agent.versions[0]
  const version = published ?? draft
  return version.modelId || '模型待配置'
}

function workspaceHref(workspaceSlug: string, path: string): string {
  return `/w/${encodeURIComponent(workspaceSlug)}/${path}`
}

function AgentCard({
  workspaceSlug,
  agent,
}: {
  workspaceSlug: string
  agent: AgentRecord
}) {
  const published = Boolean(agent.currentPublishedVersionId)
  const counts = capabilityCounts(
    agent.versions.find(
      (version) => version.id === agent.currentPublishedVersionId,
    )?.manifestJson ??
      agent.versions.find((version) => version.status === 'draft')
        ?.manifestJson,
  )
  const channels = channelLabel(agent.enabledChannels ?? ['web'])
  const monogram = agent.name.trim().slice(0, 2).toUpperCase()
  const primaryHref = published
    ? agentSectionHref(workspaceSlug, agent.id, 'chat', 'view')
    : agentSectionHref(workspaceSlug, agent.id, 'basic', 'edit')
  const editHref = agentSectionHref(workspaceSlug, agent.id, 'basic', 'edit')

  return (
    <article
      className="agent-home-card"
      data-published={published || undefined}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="agent-home-monogram">{monogram}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-bold tracking-[-0.02em] text-[var(--sea-ink)]">
                {agent.name}
              </h3>
              <span
                className="agent-home-status"
                data-status={published ? 'published' : 'draft'}
              >
                {published ? '已发布' : '草稿'}
              </span>
            </div>
            <p className="mt-2 line-clamp-2 min-h-10 text-xs leading-5 text-[var(--sea-ink-soft)]">
              {agent.description || '尚未填写 Agent 简介。'}
            </p>
          </div>
        </div>
      </div>

      <dl className="agent-home-card-meta">
        <div>
          <dt>模型</dt>
          <dd title={modelLabel(agent)}>{modelLabel(agent)}</dd>
        </div>
        <div>
          <dt>渠道</dt>
          <dd>{channels}</dd>
        </div>
        <div>
          <dt>能力</dt>
          <dd>
            {counts.tools} 工具 · {counts.skills} 技能
          </dd>
        </div>
      </dl>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[var(--sea-ink-soft)]">
          {published ? (
            <ShieldCheck aria-hidden="true" className="size-3.5" />
          ) : (
            <CircleDashed aria-hidden="true" className="size-3.5" />
          )}
          {published ? '固定发布版本' : '尚未对外提供'}
        </span>
        <div className="flex items-center gap-2">
          {published ? (
            <a
              href={editHref}
              className="agent-home-icon-link"
              aria-label={`配置 ${agent.name}`}
            >
              <Settings2 aria-hidden="true" className="size-3.5" />
            </a>
          ) : null}
          <a className="agent-home-card-action" href={primaryHref}>
            {published ? (
              <MessageCircle aria-hidden="true" className="size-3.5" />
            ) : (
              <ArrowRight aria-hidden="true" className="size-3.5" />
            )}
            {published ? '开始对话' : '继续配置'}
          </a>
        </div>
      </div>
    </article>
  )
}

function AgentGrid({
  workspaceSlug,
  agents,
}: {
  workspaceSlug: string
  agents: AgentRecord[]
}) {
  return (
    <div className="agent-home-grid">
      {agents.map((agent) => (
        <AgentCard key={agent.id} workspaceSlug={workspaceSlug} agent={agent} />
      ))}
    </div>
  )
}

function LoadingCards() {
  return <AgentCardGridSkeleton />
}

export function AgentHomeDashboard() {
  const [auth, setAuth] = useState<AuthMeResponse | null>(null)
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    null,
  )
  const [loadState, setLoadState] = useState<LoadState>({ state: 'idle' })
  const [authError, setAuthError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let active = true
    getAuthMe()
      .then((result) => {
        if (!active) return
        setAuth(result)
        setActiveWorkspaceId(result.workspaces[0]?.workspaceId ?? null)
      })
      .catch((error: unknown) => {
        if (!active) return
        setAuthError(
          error instanceof ApiError && error.status === 401
            ? '登录状态已失效，请通过零信任网关重新登录。'
            : '工作区加载失败，请稍后重试。',
        )
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!activeWorkspaceId) return
    let active = true
    setLoadState({ state: 'loading' })
    listAgentsRequest(activeWorkspaceId)
      .then((agents) => {
        if (active) setLoadState({ state: 'ready', agents })
      })
      .catch(() => {
        if (active) {
          setLoadState({
            state: 'error',
            message: 'Agent 列表加载失败，请稍后重试。',
          })
        }
      })
    return () => {
      active = false
    }
  }, [activeWorkspaceId, reloadToken])

  const workspace =
    auth?.workspaces.find((item) => item.workspaceId === activeWorkspaceId) ??
    auth?.workspaces[0]
  const agents = loadState.state === 'ready' ? loadState.agents : []
  const publishedAgents = agents.filter(
    (agent) => agent.currentPublishedVersionId,
  )
  const draftAgents = agents.filter((agent) => !agent.currentPublishedVersionId)
  const initials = (auth?.user.name || auth?.user.username || 'Pi')
    .trim()
    .slice(0, 2)
    .toUpperCase()

  if (!auth && !authError) {
    return <HomePageSkeleton />
  }

  return (
    <main className="agent-home">
      <header className="agent-home-topbar">
        <a href="/" className="agent-home-brand">
          <span className="agent-home-brand-mark">π</span>
          <span>
            <strong>Pi Agent</strong>
            <small>团队 Agent 平台</small>
          </span>
        </a>
        <div className="agent-home-identity">
          <span className="agent-home-avatar">{initials}</span>
          <span className="hidden sm:block">
            <strong>
              {auth?.user.name || auth?.user.username || '正在登录'}
            </strong>
            <small>
              {auth?.authMode === 'gateway' ? '零信任登录' : '本地开发身份'}
            </small>
          </span>
        </div>
      </header>

      <section className="agent-home-hero">
        <div className="agent-home-hero-copy">
          <p className="agent-home-kicker">
            <span />
            Agent Operating Layer
          </p>
          <h1>
            把团队的「怎么做」
            <br />
            交给 Agent 去执行。
          </h1>
          <p>
            为不同团队创建专属 Agent。提示词、工具、技能与渠道统一配置，
            消息先持久化，再稳定地响应每一次对话。
          </p>
          {workspace ? (
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button size="lg" asChild>
                <a href={workspaceHref(workspace.slug, 'agents/new')}>
                  <Plus aria-hidden="true" />
                  创建 Agent
                </a>
              </Button>
              {publishedAgents[0] ? (
                <a
                  className="agent-home-secondary-action"
                  href={agentSectionHref(
                    workspace.slug,
                    publishedAgents[0].id,
                    'chat',
                    'view',
                  )}
                >
                  与 {publishedAgents[0].name} 对话
                  <ArrowRight aria-hidden="true" />
                </a>
              ) : null}
            </div>
          ) : null}
        </div>

        <aside className="agent-home-principles">
          <div className="agent-home-orbit" aria-hidden="true">
            <span />
            <span />
            <Bot />
          </div>
          <p className="agent-rail-label">运行原则</p>
          <h2>先落库，再响应</h2>
          <p>
            Web 与如流共享同一套 Pi Durable 运行时。渠道只负责入参与最终响应，
            对话和提交状态始终保存在数据库。
          </p>
          <dl>
            <div>
              <dt>可用 Agent</dt>
              <dd>
                {loadState.state === 'ready' ? publishedAgents.length : '—'}
              </dd>
            </div>
            <div>
              <dt>配置中</dt>
              <dd>{loadState.state === 'ready' ? draftAgents.length : '—'}</dd>
            </div>
            <div>
              <dt>渠道</dt>
              <dd>Web + 如流</dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="agent-home-workspace">
        <div className="agent-home-workspace-heading">
          <div>
            <p className="agent-rail-label">工作空间</p>
            <h2>{workspace?.name || '正在加载工作区'}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {workspace &&
            (workspace.role === 'platform_admin' ||
              workspace.role === 'workspace_admin') ? (
              <>
                <a
                  href={workspaceHref(workspace.slug, 'members')}
                  className="agent-home-provider-link"
                >
                  <UserRound aria-hidden="true" />
                  成员
                </a>
                <a
                  href={workspaceHref(workspace.slug, 'providers')}
                  className="agent-home-provider-link"
                >
                  <Settings2 aria-hidden="true" />
                  供应商
                </a>
              </>
            ) : null}
            {auth && auth.workspaces.length > 1 ? (
              <nav
                aria-label="切换工作区"
                className="agent-home-workspace-tabs"
              >
                {auth.workspaces.map((item) => (
                  <button
                    key={item.workspaceId}
                    type="button"
                    data-active={
                      item.workspaceId === activeWorkspaceId || undefined
                    }
                    onClick={() => setActiveWorkspaceId(item.workspaceId)}
                  >
                    {item.name}
                  </button>
                ))}
              </nav>
            ) : null}
          </div>
        </div>

        {authError ? (
          <div role="alert" className="agent-home-error">
            <ShieldCheck aria-hidden="true" />
            <span>{authError}</span>
          </div>
        ) : null}

        {auth && auth.workspaces.length === 0 ? (
          <div role="alert" className="agent-home-error">
            <ShieldCheck aria-hidden="true" />
            <span>当前账号尚未加入任何工作区，请联系平台管理员。</span>
          </div>
        ) : null}

        {!authError && !auth ? <LoadingCards /> : null}

        {!authError &&
        auth &&
        auth.workspaces.length > 0 &&
        loadState.state === 'loading' ? (
          <LoadingCards />
        ) : null}

        {loadState.state === 'error' ? (
          <div role="alert" className="agent-home-error">
            <CircleDashed aria-hidden="true" />
            <span>{loadState.message}</span>
            <button
              type="button"
              onClick={() => setReloadToken((current) => current + 1)}
            >
              重试
            </button>
          </div>
        ) : null}

        {loadState.state === 'ready' ? (
          <div className="mt-8 space-y-10">
            <section aria-labelledby="published-agents">
              <div className="agent-home-section-heading">
                <div>
                  <p className="agent-rail-label">Ready to use</p>
                  <h2 id="published-agents">可用 Agent</h2>
                </div>
                <span>
                  <CheckCircle2 aria-hidden="true" />
                  {publishedAgents.length} 个已发布
                </span>
              </div>
              {publishedAgents.length > 0 && workspace ? (
                <AgentGrid
                  workspaceSlug={workspace.slug}
                  agents={publishedAgents}
                />
              ) : (
                <div className="agent-home-empty">
                  <span>
                    <Sparkles aria-hidden="true" />
                  </span>
                  <div>
                    <h3>还没有可用的 Agent</h3>
                    <p>创建并发布第一个 Agent 后，它会出现在这里。</p>
                  </div>
                  {workspace ? (
                    <a href={workspaceHref(workspace.slug, 'agents/new')}>
                      开始创建
                      <ArrowRight aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
              )}
            </section>

            {draftAgents.length > 0 && workspace ? (
              <section aria-labelledby="draft-agents">
                <div className="agent-home-section-heading">
                  <div>
                    <p className="agent-rail-label">In progress</p>
                    <h2 id="draft-agents">配置中的 Agent</h2>
                  </div>
                  <span>
                    <FolderKanban aria-hidden="true" />
                    {draftAgents.length} 个草稿
                  </span>
                </div>
                <AgentGrid
                  workspaceSlug={workspace.slug}
                  agents={draftAgents}
                />
              </section>
            ) : null}
          </div>
        ) : null}
      </section>

      <footer className="agent-home-footer">
        <span>
          <Boxes aria-hidden="true" />
          Pi Durable Runtime
        </span>
        <span>
          <Globe2 aria-hidden="true" />
          HTTP + SSE + WebSocket
        </span>
        <span>
          <UserRound aria-hidden="true" />
          {auth?.user.username ?? '安全登录'}
        </span>
      </footer>
    </main>
  )
}
