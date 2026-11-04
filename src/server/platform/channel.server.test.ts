import { randomBytes } from 'node:crypto'

import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase } from '#/db'
import { channelConnections } from '#/db/schema'
import { parseServerEnv } from '#/server/env.server'
import { SecretBox } from '#/server/secrets/secret-box.server'

import { createAgent, getAgent } from './agent-version.server'
import {
  getAgentChannels,
  saveInfoFlowChannel,
  testInfoFlowConnection,
} from './channel.server'
import { ensureDevelopmentSeed, resolvePrincipal } from './workspace-access.server'

const key = randomBytes(32).toString('base64')
const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  APP_DATABASE_PATH: ':memory:',
  CHANNEL_SECRET_KEK: key,
})

describe('channel service', () => {
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

  it('starts with Web enabled and InfoFlow disabled', async () => {
    const config = await getAgentChannels(
      db,
      principal!,
      workspaceId,
      agentId,
      new SecretBox(key),
    )

    expect(config.web).toEqual({
      channel: 'web',
      enabled: true,
      status: 'ready',
    })
    expect(config.infoflow).toEqual({
      channel: 'infoflow',
      enabled: false,
      configured: false,
      status: 'not_configured',
    })
  })

  it('stores InfoFlow credentials encrypted and returns masks only', async () => {
    const box = new SecretBox(key)
    const saved = await saveInfoFlowChannel(
      db,
      principal!,
      workspaceId,
      agentId,
      {
        enabled: true,
        infoflowAgentId: '50655',
        appKey: '8e5bdf1f3a551671771f51562e6ab1e4',
        appSecret: 'super-secret-app-secret',
      },
      box,
    )

    expect(saved.infoflow).toEqual(
      expect.objectContaining({
        enabled: true,
        configured: true,
        infoflowAgentId: '50655',
        appKeyMasked: expect.stringContaining('••••'),
        status: 'disconnected',
      }),
    )
    expect(JSON.stringify(saved)).not.toContain('super-secret-app-secret')

    const raw = db.select().from(channelConnections).get()
    const rawText = JSON.stringify(raw)
    expect(rawText).not.toContain('8e5bdf1f3a551671771f51562e6ab1e4')
    expect(rawText).not.toContain('super-secret-app-secret')

    const agent = await getAgent(db, principal!, workspaceId, agentId)
    expect(agent.enabledChannels).toEqual(['web', 'infoflow'])
  })

  it('preserves existing secrets when credential inputs are blank', async () => {
    const box = new SecretBox(key)
    await saveInfoFlowChannel(
      db,
      principal!,
      workspaceId,
      agentId,
      {
        enabled: true,
        infoflowAgentId: '50655',
        appKey: 'app-key-123456',
        appSecret: 'app-secret-123456',
      },
      box,
    )

    const updated = await saveInfoFlowChannel(
      db,
      principal!,
      workspaceId,
      agentId,
      {
        enabled: true,
        infoflowAgentId: '50655',
        appKey: '',
        appSecret: '',
      },
      box,
    )

    expect(updated.infoflow).toEqual(
      expect.objectContaining({
        configured: true,
        appKeyMasked: 'app••••3456',
      }),
    )
  })

  it('tests stored credentials without exposing them', async () => {
    const box = new SecretBox(key)
    await saveInfoFlowChannel(
      db,
      principal!,
      workspaceId,
      agentId,
      {
        enabled: true,
        infoflowAgentId: '50655',
        appKey: 'app-key-123456',
        appSecret: 'app-secret-123456',
      },
      box,
    )
    const getInfo = vi.fn().mockResolvedValue({
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
    })
    const createClient = vi.fn(() => ({ robot: { getInfo } }))

    const result = await testInfoFlowConnection(
      db,
      principal!,
      workspaceId,
      agentId,
      env,
      box,
      createClient,
    )

    expect(createClient).toHaveBeenCalledWith({
      appKey: 'app-key-123456',
      appSecret: 'app-secret-123456',
      agentId: '50655',
      baseUrl: 'https://apiin.im.baidu.com/api/v1',
    })
    expect(result).toEqual({
      ok: true,
      infoflowAgentId: '50655',
      name: '产品评审机器人',
      iconUrl: undefined,
    })
    expect(JSON.stringify(result)).not.toContain('app-secret-123456')
  })
})
