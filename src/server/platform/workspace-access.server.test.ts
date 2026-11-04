import { randomUUID } from 'node:crypto'

import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'

import { createDatabase } from '#/db'
import { users, workspaces } from '#/db/schema'
import type { Identity } from '#/server/auth/types.server'
import { parseServerEnv } from '#/server/env.server'

import {
  ensureDevelopmentSeed,
  requireWorkspaceAccess,
  resolvePrincipal,
} from './workspace-access.server'

const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  APP_DATABASE_PATH: ':memory:',
  CHANNEL_SECRET_KEK: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
})

const identity: Identity = {
  username: 'alice',
  name: null,
  email: null,
  expiresAt: Date.now() + 60_000,
  authMode: 'development',
}

describe('workspace access', () => {
  it('seeds a development workspace idempotently', async () => {
    const db = createDatabase(':memory:')
    migrate(db, { migrationsFolder: './drizzle' })

    await ensureDevelopmentSeed(db, env)
    await ensureDevelopmentSeed(db, env)

    expect(db.select().from(users).all()).toHaveLength(1)
    expect(db.select().from(workspaces).all()).toHaveLength(1)
    expect(db.select().from(workspaces).get()).toMatchObject({
      slug: 'fde',
      name: '数字人FDE组',
    })
  })

  it('does not create a workspace during principal resolution', async () => {
    const db = createDatabase(':memory:')
    migrate(db, { migrationsFolder: './drizzle' })

    await expect(resolvePrincipal(db, identity, env)).resolves.toBeNull()
    expect(db.select().from(workspaces).all()).toHaveLength(0)
  })

  it('renames the legacy default workspace without changing its id', async () => {
    const db = createDatabase(':memory:')
    migrate(db, { migrationsFolder: './drizzle' })
    const workspaceId = randomUUID()
    db.insert(workspaces)
      .values({ id: workspaceId, slug: 'default', name: '开发工作区' })
      .run()

    await ensureDevelopmentSeed(db, env)

    expect(db.select().from(workspaces).get()).toMatchObject({
      id: workspaceId,
      slug: 'fde',
      name: '数字人FDE组',
    })
  })

  it('resolves workspace roles for the authenticated user', async () => {
    const db = createDatabase(':memory:')
    migrate(db, { migrationsFolder: './drizzle' })
    await ensureDevelopmentSeed(db, env)

    const principal = await resolvePrincipal(db, identity, env)

    expect(principal?.username).toBe('alice')
    expect(principal?.workspaces).toEqual([
      expect.objectContaining({
        slug: 'fde',
        name: '数字人FDE组',
        role: 'workspace_admin',
      }),
    ])
  })

  it('denies access to a foreign workspace', async () => {
    const db = createDatabase(':memory:')
    migrate(db, { migrationsFolder: './drizzle' })
    await ensureDevelopmentSeed(db, env)
    const principal = await resolvePrincipal(db, identity, env)
    const foreignId = randomUUID()
    db.insert(workspaces)
      .values({ id: foreignId, slug: 'foreign', name: 'Foreign' })
      .run()

    await expect(
      requireWorkspaceAccess(db, principal, foreignId, ['editor']),
    ).rejects.toThrow(/forbidden/i)
  })
})
