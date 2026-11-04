import { describe, expect, it } from 'vitest'

import { modelToolName } from './capability-tools.server'

describe('model tool names', () => {
  it('converts runtime names into OpenAI-compatible function names', () => {
    expect(modelToolName('platform.tool.http.qa@1.0.0')).toBe(
      'platform_tool_http_qa_1_0_0',
    )
  })

  it('keeps long names unique and within the model limit', () => {
    const prefix = 'platform.tool.http.'.padEnd(80, 'a')
    const first = modelToolName(`${prefix}@1.0.0`)
    const second = modelToolName(`${prefix}@2.0.0`)

    expect(first).toHaveLength(64)
    expect(second).toHaveLength(64)
    expect(first).not.toBe(second)
    expect(first).toMatch(/^[a-zA-Z0-9_-]+$/)
  })
})
