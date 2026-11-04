import { randomUUID } from 'node:crypto'

import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'

import type { createDatabase } from '#/db'
import { aiProviders } from '#/db/schema'
import type {
  SealedSecret,
  SecretBox,
} from '#/server/secrets/secret-box.server'

import { requireWorkspaceAccess } from './workspace-access.server'
import type { AppPrincipal } from './workspace-access.server'

type AppDatabase = ReturnType<typeof createDatabase>
export type AiProviderRow = typeof aiProviders.$inferSelect
export type ProviderModelFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>

const modelsResponseSchema = z.object({
  data: z.array(z.object({ id: z.string().trim().min(1) })),
})

export const aiProviderInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().trim().url().max(500),
  token: z.string().trim().min(1).max(4000).optional(),
  enabled: z.boolean(),
})

export type AiProviderRecord = {
  id: string
  name: string
  baseUrl: string
  tokenMasked: string
  enabled: boolean
  lastTestedAt?: string
  createdAt: string
  updatedAt: string
}

export class AiProviderTestError extends Error {
  constructor(readonly code: 'provider_unavailable' | 'invalid_response') {
    super(code)
    this.name = 'AiProviderTestError'
  }
}

function providerAad(providerId: string): string {
  return `ai_provider:${providerId}`
}

function maskToken(token: string): string {
  if (token.length < 8) return '••••'
  return `${token.slice(0, 3)}••••${token.slice(-4)}`
}

export function openAiProviderToken(
  provider: Pick<AiProviderRow, 'id' | 'tokenJson'>,
  box: SecretBox,
): string {
  return box.open(provider.tokenJson as SealedSecret, providerAad(provider.id))
}

function toRecord(provider: AiProviderRow, box: SecretBox): AiProviderRecord {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    tokenMasked: maskToken(openAiProviderToken(provider, box)),
    enabled: provider.enabled,
    ...(provider.lastTestedAt
      ? { lastTestedAt: provider.lastTestedAt.toISOString() }
      : {}),
    createdAt: provider.createdAt.toISOString(),
    updatedAt: provider.updatedAt.toISOString(),
  }
}

export async function listAiProviders(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  box: SecretBox,
): Promise<AiProviderRecord[]> {
  await requireWorkspaceAccess(db, principal, workspaceId, [
    'platform_admin',
    'workspace_admin',
  ])
  return db
    .select()
    .from(aiProviders)
    .where(eq(aiProviders.workspaceId, workspaceId))
    .orderBy(asc(aiProviders.createdAt))
    .all()
    .map((provider) => toRecord(provider, box))
}

export async function listEnabledAiProviders(
  db: AppDatabase,
  workspaceId?: string,
) {
  const where = workspaceId
    ? and(
        eq(aiProviders.workspaceId, workspaceId),
        eq(aiProviders.enabled, true),
      )
    : eq(aiProviders.enabled, true)
  return db
    .select()
    .from(aiProviders)
    .where(where)
    .orderBy(asc(aiProviders.createdAt))
    .all()
}

export async function saveAiProvider(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  input: z.infer<typeof aiProviderInputSchema>,
  box: SecretBox,
  options: { providerId?: string; explicitId?: string } = {},
): Promise<AiProviderRecord> {
  await requireWorkspaceAccess(db, principal, workspaceId, [
    'platform_admin',
    'workspace_admin',
  ])
  const parsed = aiProviderInputSchema.parse(input)
  const now = new Date()

  if (options.providerId) {
    const existing = db
      .select()
      .from(aiProviders)
      .where(
        and(
          eq(aiProviders.id, options.providerId),
          eq(aiProviders.workspaceId, workspaceId),
        ),
      )
      .get()
    if (!existing) throw new Error('provider not found')
    const tokenJson = parsed.token
      ? box.seal(parsed.token, providerAad(existing.id))
      : existing.tokenJson
    db.update(aiProviders)
      .set({
        name: parsed.name,
        baseUrl: parsed.baseUrl.replace(/\/+$/, ''),
        tokenJson,
        enabled: parsed.enabled,
        updatedAt: now,
      })
      .where(eq(aiProviders.id, existing.id))
      .run()
    const updated = db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.id, existing.id))
      .get()
    if (!updated) throw new Error('provider not found')
    return toRecord(updated, box)
  }

  if (!parsed.token) throw new Error('provider token is required')
  const providerId = options.explicitId ?? randomUUID()
  const tokenJson = box.seal(parsed.token, providerAad(providerId))
  db.insert(aiProviders)
    .values({
      id: providerId,
      workspaceId,
      name: parsed.name,
      baseUrl: parsed.baseUrl.replace(/\/+$/, ''),
      tokenJson,
      enabled: parsed.enabled,
      createdBy: principal.userId,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  const created = db
    .select()
    .from(aiProviders)
    .where(eq(aiProviders.id, providerId))
    .get()
  if (!created) throw new Error('provider was not stored')
  return toRecord(created, box)
}

export async function markAiProviderTested(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  providerId: string,
  testedAt: Date,
): Promise<void> {
  await requireWorkspaceAccess(db, principal, workspaceId, [
    'platform_admin',
    'workspace_admin',
  ])
  db.update(aiProviders)
    .set({ lastTestedAt: testedAt, updatedAt: testedAt })
    .where(
      and(
        eq(aiProviders.id, providerId),
        eq(aiProviders.workspaceId, workspaceId),
      ),
    )
    .run()
}

export async function fetchAiProviderModels(
  provider: Pick<AiProviderRow, 'id' | 'baseUrl' | 'tokenJson'>,
  box: SecretBox,
  fetchModels: ProviderModelFetch = fetch,
): Promise<string[]> {
  let response: Response
  try {
    response = await fetchModels(
      `${provider.baseUrl.replace(/\/+$/, '')}/models`,
      {
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${openAiProviderToken(provider, box)}`,
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      },
    )
  } catch {
    throw new AiProviderTestError('provider_unavailable')
  }
  if (!response.ok) {
    throw new AiProviderTestError('provider_unavailable')
  }
  const parsed = modelsResponseSchema.safeParse(
    await response.json().catch(() => null),
  )
  if (!parsed.success) {
    throw new AiProviderTestError('invalid_response')
  }

  return [...new Set(parsed.data.data.map((model) => model.id.trim()))].filter(
    Boolean,
  )
}

export async function testAiProvider(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  providerId: string,
  box: SecretBox,
  fetchModels: ProviderModelFetch = fetch,
): Promise<{ modelCount: number }> {
  await requireWorkspaceAccess(db, principal, workspaceId, [
    'platform_admin',
    'workspace_admin',
  ])
  const provider = db
    .select()
    .from(aiProviders)
    .where(
      and(
        eq(aiProviders.id, providerId),
        eq(aiProviders.workspaceId, workspaceId),
      ),
    )
    .get()
  if (!provider) throw new Error('provider not found')
  const models = await fetchAiProviderModels(provider, box, fetchModels)
  await markAiProviderTested(db, principal, workspaceId, providerId, new Date())
  return { modelCount: models.length }
}
