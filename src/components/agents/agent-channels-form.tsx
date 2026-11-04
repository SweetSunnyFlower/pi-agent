import {
  Bot,
  Check,
  Globe2,
  KeyRound,
  LoaderCircle,
  MessageSquareText,
  PlugZap,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Switch } from '#/components/ui/switch'
import {
  getAgentChannels,
  saveInfoFlowChannelRequest,
  testInfoFlowConnectionRequest,
} from '#/lib/api/platform-client'
import type {
  AgentChannelsResponse,
  ChannelConnectionStatus,
} from '#/lib/api/platform-client'
import { cn } from '#/lib/utils'

const statusLabels: Record<ChannelConnectionStatus, string> = {
  not_configured: '未配置',
  disconnected: '已配置',
  connecting: '连接中',
  connected: '已连接',
  error: '异常',
}

export function AgentChannelsForm({
  workspaceId,
  agentId,
  initialConfig,
  onSaved,
  readOnly = false,
}: {
  workspaceId: string
  agentId: string
  initialConfig: AgentChannelsResponse
  onSaved?: () => void | Promise<void>
  readOnly?: boolean
}) {
  const [config, setConfig] = useState(initialConfig)
  const [expanded, setExpanded] = useState(
    !readOnly &&
      !initialConfig.infoflow.configured &&
      initialConfig.infoflow.enabled,
  )
  const [enabled, setEnabled] = useState(initialConfig.infoflow.enabled)
  const [infoflowAgentId, setInfoflowAgentId] = useState(
    initialConfig.infoflow.infoflowAgentId ?? '',
  )
  const [appKey, setAppKey] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const current = config.infoflow
    if (
      !current.enabled ||
      !current.configured ||
      !['disconnected', 'connecting'].includes(current.status)
    ) {
      return
    }

    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      try {
        const latest = await getAgentChannels(workspaceId, agentId)
        if (!active) return
        setConfig(latest)
        if (
          latest.infoflow.status === 'connected' ||
          latest.infoflow.status === 'error'
        ) {
          return
        }
      } catch {
        // Keep the last known state; the next poll may recover.
      }
      if (active) timer = setTimeout(refresh, 2_000)
    }

    timer = setTimeout(refresh, 1_200)
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [
    agentId,
    config.infoflow.configured,
    config.infoflow.enabled,
    config.infoflow.status,
    workspaceId,
  ])

  async function persistChannel(
    nextEnabled: boolean,
    closeEditor: boolean,
  ): Promise<boolean> {
    setSaving(true)
    setSaved(false)
    setError(null)
    setTestResult(null)
    try {
      const updated = await saveInfoFlowChannelRequest(workspaceId, agentId, {
        enabled: nextEnabled,
        infoflowAgentId: infoflowAgentId.trim(),
        appKey: appKey.trim(),
        appSecret: appSecret.trim(),
      })
      setConfig(updated)
      setEnabled(updated.infoflow.enabled)
      setInfoflowAgentId(updated.infoflow.infoflowAgentId ?? '')
      setAppKey('')
      setAppSecret('')
      if (closeEditor) setExpanded(false)
      setSaved(true)
      void onSaved?.()
    } catch {
      setError('渠道配置保存失败，请检查凭据或机器人是否已被其他 Agent 使用。')
      return false
    } finally {
      setSaving(false)
    }
    return true
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!infoflowAgentId.trim() || !Number.isFinite(Number(infoflowAgentId))) {
      setError('请填写有效的如流 Agent ID。')
      return
    }
    if (
      enabled &&
      (!config.infoflow.configured || appKey.trim() || appSecret.trim()) &&
      (!appKey.trim() || !appSecret.trim())
    ) {
      setError('首次启用如流机器人时必须填写 App Key 和 App Secret。')
      return
    }

    await persistChannel(enabled, true)
  }

  async function toggleEnabled(nextEnabled: boolean) {
    if (saving || testing) return
    const previous = enabled
    setEnabled(nextEnabled)
    setSaved(false)
    setError(null)

    if (!infoflow.configured) {
      setExpanded(true)
      return
    }

    const persisted = await persistChannel(nextEnabled, false)
    if (!persisted) setEnabled(previous)
  }

  async function testConnection() {
    setTesting(true)
    setError(null)
    setTestResult(null)
    try {
      const result = await testInfoFlowConnectionRequest(workspaceId, agentId)
      setTestResult(`凭据有效：${result.name}`)
      setConfig((current) => ({
        ...current,
        infoflow: {
          ...current.infoflow,
          status: 'disconnected',
          statusMessage: 'credentials_ok',
          displayName: result.name,
          iconUrl: result.iconUrl,
          lastTestedAt: new Date().toISOString(),
        },
      }))
    } catch {
      setError('连接测试失败，请检查如流 Agent ID、App Key 和 App Secret。')
      setConfig((current) => ({
        ...current,
        infoflow: {
          ...current.infoflow,
          status: 'error',
          statusMessage: 'credential_test_failed',
        },
      }))
    } finally {
      setTesting(false)
    }
  }

  const infoflow = config.infoflow
  const credentialEditor = (
    <form
      onSubmit={save}
      className="mt-4 grid gap-4 rounded-xl border border-[var(--line)] bg-white/30 px-4 py-4 sm:grid-cols-2"
    >
      <div className="grid gap-1.5">
        <label
          htmlFor="infoflow-agent-id"
          className="text-xs font-semibold"
        >
          如流 Agent ID
        </label>
        <Input
          id="infoflow-agent-id"
          value={infoflowAgentId}
          onChange={(event) => setInfoflowAgentId(event.target.value)}
          inputMode="numeric"
          placeholder="例如：50655"
        />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="infoflow-app-key" className="text-xs font-semibold">
          App Key
        </label>
        <Input
          id="infoflow-app-key"
          value={appKey}
          onChange={(event) => setAppKey(event.target.value)}
          autoComplete="off"
          placeholder={infoflow.appKeyMasked ?? '填写如流应用 App Key'}
        />
      </div>
      <div className="grid gap-1.5 sm:col-span-2">
        <label
          htmlFor="infoflow-app-secret"
          className="text-xs font-semibold"
        >
          App Secret
        </label>
        <Input
          id="infoflow-app-secret"
          type="password"
          value={appSecret}
          onChange={(event) => setAppSecret(event.target.value)}
          autoComplete="new-password"
          placeholder={
            infoflow.configured
              ? '留空则保留现有 App Secret'
              : '填写如流应用 App Secret'
          }
        />
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--line)] pt-3 sm:col-span-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setExpanded(false)
            setError(null)
          }}
        >
          取消
        </Button>
        {infoflow.configured ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={testing}
            onClick={testConnection}
          >
            {testing ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <PlugZap aria-hidden="true" />
            )}
            {testing ? '测试中…' : '测试连接'}
          </Button>
        ) : null}
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <Check aria-hidden="true" />
          )}
          {saving ? '保存中…' : '保存渠道配置'}
        </Button>
      </div>
    </form>
  )

  return (
    <div className="grid gap-4">
      <section className="agent-panel p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--lagoon-deep)]">
            <Globe2 aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">Web</h2>
              <span className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2 py-0.5 text-[9px] font-semibold text-[var(--palm)]">
                默认启用
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-5 text-[var(--sea-ink-soft)]">
              Web 使用 HTTP 提交和 SSE
              状态事件；对话与文档仍由统一运行时持久化。
            </p>
          </div>
          <ShieldCheck
            aria-label="Web 渠道正常"
            className="size-4 text-[var(--palm)]"
          />
        </div>
      </section>

      <section className="agent-panel p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--lagoon-deep)]">
            <MessageSquareText aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">如流机器人</h2>
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[9px] font-semibold',
                  infoflow.status === 'error'
                    ? 'border-destructive/20 bg-destructive/5 text-destructive'
                    : 'border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--sea-ink-soft)]',
                )}
              >
                {statusLabels[infoflow.status]}
              </span>
              {infoflow.enabled ? (
                <span className="rounded-full border border-[var(--chip-line)] px-2 py-0.5 text-[9px]">
                  单 Agent 专属机器人
                </span>
              ) : null}
              {readOnly ? (
                <span className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2 py-0.5 text-[9px] font-semibold text-[var(--sea-ink-soft)]">
                  只读
                </span>
              ) : null}
            </div>
            <p className="mt-1.5 text-xs leading-5 text-[var(--sea-ink-soft)]">
              群聊只在当前机器人被 @ 时触发；私聊直接进入 Agent。最终回复以完整
              Markdown 发送。
            </p>

            {!readOnly ? (
              <div className="mt-4 flex items-center justify-between rounded-xl border border-[var(--line)] bg-white/30 px-4 py-3">
                <div>
                  <p className="text-xs font-semibold">启用如流机器人</p>
                  <p className="mt-1 text-[10px] text-[var(--sea-ink-soft)]">
                    开关立即生效；凭据修改请点击下方“编辑凭据”。
                  </p>
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={(checked) => void toggleEnabled(checked)}
                  disabled={saving || testing}
                  aria-label="启用如流机器人"
                />
              </div>
            ) : null}

            {!readOnly && expanded ? (
              credentialEditor
            ) : infoflow.configured ? (
              <dl className="mt-4 grid gap-2 rounded-xl border border-[var(--line)] bg-white/30 px-4 py-3 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-[10px] text-[var(--sea-ink-soft)]">
                    Agent ID
                  </dt>
                  <dd className="mt-0.5 font-mono">
                    {infoflow.infoflowAgentId}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] text-[var(--sea-ink-soft)]">
                    App Key
                  </dt>
                  <dd className="mt-0.5 font-mono">{infoflow.appKeyMasked}</dd>
                </div>
                {infoflow.displayName ? (
                  <div className="sm:col-span-2">
                    <dt className="text-[10px] text-[var(--sea-ink-soft)]">
                      机器人
                    </dt>
                    <dd className="mt-0.5 flex items-center gap-1.5">
                      <Bot
                        aria-hidden="true"
                        className="size-3.5 text-[var(--lagoon-deep)]"
                      />
                      {infoflow.displayName}
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : null}

            {readOnly && !infoflow.configured ? (
              <p className="mt-4 rounded-xl border border-dashed border-[var(--line)] px-4 py-3 text-xs text-[var(--sea-ink-soft)]">
                尚未配置如流机器人。
              </p>
            ) : null}

            {readOnly ? null : !expanded ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setExpanded(true)
                    setError(null)
                  }}
                >
                  {infoflow.configured ? (
                    <KeyRound aria-hidden="true" />
                  ) : (
                    <Bot aria-hidden="true" />
                  )}
                  {infoflow.configured ? '编辑凭据' : '配置如流机器人'}
                </Button>
                {infoflow.configured ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={testing}
                    onClick={testConnection}
                  >
                    {testing ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="animate-spin"
                      />
                    ) : (
                      <PlugZap aria-hidden="true" />
                    )}
                    {testing ? '测试中…' : '测试连接'}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {!readOnly && testResult ? (
        <p role="status" className="text-xs font-semibold text-[var(--palm)]">
          {testResult}
        </p>
      ) : null}
      {!readOnly && saved ? (
        <p role="status" className="text-xs font-semibold text-[var(--palm)]">
          渠道配置已保存
        </p>
      ) : null}
      {!readOnly && error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
