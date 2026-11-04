// @vitest-environment jsdom

import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { UiInteractionRecord } from '#/lib/chat/ui-interaction'
import { renderUi } from '#/test/ui'

import { AgentUiInteractionCard } from './agent-ui-interaction-card'

afterEach(cleanup)

function interaction(
  request: UiInteractionRecord['request'],
): UiInteractionRecord {
  return {
    id: 'ui-1',
    kind: request.kind,
    request,
    status: 'pending',
    createdAt: '2026-10-20T02:00:00.000Z',
  }
}

describe('AgentUiInteractionCard', () => {
  it('submits one selected option', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    renderUi(
      <AgentUiInteractionCard
        interaction={interaction({
          kind: 'single_select',
          title: '选择部署环境',
          description: '请选择本次要使用的环境。',
          options: [
            { id: 'dev', label: '开发环境', description: '用于联调' },
            { id: 'prod', label: '生产环境', description: '正式流量' },
          ],
          submitLabel: '确认环境',
        })}
        onSubmit={onSubmit}
      />,
    )

    expect(screen.getByText('开发环境')).toBeTruthy()
    const submit = screen.getByRole('button', { name: '确认环境' })
    expect(submit.hasAttribute('disabled')).toBe(true)
    await user.click(screen.getByRole('radio', { name: /开发环境/ }))
    await user.click(submit)

    expect(onSubmit).toHaveBeenCalledWith({
      kind: 'single_select',
      selectedOptionId: 'dev',
    })
  })

  it('submits freeform text as a single-select answer', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    renderUi(
      <AgentUiInteractionCard
        interaction={interaction({
          kind: 'single_select',
          title: '选择部署环境',
          options: [
            { id: 'dev', label: '开发环境' },
            { id: 'prod', label: '生产环境' },
          ],
        })}
        onSubmit={onSubmit}
      />,
    )

    await user.type(screen.getByLabelText('其他内容'), '预发布环境')
    await user.click(screen.getByRole('button', { name: '提交' }))

    expect(onSubmit).toHaveBeenCalledWith({
      kind: 'single_select',
      otherText: '预发布环境',
    })
  })

  it('submits multiple selected options', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    renderUi(
      <AgentUiInteractionCard
        interaction={interaction({
          kind: 'multi_select',
          title: '选择检查项',
          options: [
            { id: 'security', label: '安全检查' },
            { id: 'rollback', label: '回滚方案' },
          ],
          minSelections: 1,
          maxSelections: 2,
        })}
        onSubmit={onSubmit}
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: '安全检查' }))
    await user.click(screen.getByRole('checkbox', { name: '回滚方案' }))
    await user.click(screen.getByRole('button', { name: '提交' }))

    expect(onSubmit).toHaveBeenCalledWith({
      kind: 'multi_select',
      selectedOptionIds: ['security', 'rollback'],
    })
  })

  it('allows freeform text to satisfy a multi-select input', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    renderUi(
      <AgentUiInteractionCard
        interaction={interaction({
          kind: 'multi_select',
          title: '选择检查项',
          options: [
            { id: 'security', label: '安全检查' },
            { id: 'rollback', label: '回滚方案' },
          ],
          minSelections: 1,
        })}
        onSubmit={onSubmit}
      />,
    )

    await user.type(screen.getByLabelText('其他内容'), '补充性能压测')
    await user.click(screen.getByRole('button', { name: '提交' }))

    expect(onSubmit).toHaveBeenCalledWith({
      kind: 'multi_select',
      selectedOptionIds: [],
      otherText: '补充性能压测',
    })
  })

  it('submits a confirmation decision', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    renderUi(
      <AgentUiInteractionCard
        interaction={interaction({
          kind: 'confirm',
          title: '确认发布',
          description: '发布后将立即生效。',
          confirmLabel: '立即发布',
          cancelLabel: '暂不发布',
        })}
        onSubmit={onSubmit}
      />,
    )

    await user.click(screen.getByRole('button', { name: '暂不发布' }))
    expect(onSubmit).toHaveBeenLastCalledWith({
      kind: 'confirm',
      confirmed: false,
    })
    await user.click(screen.getByRole('button', { name: '立即发布' }))
    expect(onSubmit).toHaveBeenLastCalledWith({
      kind: 'confirm',
      confirmed: true,
    })
  })

  it('includes freeform context in a confirmation response', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    renderUi(
      <AgentUiInteractionCard
        interaction={interaction({
          kind: 'confirm',
          title: '确认发布',
          confirmLabel: '立即发布',
          cancelLabel: '暂不发布',
        })}
        onSubmit={onSubmit}
      />,
    )

    await user.type(screen.getByLabelText('其他内容'), '请先通知值班同学')
    await user.click(screen.getByRole('button', { name: '立即发布' }))

    expect(onSubmit).toHaveBeenCalledWith({
      kind: 'confirm',
      confirmed: true,
      otherText: '请先通知值班同学',
    })
  })

  it('submits a short form with typed values', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    renderUi(
      <AgentUiInteractionCard
        interaction={interaction({
          kind: 'form',
          title: '补充发布信息',
          fields: [
            {
              id: 'owner',
              label: '负责人',
              type: 'text',
              required: true,
            },
            {
              id: 'rollback',
              label: '回滚方案',
              type: 'textarea',
            },
            {
              id: 'wait',
              label: '观察分钟数',
              type: 'number',
            },
          ],
          submitLabel: '提交信息',
        })}
        onSubmit={onSubmit}
      />,
    )

    const submit = screen.getByRole('button', { name: '提交信息' })
    expect(submit.hasAttribute('disabled')).toBe(true)
    await user.type(screen.getByLabelText('负责人'), 'Alice')
    await user.type(screen.getByLabelText('回滚方案'), '切回上一版本')
    await user.type(screen.getByLabelText('观察分钟数'), '15')
    await user.type(screen.getByLabelText('其他内容'), '发布前二次确认')
    await user.click(submit)

    expect(onSubmit).toHaveBeenCalledWith({
      kind: 'form',
      values: {
        owner: 'Alice',
        rollback: '切回上一版本',
        wait: 15,
      },
      otherText: '发布前二次确认',
    })
  })
})
