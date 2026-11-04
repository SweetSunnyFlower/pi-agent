import type { createDatabase } from '#/db'
import type { Models } from '@earendil-works/pi-ai'
import type { Harness, Registry } from '@earendil-works/pi-durable'
import { authenticateRequest } from '#/server/auth/authenticate.server'
import type { ServerEnv } from '#/server/env.server'
import { errorResponse } from '#/server/http/chat-http.server'
import {
  authenticateOpenApiToken,
  createAgentApiToken,
  listAgentApiTokens,
  revokeAgentApiToken,
} from '#/server/platform/agent-api-token.server'
import { resolvePrincipal } from '#/server/platform/workspace-access.server'
import type { AppPrincipal } from '#/server/platform/workspace-access.server'
import { sendOpenMessage } from '#/server/runtime/chat.server'

type AppDatabase = ReturnType<typeof createDatabase>

type OpenChatDependencies = {
  db: AppDatabase
  env: ServerEnv
  agentId: string
  harness: Harness
  registry?: Registry
  models?: Models
}

type TokenDependencies = {
  db: AppDatabase
  env: ServerEnv
  workspaceId: string
  agentId: string
}

const openApiDisabled = () =>
  Response.json({ error: 'open_api_disabled' }, { status: 503 })

function bearerToken(request: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(
    request.headers.get('authorization') ?? '',
  )
  return match?.[1] ?? null
}

// Invalid JSON becomes undefined so schema validation reports a 400.
function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => undefined)
}

export async function postOpenChatHandler(
  request: Request,
  dependencies: OpenChatDependencies,
): Promise<Response> {
  const secret = dependencies.env.OPEN_API_JWT_SECRET
  if (!secret) return openApiDisabled()
  const token = bearerToken(request)
  const caller = token
    ? await authenticateOpenApiToken(dependencies.db, token, secret)
    : null
  if (!caller) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (caller.agentId !== dependencies.agentId) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  try {
    return Response.json(
      await sendOpenMessage(
        dependencies.db,
        caller,
        await readJson(request),
        dependencies.harness,
        dependencies.registry,
        dependencies.models,
        dependencies.env.CHAT_MAX_IMAGES_PER_MESSAGE,
      ),
    )
  } catch (error) {
    return errorResponse(error)
  }
}

async function principalFor(
  request: Request,
  dependencies: TokenDependencies,
): Promise<AppPrincipal | Response> {
  const identity = await authenticateRequest(request.headers, dependencies.env)
  const principal = identity
    ? await resolvePrincipal(dependencies.db, identity, dependencies.env)
    : null
  if (!principal) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  return principal
}

function originAllowed(request: Request, env: ServerEnv): boolean {
  const origin = request.headers.get('origin')
  return !origin || origin === new URL(env.APP_ORIGIN).origin
}

function tokenErrorResponse(error: unknown): Response {
  if (
    error instanceof Error &&
    ['agent not found', 'token not found'].includes(error.message)
  ) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  return errorResponse(error)
}

export async function listAgentApiTokensHandler(
  request: Request,
  dependencies: TokenDependencies,
): Promise<Response> {
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    return Response.json({
      enabled: Boolean(dependencies.env.OPEN_API_JWT_SECRET),
      tokens: await listAgentApiTokens(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        dependencies.agentId,
      ),
    })
  } catch (error) {
    return tokenErrorResponse(error)
  }
}

export async function createAgentApiTokenHandler(
  request: Request,
  dependencies: TokenDependencies,
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const secret = dependencies.env.OPEN_API_JWT_SECRET
  if (!secret) return openApiDisabled()
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    return Response.json(
      await createAgentApiToken(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        dependencies.agentId,
        await readJson(request),
        secret,
      ),
      { status: 201 },
    )
  } catch (error) {
    return tokenErrorResponse(error)
  }
}

export async function revokeAgentApiTokenHandler(
  request: Request,
  dependencies: TokenDependencies & { tokenId: string },
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    return Response.json(
      await revokeAgentApiToken(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        dependencies.agentId,
        dependencies.tokenId,
      ),
    )
  } catch (error) {
    return tokenErrorResponse(error)
  }
}
