import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase } from '#/db'
import { parseServerEnv } from '#/server/env.server'
import { saveAiProvider } from '#/server/platform/ai-provider.server'
import { ensureDevelopmentSeed, resolvePrincipal } from '#/server/platform/workspace-access.server'
import { SecretBox } from '#/server/secrets/secret-box.server'

import { handleModelConfig } from './model-http.server'

const key = Buffer.alloc(32, 11).toString('base64')
const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  APP_DATABASE_PATH: ':memory:',
  CHANNEL_SECRET_KEK: key,
})
const request = new Request(
  'http://localhost:3000/api/model-config?workspaceId=w1',
)

describe('handleModelConfig', () => {
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

  it('merges models from every enabled provider without exposing tokens', async () => {
    const primary = await saveAiProvider(
      db,
      principal!,
      workspaceId,
      {
        name: '主网关',
        baseUrl: 'https://primary.example.com/v1/',
        token: 'sk-primary-secret-1234',
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
        token: 'sk-backup-secret-5678',
        enabled: true,
      },
      box,
    )
    await saveAiProvider(
      db,
      principal!,
      workspaceId,
      {
        name: '停用网关',
        baseUrl: 'https://disabled.example.com/v1',
        token: 'sk-disabled-secret-0000',
        enabled: false,
      },
      box,
    )
    const fetchModels = vi.fn((url: string) => {
      if (url === 'https://primary.example.com/v1/models') {
        return Promise.resolve(
          Response.json({
            data: [
              { id: 'DeepSeek-V4-Pro' },
              { id: 'DeepSeek-V4-Flash' },
              { id: ' DeepSeek-V4-Pro ' },
            ],
          }),
        )
      }
      if (url === 'https://backup.example.com/v1/models') {
        return Promise.resolve(
          Response.json({ data: [{ id: 'Backup-Model' }] }),
        )
      }
      return Promise.resolve(Response.json({ data: [] }))
    })

    const response = await handleModelConfig(request, {
      db,
      env,
      workspaceId,
      box,
      fetchModels,
    })
    const text = await response.text()
    const body = JSON.parse(text) as {
      configured: boolean
      options: Array<{
        provider: string
        providerLabel: string
        modelId: string
        baseUrl: string
      }>
    }

    expect(response.status).toBe(200)
    expect(text).not.toContain('sk-primary-secret-1234')
    expect(fetchModels).toHaveBeenCalledTimes(2)
    expect(body.configured).toBe(true)
    expect(body.options).toEqual([
      {
        provider: primary.id,
        providerLabel: '主网关',
        modelId: 'DeepSeek-V4-Pro',
        baseUrl: 'https://primary.example.com/v1',
      },
      {
        provider: primary.id,
        providerLabel: '主网关',
        modelId: 'DeepSeek-V4-Flash',
        baseUrl: 'https://primary.example.com/v1',
      },
      {
        provider: backup.id,
        providerLabel: '备用网关',
        modelId: 'Backup-Model',
        baseUrl: 'https://backup.example.com/v1',
      },
    ])
    expect(fetchModels).toHaveBeenCalledWith(
      'https://primary.example.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer sk-primary-secret-1234',
        }),
      }),
    )
  })

  it('keeps available provider models when another provider fails', async () => {
    const healthy = await saveAiProvider(
      db,
      principal!,
      workspaceId,
      {
        name: '正常网关',
        baseUrl: 'https://healthy.example.com/v1',
        token: 'sk-healthy-secret-1234',
        enabled: true,
      },
      box,
    )
    await saveAiProvider(
      db,
      principal!,
      workspaceId,
      {
        name: '故障网关',
        baseUrl: 'https://broken.example.com/v1',
        token: 'sk-broken-secret-5678',
        enabled: true,
      },
      box,
    )
    const fetchModels = vi.fn((url: string) => {
      if (url.startsWith('https://broken')) {
        return Promise.resolve(
          Response.json({ error: 'failed' }, { status: 503 }),
        )
      }
      return Promise.resolve(Response.json({ data: [{ id: 'Healthy-Model' }] }))
    })

    const response = await handleModelConfig(request, {
      db,
      env,
      workspaceId,
      box,
      fetchModels,
    })
    await expect(response.json()).resolves.toMatchObject({
      configured: true,
      options: [
        expect.objectContaining({
          provider: healthy.id,
          modelId: 'Healthy-Model',
        }),
      ],
      errors: [
        expect.objectContaining({
          providerLabel: '故障网关',
          code: 'provider_unavailable',
        }),
      ],
    })
  })

  it('reports no providers as unconfigured without requesting models', async () => {
    const fetchModels = vi.fn()
    const response = await handleModelConfig(request, {
      db,
      env,
      workspaceId,
      box,
      fetchModels,
    })

    await expect(response.json()).resolves.toEqual({
      configured: false,
      options: [],
    })
    expect(fetchModels).not.toHaveBeenCalled()
  })
})
