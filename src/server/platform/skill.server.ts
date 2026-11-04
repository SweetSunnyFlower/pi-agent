import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'

import { and, asc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import type { createDatabase } from '#/db'
import {
  agentVersionCapabilities,
  agentVersions,
  auditLogs,
  capabilities,
  capabilityVersions,
} from '#/db/schema'
import {
  installSkillPackage,
  MAX_SKILL_PACKAGE_BYTES,
  readSkillPackage,
  removeInstalledSkillPackage,
} from '#/server/skills/skill-package.server'

import { deleteCapability, manifestForDraft } from './capability.server'
import { requireWorkspaceAccess } from './workspace-access.server'
import type { AppPrincipal } from './workspace-access.server'

type AppDatabase = ReturnType<typeof createDatabase>
type SkillSource = 'builtin' | 'workspace'

export type SkillCatalogItem = {
  id: string
  versionId: string
  name: string
  description: string
  source: SkillSource
  version: string
  runtimeName: string
  content: string
  packagePath?: string
  files?: Array<{
    path: string
    size: number
    sha256: string
  }>
  selected: boolean
  sortOrder?: number
}

export const createSkillInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  content: z.string().trim().min(1).max(50_000),
})

export const replaceSkillsInputSchema = z.object({
  capabilityVersionIds: z.array(z.uuid()).max(100),
})

function emptyObjectSchema() {
  return {
    type: 'object',
    properties: {},
    additionalProperties: false,
  }
}

function skillSlug(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const fallback = createHash('sha1')
    .update(name.trim())
    .digest('hex')
    .slice(0, 12)
  return normalized || `skill-${fallback}`
}

function skillContent(definition: unknown): string {
  if (
    definition &&
    typeof definition === 'object' &&
    'content' in definition &&
    typeof (definition as Record<string, unknown>).content === 'string'
  ) {
    return (definition as Record<string, string>).content
  }
  return ''
}

function skillPackageMetadata(definition: unknown): {
  packagePath?: string
  files?: SkillCatalogItem['files']
} {
  if (!definition || typeof definition !== 'object') return {}
  const record = definition as Record<string, unknown>
  const packagePath =
    typeof record.packagePath === 'string' ? record.packagePath : undefined
  const files = Array.isArray(record.files)
    ? record.files.flatMap((file) => {
        if (!file || typeof file !== 'object') return []
        const value = file as Record<string, unknown>
        if (
          typeof value.path !== 'string' ||
          typeof value.size !== 'number' ||
          typeof value.sha256 !== 'string'
        ) {
          return []
        }
        return [
          {
            path: value.path,
            size: value.size,
            sha256: value.sha256,
          },
        ]
      })
    : undefined
  return {
    ...(packagePath ? { packagePath } : {}),
    ...(files ? { files } : {}),
  }
}

async function requireEditor(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
): Promise<void> {
  await requireWorkspaceAccess(db, principal, workspaceId, [
    'workspace_admin',
    'editor',
  ])
}

function draftForAgent(db: AppDatabase, workspaceId: string, agentId: string) {
  const draft = db
    .select()
    .from(agentVersions)
    .where(
      and(
        eq(agentVersions.agentId, agentId),
        eq(agentVersions.workspaceId, workspaceId),
        eq(agentVersions.status, 'draft'),
      ),
    )
    .get()
  if (!draft) throw new Error('no editable draft')
  return draft
}

