import { z } from 'zod'

import type { createDatabase } from '#/db'
import { authenticateRequest } from '#/server/auth/authenticate.server'
import type { ServerEnv } from '#/server/env.server'
import {
  createSkill,
  createSkillPackageFromArchive,
  createSkillInputSchema,
  deleteSkill,
  listSkillsForDraft,
  listSkillsForVersion,
  replaceDraftSkills,
  replaceSkillsInputSchema,
} from '#/server/platform/skill.server'
import { resolvePrincipal } from '#/server/platform/workspace-access.server'
import type { AppPrincipal } from '#/server/platform/workspace-access.server'

type Dependencies = {
  db: ReturnType<typeof createDatabase>
  env: ServerEnv
  workspaceId: string
  agentId?: string
  versionId?: string
  skillsRoot?: string
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
  if (error instanceof Error && error.message === 'invalid capability') {
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
  return Response.json({ error: 'internal_error' }, { status: 500 })
}

export async function createSkillHandler(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    const input = createSkillInputSchema.parse(await request.json())
    return Response.json(
      await createSkill(
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

export async function uploadSkillPackageHandler(
  request: Request,
  dependencies: Dependencies & { skillsRoot: string },
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    const form = await request.formData()
    const file = form.get('file')
    if (
      !(file instanceof File) ||
      !file.name.toLocaleLowerCase().endsWith('.zip')
    ) {
      return Response.json(
        {
          error: 'invalid_skill_package',
          message: '请上传 .zip 格式的 Skill 包。',
        },
        { status: 400 },
      )
    }
    const archive = new Uint8Array(await file.arrayBuffer())
    return Response.json(
      await createSkillPackageFromArchive(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        archive,
        dependencies.skillsRoot,
      ),
      { status: 201 },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.startsWith('invalid skill package')) {
      return Response.json(
        { error: 'invalid_skill_package', message },
        { status: 400 },
      )
    }
    if (
      message === 'skill package already exists' ||
      message === 'capability already exists'
    ) {
      return Response.json(
        { error: 'capability_exists', message },
        { status: 409 },
      )
    }
    return errorResponse(error)
  }
}

export async function listAgentSkillsHandler(
  request: Request,
  dependencies: Dependencies & { agentId: string; versionId?: string },
): Promise<Response> {
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    return Response.json(
      dependencies.versionId
        ? await listSkillsForVersion(
            dependencies.db,
            principal,
            dependencies.workspaceId,
            dependencies.agentId,
            dependencies.versionId,
          )
        : await listSkillsForDraft(
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

export async function replaceAgentSkillsHandler(
  request: Request,
  dependencies: Dependencies & { agentId: string },
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    const input = replaceSkillsInputSchema.parse(await request.json())
    return Response.json(
      await replaceDraftSkills(
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

export async function deleteAgentSkillHandler(
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
      await deleteSkill(
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
