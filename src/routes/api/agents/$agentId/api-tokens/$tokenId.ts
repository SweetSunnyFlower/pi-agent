import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import { revokeAgentApiTokenHandler } from '#/server/http/open-api-http.server'

export const Route = createFileRoute(
  '/api/agents/$agentId/api-tokens/$tokenId',
)({
  server: {
    handlers: {
      DELETE: ({ request, params }) => {
        const workspaceId = new URL(request.url).searchParams.get('workspaceId')
        if (!workspaceId) {
          return Response.json({ error: 'workspace_required' }, { status: 400 })
        }
        return revokeAgentApiTokenHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
          workspaceId,
          agentId: params.agentId,
          tokenId: params.tokenId,
        })
      },
    },
  },
})
