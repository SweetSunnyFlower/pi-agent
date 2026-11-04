import { describe, expect, it } from 'vitest'

import { hasAgentSectionChanges } from './agent-change'

describe('Agent section change markers', () => {
  it('marks the module that changed', () => {
    const status = {
      hasChanges: true,
      changedModules: ['prompt' as const],
    }

    expect(hasAgentSectionChanges('prompt', status)).toBe(true)
    expect(hasAgentSectionChanges('tools', status)).toBe(false)
    expect(hasAgentSectionChanges('publish', status)).toBe(true)
  })

  it('does not mark navigation or basic information without a change', () => {
    expect(
      hasAgentSectionChanges('basic', {
        hasChanges: false,
        changedModules: [],
      }),
    ).toBe(false)
    expect(
      hasAgentSectionChanges('publish', {
        hasChanges: false,
        changedModules: [],
      }),
    ).toBe(false)
  })
})
