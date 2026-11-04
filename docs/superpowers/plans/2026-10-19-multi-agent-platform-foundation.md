# Multi-Agent Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the authenticated workspace, database, and Agent-version foundation required by the multi-Agent platform.

**Architecture:** TanStack Start server routes call small platform services. Authentication is selected by `AUTH_MODE`, every resource is workspace-scoped, and published Agent versions are immutable. SQLite is accessed through Drizzle in this plan; the Pi Durable Harness and its `pi_` tables are added by the next plan.

**Tech Stack:** TypeScript, TanStack Start, Nitro, React, Drizzle ORM, better-sqlite3, Zod, jose, Vitest.

## Global Constraints

- Node.js must be at least 22.19.0.
- `AUTH_MODE` must be exactly `gateway` or `development`; there is no fallback.
- `AUTH_MODE=development` with `NODE_ENV=production` must fail startup.
- Gateway authentication uses only the `x-zt-authorization` JWT header.
- Gateway JWT algorithms are limited to HS256, HS384, and HS512.
- Development authentication uses `DEV_AUTH_USERNAME` and still enforces workspace RBAC.
- Every Agent, user-owned resource, audit row, and API lookup is scoped by workspace.
- Agent versions are immutable after publication.
- Existing conversations keep their bound Agent version; this plan stores that binding contract for later runtime work.
- Secrets are encrypted; plaintext secrets never enter logs or HTTP responses.
- `.env.example` contains placeholders and documentation only.
- InfoFlow credentials are not application-wide environment variables.
- Server-only modules must not be imported by client components.
- This plan does not implement Pi Durable chat execution, capability execution, or InfoFlow connectivity.

## File Structure

```text
.env.example
vitest.config.ts
src/server/env.server.ts
src/server/env.server.test.ts
src/db/schema.ts
src/db/index.ts
src/db/schema.test.ts
src/server/secrets/secret-box.server.ts
src/server/secrets/secret-box.server.test.ts
src/server/auth/types.server.ts
src/server/auth/authenticate.server.ts
src/server/auth/authenticate.server.test.ts
src/server/platform/workspace-access.server.ts
src/server/platform/workspace-access.server.test.ts
src/server/platform/agent-version.server.ts
src/server/platform/agent-version.server.test.ts
src/server/http/auth-http.server.ts
src/server/http/agent-http.server.ts
src/server/http/agent-http.server.test.ts
src/routes/api/auth/me.ts
src/routes/api/workspaces/index.ts
src/routes/api/workspaces/$workspaceId/agents.ts
src/routes/api/agents/$agentId.ts
src/routes/api/agents/$agentId/draft.ts
src/routes/api/agents/$agentId/publish.ts
src/routes/api/agents/$agentId/versions.ts
scripts/seed-dev.ts
drizzle/
```

Responsibilities:

- `env.server.ts`: parse and validate all process configuration.
- `schema.ts`: define workspace, identity, Agent, AgentVersion, and audit tables.
- `secret-box.server.ts`: AES-256-GCM encryption and decryption.
- `authenticate.server.ts`: convert either a gateway JWT or development environment into an `Identity`.
- `workspace-access.server.ts`: map identities to users/workspaces and enforce roles.
- `agent-version.server.ts`: draft, publish, list, and copy immutable Agent versions.
- `*-http.server.ts`: testable HTTP behavior with injected dependencies.
- `src/routes/api/**`: thin TanStack Start adapters that call the HTTP services.

---

### Task 1: Add Environment Validation and Test Infrastructure

**Files:**

- Modify: `package.json`
- Create: `.env.example`
- Create: `vitest.config.ts`
- Create: `src/server/env.server.ts`
- Create: `src/server/env.server.test.ts`

**Interfaces:**

- Consumes: Node `process.env`.
- Produces:
  - `type ServerEnv`
  - `parseServerEnv(source: Record<string, string | undefined>): ServerEnv`
  - `getServerEnv(): ServerEnv`
  - `resetServerEnvForTests(): void`

- [ ] **Step 1: Install runtime and test dependencies**

Run:

```bash
npm install jose dotenv
npm install --save-dev vitest
```

Expected: `package.json` and `package-lock.json` include `jose` and `vitest`.

- [ ] **Step 2: Add test and typecheck scripts**

Update the `scripts` block in `package.json`:

```json
{
  "scripts": {
    "dev": "vite dev --port 3000",
    "generate-routes": "tsr generate",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "eslint",
    "format": "prettier --write . && eslint --fix",
    "check": "prettier --check .",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:push": "drizzle-kit push",
    "db:pull": "drizzle-kit pull",
    "db:studio": "drizzle-kit studio",
    "dev:seed": "tsx scripts/seed-dev.ts"
  }
}
```

- [ ] **Step 3: Write the failing environment tests**

Create `src/server/env.server.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { parseServerEnv } from './env.server'

const base = {
  NODE_ENV: 'development',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  DEV_WORKSPACE_SLUG: 'default',
  APP_DATABASE_PATH: './data/test.sqlite',
  CHANNEL_SECRET_KEK: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  INFOFLOW_API_BASE_URL: 'https://apiin.im.baidu.com/api/v1',
  INFOFLOW_WS_GATEWAY: 'infoflow-open-gateway.weiyun.baidu.com',
  INFOFLOW_WS_CONNECT_DOMAIN: 'infoflow-open-gateway.weiyun.baidu.com:8869',
} as const

describe('parseServerEnv', () => {
  it('accepts development authentication without gateway JWT settings', () => {
    const env = parseServerEnv(base)

    expect(env.AUTH_MODE).toBe('development')
    expect(env.DEV_AUTH_USERNAME).toBe('alice')
    expect(env.DEV_WORKSPACE_SLUG).toBe('default')
  })

  it('requires gateway settings in gateway mode', () => {
    expect(() =>
      parseServerEnv({
        ...base,
        AUTH_MODE: 'gateway',
        DEV_AUTH_USERNAME: undefined,
        DEV_WORKSPACE_SLUG: undefined,
      }),
    ).toThrow(/AUTH_JWT_SECRET/)
  })

  it('accepts gateway settings when all required fields are present', () => {
    const env = parseServerEnv({
      ...base,
      AUTH_MODE: 'gateway',
      AUTH_JWT_SECRET: 'a-long-development-only-secret',
      AUTH_JWT_ALGORITHM: 'HS256',
      AUTH_JWT_ISSUER: 'zero-trust-gateway',
      AUTH_JWT_AUDIENCE: 'multi-agent-platform',
    })

    expect(env.AUTH_MODE).toBe('gateway')
    expect(env.AUTH_JWT_ALGORITHM).toBe('HS256')
  })

  it('rejects development authentication in production', () => {
    expect(() =>
      parseServerEnv({
        ...base,
        NODE_ENV: 'production',
      }),
    ).toThrow(/development.*production/i)
  })

  it('does not require InfoFlow bot credentials', () => {
    const env = parseServerEnv(base)

    expect(env).not.toHaveProperty('INFOFLOW_APP_KEY')
    expect(env).not.toHaveProperty('INFOFLOW_APP_SECRET')
    expect(env).not.toHaveProperty('INFOFLOW_AGENT_ID')
  })
})
```

- [ ] **Step 4: Run the environment tests to verify they fail**

Run:

```bash
npm test -- src/server/env.server.test.ts
```

Expected: FAIL because `src/server/env.server.ts` does not exist.

- [ ] **Step 5: Implement environment parsing**

Create `src/server/env.server.ts`:

