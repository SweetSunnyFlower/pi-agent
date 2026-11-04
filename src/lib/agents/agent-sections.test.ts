import { describe, expect, it } from 'vitest'

import {
  agentSectionHref,
  agentSectionsForMode,
  parseAgentWorkspaceMode,
} from './agent-sections'

describe('Agent workspace modes', () => {
  it('shows conversation without publishing in view mode', () => {
    expect(agentSectionsForMode('view').map((section) => section.id)).toEqual([
      'basic',
      'prompt',
      'tools',
      'skills',
      'channels',
      'chat',
    ])
  })

  it('shows publishing without conversation in edit mode', () => {
    expect(agentSectionsForMode('edit').map((section) => section.id)).toEqual([
      'basic',
      'prompt',
      'tools',
      'skills',
      'channels',
      'publish',
    ])
  })

  it('keeps the workspace mode in section links', () => {
    expect(agentSectionHref('产品 研发', 'agent-1', 'prompt', 'view')).toBe(
      '/w/%E4%BA%A7%E5%93%81%20%E7%A0%94%E5%8F%91/agents/agent-1/prompt?mode=view',
    )
  })

  it('defaults unknown locations to edit mode', () => {
    expect(parseAgentWorkspaceMode({ mode: 'view' })).toBe('view')
    expect(parseAgentWorkspaceMode({ mode: 'edit' })).toBe('edit')
    expect(parseAgentWorkspaceMode({ mode: 'unexpected' })).toBe('edit')
    expect(parseAgentWorkspaceMode(undefined)).toBe('edit')
    expect(parseAgentWorkspaceMode(undefined, 'view')).toBe('view')
  })
})
