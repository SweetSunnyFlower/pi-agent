import { createHash, randomUUID } from 'node:crypto'

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

import { requireWorkspaceAccess } from './workspace-access.server'
import type { AppPrincipal } from './workspace-access.server'

type AppDatabase = ReturnType<typeof createDatabase>
type ToolSource = 'builtin' | 'http' | 'openapi' | 'mcp'

export type ToolDefinitionInput = {
  name: string
  description: string
  source: 'http' | 'openapi' | 'mcp'
  slug: string
  inputSchema: Record<string, unknown>
  configSchema: Record<string, unknown>
  definition: Record<string, unknown>
  runtimeName?: string
}

export type ToolCatalogItem = {
  id: string
  versionId: string
  name: string
  description: string
  source: ToolSource
  version: string
  runtimeName: string
  method?: string
  endpoint?: string
  inputSchema: Record<string, unknown>
  definition: Record<string, unknown>
  selected: boolean
}

export type ToolVersionContent = {
  name: string
  description: string
  source: 'http' | 'openapi' | 'mcp'
  inputSchema: Record<string, unknown>
  configSchema: Record<string, unknown>
  definition: Record<string, unknown>
}

const inputSchema = z.record(z.string(), z.unknown())

export const httpToolInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  endpoint: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
  inputSchema: inputSchema.default({
    type: 'object',
    properties: {},
    additionalProperties: false,
  }),
})

export const replaceToolsInputSchema = z.object({
  capabilityVersionIds: z.array(z.uuid()).max(100),
})

type HttpToolInput = z.infer<typeof httpToolInputSchema>

function manifestHash(manifest: unknown): string {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
}

export function normalizeToolSlug(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const fallback = createHash('sha1')
    .update(value.trim())
    .digest('hex')
    .slice(0, 12)
  return normalized || `tool-${fallback}`
}

function definitionValue(definition: unknown, key: string): string | undefined {
  if (
    definition &&
    typeof definition === 'object' &&
    key in definition &&
    typeof (definition as Record<string, unknown>)[key] === 'string'
  ) {
    return (definition as Record<string, string>)[key]
  }
  return undefined
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0
    const rightPart = rightParts[index] ?? 0
    if (Number.isNaN(leftPart) || Number.isNaN(rightPart)) {
      return left.localeCompare(right, undefined, { numeric: true })
    }
    if (leftPart !== rightPart) return leftPart - rightPart
  }
  return 0
}

function nextPatchVersion(version: string): string {
  const parts = version.split('.')
  if (parts.length === 3 && parts.every((part) => /^\d+$/.test(part))) {
    return `${Number(parts[0])}.${Number(parts[1])}.${Number(parts[2]) + 1}`
  }
  return '1.0.1'
}

function nextRuntimeName(
  runtimeName: string,
  currentVersion: string,
  nextVersion: string,
): string {
  const suffix = `@${currentVersion}`
  return runtimeName.endsWith(suffix)
    ? `${runtimeName.slice(0, -suffix.length)}@${nextVersion}`
    : `${runtimeName}@${nextVersion}`
}

