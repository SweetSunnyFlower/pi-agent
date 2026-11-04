import { cn } from '#/lib/utils'

import { Skeleton } from '../ui/skeleton'
import { LoadingRegion } from './loading-region'

type AgentFormVariant = 'prompt' | 'tools' | 'skills' | 'channels' | 'publish'

function HeaderPlaceholder() {
  return (
    <header className="flex flex-col gap-5 border-(--line) pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="w-full max-w-2xl">
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="mt-3 h-9 w-3/5 min-w-56" />
        <Skeleton className="mt-4 h-3 w-full max-w-xl" />
        <Skeleton className="mt-2 h-3 w-4/5 max-w-lg" />
      </div>
    </header>
  )
}

function AgentCardPlaceholder() {
  return (
    <div
      data-skeleton-card
      className="agent-home-card min-h-64 gap-5"
      aria-hidden="true"
    >
      <div className="flex gap-3">
        <Skeleton className="size-10 rounded-xl" />
        <div className="flex-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-3 h-3 w-48" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((item) => (
          <div key={item}>
            <Skeleton className="h-2.5 w-12" />
            <Skeleton className="mt-2 h-3 w-full" />
          </div>
        ))}
      </div>
      <div className="mt-auto flex justify-end border-t border-[var(--line)] pt-4">
        <Skeleton className="h-8 w-28 rounded-lg" />
      </div>
    </div>
  )
}

function AgentCardItems({ count = 3 }: { count?: number }) {
  return (
    <div className="agent-home-grid">
      {Array.from({ length: count }, (_, index) => (
        <AgentCardPlaceholder key={index} />
      ))}
    </div>
  )
}

export function AgentCardGridSkeleton({ count = 3 }: { count?: number }) {
  return (
    <LoadingRegion label="正在加载 Agent">
      <AgentCardItems count={count} />
    </LoadingRegion>
  )
}

