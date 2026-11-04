import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import { createHttpToolHandler } from '#/server/http/capability-http.server'

export const Route = createFileRoute(
  '/api/workspaces/$workspaceId/capabilities/tools',
)({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        createHttpToolHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
          workspaceId: params.workspaceId,
        }),
    },
  },
})