function emptyObjectSchema() {
  return {
    type: 'object',
    properties: {},
    additionalProperties: false,
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

export async function createToolVersions(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  definitions: ToolDefinitionInput[],
): Promise<ToolCatalogItem[]> {
  await requireWorkspaceAccess(db, principal, workspaceId, [
    'platform_admin',
    'workspace_admin',
  ])
  if (definitions.length === 0) return []

  const uniqueSlugs = new Set(definitions.map((definition) => definition.slug))
  if (uniqueSlugs.size !== definitions.length) {
    throw new Error('capability already exists')
  }

  const version = '1.0.0'
  const created = definitions.map((definition) => ({
    ...definition,
    capabilityId: randomUUID(),
    versionId: randomUUID(),
    runtimeName:
      definition.runtimeName ??
      `platform.tool.${definition.source}.${definition.slug}@${version}`,
  }))

  try {
    db.transaction((tx) => {
      const now = new Date()
      for (const tool of created) {
        tx.insert(capabilities)
          .values({
            id: tool.capabilityId,
            workspaceId,
            kind: 'tool',
            slug: tool.slug,
            createdBy: principal.userId,
            createdAt: now,
          })
          .run()
        tx.insert(capabilityVersions)
          .values({
            id: tool.versionId,
            workspaceId,
            capabilityId: tool.capabilityId,
            version,
            name: tool.name,
            description: tool.description,
            source: tool.source,
            runtimeName: tool.runtimeName,
            inputSchemaJson: tool.inputSchema,
            configSchemaJson: tool.configSchema,
            definitionJson: tool.definition,
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
            targetId: tool.versionId,
            detailsJson: {
              capabilityId: tool.capabilityId,
              kind: 'tool',
              source: tool.source,
            },
            createdAt: now,
          })
          .run()
      }
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

  return created.map((tool) => ({
    id: tool.capabilityId,
    versionId: tool.versionId,
    name: tool.name,
    description: tool.description,
    source: tool.source,
    version,
    runtimeName: tool.runtimeName,
    method: definitionValue(tool.definition, 'method'),
    endpoint: definitionValue(tool.definition, 'endpoint'),
    inputSchema: tool.inputSchema,
    definition: tool.definition,
    selected: false,
  }))
}

export async function createHttpTool(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  input: HttpToolInput,
): Promise<ToolCatalogItem> {
  const parsed = httpToolInputSchema.parse(input)
  const endpoint = new URL(parsed.endpoint)
  if (!['http:', 'https:'].includes(endpoint.protocol)) {
    throw new Error('invalid tool endpoint')
  }

  const [tool] = await createToolVersions(db, principal, workspaceId, [
    {
      name: parsed.name,
      description: parsed.description,
      source: 'http',
      slug: normalizeToolSlug(parsed.name),
      inputSchema: parsed.inputSchema,
      configSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      definition: {
        kind: 'http',
        endpoint: endpoint.toString(),
        method: parsed.method,
      },
    },
  ])
  return tool
}

export async function createToolVersionRevision(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
  versionId: string,
  content: ToolVersionContent,
): Promise<ToolCatalogItem[]> {
  await requireWorkspaceAccess(db, principal, workspaceId, [
    'platform_admin',
    'workspace_admin',
  ])
  const current = db
    .select({
      capabilityId: capabilityVersions.capabilityId,
      version: capabilityVersions.version,
      source: capabilityVersions.source,
      runtimeName: capabilityVersions.runtimeName,
    })
    .from(capabilityVersions)
    .where(
      and(
        eq(capabilityVersions.id, versionId),
        eq(capabilityVersions.workspaceId, workspaceId),
      ),
    )
    .get()
  if (!current || current.source !== content.source) {
    throw new Error('invalid capability')
  }
  const draft = draftForAgent(db, workspaceId, agentId)
  const bindings = db
    .select({
      capabilityVersionId: agentVersionCapabilities.capabilityVersionId,
    })
    .from(agentVersionCapabilities)
    .where(eq(agentVersionCapabilities.agentVersionId, draft.id))
    .orderBy(asc(agentVersionCapabilities.sortOrder))
    .all()
  const versions = db
    .select({ version: capabilityVersions.version })
    .from(capabilityVersions)
    .where(eq(capabilityVersions.capabilityId, current.capabilityId))
    .all()
  const latestVersion = versions
    .map((row) => row.version)
    .sort(compareVersions)
    .at(-1)
  const nextVersion = nextPatchVersion(
    latestVersion && compareVersions(latestVersion, current.version) > 0
      ? latestVersion
      : current.version,
  )
  const newVersionId = randomUUID()

  db.transaction((tx) => {
    const now = new Date()
    tx.insert(capabilityVersions)
      .values({
        id: newVersionId,
        workspaceId,
        capabilityId: current.capabilityId,
        version: nextVersion,
        name: content.name,
        description: content.description,
        source: content.source,
        runtimeName: nextRuntimeName(
          current.runtimeName,
          current.version,
          nextVersion,
        ),
        inputSchemaJson: content.inputSchema,
        configSchemaJson: content.configSchema,
        definitionJson: content.definition,
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
        action: 'capability.version.create',
        targetType: 'capability_version',
        targetId: newVersionId,
        detailsJson: {
          capabilityId: current.capabilityId,
          previousVersionId: versionId,
          version: nextVersion,
        },
        createdAt: now,
      })
      .run()
  })

  const boundVersionIds = bindings.map((binding) => binding.capabilityVersionId)
  if (boundVersionIds.includes(versionId)) {
    await replaceDraftTools(db, principal, workspaceId, agentId, {
      capabilityVersionIds: boundVersionIds.map((id) =>
        id === versionId ? newVersionId : id,
      ),
    })
  }
  return listToolsForDraft(db, principal, workspaceId, agentId)
}

export async function reviseHttpTool(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
  versionId: string,
  input: z.infer<typeof httpToolInputSchema>,
): Promise<ToolCatalogItem[]> {
  const parsed = httpToolInputSchema.parse(input)
  const endpoint = new URL(parsed.endpoint)
  if (!['http:', 'https:'].includes(endpoint.protocol)) {
    throw new Error('invalid tool endpoint')
  }
  return createToolVersionRevision(
    db,
    principal,
    workspaceId,
    agentId,
    versionId,
    {
      name: parsed.name,
      description: parsed.description,
      source: 'http',
      inputSchema: parsed.inputSchema,
      configSchema: emptyObjectSchema(),
      definition: {
        kind: 'http',
        endpoint: endpoint.toString(),
        method: parsed.method,
      },
    },
  )
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

function listToolCatalog(
  db: AppDatabase,
  workspaceId: string,
  agentVersionId: string,
): ToolCatalogItem[] {
  const selected = new Set(
    db
      .select({
        capabilityVersionId: agentVersionCapabilities.capabilityVersionId,
      })
      .from(agentVersionCapabilities)
      .where(eq(agentVersionCapabilities.agentVersionId, agentVersionId))
      .all()
      .map((binding) => binding.capabilityVersionId),
  )
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
      inputSchemaJson: capabilityVersions.inputSchemaJson,
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
        eq(capabilities.kind, 'tool'),
      ),
    )
    .all()

  const grouped = new Map<string, typeof rows>()
  for (const row of rows) {
    const versions = grouped.get(row.capabilityId) ?? []
    versions.push(row)
    grouped.set(row.capabilityId, versions)
  }
  const displayed = [...grouped.values()]
    .map((versions) => {
      const selectedVersion = versions
        .filter((row) => selected.has(row.versionId))
        .sort((left, right) => compareVersions(left.version, right.version))
        .at(-1)
      const activeVersion = versions
        .filter((row) => row.status === 'active')
        .sort((left, right) => compareVersions(left.version, right.version))
        .at(-1)
      return selectedVersion ?? activeVersion
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))

  return displayed
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((row) => ({
      id: row.id,
      versionId: row.versionId,
      name: row.name,
      description: row.description,
      source: row.source as ToolSource,
      version: row.version,
      runtimeName: row.runtimeName,
      method: definitionValue(row.definitionJson, 'method'),
      endpoint: definitionValue(row.definitionJson, 'endpoint'),
      inputSchema: row.inputSchemaJson as Record<string, unknown>,
      definition: row.definitionJson as Record<string, unknown>,
      selected: selected.has(row.versionId),
    }))
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

export async function listToolsForDraft(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
): Promise<ToolCatalogItem[]> {
  await requireCatalogAccess(db, principal, workspaceId)
  const draft = draftForAgent(db, workspaceId, agentId)
  return listToolCatalog(db, workspaceId, draft.id)
}

export async function listToolsForVersion(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
  versionId: string,
): Promise<ToolCatalogItem[]> {
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
  return listToolCatalog(db, workspaceId, version.id)
}

export async function replaceDraftTools(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
  input: z.infer<typeof replaceToolsInputSchema>,
): Promise<ToolCatalogItem[]> {
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
              eq(capabilities.kind, 'tool'),
              eq(capabilityVersions.status, 'active'),
              inArray(capabilityVersions.id, versionIds),
            ),
          )
          .all()
  if (validVersions.length !== versionIds.length) {
    throw new Error('invalid capability')
  }

  db.transaction((tx) => {
    const existingToolVersions = tx
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
          eq(capabilities.kind, 'tool'),
        ),
      )
      .all()

    if (existingToolVersions.length > 0) {
      tx.delete(agentVersionCapabilities)
        .where(
          and(
            eq(agentVersionCapabilities.agentVersionId, draft.id),
            inArray(
              agentVersionCapabilities.capabilityVersionId,
              existingToolVersions.map((version) => version.id),
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

    const manifest = {
      capabilities: bindings.map((binding) => ({
        runtimeName: binding.runtimeName,
        kind: binding.kind,
        version: binding.version,
      })),
      prompt: draft.instructions,
      model: {
        provider: draft.modelProvider,
        modelId: draft.modelId,
        thinkingLevel: draft.thinkingLevel,
      },
    }

    tx.update(agentVersions)
      .set({
        manifestJson: manifest,
        manifestHash: manifestHash(manifest),
      })
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
        detailsJson: { kind: 'tool', capabilityVersionIds: versionIds },
        createdAt: new Date(),
      })
      .run()
  })

  return listToolsForDraft(db, principal, workspaceId, agentId)
}

export async function deleteCapability(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  kind: 'tool' | 'skill',
  versionId: string,
): Promise<string[]> {
  await requireWorkspaceAccess(db, principal, workspaceId, [
    'platform_admin',
    'workspace_admin',
  ])
  const selected = db
    .select({
      capabilityId: capabilities.id,
      source: capabilityVersions.source,
    })
    .from(capabilityVersions)
    .innerJoin(
      capabilities,
      eq(capabilityVersions.capabilityId, capabilities.id),
    )
    .where(
      and(
        eq(capabilityVersions.id, versionId),
        eq(capabilityVersions.workspaceId, workspaceId),
        eq(capabilities.kind, kind),
      ),
    )
    .get()
  if (!selected || selected.source === 'builtin') {
    throw new Error('invalid capability')
  }
  const versions = db
    .select({ id: capabilityVersions.id })
    .from(capabilityVersions)
    .where(eq(capabilityVersions.capabilityId, selected.capabilityId))
    .all()
  const versionIds = versions.map((version) => version.id)
  const drafts = db
    .select()
    .from(agentVersions)
    .where(
      and(
        eq(agentVersions.workspaceId, workspaceId),
        eq(agentVersions.status, 'draft'),
      ),
    )
    .all()
  const draftIds = drafts.map((draft) => draft.id)
  const draftBindings =
    draftIds.length === 0
      ? []
      : db
          .select({
            agentVersionId: agentVersionCapabilities.agentVersionId,
          })
          .from(agentVersionCapabilities)
          .where(
            and(
              inArray(agentVersionCapabilities.agentVersionId, draftIds),
              inArray(agentVersionCapabilities.capabilityVersionId, versionIds),
            ),
          )
          .all()
  const affectedDraftIds = [
    ...new Set(draftBindings.map((binding) => binding.agentVersionId)),
  ]

  db.transaction((tx) => {
    if (affectedDraftIds.length > 0) {
      tx.delete(agentVersionCapabilities)
        .where(
          and(
            inArray(agentVersionCapabilities.agentVersionId, affectedDraftIds),
            inArray(agentVersionCapabilities.capabilityVersionId, versionIds),
          ),
        )
        .run()
    }
    tx.update(capabilityVersions)
      .set({ status: 'disabled' })
      .where(eq(capabilityVersions.capabilityId, selected.capabilityId))
      .run()

    for (const draft of drafts.filter((item) =>
      affectedDraftIds.includes(item.id),
    )) {
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
          eq(
            agentVersionCapabilities.capabilityVersionId,
            capabilityVersions.id,
          ),
        )
        .innerJoin(
          capabilities,
          eq(capabilityVersions.capabilityId, capabilities.id),
        )
        .where(eq(agentVersionCapabilities.agentVersionId, draft.id))
        .orderBy(asc(agentVersionCapabilities.sortOrder))
        .all()
      const next = manifestForDraft(draft, bindings)
      tx.update(agentVersions)
        .set({
          manifestJson: next.manifest,
          manifestHash: next.manifestHash,
        })
        .where(eq(agentVersions.id, draft.id))
        .run()
    }
    tx.insert(auditLogs)
      .values({
        id: randomUUID(),
        workspaceId,
        actorUserId: principal.userId,
        action: 'capability.delete',
        targetType: 'capability',
        targetId: selected.capabilityId,
        detailsJson: { kind, versionId, affectedDraftIds },
        createdAt: new Date(),
      })
      .run()
  })
  return affectedDraftIds
}

export async function deleteTool(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
  versionId: string,
): Promise<ToolCatalogItem[]> {
  await deleteCapability(db, principal, workspaceId, 'tool', versionId)
  return listToolsForDraft(db, principal, workspaceId, agentId)
}

export function manifestForDraft(
  draft: typeof agentVersions.$inferSelect,
  bindings: Array<{ runtimeName: string; kind: string; version: string }>,
) {
  const manifest = {
    capabilities: bindings,
    prompt: draft.instructions,
    model: {
      provider: draft.modelProvider,
      modelId: draft.modelId,
      thinkingLevel: draft.thinkingLevel,
    },
  }
  return {
    manifest,
    manifestHash: manifestHash(manifest),
  }
}
