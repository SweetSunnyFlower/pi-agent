import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import { listConversationsHandler } from '#/server/http/chat-http.server'
import { getPiRuntime } from '#/server/runtime/pi-runtime.server'

export const Route = createFileRoute('/api/agents/$agentId/conversations')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const workspaceId = new URL(request.url).searchParams.get('workspaceId')
        if (!workspaceId) {
          return Response.json({ error: 'workspace_required' }, { status: 400 })
        }
        const runtime = await getPiRuntime()
        return listConversationsHandler(request, {
          db: getDatabase(),
          env: getServerEnv(),
          workspaceId,
          agentId: params.agentId,
          harness: runtime.harness,
        })
      },
    },
  },
})
