# Page Loading Skeletons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add accessible, layout-matched loading skeletons to every browser-rendered page while keeping mutation feedback inside the triggering buttons.

**Architecture:** A shared `Skeleton` primitive and `LoadingRegion` wrapper provide styling and accessibility. A semantic skeleton module composes those primitives into page-specific layouts, and route/feature components switch to them only during initial or list-loading states.

**Tech Stack:** React 19, TanStack Router, Tailwind CSS, project CSS variables, Vitest, Testing Library.

## Global Constraints

- Page skeletons cover initial page data loading and list replacement.
- Save, publish, upload, provider test, and channel test actions keep inline button loading.
- Every loading region exposes `role="status"`, `aria-busy="true"`, and a Chinese accessible label.
- Decorative skeleton blocks are hidden from assistive technology.
- Shimmer animation is disabled by `prefers-reduced-motion`.
- Existing user changes in `agent-page-header.tsx`, `model-change-divider.tsx`, and the chat route must not be staged or committed.
- Use Chinese UI copy.

---

## File Structure

Create:

- `src/components/ui/skeleton.tsx` — shared decorative skeleton primitive.
- `src/components/loading/loading-region.tsx` — accessible loading wrapper.
- `src/components/loading/page-skeletons.tsx` — semantic page and list skeletons.
- `src/components/ui/skeleton.test.tsx` — primitive and loading-region tests.
- `src/components/loading/page-skeletons.test.tsx` — semantic skeleton coverage.

Modify:

- `src/styles.css` — shimmer token, animation, and reduced-motion behavior.
- `src/components/home/agent-home-dashboard.tsx` — initial page and card-list skeletons.
- `src/components/home/agent-home-dashboard.test.tsx` — initial loading test.
- `src/routes/w.$workspaceSlug.agents.new.tsx` — creation page skeleton.
- `src/routes/w.$workspaceSlug.providers.tsx` — provider page skeleton.
- `src/components/providers/provider-management.tsx` — provider-list skeleton.
- `src/components/providers/provider-management.test.tsx` — provider loading test.
- `src/routes/w.$workspaceSlug.agents.$agentId.tsx` — Agent shell skeleton.
- `src/components/agents/agent-edit-draft-gate.tsx` — draft-preparation skeleton.
- `src/routes/w.$workspaceSlug.agents.$agentId.prompt.tsx` — prompt form skeleton.
- `src/routes/w.$workspaceSlug.agents.$agentId.tools.tsx` — tools form skeleton.
- `src/routes/w.$workspaceSlug.agents.$agentId.skills.tsx` — Skills form skeleton.
- `src/routes/w.$workspaceSlug.agents.$agentId.channels.tsx` — channels form skeleton.
- `src/routes/w.$workspaceSlug.agents.$agentId.publish.tsx` — publish form skeleton.
- `src/components/agents/agent-chat-panel.tsx` — chat and history skeletons.
- `src/components/agents/agent-chat-panel.test.tsx` — chat loading tests.

---

### Task 1: Shared Skeleton Primitive

**Files:**

- Create: `src/components/ui/skeleton.tsx`
- Create: `src/components/loading/loading-region.tsx`
- Create: `src/components/ui/skeleton.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**

- Produces: `Skeleton(props: React.ComponentProps<'span'>)`
- Produces: `LoadingRegion({ label, className?, children })`

- [ ] **Step 1: Write the failing primitive test**

Create `src/components/ui/skeleton.test.tsx`:

```tsx
// @vitest-environment jsdom

import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { renderUi } from '#/test/ui'

import { LoadingRegion } from '../loading/loading-region'
import { Skeleton } from './skeleton'

afterEach(cleanup)

