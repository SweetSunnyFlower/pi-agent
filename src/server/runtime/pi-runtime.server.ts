import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { MutableModels } from '@earendil-works/pi-ai'
import { createRegistry, Harness } from '@earendil-works/pi-durable'
import type { Registry } from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import { listEnabledAiProviders } from '#/server/platform/ai-provider.server'
import { SecretBox } from '#/server/secrets/secret-box.server'

import {
  createProviderModels,
  syncProviderModels,
} from './gateway-models.server'

export type PiRuntime = {
  harness: Harness
  models: MutableModels
  registry: Registry
  close: () => Promise<void>
}

declare global {
  var __piRuntimePromise__: Promise<PiRuntime> | undefined
}

export async function openPiRuntime(options: {
  databasePath: string
  models?: MutableModels
}): Promise<PiRuntime> {
  let models = options.models
  if (!models) {
    const env = getServerEnv()
    const db = getDatabase()
    const box = new SecretBox(env.CHANNEL_SECRET_KEK)
    models = await createProviderModels(await listEnabledAiProviders(db), box)
  }
  const storage = await openNodeSqliteStorage(options.databasePath, {
    prefix: 'pi_',
    busyTimeoutMs: 5000,
  })
  const registry = createRegistry()
  const harness = await Harness.open(
    storage,
    {
      models,
      registry,
      settings: {
        progress: {
          partialIntervalMs: 250,
          outputIntervalMs: 500,
        },
      },
      onReport(error) {
        const name = error instanceof Error ? error.name : 'UnknownError'
        console.error(`[pi-runtime] ${name}`)
      },
    },
    BACKGROUND_CONTEXT,
  )
  harness.resume()

  return {
    harness,
    models,
    registry,
    close: () => harness.close(BACKGROUND_CONTEXT),
  }
}

export function getPiRuntime(): Promise<PiRuntime> {
  if (!globalThis.__piRuntimePromise__) {
    const env = getServerEnv()
    globalThis.__piRuntimePromise__ = openPiRuntime({
      databasePath: env.APP_DATABASE_PATH,
    }).catch((error) => {
      globalThis.__piRuntimePromise__ = undefined
      throw error
    })
  }
  return globalThis.__piRuntimePromise__
}

export async function syncRuntimeProviderModels(runtime: PiRuntime) {
  const env = getServerEnv()
  const db = getDatabase()
  await syncProviderModels(
    runtime.models,
    await listEnabledAiProviders(db),
    new SecretBox(env.CHANNEL_SECRET_KEK),
  )
}

export async function syncPiRuntimeProviders(): Promise<void> {
  await syncRuntimeProviderModels(await getPiRuntime())
}
