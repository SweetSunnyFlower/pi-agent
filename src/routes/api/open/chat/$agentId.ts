import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import { postOpenChatHandler } from '#/server/http/open-api-http.server'
import { getPiRuntime } from '#/server/runtime/pi-runtime.server'

export const Route = createFileRoute('/api/open/chat/$agentId')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const runtime = await getPiRuntime()
        return postOpenChatHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
          agentId: params.agentId,
          harness: runtime.harness,
          registry: runtime.registry,
          models: runtime.models,
        })
      },
    },
  },
})
