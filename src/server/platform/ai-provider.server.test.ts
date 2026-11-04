import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '#/db'
import { aiProviders, users, workspaceMembers } from '#/db/schema'
import { parseServerEnv } from '#/server/env.server'
import { SecretBox } from '#/server/secrets/secret-box.server'

import {
  listAiProviders,
  openAiProviderToken,
  saveAiProvider,
} from './ai-provider.server'
import { ensureDevelopmentSeed, resolvePrincipal } from './workspace-access.server'

const key = Buffer.alloc(32, 9).toString('base64')
const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  APP_DATABASE_PATH: ':memory:',
  CHANNEL_SECRET_KEK: key,
})

describe('AI provider service', () => {
  let db: ReturnType<typeof createDatabase>
  let box: SecretBox
  let principal: Awaited<ReturnType<typeof resolvePrincipal>>
  let workspaceId: string

  beforeEach(async () => {
    db = createDatabase(':memory:')
    migrate(db, { migrationsFolder: './drizzle' })
    box = new SecretBox(key)
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

  it('stores multiple providers with encrypted tokens and masked API output', async () => {
    const primary = await saveAiProvider(
      db,
      principal!,
      workspaceId,
      {
        name: '主网关',
        baseUrl: 'https://primary.example.com/v1',
        token: 'sk-primary-secret-1234',
        enabled: true,
      },
      box,
    )
    await saveAiProvider(
      db,
      principal!,
      workspaceId,
      {
        name: '备用网关',
        baseUrl: 'https://backup.example.com/v1',
        token: 'sk-backup-secret-5678',
        enabled: true,
      },
      box,
    )

    const providers = await listAiProviders(db, principal!, workspaceId, box)
    expect(providers.map((provider) => provider.name)).toEqual([
      '主网关',
      '备用网关',
    ])
    expect(providers[0].tokenMasked).toBe('sk-••••1234')
    expect(JSON.stringify(providers)).not.toContain('sk-primary-secret-1234')

    const row = db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.id, primary.id))
      .get()
    expect(row).toBeTruthy()
    expect(JSON.stringify(row?.tokenJson)).not.toContain(
      'sk-primary-secret-1234',
    )
    expect(openAiProviderToken(row!, box)).toBe('sk-primary-secret-1234')
  })

  it('updates provider settings without requiring the token again', async () => {
    const created = await saveAiProvider(
      db,
      principal!,
      workspaceId,
      {
        name: '主网关',
        baseUrl: 'https://primary.example.com/v1',
        token: 'sk-original-secret-1234',
        enabled: true,
      },
      box,
    )

    const updated = await saveAiProvider(
      db,
      principal!,
      workspaceId,
      {
        name: '主网关新版',
        baseUrl: 'https://primary-new.example.com/v1',
        enabled: false,
      },
      box,
      { providerId: created.id },
    )

    expect(updated).toMatchObject({
      id: created.id,
      name: '主网关新版',
      baseUrl: 'https://primary-new.example.com/v1',
      enabled: false,
    })
    const row = db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.id, created.id))
      .get()
    expect(openAiProviderToken(row!, box)).toBe('sk-original-secret-1234')
  })

  it('rejects provider management for an ordinary workspace user', async () => {
    const bobId = randomUUID()
    db.insert(users).values({ id: bobId, username: 'bob' }).run()
    db.insert(workspaceMembers)
      .values({ workspaceId, userId: bobId, role: 'user' })
      .run()
    const bob = await resolvePrincipal(
      db,
      {
        username: 'bob',
        name: null,
        email: null,
        expiresAt: Date.now() + 60_000,
        authMode: 'development',
      },
      env,
    )

    await expect(
      saveAiProvider(
        db,
        bob!,
        workspaceId,
        {
          name: '越权供应商',
          baseUrl: 'https://forbidden.example.com/v1',
          token: 'secret',
          enabled: true,
        },
        box,
      ),
    ).rejects.toThrow('forbidden')
  })
})
