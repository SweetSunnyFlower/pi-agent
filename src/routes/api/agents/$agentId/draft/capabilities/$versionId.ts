import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import {
  deleteAgentToolHandler,
  reviseAgentToolHandler,
} from '#/server/http/capability-http.server'

export const Route = createFileRoute(
  '/api/agents/$agentId/draft/capabilities/$versionId',
)({
  server: {
    handlers: {
      PATCH: ({ request, params }) => {
        const workspaceId = new URL(request.url).searchParams.get('workspaceId')
        if (!workspaceId) {
          return Response.json({ error: 'workspace_required' }, { status: 400 })
        }
        return reviseAgentToolHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
          workspaceId,
          agentId: params.agentId,
          versionId: params.versionId,
        })
      },
      DELETE: ({ request, params }) => {
        const workspaceId = new URL(request.url).searchParams.get('workspaceId')
        if (!workspaceId) {
          return Response.json({ error: 'workspace_required' }, { status: 400 })
        }
        return deleteAgentToolHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
          workspaceId,
          agentId: params.agentId,
          versionId: params.versionId,
        })
      },
    },
  },
})
