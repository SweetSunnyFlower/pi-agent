import { randomUUID } from 'node:crypto'

import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase } from '#/db'
import { users, workspaceMembers } from '#/db/schema'
import { parseServerEnv } from '#/server/env.server'
import { SecretBox } from '#/server/secrets/secret-box.server'

import {
  getAiProvidersHandler,
  saveAiProviderHandler,
  testAiProviderHandler,
  updateAiProviderHandler,
} from './ai-provider-http.server'
import { ensureDevelopmentSeed, resolvePrincipal } from '../platform/workspace-access.server'

const key = Buffer.alloc(32, 10).toString('base64')
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

describe('AI provider HTTP services', () => {
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

  it('creates, edits, tests and lists encrypted providers', async () => {
    const createResponse = await saveAiProviderHandler(
      request(
        `http://localhost:3000/api/workspaces/${workspaceId}/providers`,
        'POST',
        {
          name: '主网关',
          baseUrl: 'https://primary.example.com/v1/',
          token: 'sk-primary-secret-1234',
          enabled: true,
        },
      ),
      { db, env, workspaceId, box },
    )
    expect(createResponse.status).toBe(201)
    const created = (await createResponse.json()) as {
      id: string
      tokenMasked: string
    }
    expect(created.tokenMasked).toBe('sk-••••1234')

    const updateResponse = await updateAiProviderHandler(
      request(
        `http://localhost:3000/api/providers/${created.id}?workspaceId=${workspaceId}`,
        'PUT',
        {
          name: '主网关新版',
          baseUrl: 'https://primary-new.example.com/v1',
          enabled: true,
        },
      ),
      { db, env, workspaceId, providerId: created.id, box },
    )
    expect(updateResponse.status).toBe(200)
    await expect(updateResponse.json()).resolves.toMatchObject({
      id: created.id,
      name: '主网关新版',
      baseUrl: 'https://primary-new.example.com/v1',
      tokenMasked: 'sk-••••1234',
    })

    const fetchModels = vi.fn().mockResolvedValue(
      Response.json({
        data: [{ id: 'model-a' }, { id: 'model-b' }],
      }),
    )
    const testResponse = await testAiProviderHandler(
      request(
        `http://localhost:3000/api/providers/${created.id}/test?workspaceId=${workspaceId}`,
        'POST',
      ),
      { db, env, workspaceId, providerId: created.id, box, fetchModels },
    )
    expect(testResponse.status).toBe(200)
    await expect(testResponse.json()).resolves.toEqual({
      ok: true,
      modelCount: 2,
    })
    expect(fetchModels).toHaveBeenCalledWith(
      'https://primary-new.example.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer sk-primary-secret-1234',
        }),
      }),
    )

    const listResponse = await getAiProvidersHandler(
      request(
        `http://localhost:3000/api/workspaces/${workspaceId}/providers`,
        'GET',
      ),
      { db, env, workspaceId, box },
    )
    const listText = await listResponse.text()
    expect(listText).not.toContain('sk-primary-secret-1234')
    expect(JSON.parse(listText)).toEqual([
      expect.objectContaining({
        id: created.id,
        name: '主网关新版',
        tokenMasked: 'sk-••••1234',
        lastTestedAt: expect.any(String),
      }),
    ])
  })

  it('rejects provider changes from ordinary users', async () => {
    const bobId = randomUUID()
    db.insert(users).values({ id: bobId, username: 'bob' }).run()
    db.insert(workspaceMembers)
      .values({ workspaceId, userId: bobId, role: 'user' })
      .run()

    const response = await saveAiProviderHandler(
      request(
        `http://localhost:3000/api/workspaces/${workspaceId}/providers`,
        'POST',
        {
          name: '越权供应商',
          baseUrl: 'https://forbidden.example.com/v1',
          token: 'secret',
          enabled: true,
        },
      ),
      {
        db,
        env: { ...env, DEV_AUTH_USERNAME: 'bob' },
        workspaceId,
        box,
      },
    )

    expect(response.status).toBe(403)
  })
})