export async function createSkill(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  input: z.infer<typeof createSkillInputSchema>,
): Promise<SkillCatalogItem> {
  await requireEditor(db, principal, workspaceId)
  const parsed = createSkillInputSchema.parse(input)
  const capabilityId = randomUUID()
  const versionId = randomUUID()
  const slug = skillSlug(parsed.name)
  const version = '1.0.0'
  const runtimeName = `platform.skill.workspace.${slug}@${version}`
  const now = new Date()

  try {
    db.transaction((tx) => {
      tx.insert(capabilities)
        .values({
          id: capabilityId,
          workspaceId,
          kind: 'skill',
          slug,
          createdBy: principal.userId,
          createdAt: now,
        })
        .run()
      tx.insert(capabilityVersions)
        .values({
          id: versionId,
          workspaceId,
          capabilityId,
          version,
          name: parsed.name,
          description: parsed.description,
          source: 'workspace',
          runtimeName,
          inputSchemaJson: emptyObjectSchema(),
          configSchemaJson: emptyObjectSchema(),
          definitionJson: {
            kind: 'skill',
            content: parsed.content,
          },
          status: 'active',
          createdBy: principal.userId,
          createdAt: now,
        })
        .run()
      tx.insert(auditLogs)
        .values({
          id: randomUUID(),
          workspaceId,
          actorUserId: principal.userId,
          action: 'capability.create',
          targetType: 'capability_version',
          targetId: versionId,
          detailsJson: {
            capabilityId,
            kind: 'skill',
            source: 'workspace',
          },
          createdAt: now,
        })
        .run()
    })
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLocaleLowerCase().includes('unique')
    ) {
      throw new Error('capability already exists')
    }
    throw error
  }

  return {
    id: capabilityId,
    versionId,
    name: parsed.name,
    description: parsed.description,
    source: 'workspace',
    version,
    runtimeName,
    content: parsed.content,
    selected: false,
  }
}

export async function createSkillPackageFromArchive(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  archive: Uint8Array,
  skillsRoot: string,
): Promise<SkillCatalogItem> {
  await requireEditor(db, principal, workspaceId)
  if (archive.byteLength > MAX_SKILL_PACKAGE_BYTES) {
    throw new Error('invalid skill package: archive exceeds the 10 MB limit')
  }
  const parsed = readSkillPackage(archive)
  const existing = db
    .select({ id: capabilities.id })
    .from(capabilities)
    .where(
      and(
        eq(capabilities.workspaceId, workspaceId),
        eq(capabilities.kind, 'skill'),
        eq(capabilities.slug, parsed.slug),
      ),
    )
    .get()
  if (existing) throw new Error('capability already exists')

  const installed = await installSkillPackage(
    parsed,
    join(skillsRoot, workspaceId),
  )
  const packagePath = `${workspaceId}/${installed.packagePath}`
  const capabilityId = randomUUID()
  const versionId = randomUUID()
  const version = '1.0.0'
  const runtimeName = `platform.skill.workspace.${parsed.slug}@${version}`
  const now = new Date()
  try {
    db.transaction((tx) => {
      tx.insert(capabilities)
        .values({
          id: capabilityId,
          workspaceId,
          kind: 'skill',
          slug: parsed.slug,
          createdBy: principal.userId,
          createdAt: now,
        })
        .run()
      tx.insert(capabilityVersions)
        .values({
          id: versionId,
          workspaceId,
          capabilityId,
          version,
          name: parsed.name,
          description: parsed.description,
          source: 'workspace',
          runtimeName,
          inputSchemaJson: emptyObjectSchema(),
          configSchemaJson: emptyObjectSchema(),
          definitionJson: {
            kind: 'skill',
            entrypoint: parsed.entrypoint,
            content: parsed.content,
            packagePath,
            files: installed.files,
          },
          status: 'active',
          createdBy: principal.userId,
          createdAt: now,
        })
        .run()
      tx.insert(auditLogs)
        .values({
          id: randomUUID(),
          workspaceId,
          actorUserId: principal.userId,
          action: 'capability.create',
          targetType: 'capability_version',
          targetId: versionId,
          detailsJson: {
            capabilityId,
            kind: 'skill',
            source: 'workspace',
            packagePath,
          },
          createdAt: now,
        })
        .run()
    })
  } catch (error) {
    await removeInstalledSkillPackage(packagePath, skillsRoot)
    if (
      error instanceof Error &&
      error.message.toLocaleLowerCase().includes('unique')
    ) {
      throw new Error('capability already exists')
    }
    throw error
  }

  return {
    id: capabilityId,
    versionId,
    name: parsed.name,
    description: parsed.description,
    source: 'workspace',
    version,
    runtimeName,
    content: parsed.content,
    packagePath,
    files: installed.files,
    selected: false,
  }
}

