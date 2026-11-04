# AI Provider Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Move model gateway configuration out of environment variables into encrypted, workspace-scoped database records and allow multiple providers.

**Architecture:** Add an `ai_providers` table whose `id` is also the Pi provider ID. Provider tokens are encrypted with `SecretBox`. Model discovery aggregates `/models` from every enabled provider. Pi runtime providers are rebuilt and synchronized whenever provider configuration changes.

**Tech Stack:** Drizzle SQLite, Pi AI dynamic providers, TanStack Start, React, Zod, Vitest.

## Global Constraints

- Providers are scoped to a workspace and managed by `platform_admin` or `workspace_admin`.
- Tokens are never returned by APIs or written to logs.
- Existing Agent versions using `oneapi-comate` remain addressable.
- A provider ID is immutable after creation and is used as `agent_versions.model_provider`.
- Provider changes must not require a server restart.
- Every production behavior needs a failing Vitest test before implementation.

---

### Task 1: Provider schema and encrypted service

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/server/platform/ai-provider.server.ts`
- Create: `src/server/platform/ai-provider.server.test.ts`
- Create: `drizzle/0006_*.sql` via `npm run db:generate`

**Interfaces:**
- Produces: `listAiProviders(db, principal, workspaceId, box): Promise<AiProviderRecord[]>`
- Produces: `saveAiProvider(db, principal, workspaceId, input, box): Promise<AiProviderRecord>`
- Produces: `openAiProviderToken(provider, box): string`

- [x] **Step 1: Write a failing service test**

Test that two providers can be created in one workspace, tokens are encrypted at rest, API records only expose masks, non-admin roles are rejected, and editing without a token preserves the existing token.

```ts
expect(listed.map((provider) => provider.name)).toEqual(['主网关', '备用网关'])
expect(listed[0].tokenMasked).toBe('sk-••••1234')
expect(db.select().from(aiProviders).all()[0].tokenJson).not.toContain('secret')
await expect(saveAiProvider(db, viewer, workspaceId, input, box)).rejects.toThrow('forbidden')
```

- [x] **Step 2: Run the test and verify it fails because the table/service do not exist**

Run: `npm test -- src/server/platform/ai-provider.server.test.ts`

- [x] **Step 3: Add schema and minimal service**

Add columns: `id`, `workspace_id`, `name`, `base_url`, `token_json`, `enabled`, `last_tested_at`, `created_by`, `created_at`, `updated_at`; unique `(workspace_id, name)`.

Use AAD `ai_provider:${providerId}` for token sealing. Generate new IDs with `randomUUID()`; allow explicit ID only for the legacy import.

- [x] **Step 4: Run the test and verify it passes**

Run: `npm test -- src/server/platform/ai-provider.server.test.ts`

- [x] **Step 5: Generate and apply the migration**

Run: `npm run db:generate`
Run: `npm run db:migrate`

- [x] **Step 6: Commit**

Run: `git add src/db/schema.ts src/server/platform/ai-provider.server.ts src/server/platform/ai-provider.server.test.ts drizzle`
Run: `git commit -m "feat: add encrypted ai provider storage"`

### Task 2: Provider HTTP API and encrypted legacy import

**Files:**
- Create: `src/server/http/ai-provider-http.server.ts`
- Create: `src/server/http/ai-provider-http.server.test.ts`
- Create: `src/routes/api/workspaces/$workspaceId/providers.ts`
- Create: `src/routes/api/providers/$providerId.ts`
- Create: `src/routes/api/providers/$providerId/test.ts`
- Create: `scripts/import-env-provider.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `GET/POST /api/workspaces/:workspaceId/providers`
- Produces: `PUT /api/providers/:providerId?workspaceId=...`
- Produces: `POST /api/providers/:providerId/test?workspaceId=...`
- Produces: `import-env-provider` script that creates provider ID `oneapi-comate` if absent.

- [x] **Step 1: Write failing HTTP tests**

Cover create/list/edit/test, role checks, masked tokens, invalid base URL, and upstream `/models` failure.

```ts
expect(createResponse.status).toBe(201)
await expect(listResponse.json()).resolves.toEqual([
  expect.objectContaining({ name: '主网关', tokenMasked: expect.any(String) }),
])
expect(JSON.stringify(await listResponse.json())).not.toContain('secret-token')
```

- [x] **Step 2: Run the tests and verify the handlers are missing**

Run: `npm test -- src/server/http/ai-provider-http.server.test.ts`

- [x] **Step 3: Implement handlers and routes**

Use existing authentication, origin checks, workspace access, and error response conventions.

- [x] **Step 4: Implement legacy import**

Read `AI_BASE_URL` and `AI_TOKEN`, resolve `DEV_WORKSPACE_SLUG`, then create or update `oneapi-comate` through `saveAiProvider` with its token encrypted.

- [x] **Step 5: Run tests and import the current provider**

Run: `npm test -- src/server/http/ai-provider-http.server.test.ts`
Run: `npm run import-env-provider`

- [x] **Step 6: Commit**

`git commit -m "feat: add provider management api"`

### Task 3: Multi-provider model discovery

**Files:**
- Modify: `src/server/http/model-http.server.ts`
- Modify: `src/server/http/model-http.server.test.ts`
- Modify: `src/lib/api/platform-client.ts`
- Modify: `src/lib/api/platform-client.test.ts`
- Modify: `src/routes/api/model-config.ts`
- Modify: `src/routes/w.$workspaceSlug.agents.$agentId.prompt.tsx`