```ts
import { config } from 'dotenv'
import { z } from 'zod'

const jwtAlgorithms = ['HS256', 'HS384', 'HS512'] as const

const serverEnvSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    APP_ORIGIN: z.string().url(),
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error'])
      .default('info'),
    AUTH_MODE: z.enum(['gateway', 'development']),
    DEV_AUTH_USERNAME: z.string().trim().min(1).optional(),
    DEV_WORKSPACE_SLUG: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
      .optional(),
    AUTH_JWT_SECRET: z.string().min(1).optional(),
    AUTH_JWT_ALGORITHM: z.enum(jwtAlgorithms).optional(),
    AUTH_JWT_ISSUER: z.string().trim().min(1).optional(),
    AUTH_JWT_AUDIENCE: z.string().trim().min(1).optional(),
    APP_DATABASE_PATH: z.string().trim().min(1),
    CHANNEL_SECRET_KEK: z.string().trim().min(1),
    INFOFLOW_API_BASE_URL: z
      .string()
      .url()
      .default('https://apiin.im.baidu.com/api/v1'),
    INFOFLOW_WS_GATEWAY: z
      .string()
      .trim()
      .min(1)
      .default('infoflow-open-gateway.weiyun.baidu.com'),
    INFOFLOW_WS_CONNECT_DOMAIN: z
      .string()
      .trim()
      .min(1)
      .default('infoflow-open-gateway.weiyun.baidu.com:8869'),
  })
  .superRefine((value, ctx) => {
    if (value.AUTH_MODE === 'development' && value.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_MODE'],
        message: 'development authentication is forbidden in production',
      })
    }

    if (value.AUTH_MODE === 'development') {
      if (!value.DEV_AUTH_USERNAME) {
        ctx.addIssue({
          code: 'custom',
          path: ['DEV_AUTH_USERNAME'],
          message: 'DEV_AUTH_USERNAME is required in development mode',
        })
      }
      if (!value.DEV_WORKSPACE_SLUG) {
        ctx.addIssue({
          code: 'custom',
          path: ['DEV_WORKSPACE_SLUG'],
          message: 'DEV_WORKSPACE_SLUG is required in development mode',
        })
      }
    }

    if (value.AUTH_MODE === 'gateway') {
      if (!value.AUTH_JWT_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_JWT_SECRET'],
          message: 'AUTH_JWT_SECRET is required in gateway mode',
        })
      }
      if (!value.AUTH_JWT_ALGORITHM) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_JWT_ALGORITHM'],
          message: 'AUTH_JWT_ALGORITHM is required in gateway mode',
        })
      }
    }
  })

export type ServerEnv = z.infer<typeof serverEnvSchema>

export function parseServerEnv(
  source: Record<string, string | undefined>,
): ServerEnv {
  return serverEnvSchema.parse(source)
}

let cachedEnv: ServerEnv | undefined
let loadedEnvFiles = false

function loadEnvFiles(): void {
  if (loadedEnvFiles) return
  loadedEnvFiles = true
  config({ path: ['.env.local', '.env'] })
}

export function getServerEnv(): ServerEnv {
  loadEnvFiles()
  cachedEnv ??= parseServerEnv(process.env)
  return cachedEnv
}

export function resetServerEnvForTests(): void {
  cachedEnv = undefined
}
```

- [ ] **Step 6: Add Vitest alias configuration**

Create `vitest.config.ts`:

```ts
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '#': path.resolve(root, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    restoreMocks: true,
  },
})
```

- [ ] **Step 7: Add `.env.example`**

Create `.env.example`:

```dotenv
# Runtime
NODE_ENV=development
PORT=3000
APP_ORIGIN=http://localhost:3000
LOG_LEVEL=info

# Authentication
# development: use DEV_AUTH_USERNAME for local debugging
# gateway: trust x-zt-authorization injected by the zero-trust gateway
AUTH_MODE=development
DEV_AUTH_USERNAME=your.username
DEV_WORKSPACE_SLUG=default

# Required only when AUTH_MODE=gateway
AUTH_JWT_SECRET=replace-with-gateway-jwt-secret
AUTH_JWT_ALGORITHM=HS256
AUTH_JWT_ISSUER=replace-with-gateway-issuer
AUTH_JWT_AUDIENCE=replace-with-gateway-audience

# SQLite and application-level secret encryption
APP_DATABASE_PATH=./data/platform.sqlite
CHANNEL_SECRET_KEK=replace-with-base64-encoded-32-byte-key

# InfoFlow global endpoints.
# INFOFLOW_AGENT_ID, INFOFLOW_APP_KEY, and INFOFLOW_APP_SECRET are intentionally
# not environment variables. They are entered in the Agent channel configuration
# and stored encrypted in the database.
INFOFLOW_API_BASE_URL=https://apiin.im.baidu.com/api/v1
INFOFLOW_WS_GATEWAY=infoflow-open-gateway.weiyun.baidu.com
INFOFLOW_WS_CONNECT_DOMAIN=infoflow-open-gateway.weiyun.baidu.com:8869
```

- [ ] **Step 8: Run the environment tests**

Run:

```bash
npm test -- src/server/env.server.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 9: Run typechecking**

Run:

```bash
npm run typecheck
```

Expected: exit code 0.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json .env.example vitest.config.ts src/server/env.server.ts src/server/env.server.test.ts
git commit -m "feat: validate platform environment"
```

---

### Task 2: Add the Workspace and Agent Database Foundation

**Files:**

- Modify: `drizzle.config.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/db/index.ts`
- Create: `src/db/schema.test.ts`
- Create: `drizzle/` migration files via `npm run db:generate`

**Interfaces:**

- Produces:
  - Drizzle tables: `workspaces`, `users`, `workspaceMembers`, `agents`, `agentVersions`, `agentAccessGrants`, `auditLogs`
  - `createDatabase(path: string)`
  - `getDatabase(): ReturnType<typeof createDatabase>`
  - Role/status/visibility unions through inferred table types.

- [ ] **Step 1: Write the failing schema test**

Create `src/db/schema.test.ts`:

```ts
import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from './index'
import {
  agentVersions,
  agents,
  users,
  workspaceMembers,
  workspaces,
} from './schema'

describe('platform schema', () => {
  let db: ReturnType<typeof createDatabase>

  beforeEach(() => {
    db = createDatabase(':memory:')
    migrate(db, { migrationsFolder: './drizzle' })
  })

  afterEach(() => {
    db.$client.close()
  })

  it('stores a workspace member, Agent, and AgentVersion', () => {
    const workspaceId = randomUUID()
    const userId = randomUUID()
    const agentId = randomUUID()
    const versionId = randomUUID()

    db.insert(workspaces)
      .values({ id: workspaceId, slug: 'default', name: 'Default' })
      .run()
    db.insert(users).values({ id: userId, username: 'alice' }).run()
    db.insert(workspaceMembers)
      .values({ workspaceId, userId, role: 'workspace_admin' })
      .run()
    db.insert(agents)
      .values({
        id: agentId,
        workspaceId,
        name: 'Reviewer',
        visibility: 'workspace',
        status: 'draft',
        createdBy: userId,
      })
      .run()
    db.insert(agentVersions)
      .values({
        id: versionId,
        workspaceId,
        agentId,
        versionNumber: 1,
        instructions: 'Review code carefully.',
        modelProvider: 'openai',
        modelId: 'gpt-6.1-sol',
        thinkingLevel: 'high',
        responsePolicyJson: {
          allowedParts: ['text', 'markdown'],
          maxTextLength: null,
          allowAttachments: false,
        },
        workspacePolicyJson: { workspaceMode: 'conversation' },
        manifestJson: { capabilities: [] },
        manifestHash: 'abc',
        status: 'draft',
        createdBy: userId,
      })
      .run()

    const stored = db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.id, versionId))
      .get()

    expect(stored?.instructions).toBe('Review code carefully.')
    expect(stored?.status).toBe('draft')
  })

  it('rejects duplicate workspace slugs', () => {
    db.insert(workspaces)
      .values({ id: randomUUID(), slug: 'default', name: 'Default' })
      .run()

    expect(() =>
      db
        .insert(workspaces)
        .values({ id: randomUUID(), slug: 'default', name: 'Duplicate' })
        .run(),
    ).toThrow(/UNIQUE/)
  })
})
```

- [ ] **Step 2: Run the schema test to verify it fails**

Run:

```bash
npm test -- src/db/schema.test.ts
```

Expected: FAIL because the required tables and `createDatabase` do not exist.

- [ ] **Step 3: Replace the starter schema**

Replace `src/db/schema.ts` with:

