import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import { listAgentSkillsHandler } from '#/server/http/skill-http.server'

export const Route = createFileRoute(
  '/api/agents/$agentId/versions/$versionId/skills',
)({
  server: {
    handlers: {
      GET: ({ request, params }) => {
        const workspaceId = new URL(request.url).searchParams.get('workspaceId')
        if (!workspaceId) {
          return Response.json({ error: 'workspace_required' }, { status: 400 })
        }
        return listAgentSkillsHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
          workspaceId,
          agentId: params.agentId,
          versionId: params.versionId,
        })
      },
    },
  },
})
