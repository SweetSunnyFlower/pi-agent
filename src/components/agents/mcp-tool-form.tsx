import { Check, LoaderCircle, PlugZap, ServerCog } from 'lucide-react'
import { useState } from 'react'
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
import { Switch } from '#/components/ui/switch'
import {
  importMcpToolsRequest,
  previewMcpServerRequest,
  reviseAgentToolRequest,
} from '#/lib/api/platform-client'
import type {
  McpPreview,
  McpTransport,
  ToolCatalogItem,
} from '#/lib/api/platform-client'

export function McpToolForm({
  workspaceId,
  agentId,
  initialTool,
  onCreated,
  onUpdated,
  onCancel,
}: {
  workspaceId: string
  agentId?: string
  initialTool?: ToolCatalogItem
  onCreated?: (tools: ToolCatalogItem[]) => void
  onUpdated?: (tools: ToolCatalogItem[]) => void
  onCancel?: () => void
}) {
  const editing = Boolean(initialTool)
  const [serverUrl, setServerUrl] = useState(
    typeof initialTool?.definition.serverUrl === 'string'
      ? initialTool.definition.serverUrl
      : '',
  )
  const [transport, setTransport] = useState<McpTransport>(
    initialTool?.definition.transport === 'sse' ? 'sse' : 'streamable-http',
  )
  const [preview, setPreview] = useState<McpPreview | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function discover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!serverUrl.trim()) {
      setError('请填写 MCP 服务地址。')
      return
    }

    setLoading(true)
    setError(null)
    setPreview(null)
    setSelected(new Set())
    try {
      const nextPreview = await previewMcpServerRequest(workspaceId, {
        serverUrl: serverUrl.trim(),
        transport,
      })
      setPreview(nextPreview)
      if (initialTool) {
        const originalToolName =
          typeof initialTool.definition.toolName === 'string'
            ? initialTool.definition.toolName
            : undefined
        if (
          originalToolName &&
          nextPreview.tools.some((tool) => tool.name === originalToolName)
        ) {
          setSelected(new Set([originalToolName]))
        }
      }
    } catch {
      setError('MCP 服务连接失败，请检查地址、传输方式和服务状态。')
    } finally {
      setLoading(false)
    }
  }

  async function importSelected() {
    if (!preview || selected.size === 0) return
    setImporting(true)
    setError(null)
    try {
      const toolName = [...selected][0]
      if (!toolName) return
      if (initialTool) {
        if (!agentId) throw new Error('agent id is required for edits')
        onUpdated?.(
          await reviseAgentToolRequest(
            workspaceId,
            agentId,
            initialTool.versionId,
            {
              kind: 'mcp',
              serverUrl: serverUrl.trim(),
              transport,
              toolName,
            },
          ),
        )
      } else {
        onCreated?.(
          await importMcpToolsRequest(workspaceId, {
            serverUrl: serverUrl.trim(),
            transport,
            toolNames: [...selected],
          }),
        )
      }
    } catch {
      setError(
        editing
          ? 'MCP 工具新版本保存失败，请检查服务连接和工具选择。'
          : 'MCP 工具导入失败，可能已存在同名工具或服务内容发生变化。',
      )
    } finally {
      setImporting(false)
    }
  }

  return (
    <div>
      <form onSubmit={discover}>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end">
          <div className="grid gap-1.5">
            <label htmlFor="mcp-server-url" className="text-xs font-semibold">
              MCP 服务地址
            </label>
            <Input
              id="mcp-server-url"
              type="url"
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              placeholder="https://mcp.example.com/mcp"
            />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="mcp-transport" className="text-xs font-semibold">
              连接方式
            </label>
            <Select
              value={transport}
              onValueChange={(value) => setTransport(value as McpTransport)}
            >
              <SelectTrigger
                id="mcp-transport"
                className="w-full bg-transparent"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="w-full">
                <SelectItem value="streamable-http">Streamable HTTP</SelectItem>
                <SelectItem value="sse">SSE（兼容）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" variant="outline" disabled={loading}>
            {loading ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <PlugZap aria-hidden="true" />
            )}
            {loading ? '连接中…' : '连接并发现'}
          </Button>
        </div>
        <p className="mt-2 text-[10px] leading-4 text-[var(--sea-ink-soft)]">
          当前支持无需浏览器登录的远程 MCP 服务；工具会保存为不可变快照。
        </p>
      </form>

      {onCancel ? (
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading || importing}
            onClick={onCancel}
          >
            取消编辑
          </Button>
        </div>
      ) : null}

      {preview ? (
        <div className="mt-5 rounded-xl border border-[var(--line)] bg-white/25">
          <div className="flex flex-col gap-2 border-b border-[var(--line)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <ServerCog
                aria-hidden="true"
                className="size-4 text-[var(--lagoon-deep)]"
              />
              <span className="text-xs font-semibold">
                {preview.serverName}
              </span>
              {preview.serverVersion ? (
                <span className="font-mono text-[9px] text-[var(--sea-ink-soft)]">
                  v{preview.serverVersion}
                </span>
              ) : null}
            </div>
            {editing ? (
              <span className="text-[10px] text-[var(--sea-ink-soft)]">
                编辑时请选择一个工具版本
              </span>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() =>
                  setSelected(
                    selected.size === preview.tools.length
                      ? new Set()
                      : new Set(preview.tools.map((tool) => tool.name)),
                  )
                }
              >
                {selected.size === preview.tools.length ? '清空' : '全选'}
              </Button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto p-2">
            {preview.tools.map((tool) => {
              const checked = selected.has(tool.name)
              return (
                <div
                  key={tool.name}
                  className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-[var(--link-bg-hover)]"
                >
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border border-[var(--chip-line)] bg-[var(--chip-bg)]">
                    <PlugZap
                      aria-hidden="true"
                      className="size-3 text-[var(--lagoon-deep)]"
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold">
                      {tool.title || tool.name}
                    </p>
                    <p className="mt-0.5 text-[10px] leading-4 text-[var(--sea-ink-soft)]">
                      {tool.description || 'MCP 工具未提供描述。'}
                    </p>
                    <p className="mt-1 truncate font-mono text-[9px] text-[var(--sea-ink-soft)]">
                      {tool.name}
                    </p>
                  </div>
                  <Switch
                    checked={checked}
                    aria-label={`选择 ${tool.name}`}
                    onCheckedChange={(enabled) =>
                      setSelected((current) => {
                        if (editing) {
                          return enabled ? new Set([tool.name]) : new Set()
                        }
                        const next = new Set(current)
                        if (enabled) next.add(tool.name)
                        else next.delete(tool.name)
                        return next
                      })
                    }
                  />
                </div>
              )
            })}
            {preview.tools.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-[var(--sea-ink-soft)]">
                此 MCP Server 没有暴露工具。
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {preview ? (
        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            size="sm"
            disabled={selected.size === 0 || importing}
            onClick={importSelected}
          >
            {importing ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <Check aria-hidden="true" />
            )}
            {importing
              ? editing
                ? '保存中…'
                : '导入中…'
              : editing
                ? '保存新版本'
                : `导入 ${selected.size} 个工具`}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
