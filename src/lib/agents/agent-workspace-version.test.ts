import { describe, expect, it } from 'vitest'

import type { AgentRecord } from '#/lib/api/platform-client'

import { agentVersionForMode } from './agent-workspace-version'

const agent = {
  id: 'a1',
  workspaceId: 'w1',
  name: 'Reviewer',
  description: '',
  visibility: 'workspace',
  status: 'draft',
  currentPublishedVersionId: 'v1',
  createdBy: 'u1',
  versions: [
    {
      id: 'v2',
      versionNumber: 2,
      instructions: 'Draft instructions',
      modelProvider: 'oneapi',
      modelId: 'draft-model',
      thinkingLevel: 'medium',
      status: 'draft',
    },
    {
      id: 'v1',
      versionNumber: 1,
      instructions: 'Published instructions',
      modelProvider: 'oneapi',
      modelId: 'published-model',
      thinkingLevel: 'high',
      status: 'published',
    },
  ],
} satisfies AgentRecord

describe('agentVersionForMode', () => {
  it('uses the immutable published version in view mode', () => {
    expect(agentVersionForMode(agent, 'view')?.id).toBe('v1')
  })

  it('uses the editable draft in edit mode', () => {
    expect(agentVersionForMode(agent, 'edit')?.id).toBe('v2')
  })

  it('does not fall back to a draft when an Agent is unpublished', () => {
    expect(
      agentVersionForMode(
        { ...agent, currentPublishedVersionId: null },
        'view',
      ),
    ).toBeUndefined()
  })
})
