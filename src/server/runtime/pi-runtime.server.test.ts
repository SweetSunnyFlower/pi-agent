import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels, fauxProvider } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'

import { openPiRuntime } from './pi-runtime.server'

describe('Pi SQLite runtime', () => {
  it('reopens the same durable conversation storage', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pi-runtime-'))
    const databasePath = join(directory, 'runtime.sqlite')
    const faux = fauxProvider({
      provider: 'oneapi-comate',
      models: [{ id: 'faux-chat', reasoning: true }],
    })
    const models = createModels()
    models.setProvider(faux.provider)

    try {
      const first = await openPiRuntime({ databasePath, models })
      const root = await first.harness.root(BACKGROUND_CONTEXT, {
        agent: {
          model: {
            provider: 'oneapi-comate',
            modelId: 'faux-chat',
          },
        },
      })
      await first.close()

      const second = await openPiRuntime({ databasePath, models })
      const reopened = await second.harness.root(BACKGROUND_CONTEXT)
      expect(String(reopened.id)).toBe(String(root.id))
      await second.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
