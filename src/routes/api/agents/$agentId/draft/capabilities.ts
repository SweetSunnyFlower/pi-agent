import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import {
  listAgentToolsHandler,
  replaceAgentToolsHandler,
} from '#/server/http/capability-http.server'

export const Route = createFileRoute('/api/agents/$agentId/draft/capabilities')(
  {
    server: {
      handlers: {
        GET: ({ request, params }) => {
          const workspaceId = new URL(request.url).searchParams.get(
            'workspaceId',
          )
          if (!workspaceId) {
            return Response.json(
              { error: 'workspace_required' },
              { status: 400 },
            )
          }
          return listAgentToolsHandler(request, {
            db: getDatabase(),
            env: getServerEnv(),
            workspaceId,
            agentId: params.agentId,
          })
        },
        PUT: ({ request, params }) => {
          const workspaceId = new URL(request.url).searchParams.get(
            'workspaceId',
          )
          if (!workspaceId) {
            return Response.json(
              { error: 'workspace_required' },
              { status: 400 },
            )
          }
          return replaceAgentToolsHandler(request, {
            db: getDatabase(),
            env: getServerEnv(),
            workspaceId,
            agentId: params.agentId,
          })
        },
      },
    },
  },
)