```ts
import { sql } from 'drizzle-orm'
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)

export const workspaces = sqliteTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('workspaces_slug_uq').on(table.slug)],
)

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    name: text('name'),
    email: text('email'),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('users_username_uq').on(table.username)],
)

export const workspaceMembers = sqliteTable(
  'workspace_members',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', {
      enum: ['platform_admin', 'workspace_admin', 'editor', 'user'],
    }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })],
)

export const agents = sqliteTable(
  'agents',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    visibility: text('visibility', {
      enum: ['workspace', 'restricted'],
    })
      .notNull()
      .default('workspace'),
    status: text('status', {
      enum: ['draft', 'active', 'disabled'],
    })
      .notNull()
      .default('draft'),
    currentPublishedVersionId: text('current_published_version_id'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex('agents_workspace_name_uq').on(table.workspaceId, table.name),
  ],
)

export const agentVersions = sqliteTable(
  'agent_versions',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    instructions: text('instructions').notNull(),
    modelProvider: text('model_provider').notNull(),
    modelId: text('model_id').notNull(),
    thinkingLevel: text('thinking_level', {
      enum: ['off', 'minimal', 'low', 'medium', 'high'],
    }).notNull(),
    responsePolicyJson: text('response_policy_json', {
      mode: 'json',
    }).notNull(),
    workspacePolicyJson: text('workspace_policy_json', {
      mode: 'json',
    }).notNull(),
    manifestJson: text('manifest_json', { mode: 'json' }).notNull(),
    manifestHash: text('manifest_hash').notNull(),
    status: text('status', {
      enum: ['draft', 'published', 'retired'],
    })
      .notNull()
      .default('draft'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    uniqueIndex('agent_versions_number_uq').on(
      table.agentId,
      table.versionNumber,
    ),
  ],
)

export const agentAccessGrants = sqliteTable(
  'agent_access_grants',
  {
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.agentId, table.userId] })],
)

export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  actorUserId: text('actor_user_id')
    .notNull()
    .references(() => users.id),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  detailsJson: text('details_json', { mode: 'json' }),
  createdAt: createdAt(),
})
```

- [ ] **Step 4: Add the database factory**

Replace `src/db/index.ts` with:

```ts
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { getServerEnv } from '#/server/env.server'

import * as schema from './schema'

export function createDatabase(path: string) {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }

  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')

  return drizzle(sqlite, { schema })
}

let database: ReturnType<typeof createDatabase> | undefined

export function getDatabase(): ReturnType<typeof createDatabase> {
  database ??= createDatabase(getServerEnv().APP_DATABASE_PATH)
  return database
}
```

- [ ] **Step 5: Update Drizzle configuration**

Replace `drizzle.config.ts` with:

```ts
import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

config({ path: ['.env.local', '.env'] })

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.APP_DATABASE_PATH ?? './data/platform.sqlite',
  },
})
```

- [ ] **Step 6: Generate the initial migration**

Run:

```bash
npm run db:generate
```

Expected: `drizzle/` contains generated SQL and metadata for the seven tables.

- [ ] **Step 7: Run the schema tests**

Run:

