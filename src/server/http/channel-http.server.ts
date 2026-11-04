import { z } from 'zod'

import type { createDatabase } from '#/db'
import { authenticateRequest } from '#/server/auth/authenticate.server'
import type { ServerEnv } from '#/server/env.server'
import {
  getAgentChannels,
  infoFlowChannelInputSchema,
  saveInfoFlowChannel,
  testInfoFlowConnection,
} from '#/server/platform/channel.server'
import type { InfoFlowClientFactory } from '#/server/platform/channel.server'
import { resolvePrincipal } from '#/server/platform/workspace-access.server'
import type { AppPrincipal } from '#/server/platform/workspace-access.server'
import type { SecretBox } from '#/server/secrets/secret-box.server'

type Dependencies = {
  db: ReturnType<typeof createDatabase>
  env: ServerEnv
  workspaceId: string
  agentId: string
  box: SecretBox
  createClient?: InfoFlowClientFactory
}

async function principalFor(
  request: Request,
  dependencies: Dependencies,
): Promise<AppPrincipal | Response> {
  const identity = await authenticateRequest(request.headers, dependencies.env)
  if (!identity) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const principal = await resolvePrincipal(
    dependencies.db,
    identity,
    dependencies.env,
  )
  if (!principal) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  return principal
}

function originAllowed(request: Request, env: ServerEnv): boolean {
  const origin = request.headers.get('origin')
  return !origin || origin === new URL(env.APP_ORIGIN).origin
}

function errorResponse(error: unknown): Response {
  if (error instanceof z.ZodError) {
    return Response.json({ error: 'validation_error' }, { status: 400 })
  }
  if (
    error instanceof Error &&
    ['incomplete infoflow configuration', 'infoflow not configured'].includes(
      error.message,
    )
  ) {
    return Response.json({ error: 'infoflow_incomplete' }, { status: 400 })
  }
  if (error instanceof Error && error.message === 'forbidden') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  if (error instanceof Error && error.message === 'agent not found') {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  if (
    error instanceof Error &&
    error.message === 'infoflow agent already in use'
  ) {
    return Response.json({ error: 'infoflow_agent_in_use' }, { status: 409 })
  }
  if (
    error instanceof Error &&
    error.message === 'InfoFlow credentials invalid'
  ) {
    return Response.json(
      { error: 'infoflow_credentials_invalid' },
      { status: 422 },
    )
  }
  return Response.json({ error: 'internal_error' }, { status: 500 })
}

export async function getAgentChannelsHandler(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    return Response.json(
      await getAgentChannels(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        dependencies.agentId,
        dependencies.box,
      ),
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function saveInfoFlowChannelHandler(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    const input = infoFlowChannelInputSchema.parse(await request.json())
    return Response.json(
      await saveInfoFlowChannel(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        dependencies.agentId,
        input,
        dependencies.box,
      ),
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function testInfoFlowConnectionHandler(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    return Response.json(
      await testInfoFlowConnection(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        dependencies.agentId,
        dependencies.env,
        dependencies.box,
        dependencies.createClient,
      ),
    )
  } catch (error) {
    return errorResponse(error)
  }
}
