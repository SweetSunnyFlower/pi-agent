import { randomUUID } from 'node:crypto'

import { and, desc, eq } from 'drizzle-orm'
import { SignJWT, jwtVerify } from 'jose'
import { z } from 'zod'

import type { createDatabase } from '#/db'
import { agentApiTokens, agents, auditLogs, users } from '#/db/schema'

import { requireWorkspaceAccess } from './workspace-access.server'
import type { AppPrincipal } from './workspace-access.server'

type AppDatabase = ReturnType<typeof createDatabase>

const OPEN_API_AUDIENCE = 'pi-agent:open-api'
const OPEN_API_ALGORITHM = 'HS256'
const dayMs = 24 * 60 * 60 * 1000

export const agentApiTokenInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  username: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{1,64}$/),
  expiresInDays: z.union([
    z.literal(30),
    z.literal(90),
    z.literal(365),
    z.null(),
  ]),
})

export type AgentApiTokenSummary = {
  id: string
  name: string
  username: string
  createdAt: string
  expiresAt: string | null
  revokedAt: string | null
  lastUsedAt: string | null
}

export type OpenApiCaller = {
  tokenId: string
  workspaceId: string
  agentId: string
  userId: string
  username: string
}

const managerRoles = ['platform_admin', 'workspace_admin'] as const

function summary(
  row: typeof agentApiTokens.$inferSelect,
): AgentApiTokenSummary {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }
}

function requireAgent(db: AppDatabase, workspaceId: string, agentId: string) {
  const agent = db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
    .get()
  if (!agent) throw new Error('agent not found')
  return agent
}

function secretKey(secret: string) {
  return new TextEncoder().encode(secret)
}

export async function listAgentApiTokens(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
): Promise<AgentApiTokenSummary[]> {
  await requireWorkspaceAccess(db, principal, workspaceId, managerRoles)
  requireAgent(db, workspaceId, agentId)
  return db
    .select()
    .from(agentApiTokens)
    .where(
      and(
        eq(agentApiTokens.workspaceId, workspaceId),
        eq(agentApiTokens.agentId, agentId),
      ),
    )
    .orderBy(desc(agentApiTokens.createdAt))
    .all()
    .map(summary)
}

export async function createAgentApiToken(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
  input: unknown,
  secret: string,
  now = new Date(),
): Promise<{ token: string; record: AgentApiTokenSummary }> {
  await requireWorkspaceAccess(db, principal, workspaceId, managerRoles)
  requireAgent(db, workspaceId, agentId)
  const parsed = agentApiTokenInputSchema.parse(input)
  const id = randomUUID()
  const expiresAt =
    parsed.expiresInDays === null
      ? null
      : new Date(now.getTime() + parsed.expiresInDays * dayMs)

  const jwt = new SignJWT({ wid: workspaceId, aid: agentId })
    .setProtectedHeader({ alg: OPEN_API_ALGORITHM, typ: 'JWT' })
    .setSubject(parsed.username)
    .setJti(id)
    .setAudience(OPEN_API_AUDIENCE)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
  if (expiresAt) jwt.setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
  const token = await jwt.sign(secretKey(secret))

  const row = db.transaction((tx) => {
    const created = tx
      .insert(agentApiTokens)
      .values({
        id,
        workspaceId,
        agentId,
        name: parsed.name,
        username: parsed.username,
        createdBy: principal.userId,
        createdAt: now,
        expiresAt,
      })
      .returning()
      .get()
    tx.insert(auditLogs)
      .values({
        id: randomUUID(),
        workspaceId,
        actorUserId: principal.userId,
        action: 'agent_api_token.create',
        targetType: 'agent',
        targetId: agentId,
        detailsJson: {
          tokenId: id,
          name: parsed.name,
          username: parsed.username,
          expiresAt: expiresAt?.toISOString() ?? null,
        },
      })
      .run()
    return created
  })

  return { token, record: summary(row) }
}

export async function revokeAgentApiToken(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
  tokenId: string,
  now = new Date(),
): Promise<AgentApiTokenSummary> {
  await requireWorkspaceAccess(db, principal, workspaceId, managerRoles)
  const row = db
    .select()
    .from(agentApiTokens)
    .where(
      and(
        eq(agentApiTokens.id, tokenId),
        eq(agentApiTokens.workspaceId, workspaceId),
        eq(agentApiTokens.agentId, agentId),
      ),
    )
    .get()
  if (!row) throw new Error('token not found')
  if (row.revokedAt) return summary(row)

  const updated = db.transaction((tx) => {
    const revoked = tx
      .update(agentApiTokens)
      .set({ revokedAt: now })
      .where(eq(agentApiTokens.id, tokenId))
      .returning()
      .get()
    tx.insert(auditLogs)
      .values({
        id: randomUUID(),
        workspaceId,
        actorUserId: principal.userId,
        action: 'agent_api_token.revoke',
        targetType: 'agent',
        targetId: agentId,
        detailsJson: { tokenId },
      })
      .run()
    return revoked
  })
  return summary(updated)
}

function ensureUser(db: AppDatabase, username: string) {
  db.insert(users)
    .values({ id: randomUUID(), username, name: username })
    .onConflictDoNothing({ target: users.username })
    .run()
  return db.select().from(users).where(eq(users.username, username)).get()!
}

export async function authenticateOpenApiToken(
  db: AppDatabase,
  token: string,
  secret: string,
  now = new Date(),
): Promise<OpenApiCaller | null> {
  let claims: { jti?: string; sub?: string; wid?: unknown; aid?: unknown }
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), {
      algorithms: [OPEN_API_ALGORITHM],
      audience: OPEN_API_AUDIENCE,
      requiredClaims: ['jti', 'sub'],
      currentDate: now,
    })
    claims = payload
  } catch {
    return null
  }

  const row = claims.jti
    ? db
        .select()
        .from(agentApiTokens)
        .where(eq(agentApiTokens.id, claims.jti))
        .get()
    : undefined
  if (
    !row ||
    row.revokedAt ||
    (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) ||
    row.username !== claims.sub ||
    row.workspaceId !== claims.wid ||
    row.agentId !== claims.aid
  ) {
    return null
  }

  const user = ensureUser(db, row.username)
  db.update(agentApiTokens)
    .set({ lastUsedAt: now })
    .where(eq(agentApiTokens.id, row.id))
    .run()

  return {
    tokenId: row.id,
    workspaceId: row.workspaceId,
    agentId: row.agentId,
    userId: user.id,
    username: user.username,
  }
}
