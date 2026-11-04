import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '#/db'
import {
  agentAccessGrants,
  agentVersions,
  agents,
  users,
  workspaceMembers,
} from '#/db/schema'
import { parseServerEnv } from '#/server/env.server'

import {
  createAgent,
  createNextVersion,
  listAgents,
  publishAgentVersion,
  updateAgentDraft,
} from './agent-version.server'
import {
  ensureDevelopmentSeed,
  resolvePrincipal,
} from './workspace-access.server'
import type { AppPrincipal } from './workspace-access.server'

const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  APP_DATABASE_PATH: ':memory:',
  CHANNEL_SECRET_KEK: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
})

describe('agent versions', () => {
  let db: ReturnType<typeof createDatabase>
  let principal: AppPrincipal
  let workspaceId: string

  beforeEach(async () => {
    db = createDatabase(':memory:')
    migrate(db, { migrationsFolder: './drizzle' })
    await ensureDevelopmentSeed(db, env)
    const resolved = await resolvePrincipal(
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
    if (!resolved) throw new Error('development principal was not resolved')
    principal = resolved
    workspaceId = principal.workspaces[0].workspaceId
  })

  afterEach(() => {
    db.$client.close()
  })

  it('creates a draft Agent and version 1', async () => {
    const created = await createAgent(db, principal, workspaceId, {
      name: 'Reviewer',
      instructions: 'Review changes.',
      modelProvider: 'openai',
      modelId: 'gpt-6.1-sol',
      thinkingLevel: 'high',
    })

    expect(created.status).toBe('draft')
    const version = db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.agentId, created.id))
      .get()
    expect(version?.versionNumber).toBe(1)
  })

  it('creates an incomplete draft from the minimal creation flow', async () => {
    const created = await createAgent(db, principal, workspaceId, {
      name: 'Reviewer',
      description: 'Reviews product changes.',
      visibility: 'workspace',
    })
    const stored = db
      .select()
      .from(agents)
      .where(eq(agents.id, created.id))
      .get()
    const draft = db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.agentId, created.id))
      .get()

    expect(stored?.description).toBe('Reviews product changes.')
    expect(draft?.instructions).toBe('')
    expect(draft?.modelProvider).toBe('')
    expect(draft?.modelId).toBe('')
    expect(draft?.thinkingLevel).toBe('off')
  })

  it('rejects publishing an incomplete draft', async () => {
    const created = await createAgent(db, principal, workspaceId, {
      name: 'Incomplete',
      description: '',
      visibility: 'workspace',
    })

    await expect(
      publishAgentVersion(db, principal, workspaceId, created.id),
    ).rejects.toThrow(/incomplete draft/i)
  })

  it('publishes a version and updates the Agent current version', async () => {
    const created = await createAgent(db, principal, workspaceId, {
      name: 'Reviewer',
      instructions: 'Review changes.',
      modelProvider: 'openai',
      modelId: 'gpt-6.1-sol',
      thinkingLevel: 'high',
    })

    const published = await publishAgentVersion(
      db,
      principal,
      workspaceId,
      created.id,
    )
    const agent = db
      .select()
      .from(agents)
      .where(eq(agents.id, created.id))
      .get()

    expect(published.status).toBe('published')
    expect(agent?.currentPublishedVersionId).toBe(published.id)
    expect(agent?.status).toBe('active')
  })

  it('rejects edits to a published version', async () => {
    const created = await createAgent(db, principal, workspaceId, {
      name: 'Reviewer',
      instructions: 'Review changes.',
      modelProvider: 'openai',
      modelId: 'gpt-6.1-sol',
      thinkingLevel: 'high',
    })
    await publishAgentVersion(db, principal, workspaceId, created.id)

    await expect(
      updateAgentDraft(db, principal, workspaceId, created.id, {
        instructions: 'New instructions',
      }),
    ).rejects.toThrow(/no editable draft/i)
  })

  it('copies the current published version into a new draft', async () => {
    const created = await createAgent(db, principal, workspaceId, {
      name: 'Reviewer',
      instructions: 'Review changes.',
      modelProvider: 'openai',
      modelId: 'gpt-6.1-sol',
      thinkingLevel: 'high',
    })
    const first = await publishAgentVersion(
      db,
      principal,
      workspaceId,
      created.id,
    )
    const second = await createNextVersion(
      db,
      principal,
      workspaceId,
      created.id,
    )

    expect(second.versionNumber).toBe(2)
    expect(second.instructions).toBe(first.instructions)
    expect(second.status).toBe('draft')
  })

  it('reuses the existing draft instead of creating a duplicate', async () => {
    const created = await createAgent(db, principal, workspaceId, {
      name: 'Reviewer',
      instructions: 'Review changes.',
      modelProvider: 'openai',
      modelId: 'gpt-6.1-sol',
      thinkingLevel: 'high',
    })
    await publishAgentVersion(db, principal, workspaceId, created.id)
    const firstDraft = await createNextVersion(
      db,
      principal,
      workspaceId,
      created.id,
    )
    const sameDraft = await createNextVersion(
      db,
      principal,
      workspaceId,
      created.id,
    )

    expect(sameDraft.id).toBe(firstDraft.id)
    expect(
      db
        .select()
        .from(agentVersions)
        .all()
        .filter(
          (version) =>
            version.agentId === created.id && version.status === 'draft',
        ),
    ).toHaveLength(1)
  })

  it('hides a restricted Agent from an ordinary user without a grant', async () => {
    const created = await createAgent(db, principal, workspaceId, {
      name: 'Private reviewer',
      instructions: 'Review private changes.',
      modelProvider: 'openai',
      modelId: 'gpt-6.1-sol',
      thinkingLevel: 'high',
      visibility: 'restricted',
    })
    const bobId = randomUUID()
    db.insert(users).values({ id: bobId, username: 'bob' }).run()
    db.insert(workspaceMembers)
      .values({ workspaceId, userId: bobId, role: 'user' })
      .run()
    const bob = (await resolvePrincipal(
      db,
      {
        username: 'bob',
        name: null,
        email: null,
        expiresAt: Date.now() + 60_000,
        authMode: 'development',
      },
      env,
    ))!

    expect(await listAgents(db, bob, workspaceId)).toEqual([])

    db.insert(agentAccessGrants)
      .values({ agentId: created.id, userId: bobId })
      .run()
    await expect(listAgents(db, bob, workspaceId)).resolves.toEqual([
      expect.objectContaining({ id: created.id }),
    ])
  })

  it('replaces restricted Agent grants transactionally', async () => {
    const created = await createAgent(db, principal, workspaceId, {
      name: 'Restricted reviewer',
      instructions: 'Review private changes.',
      modelProvider: 'openai',
      modelId: 'gpt-6.1-sol',
      thinkingLevel: 'high',
      visibility: 'restricted',
    })
    const bobId = randomUUID()
    db.insert(users).values({ id: bobId, username: 'bob' }).run()
    db.insert(workspaceMembers)
      .values({ workspaceId, userId: bobId, role: 'user' })
      .run()

    await updateAgentDraft(db, principal, workspaceId, created.id, {
      memberUserIds: [bobId],
    })

    expect(
      db
        .select()
        .from(agentAccessGrants)
        .where(eq(agentAccessGrants.agentId, created.id))
        .all(),
    ).toEqual([
      expect.objectContaining({ agentId: created.id, userId: bobId }),
    ])

    await updateAgentDraft(db, principal, workspaceId, created.id, {
      memberUserIds: [],
    })
    expect(
      db
        .select()
        .from(agentAccessGrants)
        .where(eq(agentAccessGrants.agentId, created.id))
        .all(),
    ).toEqual([])
  })

  it('rejects grant changes from a non-admin editor', async () => {
    const created = await createAgent(db, principal, workspaceId, {
      name: 'Editor restricted reviewer',
      instructions: 'Review private changes.',
      modelProvider: 'openai',
      modelId: 'gpt-6.1-sol',
      thinkingLevel: 'high',
      visibility: 'restricted',
    })
    const editorId = randomUUID()
    db.insert(users).values({ id: editorId, username: 'editor' }).run()
    db.insert(workspaceMembers)
      .values({ workspaceId, userId: editorId, role: 'editor' })
      .run()
    const editor = (await resolvePrincipal(
      db,
      {
        username: 'editor',
        name: null,
        email: null,
        expiresAt: Date.now() + 60_000,
        authMode: 'development',
      },
      env,
    ))!

    await expect(
      updateAgentDraft(db, editor, workspaceId, created.id, {
        memberUserIds: [editorId],
      }),
    ).rejects.toThrow(/forbidden/i)
  })
})
