import type { createDatabase } from '#/db'
import { authenticateRequest } from '#/server/auth/authenticate.server'
import type { ServerEnv } from '#/server/env.server'
import {
  AiProviderTestError,
  fetchAiProviderModels,
  listEnabledAiProviders,
} from '#/server/platform/ai-provider.server'
import type { ProviderModelFetch } from '#/server/platform/ai-provider.server'
import {
  requireWorkspaceAccess,
  resolvePrincipal,
} from '#/server/platform/workspace-access.server'
import type { SecretBox } from '#/server/secrets/secret-box.server'

type Dependencies = {
  db: ReturnType<typeof createDatabase>
  env: ServerEnv
  workspaceId: string
  box: SecretBox
  fetchModels?: ProviderModelFetch
}

export async function handleModelConfig(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
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
  try {
    await requireWorkspaceAccess(
      dependencies.db,
      principal,
      dependencies.workspaceId,
      ['platform_admin', 'workspace_admin', 'editor', 'user'],
    )
  } catch {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  const providers = await listEnabledAiProviders(
    dependencies.db,
    dependencies.workspaceId,
  )
  if (providers.length === 0) {
    return Response.json({ configured: false, options: [] })
  }

  const results = await Promise.all(
    providers.map(async (provider) => {
      try {
        const modelIds = await fetchAiProviderModels(
          provider,
          dependencies.box,
          dependencies.fetchModels,
        )
        return {
          provider,
          options: modelIds.map((modelId) => ({
            provider: provider.id,
            providerLabel: provider.name,
            modelId,
            baseUrl: provider.baseUrl,
          })),
          error: null,
        }
      } catch (error) {
        return {
          provider,
          options: [],
          error: {
            providerId: provider.id,
            providerLabel: provider.name,
            code:
              error instanceof AiProviderTestError
                ? error.code
                : 'provider_unavailable',
          },
        }
      }
    }),
  )

  return Response.json({
    configured: true,
    options: results.flatMap((result) => result.options),
    ...(results.some((result) => result.error)
      ? {
          errors: results
            .map((result) => result.error)
            .filter((error): error is NonNullable<typeof error> => !!error),
        }
      : {}),
  })
}
