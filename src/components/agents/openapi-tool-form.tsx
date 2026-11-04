import { Check, FileJson2, LoaderCircle, ScanSearch } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Switch } from '#/components/ui/switch'
import {
  importOpenApiToolsRequest,
  previewOpenApiRequest,
  reviseAgentToolRequest,
} from '#/lib/api/platform-client'
import type { OpenApiPreview, ToolCatalogItem } from '#/lib/api/platform-client'

export function OpenApiToolForm({
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
  const [documentUrl, setDocumentUrl] = useState(
    typeof initialTool?.definition.documentUrl === 'string'
      ? initialTool.definition.documentUrl
      : '',
  )
  const [preview, setPreview] = useState<OpenApiPreview | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadOperations(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!documentUrl.trim()) {
      setError('请填写 OpenAPI 文档地址。')
      return
    }

    setLoading(true)
    setError(null)
    setPreview(null)
    setSelected(new Set())
    try {
      const nextPreview = await previewOpenApiRequest(
        workspaceId,
        documentUrl.trim(),
      )
      setPreview(nextPreview)
      if (initialTool) {
        const operationId =
          typeof initialTool.definition.operationId === 'string'
            ? initialTool.definition.operationId
            : undefined
        const method =
          typeof initialTool.definition.method === 'string'
            ? initialTool.definition.method
            : undefined
        const path =
          typeof initialTool.definition.path === 'string'
            ? initialTool.definition.path
            : undefined
        const original = nextPreview.operations.find(
          (operation) =>
            (operationId && operation.operationId === operationId) ||
            (method &&
              path &&
              operation.method === method &&
              operation.path === path),
        )
        if (original) setSelected(new Set([original.key]))
      }
    } catch {
      setError('OpenAPI 文档读取失败，请检查地址、格式和访问权限。')
    } finally {
      setLoading(false)
    }
  }

  async function importSelected() {
    if (!preview || selected.size === 0) return
    setImporting(true)
    setError(null)
    try {
      const operationKey = [...selected][0]
      if (!operationKey) return
      if (initialTool) {
        if (!agentId) throw new Error('agent id is required for edits')
        onUpdated?.(
          await reviseAgentToolRequest(
            workspaceId,
            agentId,
            initialTool.versionId,
            {
              kind: 'openapi',
              documentUrl: documentUrl.trim(),
              operationKey,
            },
          ),
        )
      } else {
        onCreated?.(
          await importOpenApiToolsRequest(workspaceId, documentUrl.trim(), [
            ...selected,
          ]),
        )
      }
    } catch {
      setError(
        editing
          ? 'OpenAPI 工具新版本保存失败，请检查文档和接口选择。'
          : '接口导入失败，可能已存在同名工具或文档内容发生变化。',
      )
    } finally {
      setImporting(false)
    }
  }

  return (
    <div>
      <form onSubmit={loadOperations}>
        <label htmlFor="openapi-document-url" className="text-xs font-semibold">
          OpenAPI 文档地址
        </label>
        <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
          <Input
            id="openapi-document-url"
            type="url"
            value={documentUrl}
            onChange={(event) => setDocumentUrl(event.target.value)}
            placeholder="https://api.example.com/openapi.yaml"
          />
          <Button type="submit" variant="outline" disabled={loading}>
            {loading ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <ScanSearch aria-hidden="true" />
            )}
            {loading ? '读取中…' : '读取接口'}
          </Button>
        </div>
        <p className="mt-2 text-[10px] leading-4 text-[var(--sea-ink-soft)]">
          支持 OpenAPI 3.x JSON/YAML；本地组件引用会解析，外部 $ref 暂不支持。
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
            <div>
              <div className="flex items-center gap-2">
                <FileJson2
                  aria-hidden="true"
                  className="size-4 text-[var(--lagoon-deep)]"
                />
                <span className="text-xs font-semibold">{preview.title}</span>
                <span className="font-mono text-[9px] text-[var(--sea-ink-soft)]">
                  v{preview.version}
                </span>
              </div>
              <p className="mt-1 truncate font-mono text-[9px] text-[var(--sea-ink-soft)]">
                {preview.serverUrl}
              </p>
            </div>
            {editing ? (
              <span className="text-[10px] text-[var(--sea-ink-soft)]">
                编辑时请选择一个接口版本
              </span>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() =>
                  setSelected(
                    selected.size === preview.operations.length
                      ? new Set()
                      : new Set(
                          preview.operations.map((operation) => operation.key),
                        ),
                  )
                }
              >
                {selected.size === preview.operations.length ? '清空' : '全选'}
              </Button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto p-2">
            {preview.operations.map((operation) => {
              const checked = selected.has(operation.key)
              return (
                <div
                  key={operation.key}
                  className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-[var(--link-bg-hover)]"
                >
                  <span className="mt-0.5 rounded border border-[var(--chip-line)] bg-[var(--chip-bg)] px-1.5 py-0.5 font-mono text-[9px] font-bold">
                    {operation.method}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">
                      {operation.name}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[9px] text-[var(--sea-ink-soft)]">
                      {operation.path}
                    </p>
                  </div>
                  <Switch
                    checked={checked}
                    aria-label={`选择 ${operation.key}`}
                    onCheckedChange={(enabled) =>
                      setSelected((current) => {
                        if (editing) {
                          return enabled ? new Set([operation.key]) : new Set()
                        }
                        const next = new Set(current)
                        if (enabled) next.add(operation.key)
                        else next.delete(operation.key)
                        return next
                      })
                    }
                  />
                </div>
              )
            })}
            {preview.operations.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-[var(--sea-ink-soft)]">
                文档中没有可导入的 operation。
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
                : `导入 ${selected.size} 个接口`}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
