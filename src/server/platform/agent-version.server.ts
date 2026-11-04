import { createHash, randomUUID } from 'node:crypto'

import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import type { createDatabase } from '#/db'
import {
  agentAccessGrants,
  agentChannels,
  agentVersionCapabilities,
  agentVersions,
  agents,
  auditLogs,
  capabilities,
  capabilityVersions,
  workspaceMembers,
} from '#/db/schema'

import { manifestForDraft } from './capability.server'
import {
  emptyModuleHashes,
  moduleHashesForVersion,
} from './agent-change-status.server'
import { requireWorkspaceAccess } from './workspace-access.server'
import type { AppPrincipal } from './workspace-access.server'

type AppDatabase = ReturnType<typeof createDatabase>

export const agentDraftInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  instructions: z.string().trim().min(1).max(100_000).optional(),
  modelProvider: z.string().trim().min(1).max(80).optional(),
  modelId: z.string().trim().min(1).max(160).optional(),
  thinkingLevel: z.enum(['off', 'minimal', 'low', 'medium', 'high']).optional(),
  visibility: z.enum(['workspace', 'restricted']).optional(),
  memberUserIds: z.array(z.uuid()).max(100).optional(),
})

type AgentDraftPatch = z.infer<typeof agentDraftInputSchema>

export type AgentDraftInput = {
  name: string
  description?: string
  instructions?: string
  modelProvider?: string
  modelId?: string
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high'
  visibility?: 'workspace' | 'restricted'
}

const defaultResponsePolicy = {
  allowedParts: ['text', 'markdown'],
  maxTextLength: null,
  allowAttachments: false,
}

const defaultWorkspacePolicy = {
  workspaceMode: 'conversation',
}

function manifestHash(manifest: unknown): string {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
}

async function requireEditor(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
) {
  return requireWorkspaceAccess(db, principal, workspaceId, [
    'workspace_admin',
    'editor',
  ])
}

