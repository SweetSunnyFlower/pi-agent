import { Boxes, FileJson2, Globe2, ServerCog } from 'lucide-react'

import { cn } from '#/lib/utils'

export type ToolSource = 'builtin' | 'http' | 'openapi' | 'mcp'

const sources = [
  {
    id: 'builtin',
    title: '内置工具',
    ariaLabel: '选择内置工具',
    description: '使用平台代码注册并审核过的工具。',
    icon: Boxes,
  },
  {
    id: 'http',
    title: 'HTTP 工具',
    ariaLabel: '选择 HTTP 工具',
    description: '手动定义一个 HTTP 接口与输入 Schema。',
    icon: Globe2,
  },
  {
    id: 'openapi',
    title: 'OpenAPI 文档',
    ariaLabel: '选择 OpenAPI 文档',
    description: '导入文档并选择其中的 API operation。',
    icon: FileJson2,
  },
  {
    id: 'mcp',
    title: 'MCP 服务',
    ariaLabel: '选择 MCP 服务',
    description: '连接远程 MCP Server 并发现可用工具。',
    icon: ServerCog,
  },
] as const

export function ToolSourcePicker({
  value,
  onSelect,
}: {
  value: ToolSource | null
  onSelect: (source: ToolSource) => void
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {sources.map((source) => {
        const Icon = source.icon
        const selected = value === source.id
        return (
          <button
            key={source.id}
            type="button"
            aria-label={source.ariaLabel}
            aria-pressed={selected}
            onClick={() => onSelect(source.id)}
            className={cn(
              'rounded-xl border p-4 text-left transition-colors',
              selected
                ? 'border-[var(--lagoon-deep)] bg-[color-mix(in_oklab,var(--lagoon)_10%,var(--surface-strong))]'
                : 'border-[var(--line)] bg-white/30 hover:bg-white/60',
            )}
          >
            <span className="grid size-8 place-items-center rounded-lg border border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--lagoon-deep)]">
              <Icon aria-hidden="true" className="size-3.5" />
            </span>
            <span className="mt-3 block text-xs font-semibold">
              {source.title}
            </span>
            <span className="mt-1 block text-[10px] leading-4 text-[var(--sea-ink-soft)]">
              {source.description}
            </span>
          </button>
        )
      })}
    </div>
  )
}
