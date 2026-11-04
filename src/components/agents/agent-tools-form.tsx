import {
  Boxes,
  Check,
  Code2,
  FileJson2,
  Globe2,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  ServerCog,
  Trash2,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { Button } from '#/components/ui/button'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { Input } from '#/components/ui/input'
import { Switch } from '#/components/ui/switch'
import {
  deleteAgentCapabilityRequest,
  replaceAgentToolsRequest,
} from '#/lib/api/platform-client'
import type { ToolCatalogItem } from '#/lib/api/platform-client'
import { cn } from '#/lib/utils'
import { HttpToolForm } from './http-tool-form'
import { McpToolForm } from './mcp-tool-form'
import { OpenApiToolForm } from './openapi-tool-form'
import { ToolSourcePicker } from './tool-source-picker'
import type { ToolSource } from './tool-source-picker'

type SourceFilter = 'all' | ToolCatalogItem['source']

const sourceLabels: Record<ToolCatalogItem['source'], string> = {
  builtin: '内置',
  http: 'HTTP',
  openapi: 'OpenAPI',
  mcp: 'MCP',
}

const filters: Array<{ value: SourceFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'builtin', label: '内置' },
  { value: 'http', label: 'HTTP' },
  { value: 'openapi', label: 'OpenAPI' },
  { value: 'mcp', label: 'MCP' },
]

const sourceDetails = {
  builtin: {
    title: '已注册的内置工具',
    description: '内置工具由平台代码注册，选择后可直接绑定到 Agent。',
    icon: Boxes,
  },
  http: {
    title: '新的 HTTP 工具',
    description: '定义接口与输入 Schema，再控制它是否对当前 Agent 生效。',
    icon: Globe2,
  },
  openapi: {
    title: '从 OpenAPI 文档导入',
    description: '读取文档并选择需要暴露给模型的 operation。',
    icon: FileJson2,
  },
  mcp: {
    title: '从 MCP Server 发现',
    description: '连接远程服务，选择可用的 MCP tool 并保存版本快照。',
    icon: ServerCog,
  },
} satisfies Record<
  ToolSource,
  {
    title: string
    description: string
    icon: typeof Boxes
  }
>

