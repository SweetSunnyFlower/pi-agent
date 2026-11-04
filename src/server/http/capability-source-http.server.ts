import { z } from 'zod'

import type { createDatabase } from '#/db'
import {
  importOpenApiTools,
  openApiDocumentInputSchema,
  openApiImportInputSchema,
  previewOpenApiDocument,
} from '#/server/capabilities/openapi.server'
import type { OpenApiFetchDocument } from '#/server/capabilities/openapi.server'
import {
  discoverRemoteMcpServer,
  importMcpTools,
  mcpImportInputSchema,
  mcpServerInputSchema,
  previewMcpServer,
} from '#/server/capabilities/mcp.server'
import type { DiscoverMcpServer } from '#/server/capabilities/mcp.server'
import { authenticateRequest } from '#/server/auth/authenticate.server'
import type { ServerEnv } from '#/server/env.server'
import {
  requireWorkspaceAccess,
  resolvePrincipal,
} from '#/server/platform/workspace-access.server'
import type { AppPrincipal } from '#/server/platform/workspace-access.server'

type Dependencies = {
  db: ReturnType<typeof createDatabase>
  env: ServerEnv
  workspaceId: string
  fetchDocument?: OpenApiFetchDocument
  discoverMcp?: DiscoverMcpServer
}

async function adminPrincipalFor(
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
  try {
    await requireWorkspaceAccess(
      dependencies.db,
      principal,
      dependencies.workspaceId,
      ['platform_admin', 'workspace_admin'],
    )
    return principal
  } catch {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
}

function originAllowed(request: Request, env: ServerEnv): boolean {
  const origin = request.headers.get('origin')
  return !origin || origin === new URL(env.APP_ORIGIN).origin
}

function errorResponse(error: unknown): Response {
  if (error instanceof z.ZodError) {
    return Response.json({ error: 'validation_error' }, { status: 400 })
  }
  const message = error instanceof Error ? error.message : ''
  if (message === 'capability already exists') {
    return Response.json({ error: 'capability_exists' }, { status: 409 })
  }
  if (
    message === 'invalid OpenAPI operation' ||
    message === 'invalid MCP tool' ||
    message === 'invalid MCP server URL' ||
    message === 'invalid OpenAPI document URL'
  ) {
    return Response.json({ error: 'validation_error' }, { status: 400 })
  }
  if (message === 'MCP server unavailable') {
    return Response.json({ error: 'mcp_unavailable' }, { status: 502 })
  }
  if (message.startsWith('OpenAPI') || message.includes('OpenAPI')) {
    return Response.json({ error: 'openapi_invalid' }, { status: 422 })
  }
  return Response.json({ error: 'internal_error' }, { status: 500 })
}

async function parseJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null)
}

export async function previewOpenApiHandler(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await adminPrincipalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    const input = openApiDocumentInputSchema.parse(await parseJson(request))
    return Response.json(
      await previewOpenApiDocument(input, dependencies.fetchDocument ?? fetch),
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function importOpenApiHandler(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await adminPrincipalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    const input = openApiImportInputSchema.parse(await parseJson(request))
    return Response.json(
      await importOpenApiTools(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        input,
        dependencies.fetchDocument ?? fetch,
      ),
      { status: 201 },
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function previewMcpServerHandler(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await adminPrincipalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    const input = mcpServerInputSchema.parse(await parseJson(request))
    return Response.json(
      await previewMcpServer(
        input,
        dependencies.discoverMcp ?? discoverRemoteMcpServer,
      ),
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function importMcpHandler(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await adminPrincipalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    const input = mcpImportInputSchema.parse(await parseJson(request))
    return Response.json(
      await importMcpTools(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        input,
        dependencies.discoverMcp ?? discoverRemoteMcpServer,
      ),
      { status: 201 },
    )
  } catch (error) {
    return errorResponse(error)
  }
}
