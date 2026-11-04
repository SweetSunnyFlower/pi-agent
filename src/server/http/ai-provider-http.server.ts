import { z } from 'zod'

import type { createDatabase } from '#/db'
import { authenticateRequest } from '#/server/auth/authenticate.server'
import type { ServerEnv } from '#/server/env.server'
import {
  AiProviderTestError,
  aiProviderInputSchema,
  listAiProviders,
  saveAiProvider,
  testAiProvider,
} from '#/server/platform/ai-provider.server'
import type { ProviderModelFetch } from '#/server/platform/ai-provider.server'
import { resolvePrincipal } from '#/server/platform/workspace-access.server'
import type { AppPrincipal } from '#/server/platform/workspace-access.server'
import type { SecretBox } from '#/server/secrets/secret-box.server'

type Dependencies = {
  db: ReturnType<typeof createDatabase>
  env: ServerEnv
  workspaceId: string
  box: SecretBox
  providerId?: string
  fetchModels?: ProviderModelFetch
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
  if (error instanceof Error && error.message === 'forbidden') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  if (error instanceof Error && error.message === 'provider not found') {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  if (
    error instanceof Error &&
    error.message.toLocaleLowerCase().includes('unique')
  ) {
    return Response.json({ error: 'provider_name_in_use' }, { status: 409 })
  }
  if (error instanceof AiProviderTestError) {
    return Response.json({ error: error.code }, { status: 422 })
  }
  return Response.json({ error: 'internal_error' }, { status: 500 })
}

export async function getAiProvidersHandler(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal
  try {
    return Response.json(
      await listAiProviders(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        dependencies.box,
      ),
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function saveAiProviderHandler(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal
  try {
    const input = aiProviderInputSchema.parse(await request.json())
    return Response.json(
      await saveAiProvider(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        input,
        dependencies.box,
      ),
      { status: 201 },
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function updateAiProviderHandler(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  if (!dependencies.providerId) {
    return Response.json({ error: 'provider_required' }, { status: 400 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal
  try {
    const input = aiProviderInputSchema.parse(await request.json())
    return Response.json(
      await saveAiProvider(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        input,
        dependencies.box,
        { providerId: dependencies.providerId },
      ),
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function testAiProviderHandler(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  if (!dependencies.providerId) {
    return Response.json({ error: 'provider_required' }, { status: 400 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal
  try {
    const result = await testAiProvider(
      dependencies.db,
      principal,
      dependencies.workspaceId,
      dependencies.providerId,
      dependencies.box,
      dependencies.fetchModels,
    )
    return Response.json({ ok: true, ...result })
  } catch (error) {
    return errorResponse(error)
  }
}
