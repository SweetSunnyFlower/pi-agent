import { ArrowRight, Check, Eye, Users } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Textarea } from '#/components/ui/textarea'
import { createAgentRequest } from '#/lib/api/platform-client'
import type { CreateAgentResponse } from '#/lib/api/platform-client'
import { cn } from '#/lib/utils'

export function AgentCreateForm({
  workspaceId,
  onCreated,
  onCancel,
}: {
  workspaceId: string
  onCreated: (agent: CreateAgentResponse) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<'workspace' | 'restricted'>(
    'workspace',
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim()) {
      setNameError('请输入 Agent 名称。')
      return
    }

    setNameError(null)
    setError(null)
    setSubmitting(true)
    try {
      const created = await createAgentRequest(workspaceId, {
        name: name.trim(),
        description: description.trim(),
        visibility,
      })
      onCreated(created)
    } catch {
      setError('Agent 创建失败，请检查访问权限后重试。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]"
    >
      <div className="agent-panel p-6 sm:p-8">
        <div className="grid gap-6">
          <div className="grid gap-2">
            <label htmlFor="agent-name" className="text-sm font-semibold">
              Agent 名称
            </label>
            <Input
              id="agent-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                if (nameError) setNameError(null)
              }}
              maxLength={120}
              placeholder="例如：产品评审助手"
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? 'agent-name-error' : undefined}
            />
            {nameError ? (
              <p id="agent-name-error" className="text-xs text-destructive">
                {nameError}
              </p>
            ) : (
              <p className="text-xs text-[var(--sea-ink-soft)]">
                使用一个团队容易识别的名称。
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <label
              htmlFor="agent-description"
              className="text-sm font-semibold"
            >
              描述
            </label>
            <Textarea
              id="agent-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
              rows={4}
              placeholder="说明这个 Agent 可以帮助团队完成什么。"
            />
            <p className="text-right font-mono text-[10px] text-[var(--sea-ink-soft)]">
              {description.length}/500
            </p>
          </div>

          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-semibold">可见范围</legend>
            {[
              {
                id: 'workspace' as const,
                label: '工作区可见',
                copy: '工作区所有成员都可以使用已发布的 Agent。',
                icon: Users,
              },
              {
                id: 'restricted' as const,
                label: '指定成员',
                copy: '仅创建者、管理员和明确授权的成员可以使用。',
                icon: Eye,
              },
            ].map((option) => {
              const Icon = option.icon
              const selected = visibility === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setVisibility(option.id)}
                  aria-pressed={selected}
                  className={cn(
                    'flex w-full items-start gap-4 rounded-xl border p-4 text-left transition-colors',
                    selected
                      ? 'border-[var(--lagoon-deep)] bg-[color-mix(in_oklab,var(--lagoon)_12%,white_88%)]'
                      : 'border-[var(--line)] bg-white/45 hover:bg-white/70',
                  )}
                >
                  <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border border-[var(--chip-line)] bg-[var(--chip-bg)]">
                    <Icon aria-hidden="true" className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      {option.label}
                      {selected ? (
                        <Check
                          aria-label="已选择"
                          className="size-4 text-[var(--palm)]"
                        />
                      ) : null}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-[var(--sea-ink-soft)]">
                      {option.copy}
                    </span>
                  </span>
                </button>
              )
            })}
          </fieldset>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-3 border-t border-[var(--line)] pt-6 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={onCancel}
            >
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? '正在创建…' : '创建草稿'}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <aside className="agent-panel h-fit p-6">
        <p className="agent-rail-label">创建后</p>
        <ol className="mt-5 space-y-5">
          {[
            ['配置提示词', '选择模型并定义 Agent 的工作方式。'],
            ['添加能力', '从已审核的目录中选择工具和技能。'],
            ['连接渠道', '启用 Web，或配置独立的如流机器人。'],
            ['发布', '发布后将为新对话创建不可变版本。'],
          ].map(([title, copy], index) => (
            <li key={title} className="flex gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] font-mono text-[10px]">
                {index + 1}
              </span>
              <span>
                <span className="block text-sm font-semibold">{title}</span>
                <span className="mt-1 block text-xs leading-5 text-[var(--sea-ink-soft)]">
                  {copy}
                </span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-6 border-t border-[var(--line)] pt-5 text-xs leading-5 text-[var(--sea-ink-soft)]">
          Agent 在发布前始终保持草稿状态，不会对外提供使用。
        </p>
      </aside>
    </form>
  )
}
