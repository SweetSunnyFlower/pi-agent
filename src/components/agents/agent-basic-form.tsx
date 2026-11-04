import { Check, Eye, LoaderCircle, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Textarea } from '#/components/ui/textarea'
import {
  getAgentAccessRequest,
  listWorkspaceMembersRequest,
  updateAgentDraftRequest,
} from '#/lib/api/platform-client'
import type { WorkspaceMemberRecord } from '#/lib/api/platform-client'
import { cn } from '#/lib/utils'

type AgentVisibility = 'workspace' | 'restricted'

export function AgentBasicForm({
  workspaceId,
  agentId,
  initialName,
  initialDescription,
  initialVisibility,
  canManageAccess = false,
  onSaved,
}: {
  workspaceId: string
  agentId: string
  initialName: string
  initialDescription: string
  initialVisibility: AgentVisibility
  canManageAccess?: boolean
  onSaved?: () => void | Promise<void>
}) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [visibility, setVisibility] =
    useState<AgentVisibility>(initialVisibility)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [members, setMembers] = useState<WorkspaceMemberRecord[]>([])
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([])
  const [accessLoading, setAccessLoading] = useState(canManageAccess)

  useEffect(() => {
    if (!canManageAccess) return
    let active = true
    setAccessLoading(true)
    Promise.all([
      listWorkspaceMembersRequest(workspaceId),
      getAgentAccessRequest(workspaceId, agentId),
    ])
      .then(([workspaceMembers, access]) => {
        if (!active) return
        setMembers(
          workspaceMembers.filter((member) => member.role === 'user'),
        )
        setSelectedMemberIds(access.userIds)
      })
      .catch(() => {
        if (active) {
          setError('受限成员加载失败，请稍后重试。')
        }
      })
      .finally(() => {
        if (active) setAccessLoading(false)
      })
    return () => {
      active = false
    }
  }, [agentId, canManageAccess, workspaceId])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim()) {
      setNameError('请输入 Agent 名称。')
      return
    }

    setSaving(true)
    setSaved(false)
    setError(null)
    setNameError(null)
    try {
      await updateAgentDraftRequest(workspaceId, agentId, {
        name: name.trim(),
        description: description.trim(),
        visibility,
        ...(canManageAccess
          ? {
              memberUserIds:
                visibility === 'restricted' ? selectedMemberIds : [],
            }
          : {}),
      })
      setSaved(true)
      void onSaved?.()
    } catch {
      setError('基本信息保存失败，请检查 Agent 名称是否重复或权限是否有效。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="agent-panel p-6 sm:p-8">
      <div className="grid gap-6">
        <div className="grid gap-2">
          <label htmlFor="agent-basic-name" className="text-sm font-semibold">
            Agent 名称
          </label>
          <Input
            id="agent-basic-name"
            value={name}
            maxLength={120}
            placeholder="例如：产品评审助手"
            aria-invalid={Boolean(nameError)}
            aria-describedby={nameError ? 'agent-basic-name-error' : undefined}
            onChange={(event) => {
              setName(event.target.value)
              setSaved(false)
              if (nameError) setNameError(null)
            }}
          />
          {nameError ? (
            <p
              id="agent-basic-name-error"
              className="text-xs text-destructive"
            >
              {nameError}
            </p>
          ) : (
            <p className="text-xs text-[var(--sea-ink-soft)]">
              名称在当前工作区内必须唯一。
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <label
            htmlFor="agent-basic-description"
            className="text-sm font-semibold"
          >
            描述
          </label>
          <Textarea
            id="agent-basic-description"
            value={description}
            rows={4}
            maxLength={500}
            placeholder="说明这个 Agent 可以帮助团队完成什么。"
            onChange={(event) => {
              setDescription(event.target.value)
              setSaved(false)
            }}
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
              copy: canManageAccess
                ? '仅创建者、管理员和明确授权的成员可以使用。'
                : '只有工作区管理员可以配置指定成员。',
              icon: Eye,
            },
          ].map((option) => {
            const Icon = option.icon
            const selected = visibility === option.id
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={selected}
                disabled={option.id === 'restricted' && !canManageAccess}
                onClick={() => {
                  setVisibility(option.id)
                  setSaved(false)
                }}
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

        {visibility === 'restricted' && canManageAccess ? (
          <fieldset className="rounded-xl border border-[var(--line)] bg-white/35 p-4">
            <legend className="px-1 text-sm font-semibold">授权成员</legend>
            <p className="mt-1 text-xs leading-5 text-[var(--sea-ink-soft)]">
              工作区管理员和编辑者可管理该 Agent；普通使用者需要在此勾选。
            </p>
            {accessLoading ? (
              <div className="mt-4 flex items-center gap-2 text-xs text-[var(--sea-ink-soft)]">
                <LoaderCircle aria-hidden="true" className="animate-spin" />
                正在加载成员…
              </div>
            ) : members.length === 0 ? (
              <p className="mt-4 text-xs text-[var(--sea-ink-soft)]">
                当前工作区还没有角色为“使用者”的成员，请先到成员管理中添加。
              </p>
            ) : (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {members.map((member) => {
                  const checked = selectedMemberIds.includes(member.userId)
                  return (
                    <label
                      key={member.userId}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors',
                        checked
                          ? 'border-[var(--lagoon-deep)] bg-[color-mix(in_oklab,var(--lagoon)_10%,white_90%)]'
                          : 'border-[var(--line)] bg-white/45',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        aria-label={`授权 ${member.name || member.username} 访问`}
                        onChange={(event) =>
                          setSelectedMemberIds((current) =>
                            event.target.checked
                              ? [...current, member.userId]
                              : current.filter((id) => id !== member.userId),
                          )
                        }
                        className="size-4 accent-[var(--lagoon-deep)]"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold">
                          {member.name || member.username}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] text-[var(--sea-ink-soft)]">
                          {member.username}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
          </fieldset>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-3 border-t border-[var(--line)] pt-6">
          {saved ? (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--palm)]"
            >
              <Check aria-hidden="true" className="size-3.5" />
              基本信息已保存
            </span>
          ) : null}
          <Button
            type="submit"
            disabled={
              saving ||
              (visibility === 'restricted' && canManageAccess && accessLoading)
            }
          >
            {saving ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : null}
            {saving ? '保存中…' : '保存基本信息'}
          </Button>
        </div>
      </div>
    </form>
  )
}