```bash
npm test -- src/db/schema.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 8: Run typechecking**

Run:

```bash
npm run typecheck
```

Expected: exit code 0.

- [ ] **Step 9: Commit**

```bash
git add drizzle.config.ts src/db/index.ts src/db/schema.ts src/db/schema.test.ts drizzle
git commit -m "feat: add workspace and agent database schema"
```

---

### Task 3: Encrypt Workspace Secrets

**Files:**

- Create: `src/server/secrets/secret-box.server.ts`
- Create: `src/server/secrets/secret-box.server.test.ts`

**Interfaces:**

- Consumes: `CHANNEL_SECRET_KEK`, a base64-encoded 32-byte key.
- Produces:
  - `type SealedSecret`
  - `new SecretBox(kekBase64: string)`
  - `seal(plaintext: string, aad: string): SealedSecret`
  - `open(sealed: SealedSecret, aad: string): string`

- [ ] **Step 1: Write the failing encryption tests**

Create `src/server/secrets/secret-box.server.test.ts`:

```ts
import { randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { SecretBox } from './secret-box.server'

const key = randomBytes(32).toString('base64')

describe('SecretBox', () => {
  it('round-trips a secret bound to AAD', () => {
    const box = new SecretBox(key)
    const sealed = box.seal('app-secret-value', 'connection:123')

    expect(sealed.ciphertext).not.toContain('app-secret-value')
    expect(box.open(sealed, 'connection:123')).toBe('app-secret-value')
  })

  it('rejects a secret opened with different AAD', () => {
    const box = new SecretBox(key)
    const sealed = box.seal('app-secret-value', 'connection:123')

    expect(() => box.open(sealed, 'connection:456')).toThrow()
  })

  it('rejects tampering', () => {
    const box = new SecretBox(key)
    const sealed = box.seal('app-secret-value', 'connection:123')

    expect(() =>
      box.open(
        { ...sealed, ciphertext: `${sealed.ciphertext.slice(0, -2)}00` },
        'connection:123',
      ),
    ).toThrow()
  })

  it('rejects keys that are not 32 bytes', () => {
    expect(
      () => new SecretBox(Buffer.from('short').toString('base64')),
    ).toThrow(/32 bytes/)
  })
})
```

- [ ] **Step 2: Run the encryption tests to verify they fail**

Run:

```bash
npm test -- src/server/secrets/secret-box.server.test.ts
```

Expected: FAIL because `SecretBox` does not exist.

- [ ] **Step 3: Implement AES-256-GCM encryption**

Create `src/server/secrets/secret-box.server.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export type SealedSecret = {
  version: 1
  algorithm: 'aes-256-gcm'
  iv: string
  tag: string
  ciphertext: string
}

const algorithm = 'aes-256-gcm'

export class SecretBox {
  readonly #key: Buffer

  constructor(kekBase64: string) {
    const key = Buffer.from(kekBase64, 'base64')
    if (key.length !== 32) {
      throw new Error('CHANNEL_SECRET_KEK must decode to exactly 32 bytes')
    }
    this.#key = key
  }

  seal(plaintext: string, aad: string): SealedSecret {
    const iv = randomBytes(12)
    const cipher = createCipheriv(algorithm, this.#key, iv)
    cipher.setAAD(Buffer.from(aad, 'utf8'))
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ])

    return {
      version: 1,
      algorithm,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    }
  }

  open(sealed: SealedSecret, aad: string): string {
    if (sealed.version !== 1 || sealed.algorithm !== algorithm) {
      throw new Error('Unsupported encrypted secret format')
    }

    try {
      const decipher = createDecipheriv(
        algorithm,
        this.#key,
        Buffer.from(sealed.iv, 'base64'),
      )
      decipher.setAAD(Buffer.from(aad, 'utf8'))
      decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'))
      return Buffer.concat([
        decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8')
    } catch {
      throw new Error('Secret decryption failed')
    }
  }
}
```

- [ ] **Step 4: Run the encryption tests**

Run:

```bash
npm test -- src/server/secrets/secret-box.server.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/secrets
git commit -m "feat: encrypt application secrets"
```

---

### Task 4: Implement Gateway and Development Authentication

**Files:**

- Create: `src/server/auth/types.server.ts`
- Create: `src/server/auth/authenticate.server.ts`
- Create: `src/server/auth/authenticate.server.test.ts`

**Interfaces:**

- Consumes: `ServerEnv`.
- Produces:
  - `type Identity`
  - `authenticateRequest(headers: Headers, env: ServerEnv, now?: number): Promise<Identity | null>`

- [ ] **Step 1: Write the failing authentication tests**

Create `src/server/auth/authenticate.server.test.ts`:

```ts
import { SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'

import { parseServerEnv } from '#/server/env.server'

import { authenticateRequest } from './authenticate.server'

const base = {
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  DEV_WORKSPACE_SLUG: 'default',
  APP_DATABASE_PATH: './data/test.sqlite',
  CHANNEL_SECRET_KEK: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
} as const

describe('authenticateRequest', () => {
  it('returns the configured development identity', async () => {
    const identity = await authenticateRequest(
      new Headers(),
      parseServerEnv(base),
      1_000,
    )

    expect(identity?.username).toBe('alice')
    expect(identity?.authMode).toBe('development')
  })

  it('verifies a gateway JWT and reads username', async () => {
    const env = parseServerEnv({
      ...base,
      AUTH_MODE: 'gateway',
      AUTH_JWT_SECRET: 'a-long-development-only-secret',
      AUTH_JWT_ALGORITHM: 'HS256',
      AUTH_JWT_ISSUER: 'zero-trust-gateway',
      AUTH_JWT_AUDIENCE: 'multi-agent-platform',
    })
    const token = await new SignJWT({
      username: 'bob',
      name: 'Bob',
      email: 'bob@example.com',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('zero-trust-gateway')
      .setAudience('multi-agent-platform')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(env.AUTH_JWT_SECRET))

    const identity = await authenticateRequest(
      new Headers({ 'x-zt-authorization': token }),
      env,
    )

    expect(identity?.username).toBe('bob')
    expect(identity?.authMode).toBe('gateway')
  })

  it('rejects a gateway request without a JWT', async () => {
    const env = parseServerEnv({
      ...base,
      AUTH_MODE: 'gateway',
      AUTH_JWT_SECRET: 'a-long-development-only-secret',
      AUTH_JWT_ALGORITHM: 'HS256',
    })

    await expect(authenticateRequest(new Headers(), env)).resolves.toBeNull()
  })

  it('rejects a JWT signed with another secret', async () => {
    const env = parseServerEnv({
      ...base,
      AUTH_MODE: 'gateway',
      AUTH_JWT_SECRET: 'expected-secret',
      AUTH_JWT_ALGORITHM: 'HS256',
    })
    const token = await new SignJWT({ username: 'mallory' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('different-secret'))

    await expect(
      authenticateRequest(new Headers({ 'x-zt-authorization': token }), env),
    ).resolves.toBeNull()
  })
})
```

- [ ] **Step 2: Run the authentication tests to verify they fail**

Run:

```bash
npm test -- src/server/auth/authenticate.server.test.ts
```

Expected: FAIL because the authentication module does not exist.

- [ ] **Step 3: Define identity types**

Create `src/server/auth/types.server.ts`:

```ts
export type AuthMode = 'gateway' | 'development'

export type Identity = {
  username: string
  name: string | null
  email: string | null
  expiresAt: number
  authMode: AuthMode
}
```

- [ ] **Step 4: Implement authentication providers**

Create `src/server/auth/authenticate.server.ts`:

```ts
import { jwtVerify } from 'jose'

import type { ServerEnv } from '#/server/env.server'

import type { Identity } from './types.server'

const headerName = 'x-zt-authorization'
const developmentSessionMs = 24 * 60 * 60 * 1000

function stringClaim(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

async function authenticateGateway(
  headers: Headers,
  env: ServerEnv,
): Promise<Identity | null> {
  const token = headers.get(headerName)
  if (!token || !env.AUTH_JWT_SECRET || !env.AUTH_JWT_ALGORITHM) {
    return null
  }

  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(env.AUTH_JWT_SECRET),
      {
        algorithms: [env.AUTH_JWT_ALGORITHM],
        requiredClaims: ['exp', 'username'],
        issuer: env.AUTH_JWT_ISSUER,
        audience: env.AUTH_JWT_AUDIENCE,
      },
    )
    const username = stringClaim(payload.username)
    if (!username || typeof payload.exp !== 'number') {
      return null
    }

    return {
      username,
      name: stringClaim(payload.name),
      email: stringClaim(payload.email),
      expiresAt: payload.exp * 1000,
      authMode: 'gateway',
    }
  } catch {
    return null
  }
}

function authenticateDevelopment(env: ServerEnv, now: number): Identity | null {
  if (!env.DEV_AUTH_USERNAME) return null

  return {
    username: env.DEV_AUTH_USERNAME,
    name: null,
    email: null,
    expiresAt: now + developmentSessionMs,
    authMode: 'development',
  }
}

export async function authenticateRequest(
  headers: Headers,
  env: ServerEnv,
  now = Date.now(),
): Promise<Identity | null> {
  if (env.AUTH_MODE === 'development') {
    return authenticateDevelopment(env, now)
  }

  return authenticateGateway(headers, env)
}
```

- [ ] **Step 5: Run the authentication tests**

Run:

```bash
npm test -- src/server/auth/authenticate.server.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/server/auth
git commit -m "feat: add gateway and development authentication"
```

---

### Task 5: Add Workspace Access and Development Seeding

**Files:**

- Create: `src/server/platform/workspace-access.server.ts`
- Create: `src/server/platform/workspace-access.server.test.ts`
- Create: `scripts/seed-dev.ts`
- Create: `src/server/http/auth-http.server.ts`
- Create: `src/routes/api/auth/me.ts`

**Interfaces:**

- Consumes:
  - `Identity`
  - Drizzle database from `createDatabase()`
- Produces:
  - `type WorkspaceRole`
  - `type WorkspaceAccess`
  - `type AppPrincipal`
  - `ensureDevelopmentSeed(db, env): Promise<void>`
  - `resolvePrincipal(db, identity, env): Promise<AppPrincipal | null>`
  - `requireWorkspaceAccess(db, principal, workspaceId, roles): Promise<WorkspaceAccess>`
  - `handleAuthMe(request, dependencies): Promise<Response>`

- [ ] **Step 1: Write the failing workspace access tests**

Create `src/server/platform/workspace-access.server.test.ts`:

```ts
import { randomUUID } from 'node:crypto'

import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'

import { createDatabase } from '#/db'
import { users, workspaces } from '#/db/schema'
import type { Identity } from '#/server/auth/types.server'
import { parseServerEnv } from '#/server/env.server'

import {
  ensureDevelopmentSeed,
  requireWorkspaceAccess,
  resolvePrincipal,
} from './workspace-access.server'

const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  DEV_WORKSPACE_SLUG: 'default',
  APP_DATABASE_PATH: ':memory:',
  CHANNEL_SECRET_KEK: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
})

const identity: Identity = {
  username: 'alice',
  name: null,
  email: null,
  expiresAt: Date.now() + 60_000,
  authMode: 'development',
}

describe('workspace access', () => {
  it('seeds a development workspace idempotently', async () => {
    const db = createDatabase(':memory:')
    migrate(db, { migrationsFolder: './drizzle' })

    await ensureDevelopmentSeed(db, env)
    await ensureDevelopmentSeed(db, env)

    expect(db.select().from(users).all()).toHaveLength(1)
    expect(db.select().from(workspaces).all()).toHaveLength(1)
  })

  it('resolves workspace roles for the authenticated user', async () => {
    const db = createDatabase(':memory:')
    migrate(db, { migrationsFolder: './drizzle' })
    await ensureDevelopmentSeed(db, env)

    const principal = await resolvePrincipal(db, identity, env)

    expect(principal?.username).toBe('alice')
    expect(principal?.workspaces).toEqual([
      expect.objectContaining({ slug: 'default', role: 'workspace_admin' }),
    ])
  })

  it('denies access to a foreign workspace', async () => {
    const db = createDatabase(':memory:')
    migrate(db, { migrationsFolder: './drizzle' })
    await ensureDevelopmentSeed(db, env)
    const principal = await resolvePrincipal(db, identity, env)
    const foreignId = randomUUID()
    db.insert(workspaces)
      .values({ id: foreignId, slug: 'foreign', name: 'Foreign' })
      .run()

    await expect(
      requireWorkspaceAccess(db, principal!, foreignId, ['editor']),
    ).rejects.toThrow(/forbidden/i)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npm test -- src/server/platform/workspace-access.server.test.ts
```

Expected: FAIL because the workspace service does not exist.

- [ ] **Step 3: Implement workspace access**

Create `src/server/platform/workspace-access.server.ts`:

```ts
import { randomUUID } from 'node:crypto'

import { and, eq } from 'drizzle-orm'

import type { createDatabase } from '#/db'
import { users, workspaceMembers, workspaces } from '#/db/schema'
import type { Identity } from '#/server/auth/types.server'
import type { ServerEnv } from '#/server/env.server'

type AppDatabase = ReturnType<typeof createDatabase>

export type WorkspaceRole =
  'platform_admin' | 'workspace_admin' | 'editor' | 'user'

export type WorkspaceAccess = {
  workspaceId: string
  slug: string
  name: string
  role: WorkspaceRole
}

export type AppPrincipal = {
  userId: string
  username: string
  name: string | null
  email: string | null
  expiresAt: number
  authMode: Identity['authMode']
  workspaces: WorkspaceAccess[]
}

export class ForbiddenError extends Error {
  constructor() {
    super('forbidden')
  }
}

export async function ensureDevelopmentSeed(
  db: AppDatabase,
  env: ServerEnv,
): Promise<void> {
  if (
    env.AUTH_MODE !== 'development' ||
    !env.DEV_AUTH_USERNAME ||
    !env.DEV_WORKSPACE_SLUG
  ) {
    return
  }

  const userId = randomUUID()
  const workspaceId = randomUUID()

  await db.transaction(async (tx) => {
    const existingUser = await tx
      .select()
      .from(users)
      .where(eq(users.username, env.DEV_AUTH_USERNAME))
      .get()

    const storedUser =
      existingUser ??
      (await tx
        .insert(users)
        .values({
          id: userId,
          username: env.DEV_AUTH_USERNAME,
          name: env.DEV_AUTH_USERNAME,
        })
        .returning()
        .get())

    const existingWorkspace = await tx
      .select()
      .from(workspaces)
      .where(eq(workspaces.slug, env.DEV_WORKSPACE_SLUG))
      .get()

    const storedWorkspace =
      existingWorkspace ??
      (await tx
        .insert(workspaces)
        .values({
          id: workspaceId,
          slug: env.DEV_WORKSPACE_SLUG,
          name: 'Development',
        })
        .returning()
        .get())

    const membership = await tx
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, storedWorkspace.id),
          eq(workspaceMembers.userId, storedUser.id),
        ),
      )
      .get()

    if (!membership) {
      await tx.insert(workspaceMembers).values({
        workspaceId: storedWorkspace.id,
        userId: storedUser.id,
        role: 'workspace_admin',
      })
    }
  })
}

export async function resolvePrincipal(
  db: AppDatabase,
  identity: Identity,
  env: ServerEnv,
): Promise<AppPrincipal | null> {
  if (identity.authMode === 'development') {
    await ensureDevelopmentSeed(db, env)
  }

  const user = await db
    .select()
    .from(users)
    .where(eq(users.username, identity.username))
    .get()
  if (!user) return null

  const access = await db
    .select({
      workspaceId: workspaces.id,
      slug: workspaces.slug,
      name: workspaces.name,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, user.id))
    .all()

  return {
    userId: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    expiresAt: identity.expiresAt,
    authMode: identity.authMode,
    workspaces: access,
  }
}

export async function requireWorkspaceAccess(
  db: AppDatabase,
  principal: AppPrincipal | null,
  workspaceId: string,
  allowedRoles: readonly WorkspaceRole[],
): Promise<WorkspaceAccess> {
  if (!principal) throw new ForbiddenError()

  const access = await db
    .select({
      workspaceId: workspaces.id,
      slug: workspaces.slug,
      name: workspaces.name,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceMembers.userId, principal.userId),
        eq(workspaceMembers.workspaceId, workspaceId),
      ),
    )
    .get()

  if (!access || !allowedRoles.includes(access.role)) {
    throw new ForbiddenError()
  }

  return access
}
```

- [ ] **Step 4: Add the development seed script**

Create `scripts/seed-dev.ts`:

```ts
import { config } from 'dotenv'

import { createDatabase } from '../src/db/index'
import { getServerEnv } from '../src/server/env.server'
import { ensureDevelopmentSeed } from '../src/server/platform/workspace-access.server'

config({ path: ['.env.local', '.env'] })

const env = getServerEnv()
if (env.AUTH_MODE !== 'development') {
  throw new Error('dev:seed requires AUTH_MODE=development')
}

const db = createDatabase(env.APP_DATABASE_PATH)
await ensureDevelopmentSeed(db, env)
console.log(
  `development user ${env.DEV_AUTH_USERNAME} is ready in workspace ${env.DEV_WORKSPACE_SLUG}`,
)
```

- [ ] **Step 5: Add a testable auth endpoint**

Create `src/server/http/auth-http.server.ts`:

```ts
import type { createDatabase } from '#/db'
import { authenticateRequest } from '#/server/auth/authenticate.server'
import type { ServerEnv } from '#/server/env.server'
import { resolvePrincipal } from '#/server/platform/workspace-access.server'

type Dependencies = {
  db: ReturnType<typeof createDatabase>
  env: ServerEnv
}

export async function handleAuthMe(
  request: Request,
  { db, env }: Dependencies,
): Promise<Response> {
  const identity = await authenticateRequest(request.headers, env)
  if (!identity) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const principal = await resolvePrincipal(db, identity, env)
  if (!principal) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  return Response.json({
    user: {
      id: principal.userId,
      username: principal.username,
      name: principal.name,
      email: principal.email,
    },
    workspaces: principal.workspaces,
    authMode: principal.authMode,
  })
}
```

- [ ] **Step 6: Add the TanStack auth route**

Create `src/routes/api/auth/me.ts`:

```ts
import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import { handleAuthMe } from '#/server/http/auth-http.server'

export const Route = createFileRoute('/api/auth/me')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handleAuthMe(request, {
          db: getDatabase(),
          env: getServerEnv(),
        }),
    },
  },
})
```

- [ ] **Step 7: Run workspace tests**

Run:

```bash
npm test -- src/server/platform/workspace-access.server.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 8: Generate routes and typecheck**

