# Add Agent Multi-Page Workspace v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first real, visually complete Agent creation and editing workspace with minimal draft creation, persistent workspace routes, shared navigation, and responsive status UI.

**Architecture:** A workspace-scoped creation page creates a real draft through the existing Agent API. The detail route loads the Agent once and provides a shared left rail, main content outlet, and right status rail. Section pages are independently addressable; v0 renders real basic data and explicit empty states for capability and channel pages that require later backend plans.

**Tech Stack:** TypeScript, React 19, TanStack Router, TanStack Start, Tailwind CSS 4, existing shadcn-style controls, Lucide icons, Vitest, Testing Library.

## Global Constraints

- Routes are prefixed with `/w/:workspaceSlug/agents`.
- The creation page collects only name, description, and visibility.
- Successful creation redirects to `/w/:workspaceSlug/agents/:agentId/basic`.
- Section navigation is not a wizard and must not impose step order.
- Use the existing sea-glass palette and Fraunces/Manrope typography.
- UI accents use `#4fb8b2`, `#328f97`, and `#2f6a4a`; no new brand palette.
- Desktop layout contains a 232px left rail, flexible editor, and 270px status rail.
- Mobile navigation becomes a horizontally scrollable section bar.
- All actions must call real APIs; do not create fake successful mutations.
- Empty capability and channel pages must not display invented data.
- All dialogs and unsaved-change prompts are deferred until the full editor plan.
- The first visual delivery is v0 and must be reviewed before capability persistence work begins.

## File Structure

```text
src/db/schema.ts
src/db/schema.test.ts
src/server/platform/agent-version.server.ts
src/server/platform/agent-version.server.test.ts
src/server/http/agent-http.server.ts
src/server/http/agent-http.server.test.ts
drizzle/
vitest.config.ts
src/test/ui.ts
src/lib/api/platform-client.ts
src/lib/api/platform-client.test.ts
src/lib/agents/agent-sections.ts
src/components/agents/agent-page-header.tsx
src/components/agents/agent-empty-state.tsx
src/components/agents/agent-workspace-shell.tsx
src/components/agents/agent-create-form.tsx
src/components/agents/agent-create-form.test.tsx
src/components/agents/agent-workspace-context.tsx
src/routes/w.$workspaceSlug.agents.new.tsx
src/routes/w.$workspaceSlug.agents.$agentId.tsx
src/routes/w.$workspaceSlug.agents.$agentId.basic.tsx
src/routes/w.$workspaceSlug.agents.$agentId.prompt.tsx
src/routes/w.$workspaceSlug.agents.$agentId.tools.tsx
src/routes/w.$workspaceSlug.agents.$agentId.skills.tsx
src/routes/w.$workspaceSlug.agents.$agentId.channels.tsx
src/routes/w.$workspaceSlug.agents.$agentId.publish.tsx
src/styles.css
```

---

### Task 1: Persist Descriptions and Allow Incomplete Draft Creation

**Files:**

- Modify: `src/db/schema.ts`
- Modify: `src/db/schema.test.ts`
- Modify: `src/server/platform/agent-version.server.ts`
- Modify: `src/server/platform/agent-version.server.test.ts`
- Modify: `src/server/http/agent-http.server.ts`
- Modify: `src/server/http/agent-http.server.test.ts`
- Create: generated migration under `drizzle/`

**Interfaces:**

- Produces:
  - `agents.description: string`
  - `AgentDraftInput.description?: string`
  - `agentDraftInputSchema` accepts `description`
  - Agent creation requires only `name`
  - A new AgentVersion draft may start with an empty prompt, empty model values, and `thinkingLevel: off`
  - Publishing an incomplete draft is rejected
  - Agent creation and draft update APIs persist `description`

- [ ] **Step 1: Add failing persistence tests**

Add `description` to the Agent insert in `src/db/schema.test.ts`:

```ts
db.insert(agents)
  .values({
    id: agentId,
    workspaceId,
    name: 'Reviewer',
    description: 'Reviews product changes.',
    visibility: 'workspace',
    status: 'draft',
    createdBy: userId,
  })
  .run()
```

Then assert:

```ts
const storedAgent = db.select().from(agents).where(eq(agents.id, agentId)).get()

expect(storedAgent?.description).toBe('Reviews product changes.')
```

In `src/server/platform/agent-version.server.test.ts`, add:

```ts
it('creates an incomplete draft from the minimal creation flow', async () => {
  const created = await createAgent(db, principal, workspaceId, {
    name: 'Reviewer',
    description: 'Reviews product changes.',
    visibility: 'workspace',
  })
  const stored = db.select().from(agents).where(eq(agents.id, created.id)).get()
  const draft = db
    .select()
    .from(agentVersions)
    .where(eq(agentVersions.agentId, created.id))
    .get()

  expect(stored?.description).toBe('Reviews product changes.')
  expect(draft?.instructions).toBe('')
  expect(draft?.modelProvider).toBe('')
  expect(draft?.modelId).toBe('')
  expect(draft?.thinkingLevel).toBe('off')
})

it('rejects publishing an incomplete draft', async () => {
  const created = await createAgent(db, principal, workspaceId, {
    name: 'Incomplete',
    description: '',
    visibility: 'workspace',
  })

  await expect(
    publishAgentVersion(db, principal, workspaceId, created.id),
  ).rejects.toThrow(/incomplete draft/i)
})
```

In `src/server/http/agent-http.server.test.ts`, change the create request body to the minimal payload:

```ts
{
  name: 'Reviewer',
  description: 'Reviews product changes.',
  visibility: 'workspace',
}
```

Import `getAgentHandler` in the handler import list and add the direct detail assertion shown below. Remove the unused creation values from the old request body. The `request(...)` call must be:

```ts
const createdResponse = await createAgentHandler(
  request(
    `http://localhost:3000/api/workspaces/${workspaceId}/agents`,
    'POST',
    {
      name: 'Reviewer',
      description: 'Reviews product changes.',
      visibility: 'workspace',
    },
  ),
  { db, env, workspaceId },
)
expect(createdResponse.status).toBe(201)
const created = (await createdResponse.json()) as { id: string }

