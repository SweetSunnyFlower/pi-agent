import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import { handleModelConfig } from '#/server/http/model-http.server'
import { SecretBox } from '#/server/secrets/secret-box.server'

export const Route = createFileRoute('/api/model-config')({
  server: {
    handlers: {
      GET: ({ request }) => {
        const workspaceId = new URL(request.url).searchParams.get('workspaceId')
        if (!workspaceId) {
          return Response.json({ error: 'workspace_required' }, { status: 400 })
        }
        const env = getServerEnv()
        return handleModelConfig(request, {
          db: getDatabase(),
          env,
          workspaceId,
          box: new SecretBox(env.CHANNEL_SECRET_KEK),
        })
      },
    },
  },
})
