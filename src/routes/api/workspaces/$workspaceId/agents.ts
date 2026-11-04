import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import {
  createAgentHandler,
  listAgentsHandler,
} from '#/server/http/agent-http.server'

export const Route = createFileRoute('/api/workspaces/$workspaceId/agents')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        listAgentsHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
          workspaceId: params.workspaceId,
        }),
      POST: ({ request, params }) =>
        createAgentHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
          workspaceId: params.workspaceId,
        }),
    },
  },
})
