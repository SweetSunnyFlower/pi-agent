import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import { removeWorkspaceMemberHandler } from '#/server/http/workspace-member-http.server'

export const Route = createFileRoute(
  '/api/workspaces/$workspaceId/members/$userId',
)({
  server: {
    handlers: {
      DELETE: ({ request, params }) =>
        removeWorkspaceMemberHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
          workspaceId: params.workspaceId,
          userId: params.userId,
        }),
    },
  },
})