Run:

```bash
npm run generate-routes
npm run typecheck
```

Expected: route tree includes `/api/auth/me`; TypeScript exits with code 0.

- [ ] **Step 9: Commit**

```bash
git add src/server/platform/workspace-access.server.ts src/server/platform/workspace-access.server.test.ts src/server/http/auth-http.server.ts src/routes/api/auth/me.ts src/routeTree.gen.ts scripts/seed-dev.ts
git commit -m "feat: add workspace authorization and development login"
```

---

### Task 6: Implement Immutable Agent Versions

**Files:**

- Create: `src/server/platform/agent-version.server.ts`
- Create: `src/server/platform/agent-version.server.test.ts`

**Interfaces:**

- Consumes:
  - `AppPrincipal`
  - `WorkspaceRole`
  - Drizzle database
- Produces:
  - `type AgentDraftInput`
  - `createAgent(db, principal, workspaceId, input)`
  - `updateAgentDraft(db, principal, workspaceId, agentId, input)`
  - `publishAgentVersion(db, principal, workspaceId, agentId)`
  - `createNextVersion(db, principal, workspaceId, agentId)`
  - `listAgents(db, principal, workspaceId)`
  - `getAgent(db, principal, workspaceId, agentId)`

- [ ] **Step 1: Write failing Agent version tests**

Create `src/server/platform/agent-version.server.test.ts`:

