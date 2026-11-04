import { randomBytes } from 'node:crypto'

import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '#/db'
import { parseServerEnv } from '#/server/env.server'
import { SecretBox } from '#/server/secrets/secret-box.server'

import {
  getAgentChangeStatus,
  md5Fingerprint,
} from './agent-change-status.server'
import {
  createAgent,
  createNextVersion,
  publishAgentVersion,
  updateAgentDraft,
} from './agent-version.server'
import { createHttpTool, replaceDraftTools } from './capability.server'
import { saveInfoFlowChannel } from './channel.server'
import { createSkill, replaceDraftSkills } from './skill.server'
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

describe('Agent change status', () => {
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

  it('uses a stable MD5 fingerprint for nested configuration', () => {
    expect(md5Fingerprint({})).toBe('99914b932bd37a50b983c5e7c90ae93b')
    expect(md5Fingerprint({ b: 2, a: { d: 4, c: 3 } })).toBe(
      md5Fingerprint({ a: { c: 3, d: 4 }, b: 2 }),
    )
  })

  async function createPublishedAgent() {
    const created = await createAgent(db, principal!, workspaceId, {
      name: 'Reviewer',
      instructions: 'Review changes.',
      modelProvider: 'oneapi-comate',
      modelId: 'DeepSeek-V4-Pro',
      thinkingLevel: 'high',
    })
    await publishAgentVersion(db, principal!, workspaceId, created.id)
    await createNextVersion(db, principal!, workspaceId, created.id)
    return created.id
  }

  it('reports no changes for an untouched draft copied from publication', async () => {
    const agentId = await createPublishedAgent()

    await expect(
      getAgentChangeStatus(db, principal!, workspaceId, agentId),
    ).resolves.toEqual({
      hasChanges: false,
      changedModules: [],
    })
  })

  it('ignores saves with identical values and clears a change after revert', async () => {
    const agentId = await createPublishedAgent()

    await updateAgentDraft(db, principal!, workspaceId, agentId, {
      instructions: 'Review changes.',
      modelProvider: 'oneapi-comate',
      modelId: 'DeepSeek-V4-Pro',
      thinkingLevel: 'high',
    })
    await expect(
      getAgentChangeStatus(db, principal!, workspaceId, agentId),
    ).resolves.toEqual({
      hasChanges: false,
      changedModules: [],
    })

    await updateAgentDraft(db, principal!, workspaceId, agentId, {
      instructions: 'Review changes deeply.',
    })
    await expect(
      getAgentChangeStatus(db, principal!, workspaceId, agentId),
    ).resolves.toEqual({
      hasChanges: true,
      changedModules: ['prompt'],
    })

    await updateAgentDraft(db, principal!, workspaceId, agentId, {
      instructions: 'Review changes.',
    })
    await expect(
      getAgentChangeStatus(db, principal!, workspaceId, agentId),
    ).resolves.toEqual({
      hasChanges: false,
      changedModules: [],
    })
  })

  it('tracks tool and Skill bindings independently', async () => {
    const agentId = await createPublishedAgent()
    const tool = await createHttpTool(db, principal!, workspaceId, {
      name: 'Issue Search',
      description: 'Search issues.',
      endpoint: 'https://api.example.com/issues',
      method: 'GET',
      inputSchema: { type: 'object', properties: {} },
    })
    const skill = await createSkill(db, principal!, workspaceId, {
      name: 'Review method',
      description: 'Review safely.',
      content: 'Check authorization and rollback.',
    })

    await replaceDraftTools(db, principal!, workspaceId, agentId, {
      capabilityVersionIds: [tool.versionId],
    })
    await expect(
      getAgentChangeStatus(db, principal!, workspaceId, agentId),
    ).resolves.toEqual({
      hasChanges: true,
      changedModules: ['tools'],
    })

    await replaceDraftSkills(db, principal!, workspaceId, agentId, {
      capabilityVersionIds: [skill.versionId],
    })
    await expect(
      getAgentChangeStatus(db, principal!, workspaceId, agentId),
    ).resolves.toEqual({
      hasChanges: true,
      changedModules: ['tools', 'skills'],
    })
  })

  it('tracks InfoFlow channel configuration changes', async () => {
    const agentId = await createPublishedAgent()

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
      new SecretBox(key),
    )

    await expect(
      getAgentChangeStatus(db, principal!, workspaceId, agentId),
    ).resolves.toEqual({
      hasChanges: true,
      changedModules: ['channels'],
    })
  })

  it('does not mark unchanged channel credentials as changed', async () => {
    const created = await createAgent(db, principal!, workspaceId, {
      name: 'Reviewer',
      instructions: 'Review changes.',
      modelProvider: 'oneapi-comate',
      modelId: 'DeepSeek-V4-Pro',
      thinkingLevel: 'high',
    })
    const box = new SecretBox(key)
    await saveInfoFlowChannel(
      db,
      principal!,
      workspaceId,
      created.id,
      {
        enabled: true,
        infoflowAgentId: '50655',
        appKey: 'app-key-123456',
        appSecret: 'app-secret-123456',
      },
      box,
    )
    await publishAgentVersion(db, principal!, workspaceId, created.id)
    await createNextVersion(db, principal!, workspaceId, created.id)

    await saveInfoFlowChannel(
      db,
      principal!,
      workspaceId,
      created.id,
      {
        enabled: true,
        infoflowAgentId: '50655',
        appKey: '',
        appSecret: '',
      },
      box,
    )

    await expect(
      getAgentChangeStatus(db, principal!, workspaceId, created.id),
    ).resolves.toEqual({
      hasChanges: false,
      changedModules: [],
    })
  })
})
