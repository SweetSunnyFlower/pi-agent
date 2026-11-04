import {
  Check,
  CheckCircle2,
  CircleAlert,
  FileText,
  LoaderCircle,
  MessageCircle,
  MessageSquareText,
  Rocket,
  Sparkles,
  Wrench,
} from 'lucide-react'
import { useState } from 'react'

import { Button } from '#/components/ui/button'
import { publishAgentRequest } from '#/lib/api/platform-client'
import type { PublishReadiness } from '#/lib/api/platform-client'
import { agentSectionHref } from '#/lib/agents/agent-sections'

export function AgentPublishPanel({
  workspaceId,
  workspaceSlug,
  agentId,
  readiness,
  onChanged,
}: {
  workspaceId: string
  workspaceSlug: string
  agentId: string
  readiness: PublishReadiness
  onChanged: () => void | Promise<void>
}) {
  const [publishing, setPublishing] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const summary = readiness.summary

  async function publish() {
    setPublishing(true)
    setError(null)
    setSuccess(null)
    try {
      const version = await publishAgentRequest(workspaceId, agentId)
      setSuccess(`版本 v${version.versionNumber} 已发布`)
      await onChanged()
    } catch {
      setError('发布失败，请重新检查阻塞项后重试。')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="grid gap-5">
      <section className="agent-panel p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">发布检查</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--sea-ink-soft)]">
              所有阻塞项通过后，才能生成不可变发布版本。
            </p>
          </div>
          <span className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2.5 py-1 font-mono text-[9px] text-[var(--kicker)]">
            {readiness.checks.filter((check) => check.passed).length}/
            {readiness.checks.length} 通过
          </span>
        </div>

        <ul className="mt-5 grid gap-2">
          {readiness.checks.map((check) => (
            <li
              key={check.id}
              className="flex items-start gap-3 rounded-xl border border-[var(--line)] bg-white/30 px-4 py-3"
            >
              {check.passed ? (
                <CheckCircle2
                  aria-label="通过"
                  className="mt-0.5 size-4 shrink-0 text-[var(--palm)]"
                />
              ) : (
                <CircleAlert
                  aria-label="未通过"
                  className="mt-0.5 size-4 shrink-0 text-destructive"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold">{check.label}</p>
                <p className="mt-0.5 text-[10px] leading-4 text-[var(--sea-ink-soft)]">
                  {check.detail}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="agent-panel p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">版本摘要</h2>
            <p className="mt-1 text-xs text-[var(--sea-ink-soft)]">
              v{summary.versionNumber} · {summary.name}
            </p>
          </div>
          <Rocket
            aria-hidden="true"
            className="size-5 text-[var(--lagoon-deep)]"
          />
        </div>

        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <dt className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--kicker)] uppercase">
              <FileText aria-hidden="true" className="size-3" />
              提示词摘要
            </dt>
            <dd className="mt-1.5 rounded-xl border border-[var(--line)] bg-white/30 px-4 py-3 text-xs leading-5">
              {summary.promptExcerpt || '尚未填写提示词'}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-[var(--sea-ink-soft)]">模型</dt>
            <dd className="mt-1 font-mono text-xs">
              {summary.modelProvider && summary.modelId
                ? summary.modelId
                : '未配置'}
            </dd>
            <dd className="mt-1 text-[10px] text-[var(--sea-ink-soft)]">
              思考等级：{summary.thinkingLevel}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-[var(--sea-ink-soft)]">渠道</dt>
            <dd className="mt-1 flex items-center gap-1.5 text-xs">
              <MessageSquareText
                aria-hidden="true"
                className="size-3.5 text-[var(--lagoon-deep)]"
              />
              {summary.channels.join(' + ')}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-[var(--sea-ink-soft)]">工具</dt>
            <dd className="mt-1 flex items-center gap-1.5 text-xs">
              <Wrench aria-hidden="true" className="size-3.5" />
              {summary.tools} 个
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-[var(--sea-ink-soft)]">技能</dt>
            <dd className="mt-1 flex items-center gap-1.5 text-xs">
              <Sparkles aria-hidden="true" className="size-3.5" />
              {summary.skills} 个
            </dd>
          </div>
        </dl>
      </section>

      {success ? (
        <p
          role="status"
          className="flex items-center gap-1.5 text-sm font-semibold text-[var(--palm)]"
        >
          <Check aria-hidden="true" className="size-4" />
          {success}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {readiness.state === 'published' ? (
          <p className="text-xs text-[var(--sea-ink-soft)]">
            编辑草稿会自动准备，无需手动创建。
          </p>
        ) : !readiness.hasChanges ? (
          <p className="text-xs text-[var(--sea-ink-soft)]">
            暂无待发布变更。修改任一配置并保存后，才会启用发布。
          </p>
        ) : (
          <Button
            type="button"
            disabled={!readiness.ready || publishing}
            onClick={publish}
          >
            {publishing ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <Rocket aria-hidden="true" />
            )}
            {publishing ? '发布中…' : '发布版本'}
          </Button>
        )}
        <Button type="button" variant="outline" asChild>
          <a href={agentSectionHref(workspaceSlug, agentId, 'chat', 'view')}>
            <MessageCircle aria-hidden="true" />
            去对话
          </a>
        </Button>
      </div>
    </div>
  )
}
