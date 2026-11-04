import { Copy, KeyRound, LoaderCircle, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
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
  createAgentApiTokenRequest,
  listAgentApiTokensRequest,
  revokeAgentApiTokenRequest,
} from '#/lib/api/platform-client'
import type {
  AgentApiToken,
  AgentApiTokensResponse,
  CreateAgentApiTokenInput,
} from '#/lib/api/platform-client'

const expiryOptions = [
  { value: '30', label: '30 天' },
  { value: '90', label: '90 天' },
  { value: '365', label: '1 年' },
  { value: 'never', label: '永不过期' },
] as const

type ExpiryValue = (typeof expiryOptions)[number]['value']

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '—'
}

function tokenStatus(token: AgentApiToken): string {
  if (token.revokedAt) return '已吊销'
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) {
    return '已过期'
  }
  return '有效'
}

export function AgentApiTokensPanel({
  workspaceId,
  agentId,
  readOnly = false,
}: {
  workspaceId: string
  agentId: string
  readOnly?: boolean
}) {
  const [data, setData] = useState<AgentApiTokensResponse | null>(null)
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [expiry, setExpiry] = useState<ExpiryValue>('90')
  const [creating, setCreating] = useState(false)
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<AgentApiToken | null>(null)
  const [revoking, setRevoking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    listAgentApiTokensRequest(workspaceId, agentId)
      .then((result) => {
        if (active) setData(result)
      })
      .catch(() => {
        if (active) setError('API Token 加载失败，请稍后重试。')
      })
    return () => {
      active = false
    }
  }, [agentId, workspaceId])

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim() || !/^[A-Za-z0-9._-]{1,64}$/.test(username.trim())) {
      setError('请填写 Token 名称和有效的邮箱前缀。')
      return
    }
    setCreating(true)
    setError(null)
    setCopied(false)
    try {
      const input: CreateAgentApiTokenInput = {
        name: name.trim(),
        username: username.trim(),
        expiresInDays:
          expiry === 'never'
            ? null
            : (Number(expiry) as CreateAgentApiTokenInput['expiresInDays']),
      }
      const result = await createAgentApiTokenRequest(
        workspaceId,
        agentId,
        input,
      )
      setCreatedToken(result.token)
      setData((current) =>
        current
          ? { ...current, tokens: [result.record, ...current.tokens] }
          : current,
      )
      setName('')
      setUsername('')
    } catch {
      setError('API Token 创建失败，请稍后重试。')
    } finally {
      setCreating(false)
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return
    setRevoking(true)
    setError(null)
    try {
      const revoked = await revokeAgentApiTokenRequest(
        workspaceId,
        agentId,
        revokeTarget.id,
      )
      setData((current) =>
        current
          ? {
              ...current,
              tokens: current.tokens.map((token) =>
                token.id === revoked.id ? revoked : token,
              ),
            }
          : current,
      )
      setRevokeTarget(null)
    } catch {
      setError('API Token 吊销失败，请稍后重试。')
    } finally {
      setRevoking(false)
    }
  }

  async function copyToken() {
    if (!createdToken) return
    await navigator.clipboard.writeText(createdToken)
    setCopied(true)
  }

  const canManage = !readOnly && Boolean(data?.enabled)

  return (
    <section className="agent-panel p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--lagoon-deep)]">
          <KeyRound aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Open API</h2>
          <p className="mt-1.5 text-xs leading-5 text-[var(--sea-ink-soft)]">
            外部系统调用{' '}
            <code className="font-mono">POST /api/open/chat/{agentId}</code>
            ，请求头携带{' '}
            <code className="font-mono">
              Authorization: Bearer &lt;token&gt;
            </code>
            ，同步返回完整回答。会话按 Token 绑定的用户名隔离。
          </p>

          {data && !data.enabled ? (
            <p className="mt-4 rounded-xl border border-dashed border-[var(--line)] px-4 py-3 text-xs text-[var(--sea-ink-soft)]">
              服务端未配置 OPEN_API_JWT_SECRET，Open API 未启用。
            </p>
          ) : null}

          {createdToken ? (
            <div
              role="status"
              className="mt-4 grid gap-2 rounded-xl border border-[var(--chip-line)] bg-[var(--chip-bg)] px-4 py-3"
            >
              <p className="text-xs font-semibold">
                Token 只显示这一次，请立即复制保存。
              </p>
              <code className="break-all font-mono text-[11px]">
                {createdToken}
              </code>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCreatedToken(null)}
                >
                  关闭
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void copyToken()}
                >
                  <Copy aria-hidden="true" />
                  {copied ? '已复制' : '复制'}
                </Button>
              </div>
            </div>
          ) : null}

          {canManage ? (
            <form
              onSubmit={create}
              className="mt-4 grid gap-3 rounded-xl border border-[var(--line)] bg-white/30 px-4 py-4 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-end"
            >
              <div className="grid gap-1.5">
                <label
                  htmlFor="api-token-name"
                  className="text-xs font-semibold"
                >
                  名称
                </label>
                <Input
                  id="api-token-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如：客服系统"
                />
              </div>
              <div className="grid gap-1.5">
                <label
                  htmlFor="api-token-username"
                  className="text-xs font-semibold"
                >
                  用户名（邮箱前缀）
                </label>
                <Input
                  id="api-token-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="off"
                  placeholder="例如：zhangsan"
                />
              </div>
              <div className="grid gap-1.5">
                <label
                  htmlFor="api-token-expiry"
                  className="text-xs font-semibold"
                >
                  有效期
                </label>
                <Select
                  value={expiry}
                  onValueChange={(value) => setExpiry(value as ExpiryValue)}
                >
                  <SelectTrigger
                    id="api-token-expiry"
                    className="w-full bg-transparent"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" className="w-full">
                    {expiryOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" size="sm" disabled={creating}>
                {creating ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : (
                  <Plus aria-hidden="true" />
                )}
                生成 Token
              </Button>
            </form>
          ) : null}

          {data && data.tokens.length > 0 ? (
            <ul className="mt-4 grid gap-2">
              {data.tokens.map((token) => (
                <li
                  key={token.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-[var(--line)] bg-white/30 px-4 py-3 text-xs"
                >
                  <span className="font-semibold">{token.name}</span>
                  <span className="font-mono">{token.username}</span>
                  <span className="rounded-full border border-[var(--chip-line)] px-2 py-0.5 text-[9px]">
                    {tokenStatus(token)}
                  </span>
                  <span className="text-[10px] text-[var(--sea-ink-soft)]">
                    过期：
                    {token.expiresAt ? formatTime(token.expiresAt) : '永不'}
                  </span>
                  <span className="text-[10px] text-[var(--sea-ink-soft)]">
                    最近使用：{formatTime(token.lastUsedAt)}
                  </span>
                  {!readOnly && !token.revokedAt ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      onClick={() => setRevokeTarget(token)}
                    >
                      <Trash2 aria-hidden="true" />
                      吊销
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : data ? (
            <p className="mt-4 text-xs text-[var(--sea-ink-soft)]">
              尚未创建 API Token。
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <AlertDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => {
          if (!open && !revoking) setRevokeTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>吊销 API Token？</AlertDialogTitle>
            <AlertDialogDescription>
              “{revokeTarget?.name}”吊销后立即失效，使用它的调用方会收到 401。
              此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={revoking}
              onClick={() => setRevokeTarget(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={revoking}
              onClick={() => void confirmRevoke()}
            >
              {revoking ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : (
                <Trash2 aria-hidden="true" />
              )}
              确认吊销
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
