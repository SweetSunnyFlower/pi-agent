import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
} from '@earendil-works/pi-ai'
import {
  createRegistry,
  Harness,
  MemoryStorage,
} from '@earendil-works/pi-durable'
import type { ConversationId } from '@earendil-works/pi-durable'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '#/db'
import { conversationBindings, users, workspaceMembers } from '#/db/schema'
import { parseServerEnv } from '#/server/env.server'
import {
  createAgent,
  publishAgentVersion,
} from '#/server/platform/agent-version.server'
import {
  ensureDevelopmentSeed,
  resolvePrincipal,
} from '#/server/platform/workspace-access.server'

import {
  createAgentApiTokenHandler,
  listAgentApiTokensHandler,
  postOpenChatHandler,
  revokeAgentApiTokenHandler,
} from './open-api-http.server'

const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  APP_DATABASE_PATH: ':memory:',
  CHANNEL_SECRET_KEK: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  OPEN_API_JWT_SECRET: 'open-api-test-secret-0123456789abcdef',
})

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function openRequest(agentId: string, token: string | null, body: unknown) {
  return new Request(`http://localhost:3000/api/open/chat/${agentId}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe('open API', () => {
  let db: ReturnType<typeof createDatabase>
  let harness: Harness
  let faux: ReturnType<typeof fauxProvider>
  let models: ReturnType<typeof createModels>
  let registry: ReturnType<typeof createRegistry>
  let workspaceId: string
  let agentId: string

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
    faux = fauxProvider({
      provider: 'oneapi-comate',
      models: [{ id: 'faux-chat' }],
    })
    models = createModels()
    models.setProvider(faux.provider)
    registry = createRegistry()
    harness = await Harness.open(
      new MemoryStorage(),
      { models, registry },
      BACKGROUND_CONTEXT,
    )
    const agent = await createAgent(db, principal!, workspaceId, {
      name: 'Reviewer',
      instructions: 'Review changes.',
      modelProvider: 'oneapi-comate',
      modelId: 'faux-chat',
      thinkingLevel: 'off',
    })
    agentId = agent.id
    await publishAgentVersion(db, principal!, workspaceId, agentId)
  })

  afterEach(async () => {
    await harness.close(BACKGROUND_CONTEXT)
    db.$client.close()
  })

  async function issueToken(
    body: Record<string, unknown> = {
      name: '客服系统',
      username: 'bob',
      expiresInDays: null,
    },
  ) {
    const response = await createAgentApiTokenHandler(
      jsonRequest(
        `http://localhost:3000/api/agents/${agentId}/api-tokens?workspaceId=${workspaceId}`,
        'POST',
        body,
      ),
      { db, env, workspaceId, agentId },
    )
    expect(response.status).toBe(201)
    return (await response.json()) as {
      token: string
      record: { id: string }
    }
  }

  const deps = () => ({ db, env, agentId, harness, registry, models })

  it('answers synchronously and isolates open conversations', async () => {
    const { token } = await issueToken()
    faux.setResponses([
      fauxAssistantMessage([fauxText('第一轮回答。')]),
      fauxAssistantMessage([fauxText('第二轮回答。')]),
    ])

    const first = await postOpenChatHandler(
      openRequest(agentId, token, { message: '你好' }),
      deps(),
    )
    expect(first.status).toBe(200)
    const firstBody = (await first.json()) as {
      conversationId: string
      submissionId: string
      text: string
    }
    expect(firstBody.text).toBe('第一轮回答。')

    const second = await postOpenChatHandler(
      openRequest(agentId, token, {
        conversationId: firstBody.conversationId,
        message: '继续',
      }),
      deps(),
    )
    expect(second.status).toBe(200)
    await expect(second.json()).resolves.toEqual(
      expect.objectContaining({
        conversationId: firstBody.conversationId,
        text: '第二轮回答。',
      }),
    )

    const bob = db.select().from(users).where(eq(users.username, 'bob')).get()
    expect(bob).toBeDefined()
    expect(
      db
        .select()
        .from(workspaceMembers)
        .where(eq(workspaceMembers.userId, bob!.id))
        .all(),
    ).toEqual([])

    const binding = db
      .select()
      .from(conversationBindings)
      .where(eq(conversationBindings.id, firstBody.conversationId))
      .get()
    expect(binding).toEqual(
      expect.objectContaining({ channel: 'open', createdBy: bob!.id }),
    )
    const conversation = await harness.conversation(
      Number(binding!.piConversationId) as ConversationId,
      BACKGROUND_CONTEXT,
    )
    const agent = await conversation!.agent(BACKGROUND_CONTEXT)
    expect(agent.tools).toEqual([])
  })

  it('rejects missing, foreign, revoked, and disabled tokens', async () => {
    const { token, record } = await issueToken()

    const missing = await postOpenChatHandler(
      openRequest(agentId, null, { message: '你好' }),
      deps(),
    )
    expect(missing.status).toBe(401)

    const forged = await postOpenChatHandler(
      openRequest(agentId, `${token}x`, { message: '你好' }),
      deps(),
    )
    expect(forged.status).toBe(401)

    const foreign = await postOpenChatHandler(
      openRequest('other-agent', token, { message: '你好' }),
      { ...deps(), agentId: 'other-agent' },
    )
    expect(foreign.status).toBe(403)

    const disabled = await postOpenChatHandler(
      openRequest(agentId, token, { message: '你好' }),
      { ...deps(), env: { ...env, OPEN_API_JWT_SECRET: undefined } },
    )
    expect(disabled.status).toBe(503)

    const revoke = await revokeAgentApiTokenHandler(
      jsonRequest(
        `http://localhost:3000/api/agents/${agentId}/api-tokens/${record.id}?workspaceId=${workspaceId}`,
        'DELETE',
      ),
      { db, env, workspaceId, agentId, tokenId: record.id },
    )
    expect(revoke.status).toBe(200)

    const revoked = await postOpenChatHandler(
      openRequest(agentId, token, { message: '你好' }),
      deps(),
    )
    expect(revoked.status).toBe(401)
  })

  it('validates the request body', async () => {
    const { token } = await issueToken()
    const response = await postOpenChatHandler(
      openRequest(agentId, token, { message: '' }),
      deps(),
    )
    expect(response.status).toBe(400)
  })

  it('lists tokens without exposing the token value', async () => {
    await issueToken({ name: 'A', username: 'bob', expiresInDays: 30 })
    const response = await listAgentApiTokensHandler(
      jsonRequest(
        `http://localhost:3000/api/agents/${agentId}/api-tokens?workspaceId=${workspaceId}`,
        'GET',
      ),
      { db, env, workspaceId, agentId },
    )
    const body = (await response.json()) as {
      enabled: boolean
      tokens: Array<Record<string, unknown>>
    }
    expect(body.enabled).toBe(true)
    expect(body.tokens).toHaveLength(1)
    expect(body.tokens[0]).not.toHaveProperty('token')
    expect(body.tokens[0].expiresAt).toEqual(expect.any(String))
  })

  it('only lets workspace admins manage tokens', async () => {
    db.insert(users).values({ id: 'u-carol', username: 'carol' }).run()
    db.insert(workspaceMembers)
      .values({ workspaceId, userId: 'u-carol', role: 'editor' })
      .run()
    const response = await createAgentApiTokenHandler(
      jsonRequest(
        `http://localhost:3000/api/agents/${agentId}/api-tokens?workspaceId=${workspaceId}`,
        'POST',
        { name: 'A', username: 'bob', expiresInDays: null },
      ),
      {
        db,
        env: { ...env, DEV_AUTH_USERNAME: 'carol' },
        workspaceId,
        agentId,
      },
    )
    expect(response.status).toBe(403)
  })
})
