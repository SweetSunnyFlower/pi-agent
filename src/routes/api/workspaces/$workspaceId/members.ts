import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import {
  listWorkspaceMembersHandler,
  saveWorkspaceMemberHandler,
} from '#/server/http/workspace-member-http.server'

export const Route = createFileRoute('/api/workspaces/$workspaceId/members')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        listWorkspaceMembersHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
          workspaceId: params.workspaceId,
        }),
      POST: ({ request, params }) =>
        saveWorkspaceMemberHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
          workspaceId: params.workspaceId,
        }),
    },
  },
})
