import {
  LoaderCircle,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  listWorkspaceMembersRequest,
  removeWorkspaceMemberRequest,
  saveWorkspaceMemberRequest,
} from '#/lib/api/platform-client'
import type {
  WorkspaceMemberRecord,
  WorkspaceAccess,
} from '#/lib/api/platform-client'

type WorkspaceRole = WorkspaceAccess['role']

const roleLabels: Record<WorkspaceRole, string> = {
  platform_admin: '平台管理员',
  workspace_admin: '工作区管理员',
  editor: '编辑者',
  user: '使用者',
}

const assignableRoles: WorkspaceRole[] = [
  'workspace_admin',
  'editor',
  'user',
]

export function WorkspaceMembers({ workspaceId }: { workspaceId: string }) {
  const [members, setMembers] = useState<WorkspaceMemberRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [newRole, setNewRole] = useState<WorkspaceRole>('user')
  const [saving, setSaving] = useState(false)
  const [roleDrafts, setRoleDrafts] = useState<Record<string, WorkspaceRole>>(
    {},
  )
  const [savingUserId, setSavingUserId] = useState<string | null>(null)
  const [removingUserId, setRemovingUserId] = useState<string | null>(null)

  async function loadMembers() {
    setLoading(true)
    setError(null)
    try {
      const next = await listWorkspaceMembersRequest(workspaceId)
      setMembers(next)
      setRoleDrafts(
        Object.fromEntries(next.map((member) => [member.userId, member.role])),
      )
    } catch {
      setError('工作区成员加载失败，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadMembers()
  }, [workspaceId])

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!username.trim()) {
      setError('请输入成员用户名。')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await saveWorkspaceMemberRequest(workspaceId, {
        username: username.trim(),
        role: newRole,
      })
      setUsername('')
      setNewRole('user')
      await loadMembers()
    } catch {
      setError('成员添加失败，请检查用户名和角色。')
    } finally {
      setSaving(false)
    }
  }

  async function saveRole(member: WorkspaceMemberRecord) {
    const role = roleDrafts[member.userId] ?? member.role
    if (role === member.role) return

    setSavingUserId(member.userId)
    setError(null)
    try {
      await saveWorkspaceMemberRequest(workspaceId, {
        username: member.username,
        role,
      })
      await loadMembers()
    } catch {
      setError(`无法更新 ${member.username} 的角色。`)
    } finally {
      setSavingUserId(null)
    }
  }

  async function removeMember(member: WorkspaceMemberRecord) {
    if (!window.confirm(`确定从当前工作区移除 ${member.username}？`)) return
    setRemovingUserId(member.userId)
    setError(null)
    try {
      await removeWorkspaceMemberRequest(workspaceId, member.userId)
      await loadMembers()
    } catch {
      setError(`无法移除 ${member.username}，请确认不是最后一名管理员。`)
    } finally {
      setRemovingUserId(null)
    }
  }

  const adminCount = members.filter(
    (member) => member.role === 'workspace_admin',
  ).length

  return (
    <div className="grid gap-5">
      <form onSubmit={addMember} className="agent-panel p-5 sm:p-6">
        <div>
          <p className="agent-rail-label">Add member</p>
          <h2 className="mt-1 text-lg font-semibold">添加工作区成员</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--sea-ink-soft)]">
            用户名不存在时会创建本地用户；再次提交同一用户名会更新其角色。
          </p>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
          <div className="grid gap-1.5">
            <label htmlFor="workspace-member-username" className="text-xs font-semibold">
              成员用户名
            </label>
            <Input
              id="workspace-member-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="例如：zhangsan"
            />
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs font-semibold">角色</span>
            <Select
              value={newRole}
              onValueChange={(value) => setNewRole(value as WorkspaceRole)}
            >
              <SelectTrigger aria-label="新成员角色" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {assignableRoles.map((role) => (
                  <SelectItem key={role} value={role}>
                    {roleLabels[role]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="submit"
            className="self-end"
            disabled={saving}
          >
            {saving ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <Plus aria-hidden="true" />
            )}
            {saving ? '添加中…' : '添加成员'}
          </Button>
        </div>
      </form>

      {error ? (
        <div role="alert" className="agent-panel p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="agent-panel flex min-h-48 items-center justify-center">
          <LoaderCircle
            aria-label="正在加载工作区成员"
            className="size-5 animate-spin text-[var(--lagoon-deep)]"
          />
        </div>
      ) : (
        <div className="grid gap-3">
          {members.map((member) => {
            const selectedRole = roleDrafts[member.userId] ?? member.role
            const roleChanged = selectedRole !== member.role
            const isLastAdmin =
              member.role === 'workspace_admin' && adminCount <= 1
            return (
              <article key={member.userId} className="agent-panel p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--lagoon-deep)]">
                    {member.role === 'workspace_admin' ? (
                      <ShieldCheck aria-hidden="true" className="size-4" />
                    ) : (
                      <UserRound aria-hidden="true" className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold">
                        {member.username}
                      </h3>
                      <span className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2 py-0.5 text-[9px] font-semibold text-[var(--sea-ink-soft)]">
                        {roleLabels[member.role]}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--sea-ink-soft)]">
                      {member.name || member.email || '本地开发用户'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={selectedRole}
                      onValueChange={(value) =>
                        setRoleDrafts((current) => ({
                          ...current,
                          [member.userId]: value as WorkspaceRole,
                        }))
                      }
                    >
                      <SelectTrigger
                        aria-label={`角色 ${member.username}`}
                        size="sm"
                        className="w-36"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {assignableRoles.map((role) => (
                          <SelectItem key={role} value={role}>
                            {roleLabels[role]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label={`保存 ${member.username} 角色`}
                      disabled={!roleChanged || savingUserId === member.userId}
                      onClick={() => void saveRole(member)}
                    >
                      {savingUserId === member.userId ? (
                        <LoaderCircle
                          aria-hidden="true"
                          className="animate-spin"
                        />
                      ) : null}
                      保存
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`移除 ${member.username}`}
                      disabled={
                        isLastAdmin || removingUserId === member.userId
                      }
                      onClick={() => void removeMember(member)}
                    >
                      {removingUserId === member.userId ? (
                        <LoaderCircle
                          aria-hidden="true"
                          className="animate-spin"
                        />
                      ) : (
                        <Trash2 aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