const detailResponse = await getAgentHandler(
  request(
    `http://localhost:3000/api/agents/${created.id}?workspaceId=${workspaceId}`,
    'GET',
  ),
  { db, env, workspaceId, agentId: created.id },
)
const detail = (await detailResponse.json()) as { description: string }
expect(detail.description).toBe('Reviews product changes.')
```

The full test must not contain a second creation call.

Later in the same test, before publishing, the draft PATCH body must provide the values that the minimal creation flow intentionally omitted:

```ts
{
  instructions: 'Review security and correctness.',
  modelProvider: 'openai',
  modelId: 'gpt-6.1-sol',
  thinkingLevel: 'high',
}
```

The publish assertion remains after this PATCH request.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- src/db/schema.test.ts src/server/platform/agent-version.server.test.ts src/server/http/agent-http.server.test.ts
```

Expected: FAIL because `description` is not defined, minimal draft inputs are rejected, and incomplete publication is not blocked.

- [ ] **Step 3: Add the database column**

In `src/db/schema.ts`, add:

```ts
description: text('description').notNull().default(''),
```

immediately after `name` in the `agents` table.

- [ ] **Step 4: Persist description and support incomplete drafts**

In `agentDraftInputSchema`, add:

```ts
description: z.string().trim().max(500).optional(),
```

Change `AgentDraftInput` so only `name` is required:

```ts
export type AgentDraftInput = {
  name: string
  description?: string
  instructions?: string
  modelProvider?: string
  modelId?: string
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high'
  visibility?: 'workspace' | 'restricted'
}
```

At the start of `createAgent`, derive complete values for form-independent storage:

```ts
const description = input.description ?? ''
const instructions = input.instructions ?? ''
const modelProvider = input.modelProvider ?? ''
const modelId = input.modelId ?? ''
const thinkingLevel = input.thinkingLevel ?? 'off'
const manifest = {
  capabilities: [],
  prompt: instructions,
  model: { provider: modelProvider, modelId, thinkingLevel },
}
```

Remove the previous `manifest` declaration that reads required fields directly from `input`.

Use those values in the Agent insert:

```ts
description,
```

Use them in the AgentVersion insert:

```ts
instructions,
modelProvider,
modelId,
thinkingLevel,
responsePolicyJson: defaultResponsePolicy,
workspacePolicyJson: defaultWorkspacePolicy,
manifestJson: manifest,
manifestHash: manifestHash(manifest),
```

In `updateAgentDraft`, derive and persist:

```ts
const description = patch.description ?? agent.description
```

then include `description` in the Agent update:

```ts
tx.update(agents)
  .set({ name, description, visibility, updatedAt: now })
  .where(eq(agents.id, agentId))
  .run()
```

Include `description` in the returned draft object:

```ts
return {
  ...draft,
  description,
  instructions,
  modelProvider,
  modelId,
  thinkingLevel,
}
```

In `createAgentHandler`, pass:

```ts
description: input.description,
```

to `createAgent`.

Replace the current create validation block with:

```ts
if (!input.name) {
  return Response.json({ error: 'validation_error' }, { status: 400 })
}
```

The handler must not require prompt or model values for draft creation.

In `publishAgentVersion`, before changing the version status, reject an incomplete draft:

```ts
if (
  !draft.instructions.trim() ||
  !draft.modelProvider.trim() ||
  !draft.modelId.trim()
) {
  throw new Error('incomplete draft')
}
```

In `errorResponse` in `src/server/http/agent-http.server.ts`, add:

```ts
if (error instanceof Error && error.message === 'incomplete draft') {
  return Response.json({ error: 'incomplete_draft' }, { status: 409 })
}
```

- [ ] **Step 5: Generate the migration**

Run:

```bash
npm run db:generate
```

Expected: one new migration adds `agents.description` with a non-null empty-string default.

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
npm test -- src/db/schema.test.ts src/server/platform/agent-version.server.test.ts src/server/http/agent-http.server.test.ts
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/db/schema.test.ts src/server/platform/agent-version.server.ts src/server/platform/agent-version.server.test.ts src/server/http/agent-http.server.ts src/server/http/agent-http.server.test.ts drizzle
git commit -m "feat: persist agent descriptions"
```

---

### Task 2: Add the Browser API Client and UI Test Harness

**Files:**

- Modify: `package.json`
- Modify: `vitest.config.ts`
- Create: `src/test/ui.ts`
- Create: `src/lib/api/platform-client.ts`
- Create: `src/lib/api/platform-client.test.ts`

**Interfaces:**

- Produces:
  - `type WorkspaceAccess`
  - `type AgentRecord`
  - `getAuthMe(): Promise<AuthMeResponse>`
  - `createAgentRequest(workspaceId, input): Promise<CreateAgentResponse>`
  - `getAgentRequest(workspaceId, agentId): Promise<AgentRecord>`
  - `ApiError`
  - `renderUi(ui): RenderResult`

- [ ] **Step 1: Install UI test dependencies**

Run:

```bash
npm install --save-dev @testing-library/react @testing-library/user-event jsdom
```

Expected: all three packages appear under `devDependencies`.

- [ ] **Step 2: Write failing API client tests**

Create `src/lib/api/platform-client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ApiError,
  createAgentRequest,
  getAgentRequest,
  getAuthMe,
} from './platform-client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('platform API client', () => {
  it('loads the authenticated user and workspaces', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        user: { id: 'u1', username: 'alice' },
        workspaces: [
          {
            workspaceId: 'w1',
            slug: 'default',
            name: 'Default',
            role: 'workspace_admin',
          },
        ],
        authMode: 'development',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await getAuthMe()

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', {
      credentials: 'include',
    })
    expect(result.workspaces[0].slug).toBe('default')
  })

  it('creates an Agent with a JSON request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ id: 'a1' }, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await createAgentRequest('w1', {
      name: 'Reviewer',
      description: 'Reviews changes.',
      visibility: 'workspace',
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/w1/agents', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Reviewer',
        description: 'Reviews changes.',
        visibility: 'workspace',
      }),
    })
  })

  it('throws ApiError with server error code', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: 'forbidden' }, { status: 403 }),
        ),
    )

    await expect(getAgentRequest('w1', 'a1')).rejects.toEqual(
      new ApiError('forbidden', 403),
    )
  })

  it('loads an Agent with workspace query', async () => {
    const agent = {
      id: 'a1',
      workspaceId: 'w1',
      name: 'Reviewer',
      description: 'Reviews changes.',
      versions: [],
    }
    const fetchMock = vi.fn().mockResolvedValue(Response.json(agent))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAgentRequest('w1', 'a1')).resolves.toEqual(agent)
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/a1?workspaceId=w1', {
      credentials: 'include',
    })
  })
})
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
npm test -- src/lib/api/platform-client.test.ts
```

Expected: FAIL because the API client module does not exist.

- [ ] **Step 4: Implement the API client**

Create `src/lib/api/platform-client.ts`:

```ts
export type WorkspaceAccess = {
  workspaceId: string
  slug: string
  name: string
  role: 'platform_admin' | 'workspace_admin' | 'editor' | 'user'
}

