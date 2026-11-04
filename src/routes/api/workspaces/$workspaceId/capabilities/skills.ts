import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import { createSkillHandler } from '#/server/http/skill-http.server'

export const Route = createFileRoute(
  '/api/workspaces/$workspaceId/capabilities/skills',
)({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        createSkillHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
          workspaceId: params.workspaceId,
        }),
    },
  },
})
