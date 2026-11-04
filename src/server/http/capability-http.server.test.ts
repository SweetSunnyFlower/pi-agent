import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '#/db'
import { parseServerEnv } from '#/server/env.server'
import { createAgent } from '#/server/platform/agent-version.server'
import {
  ensureDevelopmentSeed,
  resolvePrincipal,
} from '#/server/platform/workspace-access.server'

import {
  createHttpToolHandler,
  deleteAgentToolHandler,
  listAgentToolsHandler,
  replaceAgentToolsHandler,
  reviseAgentToolHandler,
} from './capability-http.server'

const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  APP_DATABASE_PATH: ':memory:',
  CHANNEL_SECRET_KEK: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
})

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

describe('capability HTTP services', () => {
  let db: ReturnType<typeof createDatabase>
  let principal: Awaited<ReturnType<typeof resolvePrincipal>>
  let workspaceId: string
  let agentId: string

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
    const agent = await createAgent(db, principal!, workspaceId, {
      name: 'Reviewer',
      instructions: 'Review changes.',
      modelProvider: 'oneapi-comate',
      modelId: 'DeepSeek-V4-Pro',
      thinkingLevel: 'high',
    })
    agentId = agent.id
  })

  afterEach(() => {
    db.$client.close()
  })

  it('creates a tool, lists the catalog, and replaces draft bindings', async () => {
    const createResponse = await createHttpToolHandler(
      request(
        `http://localhost:3000/api/workspaces/${workspaceId}/capabilities/tools`,
        'POST',
        {
          name: 'Issue Search',
          description: 'Search reviewed issues.',
          endpoint: 'https://api.example.com/issues/search',
          method: 'POST',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
          },
        },
      ),
      { db, env, workspaceId },
    )
    expect(createResponse.status).toBe(201)
    const tool = (await createResponse.json()) as {
      versionId: string
      selected: boolean
    }
    expect(tool.selected).toBe(false)

    const bindResponse = await replaceAgentToolsHandler(
      request(
        `http://localhost:3000/api/agents/${agentId}/draft/capabilities?workspaceId=${workspaceId}`,
        'PUT',
        { capabilityVersionIds: [tool.versionId] },
      ),
      { db, env, workspaceId, agentId },
    )
    expect(bindResponse.status).toBe(200)
    await expect(bindResponse.json()).resolves.toEqual([
      expect.objectContaining({
        versionId: tool.versionId,
        selected: true,
      }),
    ])

    const listResponse = await listAgentToolsHandler(
      request(
        `http://localhost:3000/api/agents/${agentId}/draft/capabilities?workspaceId=${workspaceId}`,
        'GET',
      ),
      { db, env, workspaceId, agentId },
    )
    expect(listResponse.status).toBe(200)
    await expect(listResponse.json()).resolves.toEqual([
      expect.objectContaining({
        name: 'Issue Search',
        selected: true,
      }),
    ])
  })

  it('rejects an invalid tool endpoint', async () => {
    const response = await createHttpToolHandler(
      request(
        `http://localhost:3000/api/workspaces/${workspaceId}/capabilities/tools`,
        'POST',
        {
          name: 'Unsafe Tool',
          endpoint: 'file:///etc/passwd',
        },
      ),
      { db, env, workspaceId },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'validation_error',
    })
  })

  it('revises an Agent tool through the draft endpoint', async () => {
    const createResponse = await createHttpToolHandler(
      request(
        `http://localhost:3000/api/workspaces/${workspaceId}/capabilities/tools`,
        'POST',
        {
          name: 'Issue Search',
          description: 'Search issues.',
          endpoint: 'https://api.example.com/issues',
          method: 'GET',
          inputSchema: { type: 'object', properties: {} },
        },
      ),
      { db, env, workspaceId },
    )
    const tool = (await createResponse.json()) as { versionId: string }
    await replaceAgentToolsHandler(
      request(
        `http://localhost:3000/api/agents/${agentId}/draft/capabilities?workspaceId=${workspaceId}`,
        'PUT',
        { capabilityVersionIds: [tool.versionId] },
      ),
      { db, env, workspaceId, agentId },
    )

    const response = await reviseAgentToolHandler(
      request(
        `http://localhost:3000/api/agents/${agentId}/draft/capabilities/${tool.versionId}?workspaceId=${workspaceId}`,
        'PATCH',
        {
          kind: 'http',
          name: 'Issue Search v2',
          description: 'Search issues using v2.',
          endpoint: 'https://api.example.com/v2/issues',
          method: 'GET',
          inputSchema: { type: 'object', properties: {} },
        },
      ),
      { db, env, workspaceId, agentId, versionId: tool.versionId },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([
      expect.objectContaining({
        name: 'Issue Search v2',
        version: '1.0.1',
        selected: true,
      }),
    ])
  })

  it('deletes a tool from the Agent draft catalog', async () => {
    const createResponse = await createHttpToolHandler(
      request(
        `http://localhost:3000/api/workspaces/${workspaceId}/capabilities/tools`,
        'POST',
        {
          name: 'Delete Tool',
          description: 'Temporary tool.',
          endpoint: 'https://api.example.com/delete',
          method: 'POST',
          inputSchema: { type: 'object', properties: {} },
        },
      ),
      { db, env, workspaceId },
    )
    const tool = (await createResponse.json()) as { versionId: string }

    const response = await deleteAgentToolHandler(
      request(
        `http://localhost:3000/api/agents/${agentId}/draft/capabilities/${tool.versionId}?workspaceId=${workspaceId}`,
        'DELETE',
      ),
      { db, env, workspaceId, agentId, versionId: tool.versionId },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([])
  })
})