export type AuthMeResponse = {
  user: {
    id: string
    username: string
    name: string | null
    email: string | null
  }
  workspaces: WorkspaceAccess[]
  authMode: 'gateway' | 'development'
}

export type AgentVersionRecord = {
  id: string
  versionNumber: number
  instructions: string
  modelProvider: string
  modelId: string
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high'
  status: 'draft' | 'published' | 'retired'
}

export type AgentRecord = {
  id: string
  workspaceId: string
  name: string
  description: string
  visibility: 'workspace' | 'restricted'
  status: 'draft' | 'active' | 'disabled'
  currentPublishedVersionId: string | null
  createdBy: string
  versions: AgentVersionRecord[]
}

export type CreateAgentInput = {
  name: string
  description?: string
  visibility: 'workspace' | 'restricted'
}

export type CreateAgentResponse = {
  id: string
  workspaceId: string
  name: string
  description: string
  status: 'draft'
  visibility: 'workspace' | 'restricted'
  draftVersionId: string
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
    this.name = 'ApiError'
  }
}

async function request<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, {
    credentials: 'include',
    ...init,
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new ApiError(body?.error ?? 'request_failed', response.status)
  }

  return (await response.json()) as T
}

export function getAuthMe(): Promise<AuthMeResponse> {
  return request<AuthMeResponse>('/api/auth/me')
}

