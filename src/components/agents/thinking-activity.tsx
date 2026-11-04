import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

import { Button } from '#/components/ui/button'
import type { ChatUsage } from '#/lib/api/platform-client'
import { cn } from '#/lib/utils'

function compactNumber(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}m`
  }
  if (value >= 1_000) {
    const thousands = value / 1_000
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}k`
  }
  return String(value)
}

function UsageLabel({ usage }: { usage: ChatUsage }) {
  return (
    <span
      className="flex shrink-0 items-center gap-2 font-mono text-[9px] text-[var(--sea-ink-soft)]"
      title={`输入 ${usage.input} · 输出 ${usage.output} · 缓存读取 ${usage.cacheRead} · 缓存写入 ${usage.cacheWrite} · 总计 ${usage.totalTokens} tokens`}
    >
      <span className="hidden items-center gap-1.5 sm:flex">
        <span>输入 {compactNumber(usage.input)}</span>
        <span aria-hidden="true" className="text-[var(--line)]">
          /
        </span>
        <span>输出 {compactNumber(usage.output)}</span>
        <span aria-hidden="true" className="text-[var(--line)]">
          /
        </span>
      </span>
      <span className="whitespace-nowrap text-[var(--lagoon-deep)]">
        总计 {compactNumber(usage.totalTokens)}
      </span>
    </span>
  )
}

export function ThinkingActivity({
  thinking,
  usage,
}: {
  thinking?: string
  usage?: ChatUsage
}) {
  const [expanded, setExpanded] = useState(false)
  const lines = (thinking ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) return null

  return (
    <section
      aria-label="思考过程"
      aria-live="polite"
      className="thinking-activity w-full max-w-[40rem]"
    >
      <div className="flex min-h-8 items-center gap-2">
        <span className="thinking-activity-label">过程</span>
        <div className="thinking-activity-viewport" data-testid="thinking-clip">
          <div
            data-testid="thinking-track"
            className="thinking-activity-track"
            style={{
              transform: expanded
                ? 'translateY(0)'
                : `translateY(-${Math.max(0, lines.length - 1) * 24}px)`,
            }}
          >
            {lines.map((line, index) => (
              <p key={index}>{line}</p>
            ))}
          </div>
        </div>
        {usage ? <UsageLabel usage={usage} /> : null}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={expanded ? '收起思考过程' : '展开思考过程'}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="size-7 shrink-0 rounded-full text-[var(--sea-ink-soft)]"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-3.5 transition-transform duration-[180ms]',
              expanded && 'rotate-180',
            )}
          />
        </Button>
      </div>
      {expanded ? (
        <div
          data-testid="thinking-expanded"
          className="thinking-activity-expanded whitespace-pre-wrap"
        >
          {thinking}
          {usage && usage.costTotal > 0 ? (
            <p className="mt-2 text-[10px] text-[var(--kicker)]">
              费用 ${usage.costTotal.toFixed(4)}
              {usage.reasoning !== undefined
                ? ` · 推理 ${compactNumber(usage.reasoning)} tokens`
                : ''}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