**Interfaces:**
- Consumes: `listAiProviders` and decrypted provider tokens.
- Produces: `GET /api/model-config?workspaceId=...`
- Produces options with `{ provider: provider.id, providerLabel: provider.name, modelId, baseUrl }`.

- [x] **Step 1: Write failing aggregation tests**

Configure two providers and verify models are merged, deduplicated per provider, sorted, and one failed provider does not hide the other provider’s models.

```ts
expect(options.map((option) => `${option.provider}:${option.modelId}`)).toEqual([
  'provider-a:model-1',
  'provider-b:model-2',
])
expect(fetchMock).toHaveBeenCalledTimes(2)
```

- [x] **Step 2: Run the tests and verify the environment-based handler fails**

Run: `npm test -- src/server/http/model-http.server.test.ts`

- [x] **Step 3: Implement provider aggregation and workspace query**

Reject missing `workspaceId`, require workspace access, decrypt tokens server-side, and return provider-specific model options.

- [x] **Step 4: Run tests**

Run: `npm test -- src/server/http/model-http.server.test.ts src/lib/api/platform-client.test.ts`

- [x] **Step 5: Commit**

`git commit -m "feat: aggregate models across ai providers"`

### Task 4: Dynamic Pi provider synchronization

**Files:**
- Modify: `src/server/runtime/gateway-models.server.ts`
- Modify: `src/server/runtime/gateway-models.server.test.ts`
- Modify: `src/server/runtime/pi-runtime.server.ts`
- Modify: `src/server/platform/ai-provider.server.ts`
- Modify: `src/server/platform/ai-provider.server.test.ts`

**Interfaces:**
- Produces: `createProviderModels(providers, fetchModels): Promise<MutableModels>`
- Produces: `syncRuntimeProviders(db, runtime, box): Promise<void>`
- Provider save/test operations invoke synchronization after commit.

- [x] **Step 1: Write failing tests**

Verify two provider IDs are registered, disabled providers are removed, and replacing base URL/API key updates the registered provider.

```ts
expect(models.getProvider('legacy-provider')?.name).toBe('主网关')
expect(runtime.models.getModel('provider-b', 'model-b')).toBeTruthy()
expect(runtime.models.getProvider('disabled-provider')).toBeUndefined()
```

- [x] **Step 2: Run tests and verify they fail**

Run: `npm test -- src/server/runtime/gateway-models.server.test.ts src/server/platform/ai-provider.server.test.ts`

- [x] **Step 3: Implement provider collection and synchronization**

Build one Pi provider per database row using the row ID, provider display name, base URL, model list, and a token resolver reading the encrypted record.

- [x] **Step 4: Run tests**

Run the same command and verify PASS.

- [x] **Step 5: Commit**

`git commit -m "feat: register ai providers at runtime"`

### Task 5: Provider management UI

**Files:**
- Create: `src/components/providers/provider-management.tsx`
- Create: `src/components/providers/provider-management.test.tsx`
- Create: `src/routes/w.$workspaceSlug.providers.tsx`
- Modify: `src/components/home/agent-home-dashboard.tsx`
- Modify: `src/components/agents/agent-prompt-form.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes provider API client functions.
- Produces `/w/:workspaceSlug/providers`.
- Homepage shows a “供应商” link for workspace admins.

- [x] **Step 1: Write failing UI tests**

Cover listing, creating, editing without re-entering token, connection test, and model-empty guidance.

```ts
await user.click(screen.getByRole('button', { name: '添加供应商' }))
await user.type(screen.getByLabelText('供应商名称'), '备用网关')
await user.click(screen.getByRole('button', { name: '保存供应商' }))
expect(await screen.findByText('备用网关')).toBeTruthy()
```

- [x] **Step 2: Run tests and verify the page/components are missing**

Run: `npm test -- src/components/providers/provider-management.test.tsx`

- [x] **Step 3: Implement management page**

Use the existing paper/sea-glass design. Do not add provider tokens to client state after save. Keep edit mode’s token blank with placeholder “留空则保留现有 Token”.

- [x] **Step 4: Update prompt empty state**

Replace `AI_TOKEN / AI_BASE_URL` text with guidance to add an enabled provider.

- [x] **Step 5: Run tests and visually verify both pages**

Run: `npm test -- src/components/providers/provider-management.test.tsx src/components/agents/agent-prompt-form.test.tsx`

- [x] **Step 6: Commit**

`git commit -m "feat: add ai provider management ui"`

### Task 6: Documentation, migration verification, and full gate

**Files:**
- Modify: `README.md`
- Modify: `.env.example`

**Interfaces:**
- Environment provider variables documented only as one-time legacy import inputs.

- [x] **Step 1: Document provider workflow and migration**

Add setup instructions for `npm run import-env-provider`, adding multiple providers, model selection, encryption, and workspace permissions.

- [x] **Step 2: Verify the existing Agent remains usable**

Create an Agent using each provider, publish it, and complete one real chat against the imported legacy provider.

- [x] **Step 3: Run the full gate**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm audit --omit=dev --audit-level=moderate
git diff --check
```

- [x] **Step 4: Commit and push**

`git commit -m "docs: document ai provider management"`
`git push origin main`