export function createAgentRequest(
  workspaceId: string,
  input: CreateAgentInput,
): Promise<CreateAgentResponse> {
  return request<CreateAgentResponse>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export function getAgentRequest(
  workspaceId: string,
  agentId: string,
): Promise<AgentRecord> {
  return request<AgentRecord>(
    `/api/agents/${encodeURIComponent(agentId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
  )
}
```

- [ ] **Step 5: Add the UI render helper**

Create `src/test/ui.ts`:

```ts
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'

export function renderUi(ui: ReactElement) {
  return render(ui)
}
```

- [ ] **Step 6: Run API client tests**

Run:

```bash
npm test -- src/lib/api/platform-client.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/test/ui.ts src/lib/api/platform-client.ts src/lib/api/platform-client.test.ts
git commit -m "feat: add platform UI api client"
```

---

### Task 3: Add the Agent Workspace Shell and Navigation

**Files:**

- Create: `src/lib/agents/agent-sections.ts`
- Create: `src/components/agents/agent-page-header.tsx`
- Create: `src/components/agents/agent-empty-state.tsx`
- Create: `src/components/agents/agent-workspace-shell.tsx`
- Modify: `src/styles.css`

**Interfaces:**

- Produces:
  - `type AgentSectionId`
  - `agentSections`
  - `agentSectionHref(workspaceSlug, agentId, section)`
  - `<AgentPageHeader />`
  - `<AgentEmptyState />`
  - `<AgentWorkspaceShell />`

- [ ] **Step 1: Create section metadata**

Create `src/lib/agents/agent-sections.ts`:

```ts
export type AgentSectionId =
  'basic' | 'prompt' | 'tools' | 'skills' | 'channels' | 'publish'

export const agentSections = [
  { id: 'basic', label: 'Basic details' },
  { id: 'prompt', label: 'Prompt & model' },
  { id: 'tools', label: 'Tools' },
  { id: 'skills', label: 'Skills' },
  { id: 'channels', label: 'Channels' },
  { id: 'publish', label: 'Review & publish' },
] as const satisfies readonly {
  id: AgentSectionId
  label: string
}[]

export function agentSectionHref(
  workspaceSlug: string,
  agentId: string,
  section: AgentSectionId,
): string {
  return `/w/${encodeURIComponent(workspaceSlug)}/agents/${encodeURIComponent(agentId)}/${section}`
}
```

- [ ] **Step 2: Create shared page components**

Create `src/components/agents/agent-page-header.tsx`:

```tsx
export function AgentPageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <header className="mb-8 flex flex-col gap-5 border-b border-[var(--line)] pb-7 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <p className="mb-2 font-mono text-[10px] font-bold tracking-[0.18em] text-[var(--kicker)] uppercase">
          {eyebrow}
        </p>
        <h1 className="font-['Fraunces',Georgia,serif] text-3xl leading-[1.05] font-semibold tracking-[-0.03em] text-[var(--sea-ink)] sm:text-[2.15rem]">
          {title}
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--sea-ink-soft)]">
          {description}
        </p>
      </div>
      {action}
    </header>
  )
}
```

Create `src/components/agents/agent-empty-state.tsx`:

```tsx
import { CircleDashed } from 'lucide-react'

export function AgentEmptyState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <section className="agent-panel flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-5 grid size-12 place-items-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--lagoon-deep)]">
        <CircleDashed aria-hidden="true" className="size-5" />
      </div>
      <h2 className="font-['Fraunces',Georgia,serif] text-xl font-semibold text-[var(--sea-ink)]">
        {title}
      </h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-[var(--sea-ink-soft)]">
        {description}
      </p>
      <span className="mt-6 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1 font-mono text-[10px] tracking-[0.12em] text-[var(--kicker)] uppercase">
        Coming in the next build
      </span>
    </section>
  )
}
```

- [ ] **Step 3: Build the workspace shell**

Create `src/components/agents/agent-workspace-shell.tsx`:

```tsx
import { Link } from '@tanstack/react-router'
import {
  BookOpenText,
  Boxes,
  CheckCircle2,
  ChevronRight,
  MessageSquareText,
  Rocket,
  Settings2,
  Sparkles,
} from 'lucide-react'

import { agentSectionHref, agentSections } from '#/lib/agents/agent-sections'
import type { AgentSectionId } from '#/lib/agents/agent-sections'

const sectionIcons = {
  basic: Settings2,
  prompt: BookOpenText,
  tools: Boxes,
  skills: Sparkles,
  channels: MessageSquareText,
  publish: Rocket,
} satisfies Record<AgentSectionId, typeof Settings2>

export function AgentWorkspaceShell({
  workspaceSlug,
  workspaceName,
  agentId,
  agentName,
  modelLabel,
  activeSection,
  isPublished,
  children,
}: {
  workspaceSlug: string
  workspaceName: string
  agentId: string
  agentName: string
  modelLabel: string
  activeSection: AgentSectionId
  isPublished: boolean
  children: React.ReactNode
}) {
  const monogram = agentName.trim().slice(0, 2).toUpperCase()

  return (
    <div className="agent-workspace-page">
      <div className="mb-5 flex items-center gap-2 text-xs text-[var(--sea-ink-soft)]">
        <Link className="hover:text-[var(--sea-ink)]" to="/">
          Workspace
        </Link>
        <ChevronRight aria-hidden="true" className="size-3" />
        <span>{workspaceName}</span>
        <ChevronRight aria-hidden="true" className="size-3" />
        <span className="text-[var(--sea-ink)]">{agentName}</span>
      </div>

      <div className="agent-workspace-grid">
        <aside className="agent-rail">
          <div className="flex items-start gap-3">
            <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--sea-ink)] font-['Fraunces',Georgia,serif] text-sm font-semibold text-white shadow-sm">
              {monogram}
            </div>
            <div className="min-w-0">
              <p className="font-['Fraunces',Georgia,serif] text-lg leading-tight font-semibold text-[var(--sea-ink)]">
                {agentName}
              </p>
              <span className="mt-2 inline-flex rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2 py-0.5 font-mono text-[9px] tracking-[0.12em] uppercase">
                {isPublished ? 'Published' : 'Draft'}
              </span>
            </div>
          </div>

          <div className="my-5 h-px bg-[var(--line)]" />

          <p className="agent-rail-label">Model</p>
          <p className="truncate font-mono text-xs text-[var(--sea-ink-soft)]">
            {modelLabel}
          </p>

          <nav aria-label="Agent configuration" className="mt-6">
            <ol className="space-y-1">
              {agentSections.map((section) => {
                const Icon = sectionIcons[section.id]
                const active = section.id === activeSection
                return (
                  <li key={section.id}>
                    <a
                      href={agentSectionHref(
                        workspaceSlug,
                        agentId,
                        section.id,
                      )}
                      aria-current={active ? 'page' : undefined}
                      className="agent-nav-link"
                      data-active={active || undefined}
                    >
                      <Icon aria-hidden="true" className="size-4" />
                      <span>{section.label}</span>
                      {active ? (
                        <span className="ml-auto size-1.5 rounded-full bg-[var(--lagoon-deep)]" />
                      ) : null}
                    </a>
                  </li>
                )
              })}
            </ol>
          </nav>
        </aside>

        <main className="min-w-0">{children}</main>

        <aside className="agent-status-rail">
          <p className="agent-rail-label">Configuration status</p>
          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm font-semibold text-[var(--sea-ink)]">
              {isPublished ? 'Published' : 'Draft in progress'}
            </span>
            {isPublished ? (
              <CheckCircle2
                aria-label="Published"
                className="size-4 text-[var(--palm)]"
              />
            ) : null}
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
            <div
              className="h-full rounded-full bg-[var(--lagoon)] transition-[width] duration-200"
              style={{ width: isPublished ? '100%' : '42%' }}
            />
          </div>

          <dl className="mt-6 space-y-4 text-sm">
            <div>
              <dt className="agent-rail-label">Tools</dt>
              <dd className="mt-1 text-[var(--sea-ink-soft)]">None yet</dd>
            </div>
            <div>
              <dt className="agent-rail-label">Skills</dt>
              <dd className="mt-1 text-[var(--sea-ink-soft)]">None yet</dd>
            </div>
            <div>
              <dt className="agent-rail-label">Channels</dt>
              <dd className="mt-1 text-[var(--sea-ink-soft)]">Web defaults</dd>
            </div>
          </dl>

          <div className="mt-7 border-t border-[var(--line)] pt-5">
            <p className="text-xs leading-5 text-[var(--sea-ink-soft)]">
              Draft changes do not affect conversations until the Agent is
              published.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add workspace shell CSS**

Append to `src/styles.css`:

```css
.agent-workspace-page {
  width: min(1480px, calc(100% - 2rem));
  margin: 1.5rem auto 3rem;
}

.agent-workspace-grid {
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr) 270px;
  gap: 20px;
  align-items: start;
}

.agent-rail,
.agent-status-rail,
.agent-panel {
  border: 1px solid var(--line);
  background: linear-gradient(165deg, var(--surface-strong), var(--surface));
  box-shadow:
    0 1px 0 var(--inset-glint) inset,
    0 14px 32px rgba(30, 90, 72, 0.08);
  backdrop-filter: blur(8px);
}

.agent-rail,
.agent-status-rail {
  position: sticky;
  top: 20px;
  border-radius: 18px;
  padding: 20px;
}

.agent-panel {
  border-radius: 18px;
}

.agent-rail-label {
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--kicker);
}

.agent-nav-link {
  display: flex;
  min-height: 40px;
  align-items: center;
  gap: 10px;
  border-radius: 10px;
  padding: 8px 10px;
  color: var(--sea-ink-soft);
  font-size: 0.82rem;
  font-weight: 600;
  text-decoration: none;
}

.agent-nav-link:hover {
  background: var(--link-bg-hover);
  color: var(--sea-ink);
}

.agent-nav-link[data-active] {
  background: color-mix(in oklab, var(--lagoon) 14%, white 86%);
  color: var(--sea-ink);
}

@media (max-width: 1279px) {
  .agent-workspace-grid {
    grid-template-columns: 220px minmax(0, 1fr);
  }

  .agent-status-rail {
    position: static;
    grid-column: 2;
  }
}

@media (max-width: 767px) {
  .agent-workspace-page {
    width: min(100% - 1.25rem, 820px);
    margin-top: 0.75rem;
  }

  .agent-workspace-grid {
    display: block;
  }

  .agent-rail {
    position: static;
    margin-bottom: 16px;
    padding: 16px;
  }

  .agent-rail nav {
    margin-top: 16px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
  }

  .agent-rail nav ol {
    display: flex;
    min-width: max-content;
    gap: 4px;
    padding-bottom: 2px;
  }

  .agent-nav-link {
    min-height: 36px;
    white-space: nowrap;
  }

  .agent-status-rail {
    margin-top: 16px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .agent-workspace-page *,
  .agent-workspace-page *::before,
  .agent-workspace-page *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 5: Verify typecheck and formatting**

Run:

```bash
npm run typecheck
npm run check
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/agents/agent-sections.ts src/components/agents/agent-page-header.tsx src/components/agents/agent-empty-state.tsx src/components/agents/agent-workspace-shell.tsx src/styles.css
git commit -m "feat: add agent workspace shell"
```

---

### Task 4: Build the Real Agent Creation Page

**Files:**

- Create: `src/components/agents/agent-create-form.tsx`
- Create: `src/components/agents/agent-create-form.test.tsx`
- Create: `src/routes/w.$workspaceSlug.agents.new.tsx`

**Interfaces:**

- Consumes:
  - `getAuthMe()`
  - `createAgentRequest(workspaceId, input)`
  - `useNavigate` from `@tanstack/react-router`
- Produces:
  - `<AgentCreateForm workspaceId onCreated onCancel />`
  - `/w/:workspaceSlug/agents/new`

- [ ] **Step 1: Write the failing creation form test**

Create `src/components/agents/agent-create-form.test.tsx`:

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderUi } from '#/test/ui'

import { AgentCreateForm } from './agent-create-form'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AgentCreateForm', () => {
  it('creates a draft and reports the new Agent id', async () => {
    const onCreated = vi.fn()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ id: 'agent-1' }, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentCreateForm
        workspaceId="workspace-1"
        onCreated={onCreated}
        onCancel={() => undefined}
      />,
    )

    await user.type(screen.getByLabelText('Agent name'), 'Reviewer')
    await user.type(
      screen.getByLabelText('Description'),
      'Reviews product changes.',
    )
    await user.click(screen.getByRole('button', { name: 'Create draft' }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/agents',
      {
        credentials: 'include',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Reviewer',
          description: 'Reviews product changes.',
          visibility: 'workspace',
        }),
      },
    )
    expect(onCreated).toHaveBeenCalledWith('agent-1')
  })

  it('shows a required-name error without making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentCreateForm
        workspaceId="w1"
        onCreated={() => undefined}
        onCancel={() => undefined}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Create draft' }))

    expect(screen.getByText('Enter an Agent name.')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify failure**

Run:

```bash
npm test -- src/components/agents/agent-create-form.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the creation form**

Create `src/components/agents/agent-create-form.tsx`:

```tsx
import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, Check, Eye, Users } from 'lucide-react'

import { createAgentRequest } from '#/lib/api/platform-client'
import type { CreateAgentResponse } from '#/lib/api/platform-client'
import { cn } from '#/lib/utils'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Textarea } from '#/components/ui/textarea'

