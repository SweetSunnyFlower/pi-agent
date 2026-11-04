import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import { publishAgentHandler } from '#/server/http/agent-http.server'

export const Route = createFileRoute('/api/agents/$agentId/publish')({
  server: {
    handlers: {
      POST: ({ request, params }) => {
        const workspaceId = new URL(request.url).searchParams.get('workspaceId')
        if (!workspaceId) {
          return Response.json({ error: 'workspace_required' }, { status: 400 })
        }
        return publishAgentHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
          workspaceId,
          agentId: params.agentId,
        })
      },
    },
  },
})