```ts
import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '#/db'
import {
  agentAccessGrants,
  agentVersions,
  agents,
  users,
  workspaceMembers,
} from '#/db/schema'

import { parseServerEnv } from '#/server/env.server'
import {
  ensureDevelopmentSeed,
  resolvePrincipal,
  type AppPrincipal,
} from './workspace-access.server'
import {
  createAgent,
  createNextVersion,
  listAgents,
  publishAgentVersion,
  updateAgentDraft,
} from './agent-version.server'

const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  DEV_WORKSPACE_SLUG: 'default',
  APP_DATABASE_PATH: ':memory:',
  CHANNEL_SECRET_KEK: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
})

describe('agent versions', () => {
  let db: ReturnType<typeof createDatabase>
  let principal: AppPrincipal
  let workspaceId: string

  beforeEach(async () => {
    db = createDatabase(':memory:')
    migrate(db, { migrationsFolder: './drizzle' })
    await ensureDevelopmentSeed(db, env)
    principal = (await resolvePrincipal(
      db,
      {
        username: 'alice',
        name: null,
        email: null,
        expiresAt: Date.now() + 60_000,
        authMode: 'development',
      },
      env,
    ))!
    workspaceId = principal.workspaces[0]!.workspaceId
  })

  afterEach(() => {
    db.$client.close()
  })

  it('creates a draft Agent and version 1', async () => {
    const created = await createAgent(db, principal, workspaceId, {
      name: 'Reviewer',
      instructions: 'Review changes.',
      modelProvider: 'openai',
      modelId: 'gpt-6.1-sol',
      thinkingLevel: 'high',
    })

    expect(created.status).toBe('draft')
    const version = db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.agentId, created.id))
      .get()
    expect(version?.versionNumber).toBe(1)
  })

  it('publishes a version and updates the Agent current version', async () => {
    const created = await createAgent(db, principal, workspaceId, {
      name: 'Reviewer',
      instructions: 'Review changes.',
      modelProvider: 'openai',
      modelId: 'gpt-6.1-sol',
      thinkingLevel: 'high',
    })

    const published = await publishAgentVersion(
      db,
      principal,
      workspaceId,
      created.id,
    )
    const agent = db
      .select()
      .from(agents)
      .where(eq(agents.id, created.id))
      .get()

    expect(published.status).toBe('published')
    expect(agent?.currentPublishedVersionId).toBe(published.id)
    expect(agent?.status).toBe('active')
  })

  it('rejects edits to a published version', async () => {
    const created = await createAgent(db, principal, workspaceId, {
      name: 'Reviewer',
      instructions: 'Review changes.',
      modelProvider: 'openai',
      modelId: 'gpt-6.1-sol',
      thinkingLevel: 'high',
    })
    await publishAgentVersion(db, principal, workspaceId, created.id)

    await expect(
      updateAgentDraft(db, principal, workspaceId, created.id, {
        instructions: 'New instructions',
      }),
    ).rejects.toThrow(/no editable draft/i)
  })

  it('copies the current published version into a new draft', async () => {
    const created = await createAgent(db, principal, workspaceId, {
      name: 'Reviewer',
      instructions: 'Review changes.',
      modelProvider: 'openai',
      modelId: 'gpt-6.1-sol',
      thinkingLevel: 'high',
    })
    const first = await publishAgentVersion(
      db,
      principal,
      workspaceId,
      created.id,
    )
    const second = await createNextVersion(
      db,
      principal,
      workspaceId,
      created.id,
    )

    expect(second.versionNumber).toBe(2)
    expect(second.instructions).toBe(first.instructions)
    expect(second.status).toBe('draft')
  })

  it('hides a restricted Agent from an ordinary user without a grant', async () => {
    const created = await createAgent(db, principal, workspaceId, {
      name: 'Private reviewer',
      instructions: 'Review private changes.',
      modelProvider: 'openai',
      modelId: 'gpt-6.1-sol',
      thinkingLevel: 'high',
      visibility: 'restricted',
    })
    const bobId = randomUUID()
    db.insert(users).values({ id: bobId, username: 'bob' }).run()
    db.insert(workspaceMembers)
      .values({ workspaceId, userId: bobId, role: 'user' })
      .run()
    const bob = (await resolvePrincipal(
      db,
      {
        username: 'bob',
        name: null,
        email: null,
        expiresAt: Date.now() + 60_000,
        authMode: 'development',
      },
      env,
    ))!

    expect(await listAgents(db, bob, workspaceId)).toEqual([])

    db.insert(agentAccessGrants)
      .values({ agentId: created.id, userId: bobId })
      .run()
    await expect(listAgents(db, bob, workspaceId)).resolves.toEqual([
      expect.objectContaining({ id: created.id }),
    ])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npm test -- src/server/platform/agent-version.server.test.ts
```

Expected: FAIL because the Agent version service does not exist.

- [ ] **Step 3: Implement finite Agent inputs**

Create `src/server/platform/agent-version.server.ts`:

```ts
import { createHash, randomUUID } from 'node:crypto'

import { and, asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import type { createDatabase } from '#/db'
import {
  agentAccessGrants,
  agentVersions,
  agents,
  auditLogs,
} from '#/db/schema'

import {
  requireWorkspaceAccess,
  type AppPrincipal,
} from './workspace-access.server'

type AppDatabase = ReturnType<typeof createDatabase>

export const agentDraftInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  instructions: z.string().trim().min(1).max(100_000).optional(),
  modelProvider: z.string().trim().min(1).max(80).optional(),
  modelId: z.string().trim().min(1).max(160).optional(),
  thinkingLevel: z.enum(['off', 'minimal', 'low', 'medium', 'high']).optional(),
  visibility: z.enum(['workspace', 'restricted']).optional(),
})

type AgentDraftPatch = z.infer<typeof agentDraftInputSchema>

export type AgentDraftInput = {
  name: string
  instructions: string
  modelProvider: string
  modelId: string
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high'
  visibility?: 'workspace' | 'restricted'
}

const defaultResponsePolicy = {
  allowedParts: ['text', 'markdown'],
  maxTextLength: null,
  allowAttachments: false,
}

const defaultWorkspacePolicy = {
  workspaceMode: 'conversation',
}

function manifestHash(manifest: unknown): string {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
}

async function requireEditor(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
): Promise<void> {
  await requireWorkspaceAccess(db, principal, workspaceId, [
    'workspace_admin',
    'editor',
  ])
}

export async function createAgent(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  input: AgentDraftInput,
) {
  await requireEditor(db, principal, workspaceId)

  const agentId = randomUUID()
  const versionId = randomUUID()
  const now = new Date()

  await db.transaction(async (tx) => {
    await tx.insert(agents).values({
      id: agentId,
      workspaceId,
      name: input.name,
      visibility: input.visibility ?? 'workspace',
      status: 'draft',
      createdBy: principal.userId,
      createdAt: now,
      updatedAt: now,
    })

    const manifest = {
      capabilities: [],
      prompt: input.instructions,
      model: {
        provider: input.modelProvider,
        modelId: input.modelId,
        thinkingLevel: input.thinkingLevel,
      },
    }

    await tx.insert(agentVersions).values({
      id: versionId,
      workspaceId,
      agentId,
      versionNumber: 1,
      instructions: input.instructions,
      modelProvider: input.modelProvider,
      modelId: input.modelId,
      thinkingLevel: input.thinkingLevel,
      responsePolicyJson: defaultResponsePolicy,
      workspacePolicyJson: defaultWorkspacePolicy,
      manifestJson: manifest,
      manifestHash: manifestHash(manifest),
      status: 'draft',
      createdBy: principal.userId,
      createdAt: now,
    })

    await tx.insert(auditLogs).values({
      id: randomUUID(),
      workspaceId,
      actorUserId: principal.userId,
      action: 'agent.create',
      targetType: 'agent',
      targetId: agentId,
      detailsJson: { versionId },
      createdAt: now,
    })
  })

  return {
    id: agentId,
    workspaceId,
    name: input.name,
    status: 'draft' as const,
    visibility: input.visibility ?? 'workspace',
    draftVersionId: versionId,
  }
}

export async function updateAgentDraft(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
  patch: AgentDraftPatch,
) {
  await requireEditor(db, principal, workspaceId)

  return db.transaction(async (tx) => {
    const agent = await tx
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
      .get()
    if (!agent) throw new Error('agent not found')

    const draft = await tx
      .select()
      .from(agentVersions)
      .where(
        and(
          eq(agentVersions.agentId, agentId),
          eq(agentVersions.workspaceId, workspaceId),
          eq(agentVersions.status, 'draft'),
        ),
      )
      .orderBy(desc(agentVersions.versionNumber))
      .get()
    if (!draft) throw new Error('no editable draft')

    const name = patch.name ?? agent.name
    const visibility = patch.visibility ?? agent.visibility
    const instructions = patch.instructions ?? draft.instructions
    const modelProvider = patch.modelProvider ?? draft.modelProvider
    const modelId = patch.modelId ?? draft.modelId
    const thinkingLevel = patch.thinkingLevel ?? draft.thinkingLevel
    const manifest = {
      capabilities: [],
      prompt: instructions,
      model: { provider: modelProvider, modelId, thinkingLevel },
    }
    const now = new Date()

    await tx
      .update(agents)
      .set({ name, visibility, updatedAt: now })
      .where(eq(agents.id, agentId))
    await tx
      .update(agentVersions)
      .set({
        instructions,
        modelProvider,
        modelId,
        thinkingLevel,
        manifestJson: manifest,
        manifestHash: manifestHash(manifest),
      })
      .where(eq(agentVersions.id, draft.id))

    return { ...draft, instructions, modelProvider, modelId, thinkingLevel }
  })
}

export async function publishAgentVersion(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
) {
  await requireEditor(db, principal, workspaceId)

  return db.transaction(async (tx) => {
    const draft = await tx
      .select()
      .from(agentVersions)
      .where(
        and(
          eq(agentVersions.agentId, agentId),
          eq(agentVersions.workspaceId, workspaceId),
          eq(agentVersions.status, 'draft'),
        ),
      )
      .orderBy(asc(agentVersions.versionNumber))
      .get()
    if (!draft) throw new Error('no editable draft')

    const publishedAt = new Date()
    const published = await tx
      .update(agentVersions)
      .set({ status: 'published', publishedAt })
      .where(eq(agentVersions.id, draft.id))
      .returning()
      .get()

    await tx
      .update(agents)
      .set({
        status: 'active',
        currentPublishedVersionId: published.id,
        updatedAt: publishedAt,
      })
      .where(eq(agents.id, agentId))

    await tx.insert(auditLogs).values({
      id: randomUUID(),
      workspaceId,
      actorUserId: principal.userId,
      action: 'agent.publish',
      targetType: 'agent_version',
      targetId: published.id,
      detailsJson: { agentId },
      createdAt: publishedAt,
    })

    return published
  })
}

export async function createNextVersion(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
) {
  await requireEditor(db, principal, workspaceId)

  return db.transaction(async (tx) => {
    const agent = await tx
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
      .get()
    if (!agent?.currentPublishedVersionId) {
      throw new Error('agent has no published version to copy')
    }

    const source = await tx
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.id, agent.currentPublishedVersionId))
      .get()
    if (!source) throw new Error('published version not found')

    const latest = await tx
      .select({ versionNumber: agentVersions.versionNumber })
      .from(agentVersions)
      .where(eq(agentVersions.agentId, agentId))
      .orderBy(desc(agentVersions.versionNumber))
      .get()

    const now = new Date()
    const next = await tx
      .insert(agentVersions)
      .values({
        id: randomUUID(),
        workspaceId,
        agentId,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        instructions: source.instructions,
        modelProvider: source.modelProvider,
        modelId: source.modelId,
        thinkingLevel: source.thinkingLevel,
        responsePolicyJson: source.responsePolicyJson,
        workspacePolicyJson: source.workspacePolicyJson,
        manifestJson: source.manifestJson,
        manifestHash: source.manifestHash,
        status: 'draft',
        createdBy: principal.userId,
        createdAt: now,
      })
      .returning()
      .get()

    await tx
      .update(agents)
      .set({ status: 'draft', updatedAt: now })
      .where(eq(agents.id, agentId))

    return next
  })
}

export async function listAgents(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
) {
  const access = await requireWorkspaceAccess(db, principal, workspaceId, [
    'workspace_admin',
    'editor',
    'user',
  ])

  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.workspaceId, workspaceId))
    .orderBy(desc(agents.updatedAt))
    .all()

  if (access.role !== 'user') return rows

  const grants = await db
    .select({ agentId: agentAccessGrants.agentId })
    .from(agentAccessGrants)
    .where(eq(agentAccessGrants.userId, principal.userId))
    .all()
  const granted = new Set(grants.map((grant) => grant.agentId))

  return rows.filter(
    (agent) => agent.visibility === 'workspace' || granted.has(agent.id),
  )
}

export async function getAgent(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
) {
  const access = await requireWorkspaceAccess(db, principal, workspaceId, [
    'workspace_admin',
    'editor',
    'user',
  ])

  const agent = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
    .get()
  if (!agent) throw new Error('agent not found')

  if (access.role === 'user' && agent.visibility === 'restricted') {
    const grant = await db
      .select()
      .from(agentAccessGrants)
      .where(
        and(
          eq(agentAccessGrants.agentId, agentId),
          eq(agentAccessGrants.userId, principal.userId),
        ),
      )
      .get()
    if (!grant) throw new Error('agent not found')
  }

  const versions = await db
    .select()
    .from(agentVersions)
    .where(eq(agentVersions.agentId, agentId))
    .orderBy(desc(agentVersions.versionNumber))
    .all()

  return { ...agent, versions }
}
```