export function AgentCreateForm({
  workspaceId,
  onCreated,
  onCancel,
}: {
  workspaceId: string
  onCreated: (agent: CreateAgentResponse) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<'workspace' | 'restricted'>(
    'workspace',
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim()) {
      setNameError('Enter an Agent name.')
      return
    }

    setNameError(null)
    setError(null)
    setSubmitting(true)
    try {
      const created = await createAgentRequest(workspaceId, {
        name: name.trim(),
        description: description.trim(),
        visibility,
      })
      onCreated(created)
    } catch {
      setError('The Agent could not be created. Check your access and retry.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]"
    >
      <div className="agent-panel p-6 sm:p-8">
        <div className="grid gap-6">
          <div className="grid gap-2">
            <label htmlFor="agent-name" className="text-sm font-semibold">
              Agent name
            </label>
            <Input
              id="agent-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                if (nameError) setNameError(null)
              }}
              maxLength={120}
              placeholder="Research assistant"
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? 'agent-name-error' : undefined}
            />
            {nameError ? (
              <p id="agent-name-error" className="text-xs text-destructive">
                {nameError}
              </p>
            ) : (
              <p className="text-xs text-[var(--sea-ink-soft)]">
                A short, recognizable name for your team.
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <label
              htmlFor="agent-description"
              className="text-sm font-semibold"
            >
              Description
            </label>
            <Textarea
              id="agent-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
              rows={4}
              placeholder="Explain what this Agent helps your team accomplish."
            />
            <p className="text-right font-mono text-[10px] text-[var(--sea-ink-soft)]">
              {description.length}/500
            </p>
          </div>

          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-semibold">Visibility</legend>
            {[
              {
                id: 'workspace' as const,
                label: 'Workspace',
                copy: 'Every member of this workspace can use the published Agent.',
                icon: Users,
              },
              {
                id: 'restricted' as const,
                label: 'Restricted',
                copy: 'Only the creator, admins, and explicitly granted users can use it.',
                icon: Eye,
              },
            ].map((option) => {
              const Icon = option.icon
              const selected = visibility === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setVisibility(option.id)}
                  aria-pressed={selected}
                  className={cn(
                    'flex w-full items-start gap-4 rounded-xl border p-4 text-left transition-colors',
                    selected
                      ? 'border-[var(--lagoon-deep)] bg-[color-mix(in_oklab,var(--lagoon)_12%,white_88%)]'
                      : 'border-[var(--line)] bg-white/45 hover:bg-white/70',
                  )}
                >
                  <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border border-[var(--chip-line)] bg-[var(--chip-bg)]">
                    <Icon aria-hidden="true" className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      {option.label}
                      {selected ? (
                        <Check
                          aria-label="Selected"
                          className="size-4 text-[var(--palm)]"
                        />
                      ) : null}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-[var(--sea-ink-soft)]">
                      {option.copy}
                    </span>
                  </span>
                </button>
              )
            })}
          </fieldset>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-3 border-t border-[var(--line)] pt-6 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create draft'}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <aside className="agent-panel h-fit p-6">
        <p className="agent-rail-label">After creation</p>
        <ol className="mt-5 space-y-5">
          {[
            [
              'Configure the prompt',
              'Choose the model and define how the Agent behaves.',
            ],
            [
              'Add capabilities',
              'Select tools and Skills from approved catalogs.',
            ],
            ['Connect channels', 'Enable Web or a dedicated InfoFlow bot.'],
            [
              'Publish',
              'Publishing creates an immutable version for new conversations.',
            ],
          ].map(([title, copy], index) => (
            <li key={title} className="flex gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] font-mono text-[10px]">
                {index + 1}
              </span>
              <span>
                <span className="block text-sm font-semibold">{title}</span>
                <span className="mt-1 block text-xs leading-5 text-[var(--sea-ink-soft)]">
                  {copy}
                </span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-6 border-t border-[var(--line)] pt-5 text-xs leading-5 text-[var(--sea-ink-soft)]">
          The Agent stays private as a draft until it is published.
        </p>
      </aside>
    </form>
  )
}
```

- [ ] **Step 4: Implement the creation route**

Create `src/routes/w.$workspaceSlug.agents.new.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'

import { AgentCreateForm } from '#/components/agents/agent-create-form'
import { AgentPageHeader } from '#/components/agents/agent-page-header'
import { ApiError, getAuthMe } from '#/lib/api/platform-client'
import type { WorkspaceAccess } from '#/lib/api/platform-client'

export const Route = createFileRoute('/w/$workspaceSlug/agents/new')({
  component: CreateAgentPage,
})

function CreateAgentPage() {
  const { workspaceSlug } = Route.useParams()
  const navigate = useNavigate()
  const [workspace, setWorkspace] = useState<WorkspaceAccess | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    getAuthMe()
      .then((result) => {
        if (!active) return
        const match = result.workspaces.find(
          (item) => item.slug === workspaceSlug,
        )
        if (!match) {
          setError('This workspace is not available to your account.')
          return
        }
        setWorkspace(match)
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(
          reason instanceof ApiError && reason.status === 401
            ? 'Sign in through the gateway to create an Agent.'
            : 'The workspace could not be loaded.',
        )
      })
    return () => {
      active = false
    }
  }, [workspaceSlug])

  return (
    <div className="agent-workspace-page max-w-[1160px]">
      <button
        type="button"
        onClick={() => window.history.back()}
        className="mb-6 inline-flex items-center gap-2 text-xs font-semibold text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]"
      >
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        Back
      </button>

      <AgentPageHeader
        eyebrow="New Agent"
        title="Create something your team can direct."
        description="Start with the essentials. The Agent remains a private draft while you configure its prompt, capabilities, channels, and release."
      />

      {error ? (
        <div role="alert" className="agent-panel p-6 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {!error && !workspace ? (
        <div className="agent-panel h-80 animate-pulse bg-[var(--surface)]" />
      ) : null}

      {workspace ? (
        <AgentCreateForm
          workspaceId={workspace.workspaceId}
          onCreated={(agent) =>
            navigate({
              to: '/w/$workspaceSlug/agents/$agentId/basic',
              params: { workspaceSlug, agentId: agent.id },
            })
          }
          onCancel={() => navigate({ to: '/' })}
        />
      ) : null}
    </div>
  )
}
```

- [ ] **Step 5: Run the form tests**

Run:

```bash
npm test -- src/components/agents/agent-create-form.test.tsx
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Generate routes and typecheck**

