import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import {
  createAgentApiTokenHandler,
  listAgentApiTokensHandler,
} from '#/server/http/open-api-http.server'

function dependencies(request: Request, agentId: string) {
  const workspaceId = new URL(request.url).searchParams.get('workspaceId')
  if (!workspaceId) return null
  return { db: getDatabase(), env: getServerEnv(), workspaceId, agentId }
}

const workspaceRequired = () =>
  Response.json({ error: 'workspace_required' }, { status: 400 })

export const Route = createFileRoute('/api/agents/$agentId/api-tokens')({
  server: {
    handlers: {
      GET: ({ request, params }) => {
        const deps = dependencies(request, params.agentId)
        return deps
          ? listAgentApiTokensHandler(request, deps)
          : workspaceRequired()
      },
      POST: ({ request, params }) => {
        const deps = dependencies(request, params.agentId)
        return deps
          ? createAgentApiTokenHandler(request, deps)
          : workspaceRequired()
      },
    },
  },
})
