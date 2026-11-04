import { z } from 'zod'

import type { createDatabase } from '#/db'
import { authenticateRequest } from '#/server/auth/authenticate.server'
import type { ServerEnv } from '#/server/env.server'
import {
  agentDraftInputSchema,
  createAgent,
  createNextVersion,
  getAgentAccess,
  getAgent,
  listAgents,
  publishAgentVersion,
  updateAgentDraft,
} from '#/server/platform/agent-version.server'
import { getPublishReadiness } from '#/server/platform/publish-readiness.server'
import { resolvePrincipal } from '#/server/platform/workspace-access.server'
import type { AppPrincipal } from '#/server/platform/workspace-access.server'

type Dependencies = {
  db: ReturnType<typeof createDatabase>
  env: ServerEnv
  workspaceId: string
  agentId?: string
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
  if (!origin) return true
  return origin === new URL(env.APP_ORIGIN).origin
}

function errorResponse(error: unknown): Response {
  if (error instanceof z.ZodError) {
    return Response.json(
      {
        error: 'validation_error',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      { status: 400 },
    )
  }
  if (error instanceof Error && error.message === 'forbidden') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  if (error instanceof Error && error.message === 'agent not found') {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  if (error instanceof Error && error.message === 'no editable draft') {
    return Response.json({ error: 'no_editable_draft' }, { status: 409 })
  }
  if (error instanceof Error && error.message === 'incomplete draft') {
    return Response.json({ error: 'incomplete_draft' }, { status: 409 })
  }
  return Response.json({ error: 'internal_error' }, { status: 500 })
}

export async function listWorkspacesHandler(
  request: Request,
  dependencies: Omit<Dependencies, 'workspaceId' | 'agentId'>,
): Promise<Response> {
  const principal = await principalFor(request, {
    ...dependencies,
    workspaceId: '',
  })
  if (principal instanceof Response) return principal
  return Response.json(principal.workspaces)
}

export async function listAgentsHandler(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    const rows = await listAgents(
      dependencies.db,
      principal,
      dependencies.workspaceId,
    )
    return Response.json(
      await Promise.all(
        rows.map((agent) =>
          getAgent(
            dependencies.db,
            principal,
            dependencies.workspaceId,
            agent.id,
          ),
        ),
      ),
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function createAgentHandler(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    const input = agentDraftInputSchema.parse(await request.json())
    if (!input.name) {
      return Response.json({ error: 'validation_error' }, { status: 400 })
    }
    const created = await createAgent(
      dependencies.db,
      principal,
      dependencies.workspaceId,
      {
        name: input.name,
        description: input.description,
        instructions: input.instructions,
        modelProvider: input.modelProvider,
        modelId: input.modelId,
        thinkingLevel: input.thinkingLevel,
        visibility: input.visibility,
      },
    )
    return Response.json(created, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function getAgentHandler(
  request: Request,
  dependencies: Dependencies & { agentId: string },
): Promise<Response> {
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    return Response.json(
      await getAgent(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        dependencies.agentId,
      ),
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function getAgentAccessHandler(
  request: Request,
  dependencies: Dependencies & { agentId: string },
): Promise<Response> {
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    return Response.json(
      await getAgentAccess(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        dependencies.agentId,
      ),
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function updateAgentDraftHandler(
  request: Request,
  dependencies: Dependencies & { agentId: string },
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    const patch = agentDraftInputSchema.parse(await request.json())
    return Response.json(
      await updateAgentDraft(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        dependencies.agentId,
        patch,
      ),
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function publishAgentHandler(
  request: Request,
  dependencies: Dependencies & { agentId: string },
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    const readiness = await getPublishReadiness(
      dependencies.db,
      principal,
      dependencies.workspaceId,
      dependencies.agentId,
    )
    if (
      readiness.state === 'draft' &&
      !readiness.hasChanges &&
      readiness.checks.every((check) => check.passed)
    ) {
      return Response.json({ error: 'no_changes' }, { status: 409 })
    }
    if (!readiness.ready) {
      return Response.json(
        { error: 'not_ready', checks: readiness.checks },
        { status: 409 },
      )
    }
    return Response.json(
      await publishAgentVersion(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        dependencies.agentId,
      ),
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function getPublishReadinessHandler(
  request: Request,
  dependencies: Dependencies & { agentId: string },
): Promise<Response> {
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    return Response.json(
      await getPublishReadiness(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        dependencies.agentId,
      ),
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function createNextVersionHandler(
  request: Request,
  dependencies: Dependencies & { agentId: string },
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    return Response.json(
      await createNextVersion(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        dependencies.agentId,
      ),
      { status: 201 },
    )
  } catch (error) {
    return errorResponse(error)
  }
}
