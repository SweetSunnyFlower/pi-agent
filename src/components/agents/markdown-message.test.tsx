// @vitest-environment jsdom

import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { renderUi } from '#/test/ui'

import { MarkdownMessage } from './markdown-message'

afterEach(cleanup)

describe('MarkdownMessage', () => {
  it('renders GFM, task lists, raw HTML and math', () => {
    const { container } = renderUi(
      <MarkdownMessage
        content={[
          '# 评审结论',
          '',
          '**高风险**，~~旧结论~~',
          '',
          '<mark>需要补充边界</mark>',
          '',
          '| 项目 | 状态 |',
          '| --- | --- |',
          '| 登录 | 待确认 |',
          '',
          '- [x] 已完成',
          '- [ ] 待处理',
          '',
          '行内公式：$E = mc^2$',
        ].join('\n')}
      />,
    )

    expect(container.querySelector('h1')?.textContent).toContain('评审结论')
    expect(container.querySelector('strong')?.textContent).toBe('高风险')
    expect(container.querySelector('del')?.textContent).toBe('旧结论')
    expect(container.querySelector('mark')?.textContent).toBe('需要补充边界')
    expect(container.querySelector('table')).toBeTruthy()
    expect(container.querySelector('table')?.hasAttribute('node')).toBe(false)
    expect(container.textContent).toContain('登录')
    const checkboxes = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    )
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes[0].checked).toBe(true)
    expect(checkboxes.every((checkbox) => checkbox.disabled)).toBe(true)
    expect(container.querySelector('.katex')).toBeTruthy()
  })

  it('highlights fenced code and opens links safely', () => {
    const { container } = renderUi(
      <MarkdownMessage
        content={[
          '[OpenAI](https://openai.com)',
          '',
          '```js',
          'const value = 1',
          '```',
        ].join('\n')}
      />,
    )

    const link = container.querySelector('a')
    expect(link?.textContent).toBe('OpenAI')
    if (!link) throw new Error('expected a rendered link')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noreferrer')
    expect(link.hasAttribute('node')).toBe(false)
    expect(container.querySelector('code.hljs')).toBeTruthy()
    expect(container.querySelector('code.hljs')?.textContent).toContain(
      'const value = 1',
    )
  })

  it('sanitizes scripts and unsafe URLs', () => {
    const { container } = renderUi(
      <MarkdownMessage
        content={[
          '<script>alert("xss")</script>',
          '',
          '<a href="javascript:alert(1)">危险链接</a>',
          '',
          '[另一个危险链接](javascript:alert(2))',
        ].join('\n')}
      />,
    )

    expect(container.querySelector('script')).toBeNull()
    expect(
      Array.from(container.querySelectorAll('a')).some((link) =>
        link.getAttribute('href')?.startsWith('javascript:'),
      ),
    ).toBe(false)
  })
})