export function AgentToolsForm({
  workspaceId,
  agentId,
  initialTools,
  onSaved,
  readOnly = false,
}: {
  workspaceId: string
  agentId: string
  initialTools: ToolCatalogItem[]
  onSaved?: () => void | Promise<void>
  readOnly?: boolean
}) {
  const [tools, setTools] = useState(initialTools)
  const [selected, setSelected] = useState(
    () =>
      new Set(
        initialTools
          .filter((tool) => tool.selected)
          .map((tool) => tool.versionId),
      ),
  )
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SourceFilter>('all')
  const [creatorOpen, setCreatorOpen] = useState(false)
  const [creatorSource, setCreatorSource] = useState<ToolSource | null>(null)
  const [editingTool, setEditingTool] = useState<ToolCatalogItem | null>(null)
  const [deletingTool, setDeletingTool] = useState<ToolCatalogItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filteredTools = useMemo(() => {
    if (readOnly) return tools.filter((tool) => tool.selected)
    const normalized = query.trim().toLocaleLowerCase()
    return tools.filter((tool) => {
      if (filter !== 'all' && tool.source !== filter) return false
      if (!normalized) return true
      return [tool.name, tool.description, tool.runtimeName]
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalized)
    })
  }, [filter, query, readOnly, tools])

  const builtinTools = tools.filter((tool) => tool.source === 'builtin')

  function toggleTool(versionId: string, enabled: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (enabled) next.add(versionId)
      else next.delete(versionId)
      return next
    })
    setSaved(false)
  }

  function addCreatedTools(created: ToolCatalogItem[]) {
    setTools((current) => [
      ...created,
      ...current.filter(
        (tool) => !created.some((item) => item.versionId === tool.versionId),
      ),
    ])
    setCreatorOpen(false)
    setCreatorSource(null)
  }

  function applyRevisedTools(updated: ToolCatalogItem[]) {
    setTools(updated)
    setSelected(
      new Set(
        updated.filter((tool) => tool.selected).map((tool) => tool.versionId),
      ),
    )
    setEditingTool(null)
    setSaved(true)
    void onSaved?.()
  }

  function openCreator() {
    setCreatorOpen(true)
    setCreatorSource(null)
    setError(null)
  }

  async function saveTools(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const updated = await replaceAgentToolsRequest(workspaceId, agentId, [
        ...selected,
      ])
      setTools(updated)
      setSelected(
        new Set(
          updated.filter((tool) => tool.selected).map((tool) => tool.versionId),
        ),
      )
      setSaved(true)
      void onSaved?.()
    } catch {
      setError('工具配置保存失败，请检查权限后重试。')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDeleteTool() {
    if (!deletingTool || deleting) return
    setDeleting(true)
    setError(null)
    try {
      const updated = await deleteAgentCapabilityRequest(
        workspaceId,
        agentId,
        'tool',
        deletingTool.versionId,
      )
      setTools(updated)
      setSelected(
        new Set(
          updated.filter((tool) => tool.selected).map((tool) => tool.versionId),
        ),
      )
      if (editingTool?.id === deletingTool.id) setEditingTool(null)
      setDeletingTool(null)
      setSaved(true)
      void onSaved?.()
    } catch {
      setError('工具删除失败，请检查权限后重试。')
    } finally {
      setDeleting(false)
    }
  }

  const SelectedSourceIcon = creatorSource
    ? sourceDetails[creatorSource].icon
    : null

  return (
    <div className="grid gap-5">
      <section className="agent-panel p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">工具目录</h2>
              <span className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2 py-0.5 font-mono text-[9px] text-[var(--sea-ink-soft)]">
                已启用 {selected.size}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-[var(--sea-ink-soft)]">
              {readOnly
                ? '这里只展示当前发布版本绑定的工具；现有对话会固定使用这些工具版本。'
                : '选择版本化工具；发布后，现有对话会继续使用原来的工具版本。'}
            </p>
          </div>
          {!readOnly ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (creatorOpen) {
                  setCreatorOpen(false)
                  setCreatorSource(null)
                } else {
                  openCreator()
                }
              }}
            >
              {creatorOpen ? (
                <X aria-hidden="true" />
              ) : (
                <Plus aria-hidden="true" />
              )}
              {creatorOpen ? '取消添加' : '添加工具'}
            </Button>
          ) : null}
        </div>

        {!readOnly ? (
          <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[var(--sea-ink-soft)]"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="搜索工具"
                placeholder="搜索名称、描述或运行时名称"
                className="h-9 pl-9"
              />
            </div>
            <div className="flex flex-wrap gap-1.5" aria-label="工具来源筛选">
              {filters.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={filter === option.value}
                  onClick={() => setFilter(option.value)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                    filter === option.value
                      ? 'border-[var(--lagoon-deep)] bg-[var(--lagoon)]/12 text-[var(--sea-ink)]'
                      : 'border-[var(--line)] bg-white/30 text-[var(--sea-ink-soft)] hover:bg-white/60',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {!readOnly && creatorOpen ? (
        <section className="agent-panel p-5 sm:p-6">
          <div>
            <h2 className="text-sm font-semibold">添加工具</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--sea-ink-soft)]">
              先选择工具来源，再进入对应的注册、导入或发现流程。
            </p>
          </div>
          <div className="mt-4">
            <ToolSourcePicker
              value={creatorSource}
              onSelect={setCreatorSource}
            />
          </div>

          {creatorSource ? (
            <div className="mt-5 border-t border-[var(--line)] pt-5">
              <div className="mb-4 flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--lagoon-deep)]">
                  {SelectedSourceIcon ? (
                    <SelectedSourceIcon aria-hidden="true" className="size-4" />
                  ) : null}
                </span>
                <div>
                  <h3 className="text-sm font-semibold">
                    {sourceDetails[creatorSource].title}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-[var(--sea-ink-soft)]">
                    {sourceDetails[creatorSource].description}
                  </p>
                </div>
              </div>

              {creatorSource === 'builtin' ? (
                builtinTools.length > 0 ? (
                  <div className="grid gap-2">
                    {builtinTools.map((tool) => (
                      <div
                        key={tool.versionId}
                        className="rounded-xl border border-[var(--line)] bg-white/30 px-4 py-3"
                      >
                        <p className="text-xs font-semibold">{tool.name}</p>
                        <p className="mt-1 text-[10px] leading-4 text-[var(--sea-ink-soft)]">
                          {tool.description || '平台内置工具。'}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-[var(--line)] px-4 py-8 text-center">
                    <p className="text-xs font-semibold">
                      平台尚未注册内置工具
                    </p>
                    <p className="mt-1 text-[10px] leading-4 text-[var(--sea-ink-soft)]">
                      内置工具需要由平台代码注册并发布后才能在这里选择。
                    </p>
                  </div>
                )
              ) : null}

              {creatorSource === 'http' ? (
                <HttpToolForm
                  workspaceId={workspaceId}
                  onCreated={(tool) => addCreatedTools([tool])}
                />
              ) : null}

              {creatorSource === 'openapi' ? (
                <OpenApiToolForm
                  workspaceId={workspaceId}
                  onCreated={addCreatedTools}
                />
              ) : null}

              {creatorSource === 'mcp' ? (
                <McpToolForm
                  workspaceId={workspaceId}
                  onCreated={addCreatedTools}
                />
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {filteredTools.length > 0 ? (
        <div className="grid gap-3">
          {filteredTools.map((tool) => {
            const checked = selected.has(tool.versionId)
            return (
              <article
                key={tool.versionId}
                className={cn(
                  'agent-panel p-5 transition-colors',
                  checked &&
                    'border-[var(--lagoon-deep)] bg-[color-mix(in_oklab,var(--lagoon)_8%,var(--surface-strong))]',
                )}
              >
                <div className="flex items-start gap-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--lagoon-deep)]">
                    {tool.source === 'http' ? (
                      <Globe2 aria-hidden="true" className="size-4" />
                    ) : tool.source === 'openapi' ? (
                      <FileJson2 aria-hidden="true" className="size-4" />
                    ) : tool.source === 'mcp' ? (
                      <ServerCog aria-hidden="true" className="size-4" />
                    ) : (
                      <Code2 aria-hidden="true" className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold">{tool.name}</h3>
                      <span className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2 py-0.5 font-mono text-[9px] text-[var(--kicker)]">
                        {sourceLabels[tool.source]} · v{tool.version}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs leading-5 text-[var(--sea-ink-soft)]">
                      {tool.description || '尚未填写工具描述。'}
                    </p>
                    <p className="mt-2 truncate font-mono text-[10px] text-[var(--sea-ink-soft)]">
                      {tool.method ? `${tool.method} ` : ''}
                      {tool.endpoint || tool.runtimeName}
                    </p>
                  </div>
                  {readOnly ? (
                    <span className="shrink-0 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2.5 py-1 text-[9px] font-semibold text-[var(--palm)]">
                      已启用
                    </span>
                  ) : (
                    <div className="flex shrink-0 items-center gap-1">
                      {tool.source !== 'builtin' ? (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`编辑 ${tool.name}`}
                            onClick={() =>
                              setEditingTool((current) =>
                                current?.versionId === tool.versionId
                                  ? null
                                  : tool,
                              )
                            }
                          >
                            <Pencil aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`删除 ${tool.name}`}
                            onClick={() => setDeletingTool(tool)}
                          >
                            <Trash2
                              aria-hidden="true"
                              className="text-destructive"
                            />
                          </Button>
                        </>
                      ) : null}
                      <Switch
                        checked={checked}
                        onCheckedChange={(enabled) =>
                          toggleTool(tool.versionId, enabled)
                        }
                        aria-label={`启用 ${tool.name}`}
                      />
                    </div>
                  )}
                </div>
                {editingTool?.versionId === tool.versionId ? (
                  <div className="mt-4 border-t border-[var(--line)] pt-4">
                    {tool.source === 'http' ? (
                      <HttpToolForm
                        workspaceId={workspaceId}
                        agentId={agentId}
                        initialTool={editingTool}
                        onUpdated={applyRevisedTools}
                        onCancel={() => setEditingTool(null)}
                      />
                    ) : null}
                    {tool.source === 'openapi' ? (
                      <OpenApiToolForm
                        workspaceId={workspaceId}
                        agentId={agentId}
                        initialTool={editingTool}
                        onUpdated={applyRevisedTools}
                        onCancel={() => setEditingTool(null)}
                      />
                    ) : null}
                    {tool.source === 'mcp' ? (
                      <McpToolForm
                        workspaceId={workspaceId}
                        agentId={agentId}
                        initialTool={editingTool}
                        onUpdated={applyRevisedTools}
                        onCancel={() => setEditingTool(null)}
                      />
                    ) : null}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      ) : (
        <section className="agent-panel flex min-h-52 flex-col items-center justify-center px-6 py-10 text-center">
          <span className="grid size-11 place-items-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--lagoon-deep)]">
            <Code2 aria-hidden="true" className="size-5" />
          </span>
          <h2 className="mt-4 text-sm font-semibold">
            {readOnly
              ? '当前版本没有启用工具'
              : tools.length === 0
                ? '还没有工具定义'
                : '没有匹配的工具'}
          </h2>
          <p className="mt-1 max-w-md text-xs leading-5 text-[var(--sea-ink-soft)]">
            {readOnly
              ? '发布版本未绑定任何工具。'
              : tools.length === 0
                ? '先添加一个工具，再选择是否绑定到当前 Agent。'
                : '尝试更换关键词或来源筛选。'}
          </p>
          {!readOnly && tools.length === 0 && !creatorOpen ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-4"
              onClick={openCreator}
            >
              <Plus aria-hidden="true" />
              添加第一个工具
            </Button>
          ) : null}
        </section>
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {!readOnly ? (
        <form
          onSubmit={saveTools}
          className="flex items-center justify-end gap-3"
        >
          {saved ? (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--palm)]"
            >
              <Check aria-hidden="true" className="size-3.5" />
              工具配置已保存
            </span>
          ) : null}
          <Button type="submit" disabled={saving}>
            {saving ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : null}
            {saving ? '保存中…' : '保存工具配置'}
          </Button>
        </form>
      ) : null}

      <AlertDialog
        open={Boolean(deletingTool)}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeletingTool(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除工具？</AlertDialogTitle>
            <AlertDialogDescription>
              “{deletingTool?.name}”会从工具目录和所有 Agent
              草稿中移除。已发布版本和旧对话仍保留原工具版本。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={deleting}
              onClick={() => setDeletingTool(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={() => void confirmDeleteTool()}
            >
              {deleting ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : (
                <Trash2 aria-hidden="true" />
              )}
              确认删除
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
