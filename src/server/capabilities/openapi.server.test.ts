import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase } from '#/db'
import { capabilityVersions } from '#/db/schema'
import { parseServerEnv } from '#/server/env.server'
import { createAgent } from '#/server/platform/agent-version.server'
import { replaceDraftTools } from '#/server/platform/capability.server'
import {
  ensureDevelopmentSeed,
  resolvePrincipal,
} from '#/server/platform/workspace-access.server'

import {
  importOpenApiTools,
  previewOpenApiDocument,
  reviseOpenApiTool,
} from './openapi.server'

const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  APP_DATABASE_PATH: ':memory:',
  CHANNEL_SECRET_KEK: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
})

const document = {
  openapi: '3.0.3',
  info: { title: 'Issue API', version: '2.0.0' },
  servers: [{ url: 'https://api.example.com/v1' }],
  paths: {
    '/issues': {
      get: {
        operationId: 'listIssues',
        summary: 'List issues',
        parameters: [
          {
            name: 'query',
            in: 'query',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: { '200': { description: 'OK' } },
      },
      post: {
        operationId: 'createIssue',
        summary: 'Create issue',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/IssueInput' },
            },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
  },
  components: {
    schemas: {
      IssueInput: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          priority: { type: 'integer' },
        },
        required: ['title'],
      },
    },
  },
}

describe('OpenAPI tool import', () => {
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

  it('previews operations and resolves local component schemas', async () => {
    const fetchDocument = vi.fn().mockResolvedValue(Response.json(document))

    const preview = await previewOpenApiDocument(
      { documentUrl: 'https://api.example.com/openapi.json' },
      fetchDocument,
    )

    expect(preview.title).toBe('Issue API')
    expect(preview.operations).toHaveLength(2)
    expect(preview.operations[1]).toEqual(
      expect.objectContaining({
        key: 'POST /issues',
        operationId: 'createIssue',
        inputSchema: expect.objectContaining({
          properties: expect.objectContaining({
            body: expect.objectContaining({
              properties: expect.objectContaining({
                title: { type: 'string' },
              }),
            }),
          }),
        }),
      }),
    )
  })

  it('creates one immutable tool version per selected operation', async () => {
    const fetchDocument = vi.fn().mockResolvedValue(Response.json(document))

    const tools = await importOpenApiTools(
      db,
      principal!,
      workspaceId,
      {
        documentUrl: 'https://api.example.com/openapi.json',
        operationKeys: ['GET /issues', 'POST /issues'],
      },
      fetchDocument,
    )

    expect(tools).toHaveLength(2)
    expect(tools.map((tool) => tool.source)).toEqual(['openapi', 'openapi'])

    const stored = db
      .select()
      .from(capabilityVersions)
      .where(eq(capabilityVersions.workspaceId, workspaceId))
      .all()
    expect(stored).toHaveLength(2)
    expect(stored[0].definitionJson).toEqual(
      expect.objectContaining({
        kind: 'openapi',
        method: expect.any(String),
        path: expect.any(String),
        serverUrl: 'https://api.example.com/v1',
      }),
    )
  })

  it('revises an imported OpenAPI operation into a new bound version', async () => {
    const fetchDocument = vi.fn().mockResolvedValue(Response.json(document))
    const [tool] = await importOpenApiTools(
      db,
      principal!,
      workspaceId,
      {
        documentUrl: 'https://api.example.com/openapi.json',
        operationKeys: ['GET /issues'],
      },
      fetchDocument,
    )
    const agent = await createAgent(db, principal!, workspaceId, {
      name: 'OpenAPI Reviewer',
      instructions: 'Review issues.',
      modelProvider: 'oneapi-comate',
      modelId: 'DeepSeek-V4-Pro',
      thinkingLevel: 'high',
    })
    await replaceDraftTools(db, principal!, workspaceId, agent.id, {
      capabilityVersionIds: [tool.versionId],
    })
    const updatedDocument = structuredClone(document)
    updatedDocument.paths['/issues'].get.summary = 'List issues v2'
    const revisedFetch = vi
      .fn()
      .mockResolvedValue(Response.json(updatedDocument))

    const catalog = await reviseOpenApiTool(
      db,
      principal!,
      workspaceId,
      agent.id,
      tool.versionId,
      {
        documentUrl: 'https://api.example.com/openapi.json',
        operationKey: 'GET /issues',
      },
      revisedFetch,
    )

    expect(catalog).toEqual([
      expect.objectContaining({
        name: 'List issues v2',
        source: 'openapi',
        version: '1.0.1',
        selected: true,
      }),
    ])
  })
})
