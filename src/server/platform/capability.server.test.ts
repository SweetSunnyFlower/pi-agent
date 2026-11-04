import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '#/db'
import { agentVersions, capabilityVersions } from '#/db/schema'
import { parseServerEnv } from '#/server/env.server'

import {
  createAgent,
  createNextVersion,
  publishAgentVersion,
  updateAgentDraft,
} from './agent-version.server'
import {
  createHttpTool,
  deleteTool,
  listToolsForDraft,
  listToolsForVersion,
  replaceDraftTools,
  reviseHttpTool,
} from './capability.server'
import {
  ensureDevelopmentSeed,
  resolvePrincipal,
} from './workspace-access.server'

const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  APP_DATABASE_PATH: ':memory:',
  CHANNEL_SECRET_KEK: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
})

describe('capability service', () => {
  let db: ReturnType<typeof createDatabase>
  let principal: Awaited<ReturnType<typeof resolvePrincipal>>
  let workspaceId: string

  beforeEach(async () => {
    db = createDatabase(':memory:')
    migrate(db, { migrationsFolder: './drizzle' })
    await ensureDevelopmentSeed(db, env)
    principal = await resolvePrincipal(
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
    workspaceId = principal!.workspaces[0].workspaceId
  })

  afterEach(() => {
    db.$client.close()
  })

  async function createDraftAgent() {
    const created = await createAgent(db, principal!, workspaceId, {
      name: `Reviewer ${Math.random()}`,
      instructions: 'Review changes.',
      modelProvider: 'oneapi-comate',
      modelId: 'DeepSeek-V4-Pro',
      thinkingLevel: 'high',
    })
    return created.id
  }

  async function createAndBindTool(agentId: string) {
    const tool = await createHttpTool(db, principal!, workspaceId, {
      name: 'Issue Search',
      description: 'Search reviewed issues.',
      endpoint: 'https://api.example.com/issues/search',
      method: 'POST',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    })
    await replaceDraftTools(db, principal!, workspaceId, agentId, {
      capabilityVersionIds: [tool.versionId],
    })
    return tool
  }

  it('creates an HTTP tool and binds its immutable version to the Agent draft', async () => {
    const agentId = await createDraftAgent()
    const tool = await createAndBindTool(agentId)

    expect(tool.runtimeName).toBe('platform.tool.http.issue-search@1.0.0')

    const catalog = await listToolsForDraft(
      db,
      principal!,
      workspaceId,
      agentId,
    )
    expect(catalog).toEqual([
      expect.objectContaining({
        versionId: tool.versionId,
        name: 'Issue Search',
        source: 'http',
        selected: true,
      }),
    ])

    const draft = db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.agentId, agentId))
      .get()
    expect(draft?.manifestJson).toEqual(
      expect.objectContaining({
        capabilities: [
          expect.objectContaining({
            runtimeName: 'platform.tool.http.issue-search@1.0.0',
            kind: 'tool',
          }),
        ],
      }),
    )
  })

  it('keeps tool bindings when prompt and model settings are updated', async () => {
    const agentId = await createDraftAgent()
    await createAndBindTool(agentId)

    await updateAgentDraft(db, principal!, workspaceId, agentId, {
      instructions: 'Updated instructions.',
      thinkingLevel: 'medium',
    })

    const draft = db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.agentId, agentId))
      .get()
    expect(draft?.manifestJson).toEqual(
      expect.objectContaining({
        capabilities: [
          {
            runtimeName: 'platform.tool.http.issue-search@1.0.0',
            kind: 'tool',
            version: '1.0.0',
          },
        ],
      }),
    )
  })

  it('copies tool bindings into the next draft version', async () => {
    const agentId = await createDraftAgent()
    const tool = await createAndBindTool(agentId)

    await publishAgentVersion(db, principal!, workspaceId, agentId)
    const next = await createNextVersion(db, principal!, workspaceId, agentId)
    const catalog = await listToolsForDraft(
      db,
      principal!,
      workspaceId,
      agentId,
    )

    expect(catalog).toEqual([
      expect.objectContaining({
        versionId: tool.versionId,
        selected: true,
      }),
    ])
    expect(next.versionNumber).toBe(2)
  })

  it('lists bindings from a published version independently of the draft', async () => {
    const agentId = await createDraftAgent()
    const publishedTool = await createAndBindTool(agentId)
    const published = await publishAgentVersion(
      db,
      principal!,
      workspaceId,
      agentId,
    )
    await createNextVersion(db, principal!, workspaceId, agentId)
    const draftTool = await createHttpTool(db, principal!, workspaceId, {
      name: 'Release Search',
      description: 'Search releases.',
      endpoint: 'https://api.example.com/releases',
      method: 'GET',
      inputSchema: { type: 'object', properties: {} },
    })
    await replaceDraftTools(db, principal!, workspaceId, agentId, {
      capabilityVersionIds: [draftTool.versionId],
    })

    const publishedCatalog = await listToolsForVersion(
      db,
      principal!,
      workspaceId,
      agentId,
      published.id,
    )
    const draftCatalog = await listToolsForDraft(
      db,
      principal!,
      workspaceId,
      agentId,
    )

    expect(
      publishedCatalog.find(
        (item) => item.versionId === publishedTool.versionId,
      )?.selected,
    ).toBe(true)
    expect(
      publishedCatalog.find((item) => item.versionId === draftTool.versionId)
        ?.selected,
    ).toBe(false)
    expect(
      draftCatalog.find((item) => item.versionId === publishedTool.versionId)
        ?.selected,
    ).toBe(false)
    expect(
      draftCatalog.find((item) => item.versionId === draftTool.versionId)
        ?.selected,
    ).toBe(true)
  })

  it('rejects a duplicate tool name in the same workspace', async () => {
    const input = {
      name: '订单查询',
      description: 'Look up an order.',
      endpoint: 'https://api.example.com/orders',
      method: 'GET' as const,
      inputSchema: { type: 'object', properties: {} },
    }
    await createHttpTool(db, principal!, workspaceId, input)

    await expect(
      createHttpTool(db, principal!, workspaceId, input),
    ).rejects.toThrow(/already exists/i)
  })

  it('creates a new tool version and rebinds it to the Agent draft', async () => {
    const agentId = await createDraftAgent()
    const original = await createAndBindTool(agentId)

    const catalog = await reviseHttpTool(
      db,
      principal!,
      workspaceId,
      agentId,
      original.versionId,
      {
        name: 'Issue Search v2',
        description: 'Search issues with the new endpoint.',
        endpoint: 'https://api.example.com/v2/issues/search',
        method: 'GET',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    )

    expect(catalog).toEqual([
      expect.objectContaining({
        name: 'Issue Search v2',
        version: '1.0.1',
        runtimeName: 'platform.tool.http.issue-search@1.0.1',
        method: 'GET',
        endpoint: 'https://api.example.com/v2/issues/search',
        selected: true,
      }),
    ])
    expect(
      db
        .select({ id: capabilityVersions.id })
        .from(capabilityVersions)
        .where(eq(capabilityVersions.capabilityId, original.id))
        .all(),
    ).toHaveLength(2)

    const draft = db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.agentId, agentId))
      .get()
    expect(draft?.manifestJson).toEqual(
      expect.objectContaining({
        capabilities: [
          expect.objectContaining({
            runtimeName: 'platform.tool.http.issue-search@1.0.1',
            version: '1.0.1',
          }),
        ],
      }),
    )
  })

  it('keeps published Agent versions bound to the previous tool version', async () => {
    const agentId = await createDraftAgent()
    const original = await createAndBindTool(agentId)
    const published = await publishAgentVersion(
      db,
      principal!,
      workspaceId,
      agentId,
    )
    await createNextVersion(db, principal!, workspaceId, agentId)

    await reviseHttpTool(
      db,
      principal!,
      workspaceId,
      agentId,
      original.versionId,
      {
        name: 'Issue Search v2',
        description: 'Search reviewed issues using v2.',
        endpoint: 'https://api.example.com/v2/issues/search',
        method: 'POST',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    )

    const publishedCatalog = await listToolsForVersion(
      db,
      principal!,
      workspaceId,
      agentId,
      published.id,
    )
    const draftCatalog = await listToolsForDraft(
      db,
      principal!,
      workspaceId,
      agentId,
    )
    expect(publishedCatalog).toEqual([
      expect.objectContaining({
        versionId: original.versionId,
        version: '1.0.0',
        selected: true,
      }),
    ])
    expect(draftCatalog).toEqual([
      expect.objectContaining({
        name: 'Issue Search v2',
        version: '1.0.1',
        selected: true,
      }),
    ])
  })

  it('removes a tool from drafts while retaining published references', async () => {
    const agentId = await createDraftAgent()
    const tool = await createAndBindTool(agentId)
    const published = await publishAgentVersion(
      db,
      principal!,
      workspaceId,
      agentId,
    )
    await createNextVersion(db, principal!, workspaceId, agentId)

    await deleteTool(db, principal!, workspaceId, agentId, tool.versionId)

    await expect(
      listToolsForDraft(db, principal!, workspaceId, agentId),
    ).resolves.toEqual([])
    await expect(
      listToolsForVersion(db, principal!, workspaceId, agentId, published.id),
    ).resolves.toEqual([
      expect.objectContaining({
        versionId: tool.versionId,
        selected: true,
      }),
    ])
    expect(
      db
        .select({ status: capabilityVersions.status })
        .from(capabilityVersions)
        .where(eq(capabilityVersions.id, tool.versionId))
        .get(),
    ).toEqual({ status: 'disabled' })
  })
})
