import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import { importMcpHandler } from '#/server/http/capability-source-http.server'

export const Route = createFileRoute(
  '/api/workspaces/$workspaceId/capabilities/mcp/import',
)({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        importMcpHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
          workspaceId: params.workspaceId,
        }),
    },
  },
})
