import { randomBytes } from 'node:crypto'

import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase } from '#/db'
import { parseServerEnv } from '#/server/env.server'
import { createAgent } from '#/server/platform/agent-version.server'
import { ensureDevelopmentSeed, resolvePrincipal } from '#/server/platform/workspace-access.server'
import { SecretBox } from '#/server/secrets/secret-box.server'

import {
  getAgentChannelsHandler,
  saveInfoFlowChannelHandler,
  testInfoFlowConnectionHandler,
} from './channel-http.server'

const key = randomBytes(32).toString('base64')
const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  APP_DATABASE_PATH: ':memory:',
  CHANNEL_SECRET_KEK: key,
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

describe('channel HTTP services', () => {
  let db: ReturnType<typeof createDatabase>
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

  it('loads, saves, and tests an encrypted InfoFlow channel', async () => {
    const box = new SecretBox(key)
    const getResponse = await getAgentChannelsHandler(
      request(
        `http://localhost:3000/api/agents/${agentId}/channels?workspaceId=${workspaceId}`,
        'GET',
      ),
      { db, env, workspaceId, agentId, box },
    )
    expect(getResponse.status).toBe(200)
    await expect(getResponse.json()).resolves.toEqual(
      expect.objectContaining({
        web: expect.objectContaining({ enabled: true }),
        infoflow: expect.objectContaining({ configured: false }),
      }),
    )

    const saveResponse = await saveInfoFlowChannelHandler(
      request(
        `http://localhost:3000/api/agents/${agentId}/channels/infoflow?workspaceId=${workspaceId}`,
        'PUT',
        {
          enabled: true,
          infoflowAgentId: '50655',
          appKey: 'app-key-123456',
          appSecret: 'app-secret-123456',
        },
      ),
      { db, env, workspaceId, agentId, box },
    )
    expect(saveResponse.status).toBe(200)
    const savedText = await saveResponse.text()
    expect(savedText).not.toContain('app-secret-123456')

    const createClient = vi.fn(() => ({
      robot: {
        getInfo: vi.fn().mockResolvedValue({
          agentId: 50655,
          name: '产品评审机器人',
          adminUser: [],
          visibleInfos: {
            tags: [],
            users: [],
            deptIds: [],
            allMergeGroup: [],
          },
          apiList: [],
          visibleGroups: [],
        }),
      },
    }))
    const testResponse = await testInfoFlowConnectionHandler(
      request(
        `http://localhost:3000/api/agents/${agentId}/channels/infoflow/test?workspaceId=${workspaceId}`,
        'POST',
      ),
      { db, env, workspaceId, agentId, box, createClient },
    )
    expect(testResponse.status).toBe(200)
    await expect(testResponse.json()).resolves.toEqual({
      ok: true,
      infoflowAgentId: '50655',
      name: '产品评审机器人',
    })
  })
})
