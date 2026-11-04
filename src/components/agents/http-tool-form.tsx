import { Check, LoaderCircle } from 'lucide-react'
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
import { Textarea } from '#/components/ui/textarea'
import {
  createHttpToolRequest,
  reviseAgentToolRequest,
} from '#/lib/api/platform-client'
import type { ToolCatalogItem } from '#/lib/api/platform-client'

const defaultInputSchema = JSON.stringify(
  {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  null,
  2,
)

export function HttpToolForm({
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
  onCreated?: (tool: ToolCatalogItem) => void
  onUpdated?: (tools: ToolCatalogItem[]) => void
  onCancel?: () => void
}) {
  const editing = Boolean(initialTool)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState(initialTool?.name ?? '')
  const [description, setDescription] = useState(initialTool?.description ?? '')
  const [endpoint, setEndpoint] = useState(initialTool?.endpoint ?? '')
  const [method, setMethod] = useState<
    'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  >(
    initialTool?.method === 'GET' ||
      initialTool?.method === 'PUT' ||
      initialTool?.method === 'PATCH' ||
      initialTool?.method === 'DELETE'
      ? initialTool.method
      : 'POST',
  )
  const [inputSchema, setInputSchema] = useState(
    initialTool?.inputSchema
      ? JSON.stringify(initialTool.inputSchema, null, 2)
      : defaultInputSchema,
  )

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim() || !endpoint.trim()) {
      setError('请填写工具名称和接口地址。')
      return
    }

    let parsedSchema: Record<string, unknown>
    try {
      const value: unknown = JSON.parse(inputSchema)
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('invalid schema')
      }
      parsedSchema = value as Record<string, unknown>
    } catch {
      setError('输入 Schema 必须是合法的 JSON 对象。')
      return
    }

    setCreating(true)
    setError(null)
    try {
      const input = {
        name: name.trim(),
        description: description.trim(),
        endpoint: endpoint.trim(),
        method,
        inputSchema: parsedSchema,
      }
      if (initialTool) {
        if (!agentId) throw new Error('agent id is required for edits')
        onUpdated?.(
          await reviseAgentToolRequest(
            workspaceId,
            agentId,
            initialTool.versionId,
            { kind: 'http', ...input },
          ),
        )
      } else {
        const created = await createHttpToolRequest(workspaceId, input)
        onCreated?.(created)
      }
    } catch {
      setError(
        editing
          ? '新版本保存失败，请检查接口地址和输入 Schema 后重试。'
          : '工具定义创建失败，请检查名称是否重复或接口地址是否有效。',
      )
    } finally {
      setCreating(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor="tool-name" className="text-xs font-semibold">
            工具名称
          </label>
          <Input
            id="tool-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            placeholder="例如：查询工单"
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="tool-endpoint" className="text-xs font-semibold">
            接口地址
          </label>
          <Input
            id="tool-endpoint"
            type="url"
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
            placeholder="https://api.example.com/tools/lookup"
          />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <label htmlFor="tool-description" className="text-xs font-semibold">
            工具描述
          </label>
          <Textarea
            id="tool-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={500}
            rows={2}
            placeholder="告诉模型这个工具什么时候应该被调用。"
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="tool-method" className="text-xs font-semibold">
            请求方法
          </label>
          <Select
            value={method}
            onValueChange={(value) => setMethod(value as typeof method)}
          >
            <SelectTrigger id="tool-method" className="w-full bg-transparent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="w-full">
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <p className="pb-1 font-mono text-[10px] leading-4 text-[var(--sea-ink-soft)]">
            {editing
              ? '保存后创建新的工具版本，并自动切换当前 Agent 草稿的绑定。'
              : '首次创建版本为 1.0.0，后续编辑会创建新版本。'}
          </p>
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <label htmlFor="tool-input-schema" className="text-xs font-semibold">
            输入 Schema
          </label>
          <Textarea
            id="tool-input-schema"
            value={inputSchema}
            onChange={(event) => setInputSchema(event.target.value)}
            rows={9}
            spellCheck={false}
            className="font-mono text-xs leading-5"
          />
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex justify-end gap-2">
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={creating}
            onClick={onCancel}
          >
            取消编辑
          </Button>
        ) : null}
        <Button type="submit" size="sm" disabled={creating}>
          {creating ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <Check aria-hidden="true" />
          )}
          {creating
            ? editing
              ? '保存中…'
              : '创建中…'
            : editing
              ? '保存新版本'
              : '保存工具定义'}
        </Button>
      </div>
    </form>
  )
}
