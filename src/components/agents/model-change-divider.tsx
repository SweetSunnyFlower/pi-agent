import { ArrowRight } from 'lucide-react'

export function ModelChangeDivider({ modelId }: { modelId: string }) {
  return (
    <div
      role="separator"
      aria-label={`模型切换到 ${modelId}`}
      className="flex items-center gap-3 py-1 text-[10px]"
    >
      <span className="h-px flex-1 bg-[var(--line)]" />
      <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1 font-medium text-[var(--sea-ink-soft)] shadow-[0_1px_0_var(--inset-glint)_inset]">
        <ArrowRight
          aria-hidden="true"
          className="size-3 shrink-0 text-[var(--lagoon-deep)]"
        />
        <span className="truncate">以下内容由 · {modelId} · 生成</span>
      </span>
      <span className="h-px flex-1 bg-[var(--line)]" />
    </div>
  )
}
