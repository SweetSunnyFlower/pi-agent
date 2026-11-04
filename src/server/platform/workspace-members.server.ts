import { randomUUID } from 'node:crypto'

import { and, asc, eq } from 'drizzle-orm'

import type { createDatabase } from '#/db'
import { users, workspaceMembers } from '#/db/schema'
import {
  requireWorkspaceAccess,
} from '#/server/platform/workspace-access.server'
import type {
  AppPrincipal,
  WorkspaceRole,
} from '#/server/platform/workspace-access.server'

type AppDatabase = ReturnType<typeof createDatabase>

export type WorkspaceMemberRecord = {
  userId: string
  username: string
  name: string | null
  email: string | null
  role: WorkspaceRole
  createdAt: Date
}

export type SaveWorkspaceMemberInput = {
  username: string
  role: WorkspaceRole
}

async function requireWorkspaceAdmin(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
) {
  return requireWorkspaceAccess(db, principal, workspaceId, [
    'workspace_admin',
    'platform_admin',
  ])
}

export async function listWorkspaceMembers(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
): Promise<WorkspaceMemberRecord[]> {
  await requireWorkspaceAdmin(db, principal, workspaceId)
  return db
    .select({
      userId: users.id,
      username: users.username,
      name: users.name,
      email: users.email,
      role: workspaceMembers.role,
      createdAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembers.createdAt), asc(users.username))
    .all()
}

export async function saveWorkspaceMember(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  input: SaveWorkspaceMemberInput,
): Promise<WorkspaceMemberRecord> {
  await requireWorkspaceAdmin(db, principal, workspaceId)
  const username = input.username.trim()
  if (!username) throw new Error('username is required')

  return db.transaction((tx) => {
    const storedUser =
      tx.select().from(users).where(eq(users.username, username)).get() ??
      tx
        .insert(users)
        .values({
          id: randomUUID(),
          username,
          name: username,
        })
        .returning()
        .get()

    const existing = tx
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, storedUser.id),
        ),
      )
      .get()

    const membership = existing
      ? tx
          .update(workspaceMembers)
          .set({ role: input.role })
          .where(
            and(
              eq(workspaceMembers.workspaceId, workspaceId),
              eq(workspaceMembers.userId, storedUser.id),
            ),
          )
          .returning()
          .get()
      : tx
          .insert(workspaceMembers)
          .values({
            workspaceId,
            userId: storedUser.id,
            role: input.role,
          })
          .returning()
          .get()

    return {
      userId: storedUser.id,
      username: storedUser.username,
      name: storedUser.name,
      email: storedUser.email,
      role: membership.role,
      createdAt: membership.createdAt,
    }
  })
}

export async function removeWorkspaceMember(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  userId: string,
): Promise<void> {
  await requireWorkspaceAdmin(db, principal, workspaceId)
  db.transaction((tx) => {
    const membership = tx
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .get()
    if (!membership) throw new Error('workspace member not found')

    if (membership.role === 'workspace_admin') {
      const adminCount = tx
        .select()
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.role, 'workspace_admin'),
          ),
        )
        .all().length
      if (adminCount <= 1) {
        throw new Error('cannot remove the last workspace administrator')
      }
    }

    tx.delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .run()
  })
}
