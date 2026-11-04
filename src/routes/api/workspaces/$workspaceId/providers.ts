import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import {
  getAiProvidersHandler,
  saveAiProviderHandler,
} from '#/server/http/ai-provider-http.server'
import { syncPiRuntimeProviders } from '#/server/runtime/pi-runtime.server'
import { SecretBox } from '#/server/secrets/secret-box.server'

export const Route = createFileRoute('/api/workspaces/$workspaceId/providers')({
  server: {
    handlers: {
      GET: ({ request, params }) => {
        const env = getServerEnv()
        return getAiProvidersHandler(request, {
          db: getDatabase(),
          env,
          workspaceId: params.workspaceId,
          box: new SecretBox(env.CHANNEL_SECRET_KEK),
        })
      },
      POST: async ({ request, params }) => {
        const env = getServerEnv()
        const response = await saveAiProviderHandler(request, {
          db: getDatabase(),
          env,
          workspaceId: params.workspaceId,
          box: new SecretBox(env.CHANNEL_SECRET_KEK),
        })
        if (response.ok) await syncPiRuntimeProviders()
        return response
      },
    },
  },
})