Run:

```bash
npm run generate-routes
npm run typecheck
```

Expected: `/w/$workspaceSlug/agents/new` is present and typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/agents/agent-create-form.tsx src/components/agents/agent-create-form.test.tsx src/routes/w.$workspaceSlug.agents.new.tsx src/routeTree.gen.ts
git commit -m "feat: add agent creation page"
```

---

### Task 5: Add the Shared Agent Detail Layout and Section Pages

**Files:**

- Create: `src/components/agents/agent-workspace-context.tsx`
- Create: `src/routes/w.$workspaceSlug.agents.$agentId.tsx`
- Create: `src/routes/w.$workspaceSlug.agents.$agentId.basic.tsx`
- Create: `src/routes/w.$workspaceSlug.agents.$agentId.prompt.tsx`
- Create: `src/routes/w.$workspaceSlug.agents.$agentId.tools.tsx`
- Create: `src/routes/w.$workspaceSlug.agents.$agentId.skills.tsx`
- Create: `src/routes/w.$workspaceSlug.agents.$agentId.channels.tsx`
- Create: `src/routes/w.$workspaceSlug.agents.$agentId.publish.tsx`

**Interfaces:**

- Consumes:
  - `getAuthMe()`
  - `getAgentRequest(workspaceId, agentId)`
  - `<AgentWorkspaceShell />`
- Produces:
  - `AgentWorkspaceContext`
  - `useAgentWorkspace()`
  - Shared Agent detail layout at `/w/$workspaceSlug/agents/$agentId`
  - Independently addressable section pages

- [ ] **Step 1: Add the context**

Create `src/components/agents/agent-workspace-context.tsx`:

```tsx
import { createContext, useContext } from 'react'

import type { AgentRecord, WorkspaceAccess } from '#/lib/api/platform-client'

type AgentWorkspaceContextValue = {
  workspace: WorkspaceAccess
  agent: AgentRecord
}

const AgentWorkspaceContext = createContext<AgentWorkspaceContextValue | null>(
  null,
)

export const AgentWorkspaceProvider = AgentWorkspaceContext.Provider

