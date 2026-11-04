import { describe, expect, it } from 'vitest'

import { modelSupportsImageInput } from './model-capabilities'

describe('model image capabilities', () => {
  it('keeps the standard DeepSeek Flash model text-only', () => {
    expect(modelSupportsImageInput('DeepSeek-V4-Flash')).toBe(false)
    expect(modelSupportsImageInput('DeepSeek-V4-Pro')).toBe(false)
  })

  it('recognizes the dedicated DeepSeek vision model', () => {
    expect(modelSupportsImageInput('DeepSeek-V4-Flash-Vision-Exp')).toBe(true)
  })

  it('recognizes common multimodal model families', () => {
    expect(modelSupportsImageInput('gpt-6.1-sol')).toBe(true)
    expect(modelSupportsImageInput('Claude Sonnet 5')).toBe(true)
    expect(modelSupportsImageInput('Gemini 3.8 Flash')).toBe(true)
  })
})
