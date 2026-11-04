import { z } from 'zod'

import type { createDatabase } from '#/db'
import { authenticateRequest } from '#/server/auth/authenticate.server'
import type { ServerEnv } from '#/server/env.server'
import {
  createHttpTool,
  deleteTool,
  httpToolInputSchema,
  listToolsForDraft,
  listToolsForVersion,
  replaceDraftTools,
  replaceToolsInputSchema,
  reviseHttpTool,
} from '#/server/platform/capability.server'
import {
  openApiRevisionInputSchema,
  reviseOpenApiTool,
} from '#/server/capabilities/openapi.server'
import type { OpenApiFetchDocument } from '#/server/capabilities/openapi.server'
import {
  mcpRevisionInputSchema,
  reviseMcpTool,
} from '#/server/capabilities/mcp.server'
import type { DiscoverMcpServer } from '#/server/capabilities/mcp.server'
import { resolvePrincipal } from '#/server/platform/workspace-access.server'
import type { AppPrincipal } from '#/server/platform/workspace-access.server'

type Dependencies = {
  db: ReturnType<typeof createDatabase>
  env: ServerEnv
  workspaceId: string
  agentId?: string
  versionId?: string
  fetchDocument?: OpenApiFetchDocument
  discoverMcp?: DiscoverMcpServer
}

const reviseToolInputSchema = z.discriminatedUnion('kind', [
  httpToolInputSchema.extend({ kind: z.literal('http') }),
  openApiRevisionInputSchema.extend({
    kind: z.literal('openapi'),
  }),
  mcpRevisionInputSchema.extend({
    kind: z.literal('mcp'),
  }),
])

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
    [
      'invalid tool endpoint',
      'invalid capability',
      'invalid OpenAPI operation',
      'invalid MCP tool',
    ].includes(error.message)
  ) {
    return Response.json({ error: 'validation_error' }, { status: 400 })
  }
  if (error instanceof Error && error.message === 'forbidden') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  if (error instanceof Error && error.message === 'no editable draft') {
    return Response.json({ error: 'no_editable_draft' }, { status: 409 })
  }
  if (error instanceof Error && error.message === 'agent version not found') {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  if (error instanceof Error && error.message === 'capability already exists') {
    return Response.json({ error: 'capability_exists' }, { status: 409 })
  }
  if (error instanceof Error && error.message === 'MCP server unavailable') {
    return Response.json({ error: 'mcp_unavailable' }, { status: 502 })
  }
  if (
    error instanceof Error &&
    (error.message.startsWith('OpenAPI') || error.message.includes('OpenAPI'))
  ) {
    return Response.json({ error: 'openapi_invalid' }, { status: 422 })
  }
  return Response.json({ error: 'internal_error' }, { status: 500 })
}

export async function createHttpToolHandler(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    const input = httpToolInputSchema.parse(await request.json())
    return Response.json(
      await createHttpTool(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        input,
      ),
      { status: 201 },
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function listAgentToolsHandler(
  request: Request,
  dependencies: Dependencies & { agentId: string; versionId?: string },
): Promise<Response> {
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    return Response.json(
      dependencies.versionId
        ? await listToolsForVersion(
            dependencies.db,
            principal,
            dependencies.workspaceId,
            dependencies.agentId,
            dependencies.versionId,
          )
        : await listToolsForDraft(
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

export async function replaceAgentToolsHandler(
  request: Request,
  dependencies: Dependencies & { agentId: string },
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    const input = replaceToolsInputSchema.parse(await request.json())
    return Response.json(
      await replaceDraftTools(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        dependencies.agentId,
        input,
      ),
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function reviseAgentToolHandler(
  request: Request,
  dependencies: Dependencies & { agentId: string; versionId: string },
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    const input = reviseToolInputSchema.parse(await request.json())
    const tools =
      input.kind === 'http'
        ? await reviseHttpTool(
            dependencies.db,
            principal,
            dependencies.workspaceId,
            dependencies.agentId,
            dependencies.versionId,
            input,
          )
        : input.kind === 'openapi'
          ? await reviseOpenApiTool(
              dependencies.db,
              principal,
              dependencies.workspaceId,
              dependencies.agentId,
              dependencies.versionId,
              input,
              dependencies.fetchDocument ?? fetch,
            )
          : await reviseMcpTool(
              dependencies.db,
              principal,
              dependencies.workspaceId,
              dependencies.agentId,
              dependencies.versionId,
              input,
              dependencies.discoverMcp,
            )
    return Response.json(tools)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function deleteAgentToolHandler(
  request: Request,
  dependencies: Dependencies & { agentId: string; versionId: string },
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    return Response.json(
      await deleteTool(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        dependencies.agentId,
        dependencies.versionId,
      ),
    )
  } catch (error) {
    return errorResponse(error)
  }
}
