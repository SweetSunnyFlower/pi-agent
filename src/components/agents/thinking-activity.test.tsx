// @vitest-environment jsdom

import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { renderUi } from '#/test/ui'

import { ModelChangeDivider } from './model-change-divider'
import { ThinkingActivity } from './thinking-activity'

afterEach(cleanup)

describe('ThinkingActivity', () => {
  it('renders without a container border', () => {
    const stylesheet = readFileSync(
      resolve(process.cwd(), 'src/styles.css'),
      'utf8',
    )
    const activityRule = stylesheet.match(
      /\.thinking-activity\s*\{([\s\S]*?)\}/,
    )?.[1]

    expect(activityRule).toBeTruthy()
    expect(activityRule).not.toMatch(/\bborder:\s*1px/)
  })

  it('keeps the latest logical line visible and expands the full process', async () => {
    const user = userEvent.setup()
    renderUi(
      <ThinkingActivity
        thinking={'第一行思考\n第二行结论'}
        usage={{
          input: 1200,
          output: 348,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 1548,
          costTotal: 0.02,
        }}
      />,
    )

    const activity = screen.getByLabelText('思考过程')
    expect(activity.className).toContain('max-w-[40rem]')
    expect(activity.className).toContain('w-full')
    expect(screen.getByTestId('thinking-track').style.transform).toBe(
      'translateY(-24px)',
    )
    expect(screen.getByText('输入 1.2k')).toBeTruthy()
    expect(screen.getByText('输出 348')).toBeTruthy()
    expect(screen.getByText('总计 1.5k')).toBeTruthy()

    const expand = screen.getByRole('button', { name: '展开思考过程' })
    expect(expand.getAttribute('aria-expanded')).toBe('false')
    await user.click(expand)

    expect(
      screen.getByRole('button', { name: '收起思考过程' }).getAttribute(
        'aria-expanded',
      ),
    ).toBe('true')
    expect(screen.getByTestId('thinking-expanded').textContent).toContain(
      '第一行思考\n第二行结论',
    )
  })
})

describe('ModelChangeDivider', () => {
  it('renders an accessible centered model switch label', () => {
    renderUi(<ModelChangeDivider modelId="DeepSeek-V4-Flash-Vision-Exp" />)

    expect(
      screen.getByRole('separator', {
        name: '模型切换到 DeepSeek-V4-Flash-Vision-Exp',
      }),
    ).toBeTruthy()
    expect(screen.getByText(/模型切换|以下内容由/).textContent).toContain(
      'DeepSeek-V4-Flash-Vision-Exp',
    )
  })
})