export function useAgentWorkspace(): AgentWorkspaceContextValue {
  const value = useContext(AgentWorkspaceContext)
  if (!value) {
    throw new Error(
      'useAgentWorkspace must be used inside AgentWorkspaceProvider',
    )
  }
  return value
}
```

- [ ] **Step 2: Add the detail layout route**

Create `src/routes/w.$workspaceSlug.agents.$agentId.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router'

import { AgentWorkspaceProvider } from '#/components/agents/agent-workspace-context'
import { AgentWorkspaceShell } from '#/components/agents/agent-workspace-shell'
import type { AgentRecord, WorkspaceAccess } from '#/lib/api/platform-client'
import { getAgentRequest, getAuthMe } from '#/lib/api/platform-client'
import type { AgentSectionId } from '#/lib/agents/agent-sections'

export const Route = createFileRoute('/w/$workspaceSlug/agents/$agentId')({
  component: AgentLayout,
})

function AgentLayout() {
  const { workspaceSlug, agentId } = Route.useParams()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const [data, setData] = useState<{
    workspace: WorkspaceAccess
    agent: AgentRecord
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    getAuthMe()
      .then(async (auth) => {
        const workspace = auth.workspaces.find(
          (item) => item.slug === workspaceSlug,
        )
        if (!workspace) throw new Error('workspace_not_found')
        const agent = await getAgentRequest(workspace.workspaceId, agentId)
        if (active) setData({ workspace, agent })
      })
      .catch(() => {
        if (active) setError('The Agent could not be loaded.')
      })
    return () => {
      active = false
    }
  }, [agentId, workspaceSlug])

  if (error) {
    return (
      <div className="agent-workspace-page">
        <div role="alert" className="agent-panel p-6 text-sm text-destructive">
          {error}
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="agent-workspace-page grid h-[70vh] place-items-center">
        <div className="size-8 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--lagoon-deep)]" />
      </div>
    )
  }

  const draft =
    data.agent.versions.find((version) => version.status === 'draft') ??
    data.agent.versions[0]
  const activeSection = (pathname.split('/').at(-1) ??
    'basic') as AgentSectionId

  return (
    <AgentWorkspaceProvider
      value={{ workspace: data.workspace, agent: data.agent }}
    >
      <AgentWorkspaceShell
        workspaceSlug={workspaceSlug}
        workspaceName={data.workspace.name}
        agentId={agentId}
        agentName={data.agent.name}
        modelLabel={
          draft ? `${draft.modelProvider}/${draft.modelId}` : 'Model not set'
        }
        activeSection={activeSection}
        isPublished={Boolean(data.agent.currentPublishedVersionId)}
      >
        <Outlet />
      </AgentWorkspaceShell>
    </AgentWorkspaceProvider>
  )
}
```

- [ ] **Step 3: Add the basic page**

Create `src/routes/w.$workspaceSlug.agents.$agentId.basic.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

import { AgentPageHeader } from '#/components/agents/agent-page-header'
import { useAgentWorkspace } from '#/components/agents/agent-workspace-context'

export const Route = createFileRoute('/w/$workspaceSlug/agents/$agentId/basic')(
  {
    component: BasicPage,
  },
)

