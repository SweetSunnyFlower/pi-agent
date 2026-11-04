import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase } from '#/db'
import { parseServerEnv } from '#/server/env.server'
import { ensureDevelopmentSeed, resolvePrincipal } from '#/server/platform/workspace-access.server'

import {
  importOpenApiHandler,
  previewMcpServerHandler,
  previewOpenApiHandler,
} from './capability-source-http.server'

const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  APP_DATABASE_PATH: ':memory:',
  CHANNEL_SECRET_KEK: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
})

const openApiDocument = {
  openapi: '3.0.3',
  info: { title: 'Issue API', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com/v1' }],
  paths: {
    '/issues': {
      get: {
        operationId: 'listIssues',
        summary: 'List issues',
        responses: { '200': { description: 'OK' } },
      },
    },
  },
}

function request(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('capability source HTTP services', () => {
  let db: ReturnType<typeof createDatabase>
  let workspaceId: string

  beforeEach(async () => {
    db = createDatabase(':memory:')
    migrate(db, { migrationsFolder: './drizzle' })
    await ensureDevelopmentSeed(db, env)
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
    workspaceId = principal!.workspaces[0].workspaceId
  })

  afterEach(() => {
    db.$client.close()
  })

  it('previews and imports selected OpenAPI operations', async () => {
    const fetchDocument = vi
      .fn()
      .mockImplementation(async () => Response.json(openApiDocument))
    const previewResponse = await previewOpenApiHandler(
      request(
        `http://localhost:3000/api/workspaces/${workspaceId}/capabilities/openapi/preview`,
        'POST',
        { documentUrl: 'https://api.example.com/openapi.json' },
      ),
      { db, env, workspaceId, fetchDocument },
    )
    expect(previewResponse.status).toBe(200)
    await expect(previewResponse.json()).resolves.toEqual(
      expect.objectContaining({
        title: 'Issue API',
        operations: [
          expect.objectContaining({ key: 'GET /issues', name: 'List issues' }),
        ],
      }),
    )

    const importResponse = await importOpenApiHandler(
      request(
        `http://localhost:3000/api/workspaces/${workspaceId}/capabilities/openapi/import`,
        'POST',
        {
          documentUrl: 'https://api.example.com/openapi.json',
          operationKeys: ['GET /issues'],
        },
      ),
      { db, env, workspaceId, fetchDocument },
    )
    expect(importResponse.status).toBe(201)
    await expect(importResponse.json()).resolves.toEqual([
      expect.objectContaining({ source: 'openapi', name: 'List issues' }),
    ])
  })

  it('discovers MCP tools through an injected client', async () => {
    const discoverMcp = vi.fn().mockResolvedValue({
      serverName: 'internal-tools',
      serverVersion: '2.0.0',
      tools: [
        {
          name: 'search_docs',
          title: 'Search docs',
          description: 'Search internal documentation.',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    })
    const response = await previewMcpServerHandler(
      request(
        `http://localhost:3000/api/workspaces/${workspaceId}/capabilities/mcp/preview`,
        'POST',
        {
          serverUrl: 'https://mcp.example.com/mcp',
          transport: 'streamable-http',
        },
      ),
      { db, env, workspaceId, discoverMcp },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        serverName: 'internal-tools',
        transport: 'streamable-http',
      }),
    )
  })
})
