// @vitest-environment jsdom

import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PublishReadiness } from '#/lib/api/platform-client'
import { renderUi } from '#/test/ui'

import { AgentPublishPanel } from './agent-publish-panel'

const readyReadiness: PublishReadiness = {
  state: 'draft' as const,
  ready: true,
  hasChanges: true,
  changedModules: ['prompt'],
  checks: [
    {
      id: 'prompt',
      label: '提示词',
      passed: true,
      detail: '已填写',
    },
  ],
  summary: {
    versionNumber: 1,
    name: '产品评审助手',
    promptExcerpt: '识别需求风险与上线阻塞项。',
    modelProvider: 'oneapi-comate',
    modelId: 'DeepSeek-V4-Pro',
    thinkingLevel: 'high',
    tools: 2,
    skills: 1,
    channels: ['Web', '如流'],
  },
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AgentPublishPanel', () => {
  it('links to the read-only conversation to the right of publish', () => {
    renderUi(
      <AgentPublishPanel
        workspaceId="w1"
        workspaceSlug="fde"
        agentId="a1"
        readiness={readyReadiness}
        onChanged={() => undefined}
      />,
    )

    const publishButton = screen.getByRole('button', { name: '发布版本' })
    const chatLink = screen.getByRole('link', { name: '去对话' })

    expect(chatLink.getAttribute('href')).toBe(
      '/w/fde/agents/a1/chat?mode=view',
    )
    expect(
      publishButton.compareDocumentPosition(chatLink) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(publishButton.parentElement).toBe(chatLink.parentElement)
  })

  it('disables publication when blocking checks fail', () => {
    renderUi(
      <AgentPublishPanel
        workspaceId="w1"
        workspaceSlug="fde"
        agentId="a1"
        readiness={{
          ...readyReadiness,
          ready: false,
          checks: [
            {
              id: 'prompt',
              label: '提示词',
              passed: false,
              detail: '提示词不能为空',
            },
          ],
        }}
        onChanged={() => undefined}
      />,
    )

    expect(screen.getByText('提示词不能为空')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: '发布版本' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('publishes a ready draft', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        id: 'v1',
        versionNumber: 1,
        status: 'published',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    renderUi(
      <AgentPublishPanel
        workspaceId="w1"
        workspaceSlug="fde"
        agentId="a1"
        readiness={readyReadiness}
        onChanged={onChanged}
      />,
    )

    expect(screen.getByText('Web + 如流')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '发布版本' }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/publish?workspaceId=w1',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(screen.getByText('版本 v1 已发布')).toBeTruthy()
    expect(onChanged).toHaveBeenCalled()
  })

  it('does not ask the user to create the next draft manually', () => {
    renderUi(
      <AgentPublishPanel
        workspaceId="w1"
        workspaceSlug="fde"
        agentId="a1"
        readiness={{ ...readyReadiness, state: 'published', ready: false }}
        onChanged={() => undefined}
      />,
    )

    expect(screen.queryByRole('button', { name: '创建下一草稿' })).toBeNull()
    expect(screen.getByText('编辑草稿会自动准备，无需手动创建。')).toBeTruthy()
  })

  it('hides the publish action when the draft has no changes', () => {
    renderUi(
      <AgentPublishPanel
        workspaceId="w1"
        workspaceSlug="fde"
        agentId="a1"
        readiness={{
          ...readyReadiness,
          ready: false,
          hasChanges: false,
          changedModules: [],
        }}
        onChanged={() => undefined}
      />,
    )

    expect(screen.queryByRole('button', { name: '发布版本' })).toBeNull()
    expect(
      screen.getByText('暂无待发布变更。修改任一配置并保存后，才会启用发布。'),
    ).toBeTruthy()
  })
})
