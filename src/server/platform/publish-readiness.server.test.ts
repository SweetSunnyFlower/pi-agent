import { randomUUID } from 'node:crypto'

import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '#/db'
import { agentChannels } from '#/db/schema'
import { parseServerEnv } from '#/server/env.server'

import {
  createAgent,
  createNextVersion,
  publishAgentVersion,
  updateAgentDraft,
} from './agent-version.server'
import { getPublishReadiness } from './publish-readiness.server'
import { ensureDevelopmentSeed, resolvePrincipal } from './workspace-access.server'

const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  APP_DATABASE_PATH: ':memory:',
  CHANNEL_SECRET_KEK: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
})

describe('publish readiness', () => {
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

  it('blocks publication when prompt and model are missing', async () => {
    const agent = await createAgent(db, principal!, workspaceId, {
      name: 'Incomplete',
    })

    const readiness = await getPublishReadiness(
      db,
      principal!,
      workspaceId,
      agent.id,
    )

    expect(readiness.ready).toBe(false)
    expect(readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'prompt', passed: false }),
        expect.objectContaining({ id: 'model', passed: false }),
      ]),
    )
  })

  it('allows a complete Web Agent to publish', async () => {
    const agent = await createAgent(db, principal!, workspaceId, {
      name: 'Reviewer',
      instructions: 'Review changes.',
      modelProvider: 'oneapi-comate',
      modelId: 'DeepSeek-V4-Pro',
      thinkingLevel: 'high',
    })

    const readiness = await getPublishReadiness(
      db,
      principal!,
      workspaceId,
      agent.id,
    )

    expect(readiness).toEqual(
      expect.objectContaining({
        ready: true,
        summary: expect.objectContaining({
          versionNumber: 1,
          tools: 0,
          skills: 0,
          channels: ['Web'],
        }),
      }),
    )
  })

  it('disables publication for an unchanged copied draft', async () => {
    const agent = await createAgent(db, principal!, workspaceId, {
      name: 'Reviewer',
      instructions: 'Review changes.',
      modelProvider: 'oneapi-comate',
      modelId: 'DeepSeek-V4-Pro',
      thinkingLevel: 'high',
    })
    await publishAgentVersion(db, principal!, workspaceId, agent.id)
    await createNextVersion(db, principal!, workspaceId, agent.id)

    const unchanged = await getPublishReadiness(
      db,
      principal!,
      workspaceId,
      agent.id,
    )
    expect(unchanged).toEqual(
      expect.objectContaining({
        state: 'draft',
        hasChanges: false,
        changedModules: [],
        ready: false,
      }),
    )

    await updateAgentDraft(db, principal!, workspaceId, agent.id, {
      thinkingLevel: 'medium',
    })
    const changed = await getPublishReadiness(
      db,
      principal!,
      workspaceId,
      agent.id,
    )
    expect(changed).toEqual(
      expect.objectContaining({
        hasChanges: true,
        changedModules: ['prompt'],
        ready: true,
      }),
    )
  })

  it('requires credentials when InfoFlow is enabled', async () => {
    const agent = await createAgent(db, principal!, workspaceId, {
      name: 'Reviewer',
      instructions: 'Review changes.',
      modelProvider: 'oneapi-comate',
      modelId: 'DeepSeek-V4-Pro',
      thinkingLevel: 'high',
    })
    db.insert(agentChannels)
      .values({
        id: randomUUID(),
        workspaceId,
        agentId: agent.id,
        channel: 'infoflow',
        enabled: true,
        configJson: { triggerMode: 'group_mention' },
      })
      .run()

    const readiness = await getPublishReadiness(
      db,
      principal!,
      workspaceId,
      agent.id,
    )

    expect(readiness.ready).toBe(false)
    expect(readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'infoflow',
          passed: false,
        }),
      ]),
    )
  })
})