describe('Skeleton', () => {
  it('renders an accessible loading region with decorative placeholders', () => {
    renderUi(
      <LoadingRegion label="正在加载测试内容">
        <Skeleton data-testid="skeleton-line" className="h-4 w-24" />
      </LoadingRegion>,
    )

    const region = screen.getByRole('status', {
      name: '正在加载测试内容',
    })
    expect(region.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByText('正在加载测试内容')).toBeTruthy()
    expect(screen.getByTestId('skeleton-line').getAttribute('aria-hidden')).toBe(
      'true',
    )
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm test -- src/components/ui/skeleton.test.tsx
```

Expected: failure because `src/components/loading/loading-region.tsx` and `src/components/ui/skeleton.tsx` do not exist.

- [ ] **Step 3: Implement the primitive**

Create `src/components/ui/skeleton.tsx`:

```tsx
import * as React from 'react'

import { cn } from '#/lib/utils'

export function Skeleton({
  className,
  ...props
}: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="skeleton"
      aria-hidden="true"
      className={cn('agent-skeleton', className)}
      {...props}
    />
  )
}
```

Create `src/components/loading/loading-region.tsx`:

```tsx
import { cn } from '#/lib/utils'

export function LoadingRegion({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn(className)}
    >
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}
```

Append to the utility area in `src/styles.css`, immediately after the existing `rise-in` keyframes:

```css
.agent-skeleton {
  position: relative;
  display: block;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(
    in oklab,
    var(--sea-ink-soft) 10%,
    var(--surface-strong)
  );
}

.agent-skeleton::after {
  position: absolute;
  inset: 0;
  content: '';
  transform: translateX(-100%);
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in oklab, white 48%, transparent 52%),
    transparent
  );
  animation: agent-skeleton-shimmer 1.6s ease-in-out infinite;
}

.agent-skeleton[data-tone='dark'] {
  background: rgba(255, 255, 255, 0.12);
}

@keyframes agent-skeleton-shimmer {
  100% {
    transform: translateX(100%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .agent-skeleton::after {
    animation: none;
  }
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```bash
npm test -- src/components/ui/skeleton.test.tsx
```

Expected: one test file and one test pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/skeleton.tsx src/components/loading/loading-region.tsx src/components/ui/skeleton.test.tsx src/styles.css
git commit -m "feat: add shared loading skeleton primitives"
```

---

### Task 2: Semantic Page Skeletons

**Files:**

- Create: `src/components/loading/page-skeletons.tsx`
- Create: `src/components/loading/page-skeletons.test.tsx`

**Interfaces:**

- Consumes: `Skeleton`, `LoadingRegion`
- Produces: `HomePageSkeleton`
- Produces: `AgentCardGridSkeleton({ count? })`
- Produces: `CreateAgentPageSkeleton`
- Produces: `ProviderPageSkeleton`
- Produces: `ProviderListSkeleton`
- Produces: `AgentWorkspaceShellSkeleton`
- Produces: `AgentFormSkeleton({ variant })` where `variant` is `prompt | tools | skills | channels | publish`
- Produces: `ChatLoadingSkeleton`
- Produces: `ConversationHistorySkeleton`

- [ ] **Step 1: Write the failing semantic skeleton tests**

Create `src/components/loading/page-skeletons.test.tsx`:

```tsx
// @vitest-environment jsdom

import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { renderUi } from '#/test/ui'

import {
  AgentCardGridSkeleton,
  AgentFormSkeleton,
  AgentWorkspaceShellSkeleton,
  ChatLoadingSkeleton,
  ConversationHistorySkeleton,
  CreateAgentPageSkeleton,
  HomePageSkeleton,
  ProviderListSkeleton,
  ProviderPageSkeleton,
} from './page-skeletons'

afterEach(cleanup)

describe('page skeletons', () => {
  it.each([
    [<HomePageSkeleton />, '正在加载工作区'],
    [<CreateAgentPageSkeleton />, '正在加载创建表单'],
    [<ProviderPageSkeleton />, '正在加载供应商页面'],
    [<ProviderListSkeleton />, '正在加载供应商'],
    [<AgentWorkspaceShellSkeleton />, '正在加载 Agent 工作区'],
    [<ChatLoadingSkeleton />, '正在加载对话'],
    [<ConversationHistorySkeleton />, '正在加载历史对话'],
  ])('exposes an accessible status for %s', (ui, label) => {
    renderUi(ui)
    expect(screen.getByRole('status', { name: label })).toBeTruthy()
    cleanup()
  })

  it('supports every Agent form variant', () => {
    renderUi(
      <>
        {(['prompt', 'tools', 'skills', 'channels', 'publish'] as const).map(
          (variant) => (
            <AgentFormSkeleton key={variant} variant={variant} />
          ),
        )}
      </>,
    )

    expect(screen.getAllByRole('status')).toHaveLength(5)
  })

  it('renders the requested number of Agent card placeholders', () => {
    renderUi(<AgentCardGridSkeleton count={4} />)
    expect(screen.getByRole('status', { name: '正在加载 Agent' })).toBeTruthy()
    expect(document.querySelectorAll('[data-skeleton-card]')).toHaveLength(4)
  })
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm test -- src/components/loading/page-skeletons.test.tsx
```

Expected: failure because `page-skeletons.tsx` does not exist.

- [ ] **Step 3: Implement the semantic skeletons**

Create `src/components/loading/page-skeletons.tsx`:

```tsx
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

export function AgentCardGridSkeleton({ count = 3 }: { count?: number }) {
  return (
    <LoadingRegion label="正在加载 Agent" className="agent-home-grid">
      {Array.from({ length: count }, (_, index) => (
        <AgentCardPlaceholder key={index} />
      ))}
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
          <div className="mt-8 space-y-10">
            <div>
              <Skeleton className="h-6 w-32" />
              <div className="mt-4">
                <AgentCardGridSkeleton />
              </div>
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

export function ProviderListSkeleton() {
  return (
    <LoadingRegion label="正在加载供应商" className="grid gap-3 lg:grid-cols-2">
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
          <ProviderListSkeleton />
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
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run:

```bash
npm test -- src/components/loading/page-skeletons.test.tsx
```

Expected: all semantic skeleton tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/loading/page-skeletons.tsx src/components/loading/page-skeletons.test.tsx
git commit -m "feat: add semantic page loading skeletons"
```

---

### Task 3: Home, Agent Creation, and Provider Pages

**Files:**

- Modify: `src/components/home/agent-home-dashboard.tsx`
- Modify: `src/components/home/agent-home-dashboard.test.tsx`
- Modify: `src/routes/w.$workspaceSlug.agents.new.tsx`
- Modify: `src/routes/w.$workspaceSlug.providers.tsx`
- Modify: `src/components/providers/provider-management.tsx`
- Modify: `src/components/providers/provider-management.test.tsx`

**Interfaces:**

- Consumes: `HomePageSkeleton`, `AgentCardGridSkeleton`, `CreateAgentPageSkeleton`, `ProviderPageSkeleton`, `ProviderListSkeleton`

- [ ] **Step 1: Add failing home loading test**

Append this test to `src/components/home/agent-home-dashboard.test.tsx`:

```tsx
it('shows an accessible workspace skeleton before authentication resolves', async () => {
  let resolveAuth: ((response: Response) => void) | undefined
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveAuth = resolve
        }),
    ),
  )

  renderUi(<AgentHomeDashboard />)

  expect(
    screen.getByRole('status', { name: '正在加载工作区' }),
  ).toBeTruthy()

  await act(async () => {
    resolveAuth?.(Response.json(auth))
  })

  expect(await screen.findByText('产品研发')).toBeTruthy()
})
```

Add `act` to the Testing Library import.

- [ ] **Step 2: Add failing provider list loading test**

Append this test to `src/components/providers/provider-management.test.tsx`:

```tsx
it('shows a provider list skeleton while loading', () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>(() => {
          // The unresolved request keeps the component in its loading state.
        }),
    ),
  )

  renderUi(<ProviderManagement workspaceId="w1" />)

  expect(screen.getByRole('status', { name: '正在加载供应商' })).toBeTruthy()
})
```

- [ ] **Step 3: Run the tests and verify RED**

Run:

```bash
npm test -- src/components/home/agent-home-dashboard.test.tsx src/components/providers/provider-management.test.tsx
```

Expected: failures because the accessible skeleton statuses are not rendered.

- [ ] **Step 4: Integrate page and list skeletons**

In `agent-home-dashboard.tsx`, import:

```tsx
import {
  AgentCardGridSkeleton,
  HomePageSkeleton,
} from '#/components/loading/page-skeletons'
```

Replace the local `LoadingCards` function with:

```tsx
function LoadingCards() {
  return <AgentCardGridSkeleton />
}
```

Immediately before the current `return (<main className="agent-home">...)`, add:

```tsx
if (!auth && !authError) {
  return <HomePageSkeleton />
}
```

In `w.$workspaceSlug.agents.new.tsx`, import `CreateAgentPageSkeleton` and replace the `!error && !workspace` panel with:

```tsx
{!error && !workspace ? <CreateAgentPageSkeleton /> : null}
```

In `w.$workspaceSlug.providers.tsx`, import `ProviderPageSkeleton` and replace the `!error && !workspace` panel with:

```tsx
{!error && !workspace ? <ProviderPageSkeleton /> : null}
```

In `provider-management.tsx`, import `ProviderListSkeleton` and replace the loading spinner panel with:

```tsx
{loading ? <ProviderListSkeleton /> : null}
```

Remove the now-unused `LoaderCircle` import from `provider-management.tsx`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npm test -- src/components/home/agent-home-dashboard.test.tsx src/components/providers/provider-management.test.tsx
```

Expected: both test files pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/home/agent-home-dashboard.tsx src/components/home/agent-home-dashboard.test.tsx src/routes/w.\$workspaceSlug.agents.new.tsx src/routes/w.\$workspaceSlug.providers.tsx src/components/providers/provider-management.tsx src/components/providers/provider-management.test.tsx
git commit -m "feat: use skeletons on home and setup pages"
```

---

### Task 4: Agent Workspace and Configuration Pages

**Files:**

- Modify: `src/routes/w.$workspaceSlug.agents.$agentId.tsx`
- Modify: `src/components/agents/agent-edit-draft-gate.tsx`
- Modify: `src/components/agents/agent-edit-draft-gate.test.tsx`
- Modify: `src/routes/w.$workspaceSlug.agents.$agentId.prompt.tsx`
- Modify: `src/routes/w.$workspaceSlug.agents.$agentId.tools.tsx`
- Modify: `src/routes/w.$workspaceSlug.agents.$agentId.skills.tsx`
- Modify: `src/routes/w.$workspaceSlug.agents.$agentId.channels.tsx`
- Modify: `src/routes/w.$workspaceSlug.agents.$agentId.publish.tsx`

**Interfaces:**

- Consumes: `AgentWorkspaceShellSkeleton`, `AgentFormSkeleton`

- [ ] **Step 1: Add a semantic shell assertion**

Append this test to `src/components/loading/page-skeletons.test.tsx`:

```tsx
it('preserves the Agent three-column layout while loading', () => {
  renderUi(<AgentWorkspaceShellSkeleton />)
  expect(document.querySelector('.agent-workspace-grid')).toBeTruthy()
  expect(document.querySelector('.agent-rail')).toBeTruthy()
  expect(document.querySelector('.agent-status-rail')).toBeTruthy()
})
```

Change the draft-preparation assertion in
`src/components/agents/agent-edit-draft-gate.test.tsx` from the old status
text to the new accessible skeleton status:

```tsx
expect(
  screen.getByRole('status', { name: '正在加载 Agent 配置' }),
).toBeTruthy()
```

- [ ] **Step 2: Run the assertion and verify RED**

Run:

```bash
npm test -- src/components/loading/page-skeletons.test.tsx -t "three-column"
```

Expected: failure until Task 2's shell skeleton is present; if Task 2 already implemented the markup, this test passes immediately and must remain as regression coverage.

- [ ] **Step 3: Integrate the workspace and section skeletons**

In `w.$workspaceSlug.agents.$agentId.tsx`, import:

```tsx
import { AgentWorkspaceShellSkeleton } from '#/components/loading/page-skeletons'
```

Replace the `if (!data)` spinner block with:

```tsx
if (!data) {
  return <AgentWorkspaceShellSkeleton />
}
```

In `agent-edit-draft-gate.tsx`, import:

```tsx
import { AgentFormSkeleton } from '#/components/loading/page-skeletons'
```

Replace the draft-preparation status panel with:

```tsx
return <AgentFormSkeleton variant="prompt" />
```

In the prompt route, import `AgentFormSkeleton` and replace the `h-80 animate-pulse` panel with:

```tsx
{!readOnly && !error && !modelConfig ? (
  <AgentFormSkeleton variant="prompt" />
) : null}
```

In the tools route, import `AgentFormSkeleton` and replace the panel with:

```tsx
{!error && version && !tools ? (
  <AgentFormSkeleton variant="tools" />
) : null}
```

In the Skills route, import `AgentFormSkeleton` and replace the panel with:

```tsx
{!error && version && !skills ? (
  <AgentFormSkeleton variant="skills" />
) : null}
```

In the channels route, import `AgentFormSkeleton` and replace the panel with:

```tsx
{!error && !config ? (
  <AgentFormSkeleton variant="channels" />
) : null}
```

In the publish route, import `AgentFormSkeleton` and replace the panel with:

```tsx
{!error && !readiness ? (
  <AgentFormSkeleton variant="publish" />
) : null}
```

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
npm test -- src/components/loading/page-skeletons.test.tsx src/components/agents/agent-edit-draft-gate.test.tsx
npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 5: Commit**

```bash
git add src/routes/w.\$workspaceSlug.agents.\$agentId.tsx src/components/agents/agent-edit-draft-gate.tsx src/components/agents/agent-edit-draft-gate.test.tsx src/routes/w.\$workspaceSlug.agents.\$agentId.prompt.tsx src/routes/w.\$workspaceSlug.agents.\$agentId.tools.tsx src/routes/w.\$workspaceSlug.agents.\$agentId.skills.tsx src/routes/w.\$workspaceSlug.agents.\$agentId.channels.tsx src/routes/w.\$workspaceSlug.agents.\$agentId.publish.tsx
git commit -m "feat: use skeletons in Agent configuration pages"
```

---

### Task 5: Chat and History Skeletons

**Files:**

- Modify: `src/components/agents/agent-chat-panel.tsx`
- Modify: `src/components/agents/agent-chat-panel.test.tsx`

**Interfaces:**

- Consumes: `ChatLoadingSkeleton`, `ConversationHistorySkeleton`

- [ ] **Step 1: Add failing chat history loading test**

Append this test to `agent-chat-panel.test.tsx`:

```tsx
it('shows a conversation history skeleton while opening history', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>(() => {
          // Keep the history request pending for the assertion.
        }),
    ),
  )
  const user = userEvent.setup()

  renderUi(
    <AgentChatPanel
      workspaceId="w1"
      agentId="a1"
      agentName="产品评审助手"
    />,
  )

  await user.click(screen.getByRole('button', { name: '历史对话' }))

  expect(
    screen.getByRole('status', { name: '正在加载历史对话' }),
  ).toBeTruthy()
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm test -- src/components/agents/agent-chat-panel.test.tsx -t "history skeleton"
```

Expected: failure because the current history loading state renders a spinner and text instead of an accessible skeleton status.

- [ ] **Step 3: Implement chat loading skeletons**

In `agent-chat-panel.tsx`, import:

```tsx
import {
  ChatLoadingSkeleton,
  ConversationHistorySkeleton,
} from '#/components/loading/page-skeletons'
```

Replace the main conversation-loading spinner branch with:

```tsx
{loadingConversation ? (
  <ChatLoadingSkeleton />
) : messages.length === 0 ? (
```

In the stored-conversation effect, set loading before fetching the saved conversation:

```tsx
const stored = sessionStorage.getItem(storageKey)
if (!stored) return
setConversationId(stored)
setLoadingConversation(true)
getConversationMessages(workspaceId, stored)
  .then((previousMessages) => {
    setMessages(previousMessages)
    const storedModel = latestAssistantModel(previousMessages)
    if (storedModel) {
      setActiveModel(storedModel)
      setSelectedModel({
        provider: storedModel.provider,
        providerLabel: '当前会话模型',
        modelId: storedModel.modelId,
        baseUrl: '',
      })
    }
  })
  .catch(() => sessionStorage.removeItem(storageKey))
  .finally(() => setLoadingConversation(false))
```

Replace the empty-history loading spinner block with:

```tsx
{historyState.status === 'loading' &&
historyState.conversations.length === 0 ? (
  <ConversationHistorySkeleton />
) : null}
```

- [ ] **Step 4: Run chat tests and verify GREEN**

Run:

```bash
npm test -- src/components/agents/agent-chat-panel.test.tsx
```

Expected: all chat panel tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/agents/agent-chat-panel.tsx src/components/agents/agent-chat-panel.test.tsx
git commit -m "feat: use skeletons for chat loading states"
```

---

### Task 6: Verification and Visual QA

**Files:**

- Verify all modified files.

- [ ] **Step 1: Run the complete automated gates**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all tests pass, typecheck and lint exit zero, and production build succeeds.

- [ ] **Step 2: Check skeleton rendering in the browser**

With the dev server at `http://localhost:3000`, use browser automation to:

- Open `/` and observe the initial workspace skeleton.
- Open an Agent edit page and observe the three-column skeleton.
- Open prompt, tools, Skills, channels, and publish routes with throttled API responses.
- Open provider management and conversation history loading states.
- Check desktop width near 1440px and mobile width near 390px.
- Confirm reduced-motion disables shimmer.

Expected: skeletons match final layout, do not overflow, and are replaced by loaded content without console errors.

- [ ] **Step 3: Commit any visual QA fixes**

If Step 2 requires corrections:

```bash
git add src/styles.css src/components/loading/page-skeletons.tsx
git commit -m "fix: refine loading skeleton layout"
```

If no corrections are required, do not create an empty commit.

- [ ] **Step 4: Report the resulting commit range and verification evidence**

Run:

```bash
git log --oneline -7
git status --short
```

Expected: skeleton commits are present and the three pre-existing user-modified files remain unstaged and uncommitted.