- [ ] **Step 4: Run Agent version tests**

Run:

```bash
npm test -- src/server/platform/agent-version.server.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Run all foundation tests**

Run:

```bash
npm test
```

Expected: PASS for environment, schema, secret, authentication, workspace, and Agent-version suites.

- [ ] **Step 6: Commit**

```bash
git add src/server/platform/agent-version.server.ts src/server/platform/agent-version.server.test.ts
git commit -m "feat: add immutable agent version workflow"
```

---

### Task 7: Expose Authenticated Workspace and Agent APIs

**Files:**

- Create: `src/server/http/agent-http.server.ts`
- Create: `src/server/http/agent-http.server.test.ts`
- Create: `src/routes/api/workspaces/index.ts`
- Create: `src/routes/api/workspaces/$workspaceId/agents.ts`
- Create: `src/routes/api/agents/$agentId.ts`
- Create: `src/routes/api/agents/$agentId/draft.ts`
- Create: `src/routes/api/agents/$agentId/publish.ts`
- Create: `src/routes/api/agents/$agentId/versions.ts`

**Interfaces:**

- Consumes:
  - `authenticateRequest`
  - `resolvePrincipal`
  - Agent version service functions
- Produces HTTP behavior:
  - `GET /api/workspaces`
  - `GET|POST /api/workspaces/:workspaceId/agents`
  - `GET /api/agents/:agentId?workspaceId=...`
  - `PATCH /api/agents/:agentId/draft?workspaceId=...`
  - `POST /api/agents/:agentId/publish?workspaceId=...`
  - `POST /api/agents/:agentId/versions?workspaceId=...`

- [ ] **Step 1: Write failing HTTP service tests**

Create `src/server/http/agent-http.server.test.ts`:

```ts
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '#/db'
import { parseServerEnv } from '#/server/env.server'
import { resolvePrincipal } from '#/server/platform/workspace-access.server'

import {
  createAgentHandler,
  listAgentsHandler,
  publishAgentHandler,
  updateAgentDraftHandler,
} from './agent-http.server'

const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  DEV_WORKSPACE_SLUG: 'default',
  APP_DATABASE_PATH: ':memory:',
  CHANNEL_SECRET_KEK: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
})

