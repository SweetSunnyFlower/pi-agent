import { z } from 'zod'

import type { createDatabase } from '#/db'
import { authenticateRequest } from '#/server/auth/authenticate.server'
import type { ServerEnv } from '#/server/env.server'
import {
  listWorkspaceMembers,
  removeWorkspaceMember,
  saveWorkspaceMember,
} from '#/server/platform/workspace-members.server'
import {
  resolvePrincipal,
} from '#/server/platform/workspace-access.server'
import type { AppPrincipal } from '#/server/platform/workspace-access.server'

type Dependencies = {
  db: ReturnType<typeof createDatabase>
  env: ServerEnv
  workspaceId: string
}

const saveMemberInputSchema = z.object({
  username: z.string().trim().min(1).max(120),
  role: z.enum(['platform_admin', 'workspace_admin', 'editor', 'user']),
})

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
  if (error instanceof Error && error.message === 'forbidden') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  if (
    error instanceof Error &&
    error.message === 'cannot remove the last workspace administrator'
  ) {
    return Response.json({ error: 'last_workspace_admin' }, { status: 409 })
  }
  if (
    error instanceof Error &&
    error.message === 'workspace member not found'
  ) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  return Response.json({ error: 'internal_error' }, { status: 500 })
}

export async function listWorkspaceMembersHandler(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    return Response.json(
      await listWorkspaceMembers(
        dependencies.db,
        principal,
        dependencies.workspaceId,
      ),
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function saveWorkspaceMemberHandler(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    const input = saveMemberInputSchema.parse(await request.json())
    return Response.json(
      await saveWorkspaceMember(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        input,
      ),
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function removeWorkspaceMemberHandler(
  request: Request,
  dependencies: Dependencies & { userId: string },
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    await removeWorkspaceMember(
      dependencies.db,
      principal,
      dependencies.workspaceId,
      dependencies.userId,
    )
    return new Response(null, { status: 204 })
  } catch (error) {
    return errorResponse(error)
  }
}
