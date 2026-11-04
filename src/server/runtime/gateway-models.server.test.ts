import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase } from '#/db'
import { parseServerEnv } from '#/server/env.server'
import {
  listEnabledAiProviders,
  saveAiProvider,
} from '#/server/platform/ai-provider.server'
import { ensureDevelopmentSeed, resolvePrincipal } from '#/server/platform/workspace-access.server'
import { SecretBox } from '#/server/secrets/secret-box.server'

import {
  createProviderModels,
  syncProviderModels,
} from './gateway-models.server'

const key = Buffer.alloc(32, 12).toString('base64')
const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  APP_DATABASE_PATH: ':memory:',
  CHANNEL_SECRET_KEK: key,
})

describe('provider Pi models', () => {
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

  it('loads every provider catalog with its own encrypted auth', async () => {
    const primary = await saveAiProvider(
      db,
      principal!,
      workspaceId,
      {
        name: '主网关',
        baseUrl: 'https://primary.example.com/v1',
        token: 'primary-token',
        enabled: true,
      },
      box,
    )
    const backup = await saveAiProvider(
      db,
      principal!,
      workspaceId,
      {
        name: '备用网关',
        baseUrl: 'https://backup.example.com/v1',
        token: 'backup-token',
        enabled: true,
      },
      box,
    )
    const fetchModels = vi.fn((url: string) =>
      Promise.resolve(
        Response.json({
          data:
            url === 'https://primary.example.com/v1/models'
              ? [{ id: 'primary-model' }]
              : [{ id: 'backup-model' }],
        }),
      ),
    )

    const providers = await listEnabledAiProviders(db, workspaceId)
    const models = await createProviderModels(providers, box, fetchModels)

    expect(models.getModels(primary.id).map((model) => model.id)).toEqual([
      'primary-model',
    ])
    expect(models.getModels(backup.id).map((model) => model.id)).toEqual([
      'backup-model',
    ])
    expect(fetchModels).toHaveBeenCalledWith(
      'https://primary.example.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer primary-token',
        }),
      }),
    )
    await expect(models.checkAuth(primary.id)).resolves.toEqual({
      source: 'database',
      type: 'api_key',
    })
  })

  it('replaces and removes providers when configuration changes', async () => {
    const primary = await saveAiProvider(
      db,
      principal!,
      workspaceId,
      {
        name: '主网关',
        baseUrl: 'https://primary.example.com/v1',
        token: 'primary-token',
        enabled: true,
      },
      box,
    )
    const backup = await saveAiProvider(
      db,
      principal!,
      workspaceId,
      {
        name: '备用网关',
        baseUrl: 'https://backup.example.com/v1',
        token: 'backup-token',
        enabled: true,
      },
      box,
    )
    const fetchModels = vi.fn((url: string) =>
      Promise.resolve(
        Response.json({
          data: [
            {
              id: url.includes('primary') ? 'primary-model' : 'backup-model',
            },
          ],
        }),
      ),
    )
    const models = await createProviderModels(
      await listEnabledAiProviders(db, workspaceId),
      box,
      fetchModels,
    )
    expect(models.getProvider(primary.id)).toBeTruthy()
    expect(models.getProvider(backup.id)).toBeTruthy()

    await saveAiProvider(
      db,
      principal!,
      workspaceId,
      {
        name: '备用网关',
        baseUrl: 'https://backup.example.com/v2',
        enabled: false,
      },
      box,
      { providerId: backup.id },
    )
    await syncProviderModels(
      models,
      await listEnabledAiProviders(db, workspaceId),
      box,
      fetchModels,
    )

    expect(models.getProvider(primary.id)).toBeTruthy()
    expect(models.getProvider(backup.id)).toBeUndefined()
  })

  it('marks only vision-capable catalog models as image inputs', async () => {
    const provider = await saveAiProvider(
      db,
      principal!,
      workspaceId,
      {
        name: '视觉网关',
        baseUrl: 'https://vision.example.com/v1',
        token: 'vision-token',
        enabled: true,
      },
      box,
    )
    const fetchModels = vi.fn(() =>
      Promise.resolve(
        Response.json({
          data: [
            { id: 'DeepSeek-V4-Flash' },
            { id: 'DeepSeek-V4-Flash-Vision-Exp' },
          ],
        }),
      ),
    )

    const models = await createProviderModels(
      await listEnabledAiProviders(db, workspaceId),
      box,
      fetchModels,
    )

    expect(models.getModel(provider.id, 'DeepSeek-V4-Flash')?.input).toEqual([
      'text',
    ])
    expect(
      models.getModel(provider.id, 'DeepSeek-V4-Flash-Vision-Exp')?.input,
    ).toEqual(['text', 'image'])
  })
})
