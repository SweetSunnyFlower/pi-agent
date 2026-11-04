import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import { testAiProviderHandler } from '#/server/http/ai-provider-http.server'
import { SecretBox } from '#/server/secrets/secret-box.server'

export const Route = createFileRoute('/api/providers/$providerId/test')({
  server: {
    handlers: {
      POST: ({ request, params }) => {
        const workspaceId = new URL(request.url).searchParams.get('workspaceId')
        if (!workspaceId) {
          return Response.json({ error: 'workspace_required' }, { status: 400 })
        }
        const env = getServerEnv()
        return testAiProviderHandler(request, {
          db: getDatabase(),
          env,
          workspaceId,
          providerId: params.providerId,
          box: new SecretBox(env.CHANNEL_SECRET_KEK),
        })
      },
    },
  },
})
