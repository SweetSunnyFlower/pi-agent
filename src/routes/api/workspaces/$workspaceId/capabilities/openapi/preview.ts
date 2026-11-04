import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import { previewOpenApiHandler } from '#/server/http/capability-source-http.server'

export const Route = createFileRoute(
  '/api/workspaces/$workspaceId/capabilities/openapi/preview',
)({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        previewOpenApiHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
          workspaceId: params.workspaceId,
        }),
    },
  },
})
