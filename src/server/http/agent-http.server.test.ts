import { randomUUID } from 'node:crypto'

import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '#/db'
import { users, workspaceMembers } from '#/db/schema'
import { parseServerEnv } from '#/server/env.server'
import { ensureDevelopmentSeed, resolvePrincipal } from '#/server/platform/workspace-access.server'

import {
  createAgentHandler,
  createNextVersionHandler,
  getAgentAccessHandler,
  getAgentHandler,
  getPublishReadinessHandler,
  listAgentsHandler,
  publishAgentHandler,
  updateAgentDraftHandler,
} from './agent-http.server'

const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
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
    if (!principal) throw new Error('development principal was not resolved')
    workspaceId = principal.workspaces[0].workspaceId
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

    const updatedResponse = await updateAgentDraftHandler(
      request(
        `http://localhost:3000/api/agents/${created.id}/draft?workspaceId=${workspaceId}`,
        'PATCH',
        {
          instructions: 'Review security and correctness.',
          modelProvider: 'openai',
          modelId: 'gpt-6.1-sol',
          thinkingLevel: 'high',
        },
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
      expect.objectContaining({
        id: created.id,
        name: 'Reviewer',
        versions: expect.any(Array),
        enabledChannels: ['web'],
      }),
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

  it('reads and updates restricted Agent access grants through HTTP', async () => {
    const createdResponse = await createAgentHandler(
      request(
        `http://localhost:3000/api/workspaces/${workspaceId}/agents`,
        'POST',
        {
          name: 'Restricted HTTP reviewer',
          visibility: 'restricted',
        },
      ),
      { db, env, workspaceId },
    )
    const created = (await createdResponse.json()) as { id: string }
    const bobId = randomUUID()
    db.insert(users).values({ id: bobId, username: 'bob' }).run()
    db.insert(workspaceMembers)
      .values({ workspaceId, userId: bobId, role: 'user' })
      .run()

    const updateResponse = await updateAgentDraftHandler(
      request(
        `http://localhost:3000/api/agents/${created.id}/draft?workspaceId=${workspaceId}`,
        'PATCH',
        { memberUserIds: [bobId] },
      ),
      { db, env, workspaceId, agentId: created.id },
    )
    expect(updateResponse.status).toBe(200)

    const accessResponse = await getAgentAccessHandler(
      request(
        `http://localhost:3000/api/agents/${created.id}/access?workspaceId=${workspaceId}`,
        'GET',
      ),
      { db, env, workspaceId, agentId: created.id },
    )
    expect(accessResponse.status).toBe(200)
    await expect(accessResponse.json()).resolves.toEqual({
      userIds: [bobId],
    })
  })

  it('rejects a mismatched Origin', async () => {
    const response = await createAgentHandler(
      request(
        `http://localhost:3000/api/workspaces/${workspaceId}/agents`,
        'POST',
        {
          name: 'Reviewer',
          description: 'Reviews product changes.',
          visibility: 'workspace',
        },
        'https://evil.example',
      ),
      { db, env, workspaceId },
    )

    expect(response.status).toBe(403)
  })

  it('blocks publishing an incomplete draft', async () => {
    const createdResponse = await createAgentHandler(
      request(
        `http://localhost:3000/api/workspaces/${workspaceId}/agents`,
        'POST',
        {
          name: 'Incomplete',
          description: '',
          visibility: 'workspace',
        },
      ),
      { db, env, workspaceId },
    )
    const created = (await createdResponse.json()) as { id: string }

    const readinessResponse = await getPublishReadinessHandler(
      request(
        `http://localhost:3000/api/agents/${created.id}/publish-readiness?workspaceId=${workspaceId}`,
        'GET',
      ),
      { db, env, workspaceId, agentId: created.id },
    )
    expect(readinessResponse.status).toBe(200)
    await expect(readinessResponse.json()).resolves.toEqual(
      expect.objectContaining({ ready: false }),
    )

    const publishResponse = await publishAgentHandler(
      request(
        `http://localhost:3000/api/agents/${created.id}/publish?workspaceId=${workspaceId}`,
        'POST',
      ),
      { db, env, workspaceId, agentId: created.id },
    )
    expect(publishResponse.status).toBe(409)
    await expect(publishResponse.json()).resolves.toEqual(
      expect.objectContaining({ error: 'not_ready' }),
    )
  })

  it('rejects publishing when the draft is identical to the published version', async () => {
    const createdResponse = await createAgentHandler(
      request(
        `http://localhost:3000/api/workspaces/${workspaceId}/agents`,
        'POST',
        {
          name: 'Reviewer',
          description: '',
          visibility: 'workspace',
        },
      ),
      { db, env, workspaceId },
    )
    const created = (await createdResponse.json()) as { id: string }

    await updateAgentDraftHandler(
      request(
        `http://localhost:3000/api/agents/${created.id}/draft?workspaceId=${workspaceId}`,
        'PATCH',
        {
          instructions: 'Review changes.',
          modelProvider: 'oneapi-comate',
          modelId: 'DeepSeek-V4-Pro',
          thinkingLevel: 'high',
        },
      ),
      { db, env, workspaceId, agentId: created.id },
    )
    await publishAgentHandler(
      request(
        `http://localhost:3000/api/agents/${created.id}/publish?workspaceId=${workspaceId}`,
        'POST',
      ),
      { db, env, workspaceId, agentId: created.id },
    )
    await createNextVersionHandler(
      request(
        `http://localhost:3000/api/agents/${created.id}/versions?workspaceId=${workspaceId}`,
        'POST',
      ),
      { db, env, workspaceId, agentId: created.id },
    )

    const publishResponse = await publishAgentHandler(
      request(
        `http://localhost:3000/api/agents/${created.id}/publish?workspaceId=${workspaceId}`,
        'POST',
      ),
      { db, env, workspaceId, agentId: created.id },
    )

    expect(publishResponse.status).toBe(409)
    await expect(publishResponse.json()).resolves.toEqual({
      error: 'no_changes',
    })
  })
})
