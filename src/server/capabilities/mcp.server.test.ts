import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '#/db'
import { capabilityVersions } from '#/db/schema'
import { parseServerEnv } from '#/server/env.server'
import { createAgent } from '#/server/platform/agent-version.server'
import { replaceDraftTools } from '#/server/platform/capability.server'
import {
  ensureDevelopmentSeed,
  resolvePrincipal,
} from '#/server/platform/workspace-access.server'

import { importMcpTools, previewMcpServer, reviseMcpTool } from './mcp.server'

const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  APP_DATABASE_PATH: ':memory:',
  CHANNEL_SECRET_KEK: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
})

const discovered = {
  serverName: 'github-tools',
  serverVersion: '1.2.3',
  tools: [
    {
      name: 'search_issues',
      title: 'Search issues',
      description: 'Search repository issues.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
      },
    },
  ],
}

describe('MCP tool import', () => {
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

  it('previews tools discovered from an MCP server', async () => {
    const preview = await previewMcpServer(
      {
        serverUrl: 'https://mcp.example.com/mcp',
        transport: 'streamable-http',
      },
      async () => discovered,
    )

    expect(preview).toEqual(
      expect.objectContaining({
        serverName: 'github-tools',
        serverVersion: '1.2.3',
        tools: [
          expect.objectContaining({
            name: 'search_issues',
            title: 'Search issues',
          }),
        ],
      }),
    )
  })

  it('creates versioned tools for selected MCP tools', async () => {
    const tools = await importMcpTools(
      db,
      principal!,
      workspaceId,
      {
        serverUrl: 'https://mcp.example.com/mcp',
        transport: 'streamable-http',
        toolNames: ['search_issues'],
      },
      async () => discovered,
    )

    expect(tools).toEqual([
      expect.objectContaining({
        name: 'Search issues',
        source: 'mcp',
        runtimeName: 'platform.tool.mcp.github-tools.search-issues@1.0.0',
      }),
    ])

    const stored = db
      .select()
      .from(capabilityVersions)
      .where(eq(capabilityVersions.workspaceId, workspaceId))
      .get()
    expect(stored?.definitionJson).toEqual({
      kind: 'mcp',
      serverUrl: 'https://mcp.example.com/mcp',
      endpoint: 'https://mcp.example.com/mcp',
      transport: 'streamable-http',
      toolName: 'search_issues',
    })
  })

  it('revises a discovered MCP tool into a new bound version', async () => {
    const [tool] = await importMcpTools(
      db,
      principal!,
      workspaceId,
      {
        serverUrl: 'https://mcp.example.com/mcp',
        transport: 'streamable-http',
        toolNames: ['search_issues'],
      },
      async () => discovered,
    )
    const agent = await createAgent(db, principal!, workspaceId, {
      name: 'MCP Reviewer',
      instructions: 'Review issues.',
      modelProvider: 'oneapi-comate',
      modelId: 'DeepSeek-V4-Pro',
      thinkingLevel: 'high',
    })
    await replaceDraftTools(db, principal!, workspaceId, agent.id, {
      capabilityVersionIds: [tool.versionId],
    })
    const updated = structuredClone(discovered)
    updated.tools[0].description = 'Search issues using the updated schema.'

    const catalog = await reviseMcpTool(
      db,
      principal!,
      workspaceId,
      agent.id,
      tool.versionId,
      {
        serverUrl: 'https://mcp.example.com/mcp',
        transport: 'streamable-http',
        toolName: 'search_issues',
      },
      async () => updated,
    )

    expect(catalog).toEqual([
      expect.objectContaining({
        name: 'Search issues',
        description: 'Search issues using the updated schema.',
        source: 'mcp',
        version: '1.0.1',
        selected: true,
      }),
    ])
  })
})
