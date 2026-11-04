import type { createDatabase } from '#/db'
import { authenticateRequest } from '#/server/auth/authenticate.server'
import type { ServerEnv } from '#/server/env.server'
import { resolvePrincipal } from '#/server/platform/workspace-access.server'

type Dependencies = {
  db: ReturnType<typeof createDatabase>
  env: ServerEnv
}

export async function handleAuthMe(
  request: Request,
  { db, env }: Dependencies,
): Promise<Response> {
  const identity = await authenticateRequest(request.headers, env)
  if (!identity) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const principal = await resolvePrincipal(db, identity, env)
  if (!principal) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  return Response.json({
    user: {
      id: principal.userId,
      username: principal.username,
      name: principal.name,
      email: principal.email,
    },
    workspaces: principal.workspaces,
    authMode: principal.authMode,
  })
}
