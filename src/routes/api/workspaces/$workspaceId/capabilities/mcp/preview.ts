import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import { previewMcpServerHandler } from '#/server/http/capability-source-http.server'

export const Route = createFileRoute(
  '/api/workspaces/$workspaceId/capabilities/mcp/preview',
)({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        previewMcpServerHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
          workspaceId: params.workspaceId,
        }),
    },
  },
})
