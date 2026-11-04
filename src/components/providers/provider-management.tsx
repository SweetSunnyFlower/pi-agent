import {
  CheckCircle2,
  CircleOff,
  KeyRound,
  LoaderCircle,
  Network,
  Pencil,
  PlugZap,
  Plus,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { ProviderListSkeleton } from '#/components/loading/page-skeletons'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Switch } from '#/components/ui/switch'
import {
  createAiProviderRequest,
  listAiProvidersRequest,
  testAiProviderRequest,
  updateAiProviderRequest,
} from '#/lib/api/platform-client'
import type {
  AiProviderRecord,
  SaveAiProviderInput,
} from '#/lib/api/platform-client'
import { cn } from '#/lib/utils'

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string }

const emptyForm: SaveAiProviderInput = {
  name: '',
  baseUrl: '',
  token: '',
  enabled: true,
}

export function ProviderManagement({ workspaceId }: { workspaceId: string }) {
  const [providers, setProviders] = useState<AiProviderRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<AiProviderRecord | null>(null)
  const [form, setForm] = useState<SaveAiProviderInput>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [testStates, setTestStates] = useState<Record<string, TestState>>({})

  async function loadProviders() {
    setLoading(true)
    setLoadError(null)
    try {
      setProviders(await listAiProvidersRequest(workspaceId))
    } catch {
      setLoadError('供应商加载失败，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadProviders()
  }, [workspaceId])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormError(null)
    setEditorOpen(true)
  }

  function openEdit(provider: AiProviderRecord) {
    setEditing(provider)
    setForm({
      name: provider.name,
      baseUrl: provider.baseUrl,
      token: '',
      enabled: provider.enabled,
    })
    setFormError(null)
    setEditorOpen(true)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.name.trim() || !form.baseUrl.trim()) {
      setFormError('请填写供应商名称和 Base URL。')
      return
    }
    if (!editing && !form.token?.trim()) {
      setFormError('新供应商必须填写 API Token。')
      return
    }

    setSaving(true)
    setFormError(null)
    const input: SaveAiProviderInput = {
      name: form.name.trim(),
      baseUrl: form.baseUrl.trim(),
      enabled: form.enabled,
      ...(form.token?.trim() ? { token: form.token.trim() } : {}),
    }
    try {
      if (editing) {
        await updateAiProviderRequest(workspaceId, editing.id, input)
      } else {
        await createAiProviderRequest(workspaceId, input)
      }
      setEditorOpen(false)
      await loadProviders()
    } catch {
      setFormError('供应商保存失败，请检查名称、地址和 Token。')
    } finally {
      setSaving(false)
    }
  }

  async function testProvider(provider: AiProviderRecord) {
    setTestStates((current) => ({
      ...current,
      [provider.id]: { status: 'testing' },
    }))
    try {
      const result = await testAiProviderRequest(workspaceId, provider.id)
      setTestStates((current) => ({
        ...current,
        [provider.id]: {
          status: 'success',
          message: `连接成功，发现 ${result.modelCount} 个模型`,
        },
      }))
      await loadProviders()
    } catch {
      setTestStates((current) => ({
        ...current,
        [provider.id]: {
          status: 'error',
          message: '连接失败，请检查 Base URL 和 API Token。',
        },
      }))
    }
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="agent-rail-label">Workspace providers</p>
          <h2 className="display-title mt-1 text-2xl font-semibold tracking-[-0.03em]">
            AI 供应商
          </h2>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-[var(--sea-ink-soft)]">
            模型请求地址和 Token
            保存在数据库中，并使用平台密钥加密。启用的供应商会共同提供 Agent
            可选模型。
          </p>
        </div>
        <Button type="button" onClick={openCreate}>
          <Plus aria-hidden="true" />
          添加供应商
        </Button>
      </div>

      {loading ? <ProviderListSkeleton /> : null}

      {loadError ? (
        <div
          role="alert"
          className="agent-panel flex items-center justify-between gap-4 p-5 text-sm text-destructive"
        >
          <span>{loadError}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadProviders()}
          >
            重新加载
          </Button>
        </div>
      ) : null}

      {!loading && !loadError && providers.length === 0 ? (
        <div className="agent-panel flex min-h-64 flex-col items-center justify-center px-6 text-center">
          <span className="grid size-12 place-items-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--lagoon-deep)]">
            <Network aria-hidden="true" className="size-5" />
          </span>
          <h3 className="mt-4 text-sm font-semibold">还没有供应商</h3>
          <p className="mt-1 max-w-sm text-xs leading-5 text-[var(--sea-ink-soft)]">
            添加第一个模型供应商后，Agent 才能选择模型。
          </p>
        </div>
      ) : null}

      {providers.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {providers.map((provider) => {
            const testState = testStates[provider.id] ?? { status: 'idle' }
            return (
              <article
                key={provider.id}
                className={cn(
                  'agent-panel p-5 transition-colors',
                  !provider.enabled && 'opacity-70',
                )}
              >
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--lagoon-deep)]">
                    <Network aria-hidden="true" className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-bold">
                        {provider.name}
                      </h3>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold',
                          provider.enabled
                            ? 'border-[var(--chip-line)] text-[var(--palm)]'
                            : 'border-[var(--line)] text-[var(--sea-ink-soft)]',
                        )}
                      >
                        {provider.enabled ? (
                          <CheckCircle2 aria-hidden="true" className="size-3" />
                        ) : (
                          <CircleOff aria-hidden="true" className="size-3" />
                        )}
                        {provider.enabled ? '已启用' : '已停用'}
                      </span>
                    </div>
                    <p className="mt-2 break-all font-mono text-[10px] leading-5 text-[var(--sea-ink-soft)]">
                      {provider.baseUrl}
                    </p>
                  </div>
                </div>

                <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-[var(--line)] pt-3 text-[10px]">
                  <dt className="text-[var(--sea-ink-soft)]">Token</dt>
                  <dd className="font-mono">{provider.tokenMasked}</dd>
                  <dt className="text-[var(--sea-ink-soft)]">最近测试</dt>
                  <dd>
                    {provider.lastTestedAt
                      ? new Intl.DateTimeFormat('zh-CN', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        }).format(new Date(provider.lastTestedAt))
                      : '尚未测试'}
                  </dd>
                </dl>

                {testState.status !== 'idle' ? (
                  <p
                    role="status"
                    className={cn(
                      'mt-3 text-[10px]',
                      testState.status === 'error'
                        ? 'text-destructive'
                        : 'text-[var(--palm)]',
                    )}
                  >
                    {testState.status === 'testing'
                      ? '正在测试连接…'
                      : testState.message}
                  </p>
                ) : null}

                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openEdit(provider)}
                    aria-label={`编辑${provider.name}`}
                  >
                    <Pencil aria-hidden="true" />
                    编辑
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={testState.status === 'testing'}
                    onClick={() => void testProvider(provider)}
                    aria-label={`测试${provider.name}`}
                  >
                    {testState.status === 'testing' ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="animate-spin"
                      />
                    ) : (
                      <PlugZap aria-hidden="true" />
                    )}
                    测试连接
                  </Button>
                </div>
              </article>
            )
          })}
        </div>
      ) : null}

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent>
          <DialogHeader className="border-b border-[var(--line)] px-5 py-5 pr-14">
            <DialogTitle>{editing ? '编辑供应商' : '添加供应商'}</DialogTitle>
            <DialogDescription>
              只接受 OpenAI 兼容的 `/models` 与 `/chat/completions` 接口。
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={save} className="grid gap-4 overflow-y-auto p-5">
            <div className="grid gap-1.5">
              <label htmlFor="provider-name" className="text-xs font-semibold">
                供应商名称
              </label>
              <Input
                id="provider-name"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="例如：内部模型网关"
              />
            </div>
            <div className="grid gap-1.5">
              <label
                htmlFor="provider-base-url"
                className="text-xs font-semibold"
              >
                Base URL
              </label>
              <Input
                id="provider-base-url"
                value={form.baseUrl}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    baseUrl: event.target.value,
                  }))
                }
                placeholder="https://gateway.example.com/v1"
                inputMode="url"
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="provider-token" className="text-xs font-semibold">
                API Token
              </label>
              <div className="relative">
                <KeyRound
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[var(--sea-ink-soft)]"
                />
                <Input
                  id="provider-token"
                  type="password"
                  value={form.token ?? ''}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      token: event.target.value,
                    }))
                  }
                  placeholder={
                    editing ? '留空则保留现有 Token' : '填写供应商 API Token'
                  }
                  autoComplete="new-password"
                  className="pl-9"
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-white/30 px-4 py-3">
              <div>
                <p className="text-xs font-semibold">启用供应商</p>
                <p className="mt-1 text-[10px] text-[var(--sea-ink-soft)]">
                  停用后，其模型不再出现在 Agent 模型下拉中。
                </p>
              </div>
              <Switch
                checked={form.enabled}
                onCheckedChange={(enabled) =>
                  setForm((current) => ({ ...current, enabled }))
                }
                aria-label="启用供应商"
              />
            </div>

            {formError ? (
              <p role="alert" className="text-xs text-destructive">
                {formError}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 border-t border-[var(--line)] pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditorOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : null}
                {saving ? '保存中…' : '保存供应商'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
