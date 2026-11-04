import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import { importOpenApiHandler } from '#/server/http/capability-source-http.server'

export const Route = createFileRoute(
  '/api/workspaces/$workspaceId/capabilities/openapi/import',
)({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        importOpenApiHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
          workspaceId: params.workspaceId,
        }),
    },
  },
})
