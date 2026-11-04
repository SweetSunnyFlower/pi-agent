import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from './index'
import {
  agentVersions,
  agents,
  users,
  workspaceMembers,
  workspaces,
} from './schema'

describe('platform schema', () => {
  let db: ReturnType<typeof createDatabase>

  beforeEach(() => {
    db = createDatabase(':memory:')
    migrate(db, { migrationsFolder: './drizzle' })
  })

  afterEach(() => {
    db.$client.close()
  })

  it('stores a workspace member, Agent, and AgentVersion', () => {
    const workspaceId = randomUUID()
    const userId = randomUUID()
    const agentId = randomUUID()
    const versionId = randomUUID()

    db.insert(workspaces)
      .values({ id: workspaceId, slug: 'default', name: 'Default' })
      .run()
    db.insert(users).values({ id: userId, username: 'alice' }).run()
    db.insert(workspaceMembers)
      .values({ workspaceId, userId, role: 'workspace_admin' })
      .run()
    db.insert(agents)
      .values({
        id: agentId,
        workspaceId,
        name: 'Reviewer',
        description: 'Reviews product changes.',
        visibility: 'workspace',
        status: 'draft',
        createdBy: userId,
      })
      .run()
    db.insert(agentVersions)
      .values({
        id: versionId,
        workspaceId,
        agentId,
        versionNumber: 1,
        instructions: 'Review code carefully.',
        modelProvider: 'openai',
        modelId: 'gpt-6.1-sol',
        thinkingLevel: 'high',
        responsePolicyJson: {
          allowedParts: ['text', 'markdown'],
          maxTextLength: null,
          allowAttachments: false,
        },
        workspacePolicyJson: { workspaceMode: 'conversation' },
        manifestJson: { capabilities: [] },
        manifestHash: 'abc',
        status: 'draft',
        createdBy: userId,
      })
      .run()

    const stored = db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.id, versionId))
      .get()

    expect(stored?.instructions).toBe('Review code carefully.')
    expect(stored?.status).toBe('draft')
    const storedAgent = db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .get()
    expect(storedAgent?.description).toBe('Reviews product changes.')
  })

  it('rejects duplicate workspace slugs', () => {
    db.insert(workspaces)
      .values({ id: randomUUID(), slug: 'default', name: 'Default' })
      .run()

    expect(() =>
      db
        .insert(workspaces)
        .values({ id: randomUUID(), slug: 'default', name: 'Duplicate' })
        .run(),
    ).toThrow(/UNIQUE/)
  })
})