function request(
  url: string,
  method: string,
  body?: unknown,
  origin = 'http://localhost:3000',
): Request {
  return new Request(url, {
    method,
    headers: {
      'content-type': 'application/json',
      origin,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('agent HTTP services', () => {
  let db: ReturnType<typeof createDatabase>
  let workspaceId: string

  beforeEach(async () => {
    db = createDatabase(':memory:')
    migrate(db, { migrationsFolder: './drizzle' })
    const principal = await resolvePrincipal(
      db,
      {
        username: 'alice',
        name: null,
        email: null,
        expiresAt: Date.now() + 60_000,
        authMode: 'development',
      },
      env,
    )
    workspaceId = principal!.workspaces[0]!.workspaceId
  })

  afterEach(() => {
    db.$client.close()
  })

  it('creates, updates, lists, and publishes an Agent', async () => {
    const createdResponse = await createAgentHandler(
      request(
        `http://localhost:3000/api/workspaces/${workspaceId}/agents`,
        'POST',
        {
          name: 'Reviewer',
          instructions: 'Review changes.',
          modelProvider: 'openai',
          modelId: 'gpt-6.1-sol',
          thinkingLevel: 'high',
        },
      ),
      { db, env, workspaceId },
    )
    expect(createdResponse.status).toBe(201)
    const created = (await createdResponse.json()) as { id: string }

    const updatedResponse = await updateAgentDraftHandler(
      request(
        `http://localhost:3000/api/agents/${created.id}/draft?workspaceId=${workspaceId}`,
        'PATCH',
        { instructions: 'Review security and correctness.' },
      ),
      { db, env, workspaceId, agentId: created.id },
    )
    expect(updatedResponse.status).toBe(200)

    const listedResponse = await listAgentsHandler(
      request(
        `http://localhost:3000/api/workspaces/${workspaceId}/agents`,
        'GET',
      ),
      { db, env, workspaceId },
    )
    expect(listedResponse.status).toBe(200)
    await expect(listedResponse.json()).resolves.toEqual([
      expect.objectContaining({ id: created.id, name: 'Reviewer' }),
    ])

    const publishedResponse = await publishAgentHandler(
      request(
        `http://localhost:3000/api/agents/${created.id}/publish?workspaceId=${workspaceId}`,
        'POST',
      ),
      { db, env, workspaceId, agentId: created.id },
    )
    expect(publishedResponse.status).toBe(200)
    await expect(publishedResponse.json()).resolves.toEqual(
      expect.objectContaining({ status: 'published' }),
    )
  })

  it('rejects a mismatched Origin', async () => {
    const response = await createAgentHandler(
      request(
        `http://localhost:3000/api/workspaces/${workspaceId}/agents`,
        'POST',
        {
          name: 'Reviewer',
          instructions: 'Review changes.',
          modelProvider: 'openai',
          modelId: 'gpt-6.1-sol',
          thinkingLevel: 'high',
        },
        'https://evil.example',
      ),
      { db, env, workspaceId },
    )

    expect(response.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run the HTTP tests to verify they fail**

Run:

```bash
npm test -- src/server/http/agent-http.server.test.ts
```

Expected: FAIL because the handler module does not exist.

- [ ] **Step 3: Implement the HTTP service**

Create `src/server/http/agent-http.server.ts`:

```ts
import { z } from 'zod'

import type { createDatabase } from '#/db'
import { authenticateRequest } from '#/server/auth/authenticate.server'
import type { ServerEnv } from '#/server/env.server'
import {
  agentDraftInputSchema,
  createAgent,
  createNextVersion,
  getAgent,
  listAgents,
  publishAgentVersion,
  updateAgentDraft,
} from '#/server/platform/agent-version.server'
import {
  resolvePrincipal,
  type AppPrincipal,
} from '#/server/platform/workspace-access.server'

type Dependencies = {
  db: ReturnType<typeof createDatabase>
  env: ServerEnv
  workspaceId: string
  agentId?: string
}

async function principalFor(
  request: Request,
  dependencies: Dependencies,
): Promise<AppPrincipal | Response> {
  const identity = await authenticateRequest(request.headers, dependencies.env)
  if (!identity) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const principal = await resolvePrincipal(
    dependencies.db,
    identity,
    dependencies.env,
  )
  if (!principal) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  return principal
}

function originAllowed(request: Request, env: ServerEnv): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true
  return origin === new URL(env.APP_ORIGIN).origin
}

function errorResponse(error: unknown): Response {
  if (error instanceof z.ZodError) {
    return Response.json(
      {
        error: 'validation_error',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      { status: 400 },
    )
  }
  if (error instanceof Error && error.message === 'forbidden') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  if (error instanceof Error && error.message === 'agent not found') {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  if (error instanceof Error && error.message === 'no editable draft') {
    return Response.json({ error: 'no_editable_draft' }, { status: 409 })
  }
  return Response.json({ error: 'internal_error' }, { status: 500 })
}

export async function listWorkspacesHandler(
  request: Request,
  dependencies: Omit<Dependencies, 'workspaceId' | 'agentId'>,
): Promise<Response> {
  const principal = await principalFor(request, {
    ...dependencies,
    workspaceId: '',
  })
  if (principal instanceof Response) return principal
  return Response.json(principal.workspaces)
}

export async function listAgentsHandler(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    return Response.json(
      await listAgents(dependencies.db, principal, dependencies.workspaceId),
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function createAgentHandler(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    const input = agentDraftInputSchema.parse(await request.json())
    if (
      !input.name ||
      !input.instructions ||
      !input.modelProvider ||
      !input.modelId ||
      !input.thinkingLevel
    ) {
      return Response.json({ error: 'validation_error' }, { status: 400 })
    }
    const created = await createAgent(
      dependencies.db,
      principal,
      dependencies.workspaceId,
      {
        name: input.name,
        instructions: input.instructions,
        modelProvider: input.modelProvider,
        modelId: input.modelId,
        thinkingLevel: input.thinkingLevel,
        visibility: input.visibility,
      },
    )
    return Response.json(created, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function getAgentHandler(
  request: Request,
  dependencies: Dependencies & { agentId: string },
): Promise<Response> {
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    return Response.json(
      await getAgent(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        dependencies.agentId,
      ),
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function updateAgentDraftHandler(
  request: Request,
  dependencies: Dependencies & { agentId: string },
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    const patch = agentDraftInputSchema.parse(await request.json())
    return Response.json(
      await updateAgentDraft(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        dependencies.agentId,
        patch,
      ),
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function publishAgentHandler(
  request: Request,
  dependencies: Dependencies & { agentId: string },
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    return Response.json(
      await publishAgentVersion(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        dependencies.agentId,
      ),
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function createNextVersionHandler(
  request: Request,
  dependencies: Dependencies & { agentId: string },
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    return Response.json(
      await createNextVersion(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        dependencies.agentId,
      ),
      { status: 201 },
    )
  } catch (error) {
    return errorResponse(error)
  }
}
```

- [ ] **Step 4: Add workspace list route**

Create `src/routes/api/workspaces/index.ts`:

```ts
import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import { listWorkspacesHandler } from '#/server/http/agent-http.server'

export const Route = createFileRoute('/api/workspaces/')({
  server: {
    handlers: {
      GET: ({ request }) =>
        listWorkspacesHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
        }),
    },
  },
})
```

- [ ] **Step 5: Add workspace Agent collection route**

Create `src/routes/api/workspaces/$workspaceId/agents.ts`:

```ts
import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import {
  createAgentHandler,
  listAgentsHandler,
} from '#/server/http/agent-http.server'

export const Route = createFileRoute('/api/workspaces/$workspaceId/agents')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        listAgentsHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
          workspaceId: params.workspaceId,
        }),
      POST: ({ request, params }) =>
        createAgentHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
          workspaceId: params.workspaceId,
        }),
    },
  },
})
```

- [ ] **Step 6: Add Agent detail route**

Create `src/routes/api/agents/$agentId.ts`:

```ts
import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import { getAgentHandler } from '#/server/http/agent-http.server'

export const Route = createFileRoute('/api/agents/$agentId')({
  server: {
    handlers: {
      GET: ({ request, params }) => {
        const workspaceId = new URL(request.url).searchParams.get('workspaceId')
        if (!workspaceId) {
          return Response.json({ error: 'workspace_required' }, { status: 400 })
        }
        return getAgentHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
          workspaceId,
          agentId: params.agentId,
        })
      },
    },
  },
})
```

- [ ] **Step 7: Add Agent draft route**

Create `src/routes/api/agents/$agentId/draft.ts`:

```ts
import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import { updateAgentDraftHandler } from '#/server/http/agent-http.server'

export const Route = createFileRoute('/api/agents/$agentId/draft')({
  server: {
    handlers: {
      PATCH: ({ request, params }) => {
        const workspaceId = new URL(request.url).searchParams.get('workspaceId')
        if (!workspaceId) {
          return Response.json({ error: 'workspace_required' }, { status: 400 })
        }
        return updateAgentDraftHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
          workspaceId,
          agentId: params.agentId,
        })
      },
    },
  },
})
```

- [ ] **Step 8: Add publish and new-version routes**

Create `src/routes/api/agents/$agentId/publish.ts`:

```ts
import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import { publishAgentHandler } from '#/server/http/agent-http.server'

export const Route = createFileRoute('/api/agents/$agentId/publish')({
  server: {
    handlers: {
      POST: ({ request, params }) => {
        const workspaceId = new URL(request.url).searchParams.get('workspaceId')
        if (!workspaceId) {
          return Response.json({ error: 'workspace_required' }, { status: 400 })
        }
        return publishAgentHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
          workspaceId,
          agentId: params.agentId,
        })
      },
    },
  },
})
```

Create `src/routes/api/agents/$agentId/versions.ts`:

```ts
import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import { createNextVersionHandler } from '#/server/http/agent-http.server'

export const Route = createFileRoute('/api/agents/$agentId/versions')({
  server: {
    handlers: {
      POST: ({ request, params }) => {
        const workspaceId = new URL(request.url).searchParams.get('workspaceId')
        if (!workspaceId) {
          return Response.json({ error: 'workspace_required' }, { status: 400 })
        }
        return createNextVersionHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
          workspaceId,
          agentId: params.agentId,
        })
      },
    },
  },
})
```

- [ ] **Step 9: Run HTTP tests**

Run:

```bash
npm test -- src/server/http/agent-http.server.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 10: Generate routes, typecheck, lint, and build**

Run:

```bash
npm run generate-routes
npm run typecheck
npm run lint
npm run build
```

Expected:

- route generator exits 0;
- TypeScript exits 0;
- ESLint exits 0;
- Vite/Nitro production build exits 0.

- [ ] **Step 11: Run the complete foundation suite**

Run:

```bash
npm test
npm run check
git diff --check
```

Expected: all tests and formatting checks pass; no whitespace errors.

- [ ] **Step 12: Commit**

```bash
git add src/server/http/agent-http.server.ts src/server/http/agent-http.server.test.ts src/routes/api/workspaces src/routes/api/agents src/routeTree.gen.ts
git commit -m "feat: expose workspace and agent APIs"
```