export async function createAgent(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  input: AgentDraftInput,
) {
  await requireEditor(db, principal, workspaceId)

  const agentId = randomUUID()
  const versionId = randomUUID()
  const now = new Date()
  const description = input.description ?? ''
  const instructions = input.instructions ?? ''
  const modelProvider = input.modelProvider ?? ''
  const modelId = input.modelId ?? ''
  const thinkingLevel = input.thinkingLevel ?? 'off'
  const manifest = {
    capabilities: [],
    prompt: instructions,
    model: {
      provider: modelProvider,
      modelId,
      thinkingLevel,
    },
  }

  db.transaction((tx) => {
    tx.insert(agents)
      .values({
        id: agentId,
        workspaceId,
        name: input.name,
        description,
        visibility: input.visibility ?? 'workspace',
        status: 'draft',
        createdBy: principal.userId,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    tx.insert(agentVersions)
      .values({
        id: versionId,
        workspaceId,
        agentId,
        versionNumber: 1,
        instructions,
        modelProvider,
        modelId,
        thinkingLevel,
        responsePolicyJson: defaultResponsePolicy,
        workspacePolicyJson: defaultWorkspacePolicy,
        manifestJson: manifest,
        manifestHash: manifestHash(manifest),
        changeBaselineJson: emptyModuleHashes(),
        status: 'draft',
        createdBy: principal.userId,
        createdAt: now,
      })
      .run()

    tx.insert(auditLogs)
      .values({
        id: randomUUID(),
        workspaceId,
        actorUserId: principal.userId,
        action: 'agent.create',
        targetType: 'agent',
        targetId: agentId,
        detailsJson: { versionId },
        createdAt: now,
      })
      .run()
  })

  return {
    id: agentId,
    workspaceId,
    name: input.name,
    description,
    status: 'draft' as const,
    visibility: input.visibility ?? 'workspace',
    draftVersionId: versionId,
  }
}

export async function updateAgentDraft(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
  patch: AgentDraftPatch,
) {
  const access = await requireEditor(db, principal, workspaceId)
  if (
    patch.memberUserIds !== undefined &&
    access.role !== 'workspace_admin' &&
    access.role !== 'platform_admin'
  ) {
    throw new Error('forbidden')
  }

  return db.transaction((tx) => {
    const agent = tx
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
      .get()
    if (!agent) throw new Error('agent not found')

    const draft = tx
      .select()
      .from(agentVersions)
      .where(
        and(
          eq(agentVersions.agentId, agentId),
          eq(agentVersions.workspaceId, workspaceId),
          eq(agentVersions.status, 'draft'),
        ),
      )
      .orderBy(desc(agentVersions.versionNumber))
      .get()
    if (!draft) throw new Error('no editable draft')

    const name = patch.name ?? agent.name
    const description = patch.description ?? agent.description
    const visibility = patch.visibility ?? agent.visibility
    const instructions = patch.instructions ?? draft.instructions
    const modelProvider = patch.modelProvider ?? draft.modelProvider
    const modelId = patch.modelId ?? draft.modelId
    const thinkingLevel = patch.thinkingLevel ?? draft.thinkingLevel
    const bindings = tx
      .select({
        runtimeName: capabilityVersions.runtimeName,
        kind: capabilities.kind,
        version: capabilityVersions.version,
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
    const nextDraft = {
      ...draft,
      instructions,
      modelProvider,
      modelId,
      thinkingLevel,
    }
    const { manifest, manifestHash: nextManifestHash } = manifestForDraft(
      nextDraft,
      bindings,
    )
    const now = new Date()

    tx.update(agents)
      .set({ name, description, visibility, updatedAt: now })
      .where(eq(agents.id, agentId))
      .run()
    tx.update(agentVersions)
      .set({
        instructions,
        modelProvider,
        modelId,
        thinkingLevel,
        manifestJson: manifest,
        manifestHash: nextManifestHash,
      })
      .where(eq(agentVersions.id, draft.id))
      .run()

    if (patch.memberUserIds !== undefined) {
      const memberUserIds = [...new Set(patch.memberUserIds)]
      if (memberUserIds.length > 0) {
        const validMembers = tx
          .select({ userId: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, workspaceId),
              inArray(workspaceMembers.userId, memberUserIds),
            ),
          )
          .all()
        if (validMembers.length !== memberUserIds.length) {
          throw new Error('invalid workspace member')
        }
      }
      tx.delete(agentAccessGrants)
        .where(eq(agentAccessGrants.agentId, agentId))
        .run()
      if (memberUserIds.length > 0) {
        tx.insert(agentAccessGrants)
          .values(
            memberUserIds.map((userId) => ({
              agentId,
              userId,
            })),
          )
          .run()
      }
    }

    return {
      ...draft,
      description,
      instructions,
      modelProvider,
      modelId,
      thinkingLevel,
    }
  })
}

export async function getAgentAccess(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
) {
  await requireWorkspaceAccess(db, principal, workspaceId, [
    'workspace_admin',
    'platform_admin',
  ])
  const agent = db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
    .get()
  if (!agent) throw new Error('agent not found')

  return {
    userIds: db
      .select({ userId: agentAccessGrants.userId })
      .from(agentAccessGrants)
      .where(eq(agentAccessGrants.agentId, agentId))
      .all()
      .map((grant) => grant.userId),
  }
}

export async function publishAgentVersion(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
) {
  await requireEditor(db, principal, workspaceId)

  return db.transaction((tx) => {
    const draft = tx
      .select()
      .from(agentVersions)
      .where(
        and(
          eq(agentVersions.agentId, agentId),
          eq(agentVersions.workspaceId, workspaceId),
          eq(agentVersions.status, 'draft'),
        ),
      )
      .orderBy(asc(agentVersions.versionNumber))
      .get()
    if (!draft) throw new Error('no editable draft')
    if (
      !draft.instructions.trim() ||
      !draft.modelProvider.trim() ||
      !draft.modelId.trim()
    ) {
      throw new Error('incomplete draft')
    }

    const publishedAt = new Date()
    const baseline = moduleHashesForVersion(
      tx as unknown as AppDatabase,
      workspaceId,
      agentId,
      draft,
    )
    const published = tx
      .update(agentVersions)
      .set({
        status: 'published',
        publishedAt,
        changeBaselineJson: baseline,
      })
      .where(eq(agentVersions.id, draft.id))
      .returning()
      .get()

    tx.update(agents)
      .set({
        status: 'active',
        currentPublishedVersionId: published.id,
        updatedAt: publishedAt,
      })
      .where(eq(agents.id, agentId))
      .run()

    tx.insert(auditLogs)
      .values({
        id: randomUUID(),
        workspaceId,
        actorUserId: principal.userId,
        action: 'agent.publish',
        targetType: 'agent_version',
        targetId: published.id,
        detailsJson: { agentId },
        createdAt: publishedAt,
      })
      .run()

    return published
  })
}

export async function createNextVersion(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
) {
  await requireEditor(db, principal, workspaceId)

  return db.transaction((tx) => {
    const agent = tx
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
      .get()

    const existingDraft = tx
      .select()
      .from(agentVersions)
      .where(
        and(
          eq(agentVersions.agentId, agentId),
          eq(agentVersions.workspaceId, workspaceId),
          eq(agentVersions.status, 'draft'),
        ),
      )
      .orderBy(desc(agentVersions.versionNumber))
      .get()
    if (existingDraft) return existingDraft

    if (!agent?.currentPublishedVersionId) {
      throw new Error('agent has no published version to copy')
    }

    const source = tx
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.id, agent.currentPublishedVersionId))
      .get()
    if (!source) throw new Error('published version not found')

    const latest = tx
      .select({ versionNumber: agentVersions.versionNumber })
      .from(agentVersions)
      .where(eq(agentVersions.agentId, agentId))
      .orderBy(desc(agentVersions.versionNumber))
      .get()

    const now = new Date()
    const baseline = moduleHashesForVersion(
      tx as unknown as AppDatabase,
      workspaceId,
      agentId,
      source,
    )
    const next = tx
      .insert(agentVersions)
      .values({
        id: randomUUID(),
        workspaceId,
        agentId,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        instructions: source.instructions,
        modelProvider: source.modelProvider,
        modelId: source.modelId,
        thinkingLevel: source.thinkingLevel,
        responsePolicyJson: source.responsePolicyJson,
        workspacePolicyJson: source.workspacePolicyJson,
        manifestJson: source.manifestJson,
        manifestHash: source.manifestHash,
        changeBaselineJson: baseline,
        status: 'draft',
        createdBy: principal.userId,
        createdAt: now,
      })
      .returning()
      .get()

    const sourceBindings = tx
      .select()
      .from(agentVersionCapabilities)
      .where(eq(agentVersionCapabilities.agentVersionId, source.id))
      .all()
    if (sourceBindings.length > 0) {
      tx.insert(agentVersionCapabilities)
        .values(
          sourceBindings.map((binding) => ({
            workspaceId: binding.workspaceId,
            agentVersionId: next.id,
            capabilityVersionId: binding.capabilityVersionId,
            enabled: binding.enabled,
            configJson: binding.configJson,
            sortOrder: binding.sortOrder,
            createdAt: now,
          })),
        )
        .run()
    }

    tx.update(agents)
      .set({ status: 'draft', updatedAt: now })
      .where(eq(agents.id, agentId))
      .run()

    return next
  })
}

export async function listAgents(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
) {
  const access = await requireWorkspaceAccess(db, principal, workspaceId, [
    'workspace_admin',
    'editor',
    'user',
  ])

  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.workspaceId, workspaceId))
    .orderBy(desc(agents.updatedAt))
    .all()

  if (access.role !== 'user') return rows

  const grants = await db
    .select({ agentId: agentAccessGrants.agentId })
    .from(agentAccessGrants)
    .where(eq(agentAccessGrants.userId, principal.userId))
    .all()
  const granted = new Set(grants.map((grant) => grant.agentId))

  return rows.filter(
    (agent) => agent.visibility === 'workspace' || granted.has(agent.id),
  )
}

export async function getAgent(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
) {
  const access = await requireWorkspaceAccess(db, principal, workspaceId, [
    'workspace_admin',
    'editor',
    'user',
  ])

  const agent = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
    .get()
  if (!agent) throw new Error('agent not found')

  if (access.role === 'user' && agent.visibility === 'restricted') {
    const grant = await db
      .select()
      .from(agentAccessGrants)
      .where(
        and(
          eq(agentAccessGrants.agentId, agentId),
          eq(agentAccessGrants.userId, principal.userId),
        ),
      )
      .get()
    if (!grant) throw new Error('agent not found')
  }

  const versions = await db
    .select()
    .from(agentVersions)
    .where(eq(agentVersions.agentId, agentId))
    .orderBy(desc(agentVersions.versionNumber))
    .all()

  const channels = await db
    .select({ channel: agentChannels.channel, enabled: agentChannels.enabled })
    .from(agentChannels)
    .where(eq(agentChannels.agentId, agentId))
    .all()
  const enabledChannels: Array<'web' | 'infoflow'> = [
    'web',
    ...channels
      .filter((channel) => channel.enabled && channel.channel === 'infoflow')
      .map((channel) => channel.channel),
  ]

  return { ...agent, versions, enabledChannels }
}
