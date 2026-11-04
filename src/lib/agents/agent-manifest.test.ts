import { describe, expect, it } from 'vitest'

import { capabilityCounts, channelLabel } from './agent-manifest'

describe('agent manifest helpers', () => {
  it('counts tools and Skills independently', () => {
    expect(
      capabilityCounts({
        capabilities: [
          {
            runtimeName: 'platform.tool.http.issue-search@1.0.0',
            kind: 'tool',
            version: '1.0.0',
          },
          {
            runtimeName: 'platform.tool.http.order-lookup@1.0.0',
            kind: 'tool',
            version: '1.0.0',
          },
          {
            runtimeName: 'platform.skill.code-review@2.0.0',
            kind: 'skill',
            version: '2.0.0',
          },
        ],
      }),
    ).toEqual({ tools: 2, skills: 1 })
  })

  it('handles drafts without capability bindings', () => {
    expect(capabilityCounts({ capabilities: [] })).toEqual({
      tools: 0,
      skills: 0,
    })
  })

  it('labels enabled channel combinations', () => {
    expect(channelLabel(['web'])).toBe('Web 默认')
    expect(channelLabel(['web', 'infoflow'])).toBe('Web + 如流')
  })
})