function listSkillCatalog(
  db: AppDatabase,
  workspaceId: string,
  agentVersionId: string,
): SkillCatalogItem[] {
  const rows = db
    .select({
      id: capabilities.id,
      capabilityId: capabilities.id,
      versionId: capabilityVersions.id,
      name: capabilityVersions.name,
      description: capabilityVersions.description,
      source: capabilityVersions.source,
      status: capabilityVersions.status,
      version: capabilityVersions.version,
      runtimeName: capabilityVersions.runtimeName,
      definitionJson: capabilityVersions.definitionJson,
    })
    .from(capabilityVersions)
    .innerJoin(
      capabilities,
      eq(capabilityVersions.capabilityId, capabilities.id),
    )
    .where(
      and(
        eq(capabilityVersions.workspaceId, workspaceId),
        eq(capabilities.kind, 'skill'),
      ),
    )
    .orderBy(asc(capabilityVersions.name))
    .all()

  const bindingRows = db
    .select({
      capabilityVersionId: agentVersionCapabilities.capabilityVersionId,
      sortOrder: agentVersionCapabilities.sortOrder,
    })
    .from(agentVersionCapabilities)
    .where(eq(agentVersionCapabilities.agentVersionId, agentVersionId))
    .all()
  const bindings = new Map(
    bindingRows.map((binding) => [
      binding.capabilityVersionId,
      binding.sortOrder,
    ]),
  )

  const grouped = new Map<string, typeof rows>()
  for (const row of rows) {
    const versions = grouped.get(row.capabilityId) ?? []
    versions.push(row)
    grouped.set(row.capabilityId, versions)
  }
  const displayed = [...grouped.values()]
    .map((versions) => {
      const selectedVersion = versions
        .filter((row) => bindings.has(row.versionId))
        .sort((left, right) => left.version.localeCompare(right.version))
        .at(-1)
      const activeVersion = versions
        .filter((row) => row.status === 'active')
        .sort((left, right) => left.version.localeCompare(right.version))
        .at(-1)
      return selectedVersion ?? activeVersion
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))

  return displayed
    .map((row) => {
      const packageMetadata = skillPackageMetadata(row.definitionJson)
      return {
        id: row.id,
        versionId: row.versionId,
        name: row.name,
        description: row.description,
        source: row.source as SkillSource,
        version: row.version,
        runtimeName: row.runtimeName,
        content: skillContent(row.definitionJson),
        ...packageMetadata,
        selected: bindings.has(row.versionId),
        sortOrder: bindings.get(row.versionId),
      }
    })
    .sort((left, right) => {
      if (left.selected && right.selected) {
        return (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
      }
      if (left.selected) return -1
      if (right.selected) return 1
      return left.name.localeCompare(right.name, 'zh-CN')
    })
}

async function requireCatalogAccess(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
): Promise<void> {
  await requireWorkspaceAccess(db, principal, workspaceId, [
    'workspace_admin',
    'editor',
    'user',
  ])
}

export async function listSkillsForDraft(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
): Promise<SkillCatalogItem[]> {
  await requireCatalogAccess(db, principal, workspaceId)
  const draft = draftForAgent(db, workspaceId, agentId)
  return listSkillCatalog(db, workspaceId, draft.id)
}

export async function listSkillsForVersion(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
  versionId: string,
): Promise<SkillCatalogItem[]> {
  await requireCatalogAccess(db, principal, workspaceId)
  const version = db
    .select({ id: agentVersions.id })
    .from(agentVersions)
    .where(
      and(
        eq(agentVersions.id, versionId),
        eq(agentVersions.agentId, agentId),
        eq(agentVersions.workspaceId, workspaceId),
      ),
    )
    .get()
  if (!version) throw new Error('agent version not found')
  return listSkillCatalog(db, workspaceId, version.id)
}

export async function deleteSkill(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
  versionId: string,
): Promise<SkillCatalogItem[]> {
  await deleteCapability(db, principal, workspaceId, 'skill', versionId)
  return listSkillsForDraft(db, principal, workspaceId, agentId)
}

export async function replaceDraftSkills(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
  input: z.infer<typeof replaceSkillsInputSchema>,
): Promise<SkillCatalogItem[]> {
  await requireEditor(db, principal, workspaceId)
  const draft = draftForAgent(db, workspaceId, agentId)
  const versionIds = [...new Set(input.capabilityVersionIds)]

  const validVersions =
    versionIds.length === 0
      ? []
      : db
          .select({ id: capabilityVersions.id })
          .from(capabilityVersions)
          .innerJoin(
            capabilities,
            eq(capabilityVersions.capabilityId, capabilities.id),
          )
          .where(
            and(
              eq(capabilityVersions.workspaceId, workspaceId),
              eq(capabilities.kind, 'skill'),
              eq(capabilityVersions.status, 'active'),
              inArray(capabilityVersions.id, versionIds),
            ),
          )
          .all()
  if (validVersions.length !== versionIds.length) {
    throw new Error('invalid capability')
  }

  db.transaction((tx) => {
    const existingSkillVersions = tx
      .select({ id: capabilityVersions.id })
      .from(agentVersionCapabilities)
      .innerJoin(
        capabilityVersions,
        eq(agentVersionCapabilities.capabilityVersionId, capabilityVersions.id),
      )
      .innerJoin(
        capabilities,
        eq(capabilityVersions.capabilityId, capabilities.id),
      )
      .where(
        and(
          eq(agentVersionCapabilities.agentVersionId, draft.id),
          eq(capabilities.kind, 'skill'),
        ),
      )
      .all()

    if (existingSkillVersions.length > 0) {
      tx.delete(agentVersionCapabilities)
        .where(
          and(
            eq(agentVersionCapabilities.agentVersionId, draft.id),
            inArray(
              agentVersionCapabilities.capabilityVersionId,
              existingSkillVersions.map((version) => version.id),
            ),
          ),
        )
        .run()
    }

    versionIds.forEach((capabilityVersionId, index) => {
      tx.insert(agentVersionCapabilities)
        .values({
          workspaceId,
          agentVersionId: draft.id,
          capabilityVersionId,
          enabled: true,
          configJson: {},
          sortOrder: index,
          createdAt: new Date(),
        })
        .run()
    })

    const bindings = tx
      .select({
        runtimeName: capabilityVersions.runtimeName,
        version: capabilityVersions.version,
        kind: capabilities.kind,
        sortOrder: agentVersionCapabilities.sortOrder,
      })
      .from(agentVersionCapabilities)
      .innerJoin(
        capabilityVersions,
        eq(agentVersionCapabilities.capabilityVersionId, capabilityVersions.id),
      )
      .innerJoin(
        capabilities,
        eq(capabilityVersions.capabilityId, capabilities.id),
      )
      .where(eq(agentVersionCapabilities.agentVersionId, draft.id))
      .orderBy(asc(agentVersionCapabilities.sortOrder))
      .all()

    const { manifest, manifestHash } = manifestForDraft(draft, bindings)
    tx.update(agentVersions)
      .set({ manifestJson: manifest, manifestHash })
      .where(eq(agentVersions.id, draft.id))
      .run()

    tx.insert(auditLogs)
      .values({
        id: randomUUID(),
        workspaceId,
        actorUserId: principal.userId,
        action: 'agent_version.capabilities.replace',
        targetType: 'agent_version',
        targetId: draft.id,
        detailsJson: { kind: 'skill', capabilityVersionIds: versionIds },
        createdAt: new Date(),
      })
      .run()
  })

  return listSkillsForDraft(db, principal, workspaceId, agentId)
}