function BasicPage() {
  const { agent, workspace } = useAgentWorkspace()

  return (
    <section>
      <AgentPageHeader
        eyebrow="01 · Basic details"
        title="Identity and access"
        description="These details help your team understand who the Agent is and who can use it."
      />
      <dl className="agent-panel overflow-hidden">
        {[
          ['Agent name', agent.name],
          ['Description', agent.description || 'No description yet'],
          ['Visibility', agent.visibility],
          ['Workspace', workspace.name],
          ['Agent ID', agent.id],
          ['Status', agent.status],
        ].map(([label, value]) => (
          <div
            key={label}
            className="grid gap-1 border-b border-[var(--line)] px-6 py-5 last:border-b-0 sm:grid-cols-[180px_1fr]"
          >
            <dt className="text-xs font-bold tracking-[0.1em] text-[var(--kicker)] uppercase">
              {label}
            </dt>
            <dd
              className={
                ['Agent ID', 'Status'].includes(label)
                  ? 'font-mono text-sm text-[var(--sea-ink-soft)]'
                  : 'text-sm text-[var(--sea-ink)]'
              }
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
```

- [ ] **Step 4: Add placeholder section pages**

Create `src/routes/w.$workspaceSlug.agents.$agentId.prompt.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

import { AgentEmptyState } from '#/components/agents/agent-empty-state'
import { AgentPageHeader } from '#/components/agents/agent-page-header'

export const Route = createFileRoute(
  '/w/$workspaceSlug/agents/$agentId/prompt',
)({ component: PromptPage })

function PromptPage() {
  return (
    <section>
      <AgentPageHeader
        eyebrow="02 · Prompt & model"
        title="Define how the Agent thinks"
        description="Edit the Agent prompt, model, thinking level, and response policy."
      />
      <AgentEmptyState
        title="Prompt editor arrives in the next implementation step"
        description="The route, Agent version, and draft persistence are connected. The editable prompt and model controls are the next slice."
      />
    </section>
  )
}
```

Create `src/routes/w.$workspaceSlug.agents.$agentId.tools.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

import { AgentEmptyState } from '#/components/agents/agent-empty-state'
import { AgentPageHeader } from '#/components/agents/agent-page-header'

export const Route = createFileRoute('/w/$workspaceSlug/agents/$agentId/tools')(
  { component: ToolsPage },
)

function ToolsPage() {
  return (
    <section>
      <AgentPageHeader
        eyebrow="03 · Tools"
        title="Give the Agent useful actions"
        description="Choose approved built-in, HTTP, OpenAPI, or MCP tools."
      />
      <AgentEmptyState
        title="No tool catalog is connected yet"
        description="Capability versions and their encrypted configuration are added by the capability catalog implementation plan."
      />
    </section>
  )
}
```

Create `src/routes/w.$workspaceSlug.agents.$agentId.skills.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

import { AgentEmptyState } from '#/components/agents/agent-empty-state'
import { AgentPageHeader } from '#/components/agents/agent-page-header'

export const Route = createFileRoute(
  '/w/$workspaceSlug/agents/$agentId/skills',
)({ component: SkillsPage })

function SkillsPage() {
  return (
    <section>
      <AgentPageHeader
        eyebrow="04 · Skills"
        title="Add repeatable expertise"
        description="Select ordered Skill sections that shape how the Agent approaches its work."
      />
      <AgentEmptyState
        title="No Skill catalog is connected yet"
        description="Versioned Skills will be selectable here after the capability catalog APIs are implemented."
      />
    </section>
  )
}
```

Create `src/routes/w.$workspaceSlug.agents.$agentId.channels.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

import { AgentEmptyState } from '#/components/agents/agent-empty-state'
import { AgentPageHeader } from '#/components/agents/agent-page-header'

export const Route = createFileRoute(
  '/w/$workspaceSlug/agents/$agentId/channels',
)({ component: ChannelsPage })

function ChannelsPage() {
  return (
    <section>
      <AgentPageHeader
        eyebrow="05 · Channels"
        title="Choose where the Agent responds"
        description="Configure Web behavior and dedicated InfoFlow bot credentials."
      />
      <AgentEmptyState
        title="Channel configuration is not connected yet"
        description="Encrypted InfoFlow credentials, connection testing, and WS connection supervision are implemented in the InfoFlow plan."
      />
    </section>
  )
}
```

Create `src/routes/w.$workspaceSlug.agents.$agentId.publish.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

import { AgentEmptyState } from '#/components/agents/agent-empty-state'
import { AgentPageHeader } from '#/components/agents/agent-page-header'

export const Route = createFileRoute(
  '/w/$workspaceSlug/agents/$agentId/publish',
)({ component: PublishPage })

function PublishPage() {
  return (
    <section>
      <AgentPageHeader
        eyebrow="06 · Review & publish"
        title="Review before release"
        description="Publishing creates an immutable version for new conversations."
      />
      <AgentEmptyState
        title="Publishing checks arrive after the editor is complete"
        description="Until required sections and channel configuration are implemented, this page does not expose a publish action that could create incomplete releases."
      />
    </section>
  )
}
```

- [ ] **Step 5: Generate routes**

Run:

```bash
npm run generate-routes
```

Expected: the route tree includes the detail layout and all six section children.

- [ ] **Step 6: Run tests, typecheck, lint, and build**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run check
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/agents/agent-workspace-context.tsx src/routes/w.\$workspaceSlug.agents.\$agentId.tsx src/routes/w.\$workspaceSlug.agents.\$agentId.basic.tsx src/routes/w.\$workspaceSlug.agents.\$agentId.prompt.tsx src/routes/w.\$workspaceSlug.agents.\$agentId.tools.tsx src/routes/w.\$workspaceSlug.agents.\$agentId.skills.tsx src/routes/w.\$workspaceSlug.agents.\$agentId.channels.tsx src/routes/w.\$workspaceSlug.agents.\$agentId.publish.tsx src/routeTree.gen.ts
git commit -m "feat: add agent multi-page workspace"
```

---

### Task 6: Responsive Visual QA and v0 Handoff

**Files:**

- Modify: `src/styles.css`
- Modify: route/component files only if visual QA finds concrete defects

**Interfaces:**

- Consumes: the completed creation, layout, and section routes.
- Produces: verified desktop/mobile v0 screenshots and a clean build.

- [ ] **Step 1: Prepare a local development database**

Run:

```bash
AUTH_MODE=development \
DEV_AUTH_USERNAME=ui-review \
DEV_WORKSPACE_SLUG=default \
APP_ORIGIN=http://localhost:3000 \
APP_DATABASE_PATH=./data/ui-review.sqlite \
CHANNEL_SECRET_KEK=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
npm run db:migrate
```

Expected: migrations apply to `./data/ui-review.sqlite`.

- [ ] **Step 2: Start the development server**

Run:

```bash
AUTH_MODE=development \
DEV_AUTH_USERNAME=ui-review \
DEV_WORKSPACE_SLUG=default \
APP_ORIGIN=http://localhost:3000 \
APP_DATABASE_PATH=./data/ui-review.sqlite \
CHANNEL_SECRET_KEK=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
npm run dev
```

Expected: the app starts at `http://localhost:3000`.

- [ ] **Step 3: Verify creation flow at desktop width**

Open:

```text
http://localhost:3000/w/default/agents/new
```

At 1440×900 verify:

- Form and right-side guidance have balanced width.
- Focus states are visible.
- Name validation appears inline.
- Draft creation uses the real API.
- Successful creation redirects to `/w/default/agents/:agentId/basic`.

- [ ] **Step 4: Verify the multi-page workspace**

Navigate through all six sections and verify:

- The left rail marks the active section.
- Independent URLs open after refresh.
- The status rail is sticky on desktop.
- Basic page displays persisted Agent data.
- Empty pages clearly state what backend capability is missing.

- [ ] **Step 5: Verify mobile layout**

At 390×844 verify:

- Left rail becomes a compact Agent header plus horizontal tabs.
- Status rail stacks below content.
- No horizontal overflow exists.
- Inputs and buttons remain reachable with one hand.

- [ ] **Step 6: Verify dark mode and reduced motion**

Add the `dark` class to the root HTML element in the browser and verify contrast on:

- Rail surfaces.
- Inputs.
- Selected visibility card.
- Active navigation item.
- Empty states.

Enable reduced motion in the browser and verify no transform animation is required to understand state changes.

- [ ] **Step 7: Fix only observed visual defects**

For each defect, make one focused change in the owning component or `styles.css`, rerun:

```bash
npm run check
npm run lint
npm run typecheck
```

Expected: all checks remain green.

- [ ] **Step 8: Capture v0 evidence**

Capture screenshots for:

- Agent creation at desktop width.
- Basic Agent workspace at desktop width.
- Mobile workspace.
- Dark-mode workspace.

Attach the screenshots to the implementation report for user review.

- [ ] **Step 9: Commit**

```bash
git add src/styles.css src/components/agents src/routes/w.\$workspaceSlug.agents.*
git commit -m "style: polish agent workspace v0"
```
