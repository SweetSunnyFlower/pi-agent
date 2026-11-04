import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { eq } from 'drizzle-orm'
import { strToU8, zipSync } from 'fflate'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '#/db'
import { agentVersionCapabilities, agentVersions } from '#/db/schema'
import { parseServerEnv } from '#/server/env.server'

import {
  createAgent,
  createNextVersion,
  publishAgentVersion,
  updateAgentDraft,
} from './agent-version.server'
import { createHttpTool, replaceDraftTools } from './capability.server'
import {
  createSkill,
  createSkillPackageFromArchive,
  deleteSkill,
  listSkillsForDraft,
  listSkillsForVersion,
  replaceDraftSkills,
} from './skill.server'
import {
  ensureDevelopmentSeed,
  resolvePrincipal,
} from './workspace-access.server'

const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  APP_DATABASE_PATH: ':memory:',
  CHANNEL_SECRET_KEK: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
})

describe('Skill service', () => {
  let db: ReturnType<typeof createDatabase>
  let principal: Awaited<ReturnType<typeof resolvePrincipal>>
  let workspaceId: string
  let skillsRoot: string

  beforeEach(async () => {
    db = createDatabase(':memory:')
    migrate(db, { migrationsFolder: './drizzle' })
    await ensureDevelopmentSeed(db, env)
    principal = await resolvePrincipal(
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
    skillsRoot = await mkdtemp(join(tmpdir(), 'pi-skills-test-'))
  })

  afterEach(async () => {
    db.$client.close()
    await rm(skillsRoot, { recursive: true, force: true })
  })

  async function createDraftAgent() {
    const agent = await createAgent(db, principal!, workspaceId, {
      name: `Reviewer ${Math.random()}`,
      instructions: 'Review changes.',
      modelProvider: 'oneapi-comate',
      modelId: 'DeepSeek-V4-Pro',
      thinkingLevel: 'high',
    })
    return agent.id
  }

  it('creates versioned Skills and preserves their selected order', async () => {
    const agentId = await createDraftAgent()
    const first = await createSkill(db, principal!, workspaceId, {
      name: 'Security review',
      description: 'Review security boundaries.',
      content: 'Check authorization boundaries before release.',
    })
    const second = await createSkill(db, principal!, workspaceId, {
      name: 'Risk review',
      description: 'Review delivery risks.',
      content: 'List blocking risks and owners.',
    })

    await replaceDraftSkills(db, principal!, workspaceId, agentId, {
      capabilityVersionIds: [second.versionId, first.versionId],
    })

    const skills = await listSkillsForDraft(
      db,
      principal!,
      workspaceId,
      agentId,
    )
    expect(skills).toEqual([
      expect.objectContaining({
        versionId: second.versionId,
        selected: true,
        sortOrder: 0,
      }),
      expect.objectContaining({
        versionId: first.versionId,
        selected: true,
        sortOrder: 1,
      }),
    ])
    expect(first.runtimeName).toMatch(/^platform\.skill\.workspace\./)
  })

  it('installs a validated Skill ZIP package on disk and in the catalog', async () => {
    const archive = zipSync({
      'SKILL.md': strToU8(
        [
          '---',
          'name: security-review',
          'description: Review changes for security risks.',
          '---',
          '',
          '# Security review',
          '',
          'Check authorization boundaries.',
        ].join('\n'),
      ),
      'references/checklist.md': strToU8('- Verify ownership'),
    })

    const skill = await createSkillPackageFromArchive(
      db,
      principal!,
      workspaceId,
      archive,
      skillsRoot,
    )

    expect(skill).toMatchObject({
      name: 'security-review',
      description: 'Review changes for security risks.',
      content: expect.stringContaining('Check authorization boundaries.'),
      selected: false,
    })
    await expect(
      readFile(
        join(skillsRoot, workspaceId, 'security-review', 'SKILL.md'),
        'utf8',
      ),
    ).resolves.toContain('Check authorization boundaries.')
    await expect(
      readFile(
        join(
          skillsRoot,
          workspaceId,
          'security-review',
          'references',
          'checklist.md',
        ),
        'utf8',
      ),
    ).resolves.toBe('- Verify ownership')
  })

  it('does not install an invalid Skill package', async () => {
    const archive = zipSync({
      'README.md': strToU8('Missing SKILL.md'),
    })

    await expect(
      createSkillPackageFromArchive(
        db,
        principal!,
        workspaceId,
        archive,
        skillsRoot,
      ),
    ).rejects.toThrow(/SKILL\.md/)
    await expect(
      readFile(
        join(skillsRoot, workspaceId, 'security-review', 'SKILL.md'),
        'utf8',
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps tool bindings when Skills are replaced', async () => {
    const agentId = await createDraftAgent()
    const tool = await createHttpTool(db, principal!, workspaceId, {
      name: 'Issue Search',
      description: 'Search issues.',
      endpoint: 'https://api.example.com/issues',
      method: 'GET',
      inputSchema: { type: 'object', properties: {} },
    })
    const skill = await createSkill(db, principal!, workspaceId, {
      name: 'Issue method',
      description: 'Search method.',
      content: 'Search before summarizing.',
    })
    await replaceDraftTools(db, principal!, workspaceId, agentId, {
      capabilityVersionIds: [tool.versionId],
    })
    await replaceDraftSkills(db, principal!, workspaceId, agentId, {
      capabilityVersionIds: [skill.versionId],
    })

    await updateAgentDraft(db, principal!, workspaceId, agentId, {
      instructions: 'Updated prompt.',
    })

    const bindings = db.select().from(agentVersionCapabilities).all()
    expect(bindings.map((binding) => binding.capabilityVersionId)).toEqual(
      expect.arrayContaining([tool.versionId, skill.versionId]),
    )
    const draft = db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.agentId, agentId))
      .get()
    expect(draft?.manifestJson).toEqual(
      expect.objectContaining({
        capabilities: expect.arrayContaining([
          expect.objectContaining({ kind: 'tool' }),
          expect.objectContaining({
            kind: 'skill',
            runtimeName: skill.runtimeName,
          }),
        ]),
        prompt: 'Updated prompt.',
      }),
    )
  })

  it('keeps Skill bindings on the published version', async () => {
    const agentId = await createDraftAgent()
    const skill = await createSkill(db, principal!, workspaceId, {
      name: 'Release method',
      description: 'Release checks.',
      content: 'Confirm rollback steps.',
    })
    await replaceDraftSkills(db, principal!, workspaceId, agentId, {
      capabilityVersionIds: [skill.versionId],
    })

    const published = await publishAgentVersion(
      db,
      principal!,
      workspaceId,
      agentId,
    )
    const bindings = db
      .select()
      .from(agentVersionCapabilities)
      .where(eq(agentVersionCapabilities.agentVersionId, published.id))
      .all()

    expect(bindings).toEqual([
      expect.objectContaining({ capabilityVersionId: skill.versionId }),
    ])
  })

  it('lists Skill order from a published version independently of the draft', async () => {
    const agentId = await createDraftAgent()
    const publishedSkill = await createSkill(db, principal!, workspaceId, {
      name: 'Published method',
      description: 'Published content.',
      content: 'Use the published method.',
    })
    await replaceDraftSkills(db, principal!, workspaceId, agentId, {
      capabilityVersionIds: [publishedSkill.versionId],
    })
    const published = await publishAgentVersion(
      db,
      principal!,
      workspaceId,
      agentId,
    )
    await createNextVersion(db, principal!, workspaceId, agentId)
    const draftSkill = await createSkill(db, principal!, workspaceId, {
      name: 'Draft method',
      description: 'Draft content.',
      content: 'Use the draft method.',
    })
    await replaceDraftSkills(db, principal!, workspaceId, agentId, {
      capabilityVersionIds: [draftSkill.versionId],
    })

    const publishedCatalog = await listSkillsForVersion(
      db,
      principal!,
      workspaceId,
      agentId,
      published.id,
    )
    const draftCatalog = await listSkillsForDraft(
      db,
      principal!,
      workspaceId,
      agentId,
    )

    expect(
      publishedCatalog.find(
        (item) => item.versionId === publishedSkill.versionId,
      )?.selected,
    ).toBe(true)
    expect(
      publishedCatalog.find((item) => item.versionId === draftSkill.versionId)
        ?.selected,
    ).toBe(false)
    expect(
      draftCatalog.find((item) => item.versionId === publishedSkill.versionId)
        ?.selected,
    ).toBe(false)
    expect(
      draftCatalog.find((item) => item.versionId === draftSkill.versionId)
        ?.selected,
    ).toBe(true)
  })

  it('removes a Skill from drafts while retaining published references', async () => {
    const agentId = await createDraftAgent()
    const skill = await createSkill(db, principal!, workspaceId, {
      name: 'Delete method',
      description: 'Temporary method.',
      content: 'This skill will be removed.',
    })
    await replaceDraftSkills(db, principal!, workspaceId, agentId, {
      capabilityVersionIds: [skill.versionId],
    })
    const published = await publishAgentVersion(
      db,
      principal!,
      workspaceId,
      agentId,
    )
    await createNextVersion(db, principal!, workspaceId, agentId)

    await deleteSkill(db, principal!, workspaceId, agentId, skill.versionId)

    await expect(
      listSkillsForDraft(db, principal!, workspaceId, agentId),
    ).resolves.toEqual([])
    await expect(
      listSkillsForVersion(db, principal!, workspaceId, agentId, published.id),
    ).resolves.toEqual([
      expect.objectContaining({
        versionId: skill.versionId,
        selected: true,
      }),
    ])
  })
})
