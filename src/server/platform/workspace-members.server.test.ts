import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '#/db'
import { users, workspaceMembers } from '#/db/schema'
import { parseServerEnv } from '#/server/env.server'
import type { AppPrincipal } from '#/server/platform/workspace-access.server'
import {
  ensureDevelopmentSeed,
  resolvePrincipal,
} from '#/server/platform/workspace-access.server'

import {
  listWorkspaceMembers,
  removeWorkspaceMember,
  saveWorkspaceMember,
} from './workspace-members.server'

const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  APP_DATABASE_PATH: ':memory:',
  CHANNEL_SECRET_KEK: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
})

describe('workspace members', () => {
  let db: ReturnType<typeof createDatabase>
  let admin: AppPrincipal
  let workspaceId: string

  beforeEach(async () => {
    db = createDatabase(':memory:')
    migrate(db, { migrationsFolder: './drizzle' })
    await ensureDevelopmentSeed(db, env)
    admin = (
      await resolvePrincipal(
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
    )!
    workspaceId = admin.workspaces[0].workspaceId
  })

  it('creates and lists a workspace member by username', async () => {
    const member = await saveWorkspaceMember(db, admin, workspaceId, {
      username: 'bob',
      role: 'user',
    })

    expect(member).toMatchObject({
      username: 'bob',
      role: 'user',
    })
    expect(await listWorkspaceMembers(db, admin, workspaceId)).toEqual([
      expect.objectContaining({ username: 'alice', role: 'workspace_admin' }),
      expect.objectContaining({ username: 'bob', role: 'user' }),
    ])
  })

  it('updates an existing member role', async () => {
    await saveWorkspaceMember(db, admin, workspaceId, {
      username: 'bob',
      role: 'user',
    })

    const updated = await saveWorkspaceMember(db, admin, workspaceId, {
      username: 'bob',
      role: 'editor',
    })

    expect(updated.role).toBe('editor')
    expect(db.select().from(users).all()).toHaveLength(2)
    expect(db.select().from(workspaceMembers).all()).toHaveLength(2)
  })

  it('rejects member management by a regular workspace user', async () => {
    await saveWorkspaceMember(db, admin, workspaceId, {
      username: 'bob',
      role: 'user',
    })
    const bob = (
      await resolvePrincipal(
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
    )!

    await expect(
      saveWorkspaceMember(db, bob, workspaceId, {
        username: 'charlie',
        role: 'user',
      }),
    ).rejects.toThrow(/forbidden/i)
  })

  it('does not remove the final workspace administrator', async () => {
    await expect(
      removeWorkspaceMember(db, admin, workspaceId, admin.userId),
    ).rejects.toThrow(/last workspace administrator/i)
  })
})
