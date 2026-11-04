import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '#/db'
import { parseServerEnv } from '#/server/env.server'
import type { AppPrincipal } from '#/server/platform/workspace-access.server'
import {
  ensureDevelopmentSeed,
  resolvePrincipal,
} from '#/server/platform/workspace-access.server'

import {
  listWorkspaceMembersHandler,
  removeWorkspaceMemberHandler,
  saveWorkspaceMemberHandler,
} from './workspace-member-http.server'

const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  APP_DATABASE_PATH: ':memory:',
  CHANNEL_SECRET_KEK: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
})

function request(method: string, body?: unknown): Request {
  return new Request('http://localhost:3000/api/workspaces/w1/members', {
    method,
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('workspace member HTTP services', () => {
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

  it('lists and saves workspace members', async () => {
    const saveResponse = await saveWorkspaceMemberHandler(
      request('POST', { username: 'bob', role: 'user' }),
      { db, env, workspaceId },
    )
    expect(saveResponse.status).toBe(200)

    const listResponse = await listWorkspaceMembersHandler(
      request('GET'),
      { db, env, workspaceId },
    )
    expect(listResponse.status).toBe(200)
    await expect(listResponse.json()).resolves.toEqual([
      expect.objectContaining({ username: 'alice', role: 'workspace_admin' }),
      expect.objectContaining({ username: 'bob', role: 'user' }),
    ])
  })

  it('prevents removing the final administrator', async () => {
    const response = await removeWorkspaceMemberHandler(
      request('DELETE'),
      { db, env, workspaceId, userId: admin.userId },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'last_workspace_admin',
    })
  })
})
