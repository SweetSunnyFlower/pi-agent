import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import { listWorkspacesHandler } from '#/server/http/agent-http.server'

export const Route = createFileRoute('/api/workspaces/')({
  server: {
    handlers: {
      GET: ({ request }) =>
        listWorkspacesHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
        }),
    },
  },
})
