import { randomUUID } from 'node:crypto'

import { and, eq } from 'drizzle-orm'

import type { createDatabase } from '#/db'
import { users, workspaceMembers, workspaces } from '#/db/schema'
import type { Identity } from '#/server/auth/types.server'
import type { ServerEnv } from '#/server/env.server'

type AppDatabase = ReturnType<typeof createDatabase>

export type WorkspaceRole =
  'platform_admin' | 'workspace_admin' | 'editor' | 'user'

export type WorkspaceAccess = {
  workspaceId: string
  slug: string
  name: string
  role: WorkspaceRole
}

export type AppPrincipal = {
  userId: string
  username: string
  name: string | null
  email: string | null
  expiresAt: number
  authMode: Identity['authMode']
  workspaces: WorkspaceAccess[]
}

export const INITIAL_WORKSPACE_SLUG = 'fde'
export const INITIAL_WORKSPACE_NAME = '数字人FDE组'

export type WorkspaceProvisionInput = {
  slug: string
  name: string
  adminUsername: string
  renameFromSlug?: string
}

export class ForbiddenError extends Error {
  constructor() {
    super('forbidden')
  }
}

export function createWorkspace(
  db: AppDatabase,
  input: WorkspaceProvisionInput,
) {
  const slug = input.slug.trim()
  const name = input.name.trim()
  const username = input.adminUsername.trim()
  if (!slug || !name || !username) {
    throw new Error('workspace slug, name, and admin username are required')
  }
  const userId = randomUUID()
  const workspaceId = randomUUID()

  return db.transaction((tx) => {
    const existingUser = tx
      .select()
      .from(users)
      .where(eq(users.username, username))
      .get()

    const storedUser =
      existingUser ??
      tx
        .insert(users)
        .values({
          id: userId,
          username,
          name: username,
        })
        .returning()
        .get()

    const existingWorkspace = tx
      .select()
      .from(workspaces)
      .where(eq(workspaces.slug, slug))
      .get()

    let storedWorkspace = existingWorkspace
    if (!storedWorkspace && input.renameFromSlug) {
      const legacyWorkspace = tx
        .select()
        .from(workspaces)
        .where(eq(workspaces.slug, input.renameFromSlug))
        .get()
      if (legacyWorkspace) {
        storedWorkspace = tx
          .update(workspaces)
          .set({ slug, name })
          .where(eq(workspaces.id, legacyWorkspace.id))
          .returning()
          .get()
      }
    }
    if (!storedWorkspace) {
      storedWorkspace = tx
        .insert(workspaces)
        .values({
          id: workspaceId,
          slug,
          name,
        })
        .returning()
        .get()
    } else if (existingWorkspace?.name !== name) {
      storedWorkspace = tx
        .update(workspaces)
        .set({ name })
        .where(eq(workspaces.id, storedWorkspace.id))
        .returning()
        .get()
    }

    const membership = tx
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, storedWorkspace.id),
          eq(workspaceMembers.userId, storedUser.id),
        ),
      )
      .get()

    if (!membership) {
      tx.insert(workspaceMembers)
        .values({
          workspaceId: storedWorkspace.id,
          userId: storedUser.id,
          role: 'workspace_admin',
        })
        .run()
    } else if (membership.role !== 'workspace_admin') {
      tx.update(workspaceMembers)
        .set({ role: 'workspace_admin' })
        .where(
          and(
            eq(workspaceMembers.workspaceId, storedWorkspace.id),
            eq(workspaceMembers.userId, storedUser.id),
          ),
        )
        .run()
    }

    return {
      workspaceId: storedWorkspace.id,
      slug: storedWorkspace.slug,
      name: storedWorkspace.name,
      userId: storedUser.id,
      username: storedUser.username,
      role: 'workspace_admin' as const,
    }
  })
}

export async function ensureDevelopmentSeed(
  db: AppDatabase,
  env: ServerEnv,
): Promise<void> {
  if (env.AUTH_MODE !== 'development' || !env.DEV_AUTH_USERNAME) return
  createWorkspace(db, {
    slug: INITIAL_WORKSPACE_SLUG,
    name: INITIAL_WORKSPACE_NAME,
    adminUsername: env.DEV_AUTH_USERNAME,
    renameFromSlug: 'default',
  })
}

export async function resolvePrincipal(
  db: AppDatabase,
  identity: Identity,
  _env: ServerEnv,
): Promise<AppPrincipal | null> {
  const user = await db
    .select()
    .from(users)
    .where(eq(users.username, identity.username))
    .get()
  if (!user) return null

  const access = await db
    .select({
      workspaceId: workspaces.id,
      slug: workspaces.slug,
      name: workspaces.name,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, user.id))
    .all()

  return {
    userId: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    expiresAt: identity.expiresAt,
    authMode: identity.authMode,
    workspaces: access,
  }
}

export async function requireWorkspaceAccess(
  db: AppDatabase,
  principal: AppPrincipal | null,
  workspaceId: string,
  allowedRoles: readonly WorkspaceRole[],
): Promise<WorkspaceAccess> {
  if (!principal) throw new ForbiddenError()

  const access = await db
    .select({
      workspaceId: workspaces.id,
      slug: workspaces.slug,
      name: workspaces.name,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceMembers.userId, principal.userId),
        eq(workspaceMembers.workspaceId, workspaceId),
      ),
    )
    .get()

  if (!access || !allowedRoles.includes(access.role)) {
    throw new ForbiddenError()
  }

  return access
}