export function HomePageSkeleton() {
  return (
    <main className="agent-home">
      <LoadingRegion label="正在加载工作区">
        <div className="agent-home-topbar">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-xl" />
            <div>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2 h-2 w-16" />
            </div>
          </div>
          <Skeleton className="h-9 w-32 rounded-full" />
        </div>

        <section className="agent-home-hero">
          <div>
            <Skeleton className="h-2.5 w-44" />
            <Skeleton className="mt-6 h-20 w-full max-w-3xl rounded-2xl" />
            <Skeleton className="mt-3 h-20 w-4/5 max-w-2xl rounded-2xl" />
            <Skeleton className="mt-8 h-4 w-full max-w-xl" />
            <Skeleton className="mt-2 h-4 w-4/5 max-w-lg" />
            <Skeleton className="mt-8 h-10 w-36 rounded-lg" />
          </div>
          <div className="agent-home-principles min-h-80">
            <Skeleton data-tone="dark" className="h-2.5 w-24" />
            <Skeleton data-tone="dark" className="mt-5 h-8 w-44" />
            <Skeleton data-tone="dark" className="mt-5 h-3 w-full" />
            <Skeleton data-tone="dark" className="mt-2 h-3 w-4/5" />
            <div className="mt-12 grid grid-cols-3 gap-4">
              {[0, 1, 2].map((item) => (
                <div key={item}>
                  <Skeleton data-tone="dark" className="h-2.5 w-16" />
                  <Skeleton data-tone="dark" className="mt-3 h-5 w-12" />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="agent-home-workspace">
          <div className="agent-home-workspace-heading">
            <div>
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="mt-3 h-7 w-44" />
            </div>
            <Skeleton className="h-9 w-28 rounded-lg" />
          </div>
          <div className="mt-8">
            <Skeleton className="h-6 w-32" />
            <div className="mt-4">
              <AgentCardItems />
            </div>
          </div>
        </section>
      </LoadingRegion>
    </main>
  )
}

export function CreateAgentPageSkeleton() {
  return (
    <div className="agent-workspace-page max-w-[1160px]">
      <LoadingRegion label="正在加载创建表单">
        <Skeleton className="mb-6 h-4 w-16" />
        <HeaderPlaceholder />
        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="agent-panel space-y-7 p-6 sm:p-8">
            {[0, 1, 2].map((item) => (
              <div key={item}>
                <Skeleton className="h-3.5 w-24" />
                <Skeleton
                  className={cn(
                    'mt-3 w-full rounded-xl',
                    item === 1 ? 'h-28' : 'h-10',
                  )}
                />
              </div>
            ))}
            <div className="flex justify-end gap-3 border-t border-[var(--line)] pt-6">
              <Skeleton className="h-9 w-20 rounded-lg" />
              <Skeleton className="h-9 w-28 rounded-lg" />
            </div>
          </div>
          <div className="agent-panel h-fit space-y-5 p-6">
            <Skeleton className="h-2.5 w-20" />
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="flex gap-3">
                <Skeleton className="size-7 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="mt-2 h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </LoadingRegion>
    </div>
  )
}

function ProviderCardItems() {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {[0, 1].map((item) => (
        <div key={item} className="agent-panel space-y-5 p-5" aria-hidden="true">
          <div className="flex gap-3">
            <Skeleton className="size-10 rounded-xl" />
            <div className="flex-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-3 h-3 w-4/5" />
            </div>
          </div>
          <div className="space-y-2 border-t border-[var(--line)] pt-4">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
          <div className="flex justify-end gap-2">
            <Skeleton className="h-8 w-20 rounded-lg" />
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function ProviderListSkeleton() {
  return (
    <LoadingRegion label="正在加载供应商">
      <ProviderCardItems />
    </LoadingRegion>
  )
}

export function ProviderPageSkeleton() {
  return (
    <main className="agent-workspace-page max-w-[1180px]">
      <LoadingRegion label="正在加载供应商页面">
        <Skeleton className="mb-6 h-4 w-24" />
        <HeaderPlaceholder />
        <div className="mt-8">
          <ProviderCardItems />
        </div>
      </LoadingRegion>
    </main>
  )
}

function AgentFormPlaceholder({ variant }: { variant: AgentFormVariant }) {
  if (variant === 'publish') {
    return (
      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="agent-panel space-y-4 p-6">
          {[0, 1, 2].map((item) => (
            <div key={item} className="flex gap-3">
              <Skeleton className="size-5 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="mt-2 h-3 w-4/5" />
              </div>
            </div>
          ))}
        </div>
        <div className="agent-panel space-y-4 p-6">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      </div>
    )
  }

  if (variant === 'channels') {
    return (
      <div className="mt-6 grid gap-5">
        {[0, 1].map((item) => (
          <div key={item} className="agent-panel p-6">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-6 w-12 rounded-full" />
            </div>
            <Skeleton className="mt-5 h-10 w-full rounded-lg" />
            <Skeleton className="mt-3 h-10 w-full rounded-lg" />
          </div>
        ))}
      </div>
    )
  }

  if (variant === 'prompt') {
    return (
      <div className="mt-6 grid gap-5">
        <div className="agent-panel grid gap-5 p-6 sm:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <div key={item}>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-10 w-full rounded-lg" />
            </div>
          ))}
        </div>
        <div className="agent-panel p-6">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-64 w-full rounded-xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="mt-6 grid gap-5">
      <div className="agent-panel p-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-3 h-3 w-72 max-w-full" />
          </div>
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
        <Skeleton className="mt-5 h-9 w-full rounded-lg" />
      </div>
      {[0, 1, 2].map((item) => (
        <div key={item} className="agent-panel flex gap-4 p-5">
          <Skeleton className="size-10 rounded-xl" />
          <div className="flex-1">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-3 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-3/4" />
          </div>
          <Skeleton className="h-6 w-10 rounded-full" />
        </div>
      ))}
    </div>
  )
}

export function AgentFormSkeleton({
  variant = 'prompt',
}: {
  variant?: AgentFormVariant
}) {
  return (
    <LoadingRegion label="正在加载 Agent 配置">
      <HeaderPlaceholder />
      <AgentFormPlaceholder variant={variant} />
    </LoadingRegion>
  )
}

export function AgentWorkspaceShellSkeleton() {
  return (
    <div className="agent-workspace-page">
      <LoadingRegion label="正在加载 Agent 工作区">
        <div className="mb-5 flex items-center gap-2">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="size-3 rounded-sm" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="size-3 rounded-sm" />
          <Skeleton className="h-3 w-28" />
        </div>
        <div className="agent-workspace-grid">
          <aside className="agent-rail" aria-hidden="true">
            <div className="flex gap-3">
              <Skeleton className="size-12 rounded-2xl" />
              <div className="flex-1">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="mt-3 h-5 w-16 rounded-full" />
              </div>
            </div>
            <Skeleton className="my-5 h-px w-full" />
            <Skeleton className="h-2.5 w-12" />
            <Skeleton className="mt-3 h-3 w-32" />
            <div className="mt-7 space-y-3">
              {Array.from({ length: 7 }, (_, index) => (
                <Skeleton key={index} className="h-9 w-full rounded-lg" />
              ))}
            </div>
          </aside>
          <main className="min-w-0" aria-hidden="true">
            <HeaderPlaceholder />
            <AgentFormPlaceholder variant="prompt" />
          </main>
          <aside className="agent-status-rail" aria-hidden="true">
            <Skeleton className="h-2.5 w-20" />
            <div className="mt-5 flex justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="size-4 rounded-full" />
            </div>
            <Skeleton className="mt-4 h-1.5 w-full rounded-full" />
            <div className="mt-7 space-y-5">
              {[0, 1, 2].map((item) => (
                <div key={item}>
                  <Skeleton className="h-2.5 w-12" />
                  <Skeleton className="mt-2 h-3 w-24" />
                </div>
              ))}
            </div>
          </aside>
        </div>
      </LoadingRegion>
    </div>
  )
}

export function ChatLoadingSkeleton() {
  return (
    <LoadingRegion label="正在加载对话" className="space-y-5 py-4">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className={cn('flex gap-3', item % 2 === 1 && 'justify-end')}
          aria-hidden="true"
        >
          <Skeleton className="size-7 rounded-full" />
          <div className={cn('w-3/5', item % 2 === 1 && 'order-first')}>
            <Skeleton className="h-16 w-full rounded-2xl" />
          </div>
        </div>
      ))}
    </LoadingRegion>
  )
}

export function ConversationHistorySkeleton() {
  return (
    <LoadingRegion label="正在加载历史对话" className="space-y-2 p-3">
      {[0, 1, 2, 3].map((item) => (
        <div
          key={item}
          className="flex gap-3 rounded-xl border border-[var(--line)] p-3"
          aria-hidden="true"
        >
          <Skeleton className="size-8 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="mt-2 h-3 w-full" />
            <Skeleton className="mt-2 h-2.5 w-20" />
          </div>
        </div>
      ))}
    </LoadingRegion>
  )
}
