import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { strToU8, zipSync } from 'fflate'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '#/db'
import { parseServerEnv } from '#/server/env.server'
import { createAgent } from '#/server/platform/agent-version.server'
import {
  ensureDevelopmentSeed,
  resolvePrincipal,
} from '#/server/platform/workspace-access.server'

import {
  createSkillHandler,
  deleteAgentSkillHandler,
  listAgentSkillsHandler,
  replaceAgentSkillsHandler,
  uploadSkillPackageHandler,
} from './skill-http.server'

const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  APP_DATABASE_PATH: ':memory:',
  CHANNEL_SECRET_KEK: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
})

function request(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('Skill HTTP services', () => {
  let db: ReturnType<typeof createDatabase>
  let workspaceId: string
  let agentId: string
  let skillsRoot: string

  beforeEach(async () => {
    db = createDatabase(':memory:')
    migrate(db, { migrationsFolder: './drizzle' })
    await ensureDevelopmentSeed(db, env)
    const principal = await resolvePrincipal(
      db,
      {
        username: 'alice',
        name: null,
        email: null,
        expiresAt: Date.now() + 60_000,
        authMode: 'development',
      },
      env,
    )
    workspaceId = principal!.workspaces[0].workspaceId
    const agent = await createAgent(db, principal!, workspaceId, {
      name: 'Reviewer',
      instructions: 'Review changes.',
      modelProvider: 'oneapi-comate',
      modelId: 'DeepSeek-V4-Pro',
      thinkingLevel: 'high',
    })
    agentId = agent.id
    skillsRoot = await mkdtemp(join(tmpdir(), 'pi-skills-http-test-'))
  })

  afterEach(async () => {
    db.$client.close()
    await rm(skillsRoot, { recursive: true, force: true })
  })

  it('creates, binds, and lists ordered Skills', async () => {
    const createResponse = await createSkillHandler(
      request(
        `http://localhost:3000/api/workspaces/${workspaceId}/capabilities/skills`,
        'POST',
        {
          name: 'Security review',
          description: 'Check security boundaries.',
          content: 'Review authorization before release.',
        },
      ),
      { db, env, workspaceId },
    )
    expect(createResponse.status).toBe(201)
    const skill = (await createResponse.json()) as {
      versionId: string
      selected: boolean
    }
    expect(skill.selected).toBe(false)

    const replaceResponse = await replaceAgentSkillsHandler(
      request(
        `http://localhost:3000/api/agents/${agentId}/draft/skills?workspaceId=${workspaceId}`,
        'PUT',
        { capabilityVersionIds: [skill.versionId] },
      ),
      { db, env, workspaceId, agentId },
    )
    expect(replaceResponse.status).toBe(200)

    const listResponse = await listAgentSkillsHandler(
      request(
        `http://localhost:3000/api/agents/${agentId}/draft/skills?workspaceId=${workspaceId}`,
        'GET',
      ),
      { db, env, workspaceId, agentId },
    )
    expect(listResponse.status).toBe(200)
    await expect(listResponse.json()).resolves.toEqual([
      expect.objectContaining({
        name: 'Security review',
        selected: true,
        sortOrder: 0,
      }),
    ])
  })

  it('uploads, validates, and installs a Skill ZIP package', async () => {
    const archive = zipSync({
      'skill/SKILL.md': strToU8(
        [
          '---',
          'name: security-review',
          'description: Review changes for security risks.',
          '---',
          '',
          'Check authorization boundaries.',
        ].join('\n'),
      ),
      'skill/references/checklist.md': strToU8('- Verify ownership'),
    })
    const form = new FormData()
    form.set(
      'file',
      new File([archive], 'security-review.zip', { type: 'application/zip' }),
    )
    const response = await uploadSkillPackageHandler(
      new Request(
        `http://localhost:3000/api/workspaces/${workspaceId}/capabilities/skills/package`,
        {
          method: 'POST',
          headers: { origin: 'http://localhost:3000' },
          body: form,
        },
      ),
      { db, env, workspaceId, skillsRoot },
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      name: 'security-review',
      description: 'Review changes for security risks.',
    })
  })

  it('returns the Skill validation error from an invalid ZIP package', async () => {
    const archive = zipSync({ 'README.md': strToU8('Missing SKILL.md') })
    const form = new FormData()
    form.set(
      'file',
      new File([archive], 'invalid.zip', { type: 'application/zip' }),
    )

    const response = await uploadSkillPackageHandler(
      new Request(
        `http://localhost:3000/api/workspaces/${workspaceId}/capabilities/skills/package`,
        {
          method: 'POST',
          headers: { origin: 'http://localhost:3000' },
          body: form,
        },
      ),
      { db, env, workspaceId, skillsRoot },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'invalid_skill_package',
      message: expect.stringContaining('SKILL.md'),
    })
  })

  it('deletes a Skill from the Agent draft catalog', async () => {
    const createResponse = await createSkillHandler(
      request(
        `http://localhost:3000/api/workspaces/${workspaceId}/capabilities/skills`,
        'POST',
        {
          name: 'Delete Skill',
          description: 'Temporary Skill.',
          content: 'Temporary instructions.',
        },
      ),
      { db, env, workspaceId },
    )
    const skill = (await createResponse.json()) as { versionId: string }

    const response = await deleteAgentSkillHandler(
      request(
        `http://localhost:3000/api/agents/${agentId}/draft/skills/${skill.versionId}?workspaceId=${workspaceId}`,
        'DELETE',
      ),
      { db, env, workspaceId, agentId, versionId: skill.versionId },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([])
  })
})
