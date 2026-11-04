import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import { saveInfoFlowChannelHandler } from '#/server/http/channel-http.server'
import { SecretBox } from '#/server/secrets/secret-box.server'

export const Route = createFileRoute('/api/agents/$agentId/channels/infoflow')({
  server: {
    handlers: {
      PUT: ({ request, params }) => {
        const workspaceId = new URL(request.url).searchParams.get('workspaceId')
        if (!workspaceId) {
          return Response.json({ error: 'workspace_required' }, { status: 400 })
        }
        const env = getServerEnv()
        return saveInfoFlowChannelHandler(request, {
          db: getDatabase(),
          env,
          workspaceId,
          agentId: params.agentId,
          box: new SecretBox(env.CHANNEL_SECRET_KEK),
        })
      },
    },
  },
})
