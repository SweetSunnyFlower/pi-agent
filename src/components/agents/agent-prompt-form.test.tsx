// @vitest-environment jsdom

import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderUi } from '#/test/ui'

import { AgentPromptForm } from './agent-prompt-form'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AgentPromptForm', () => {
  it('renders a saved prompt without editing controls in read-only mode', () => {
    renderUi(
      <AgentPromptForm
        workspaceId="w1"
        agentId="a1"
        initialInstructions="**只读发布版本**"
        initialProvider="oneapi-comate"
        initialModelId="DeepSeek-V4-Pro"
        initialThinkingLevel="high"
        modelOptions={[]}
        readOnly
      />,
    )

    expect(
      screen
        .getByRole('textbox', { name: '提示词' })
        .getAttribute('contenteditable'),
    ).toBe('false')
    expect(
      screen
        .getByRole('button', { name: /模型.*DeepSeek-V4-Pro/ })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen
        .getByRole('button', { name: '高深入推理' })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(screen.queryByRole('button', { name: '保存草稿' })).toBeNull()
    expect(screen.getByText('只读模式')).toBeTruthy()
  })

  it('keeps a saved model selectable when the models endpoint omits it', () => {
    renderUi(
      <AgentPromptForm
        workspaceId="w1"
        agentId="a1"
        initialInstructions="保持当前模型。"
        initialProvider="oneapi-comate"
        initialModelId="DeepSeek-V4-Flash-内部"
        initialThinkingLevel="off"
        modelOptions={[
          {
            provider: 'oneapi-comate',
            providerLabel: '内部模型网关',
            modelId: 'DeepSeek-V4-Flash',
            baseUrl: 'https://oneapi-comate.baidu-int.com/v1',
          },
        ]}
      />,
    )

    expect(
      screen.getByRole('button', {
        name: /模型.*DeepSeek-V4-Flash-内部/,
      }).textContent,
    ).toContain('DeepSeek-V4-Flash-内部')
  })

  it('saves prompt, model, and thinking level', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ status: 'draft' }))
    vi.stubGlobal('fetch', fetchMock)
    const onSaved = vi.fn()
    const user = userEvent.setup()

    renderUi(
      <AgentPromptForm
        workspaceId="w1"
        agentId="a1"
        initialInstructions="**你是一个产品评审助手。**"
        initialThinkingLevel="off"
        onSaved={onSaved}
        modelOptions={[
          {
            provider: 'oneapi-comate',
            providerLabel: '内部模型网关',
            modelId: 'DeepSeek-V4-Flash-内部',
            baseUrl: 'https://oneapi-comate.baidu-int.com/v1',
          },
        ]}
      />,
    )

    expect(screen.queryByRole('button', { name: '加粗' })).toBeNull()
    expect(
      screen.getByRole('textbox', { name: '提示词' }).textContent,
    ).toContain('你是一个产品评审助手。')
    await user.click(screen.getByRole('button', { name: '中等平衡速度与质量' }))
    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/draft?workspaceId=w1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          instructions: '**你是一个产品评审助手。**',
          modelProvider: 'oneapi-comate',
          modelId: 'DeepSeek-V4-Flash-内部',
          thinkingLevel: 'medium',
        }),
      }),
    )
    expect(screen.getByText('草稿已保存')).toBeTruthy()
    expect(onSaved).toHaveBeenCalled()
  })

  it('selects a model from a provider submenu', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ status: 'draft' })),
    )
    const user = userEvent.setup()

    renderUi(
      <AgentPromptForm
        workspaceId="w1"
        agentId="a1"
        initialInstructions="选择备用模型。"
        initialThinkingLevel="off"
        modelOptions={[
          {
            provider: 'provider-primary',
            providerLabel: '主网关',
            modelId: 'Primary-Model',
            baseUrl: 'https://primary.example.com/v1',
          },
          {
            provider: 'provider-backup',
            providerLabel: '备用网关',
            modelId: 'Backup-Pro',
            baseUrl: 'https://backup.example.com/v1',
          },
          {
            provider: 'provider-backup',
            providerLabel: '备用网关',
            modelId: 'Backup-Flash',
            baseUrl: 'https://backup.example.com/v1',
          },
        ]}
      />,
    )

    expect(screen.queryByText('https://primary.example.com/v1')).toBeNull()
    await user.click(screen.getByRole('button', { name: /模型.*主网关/ }))
    await user.hover(await screen.findByRole('menuitem', { name: /备用网关/ }))
    const backupModel = await screen.findByRole('menuitemradio', {
      name: 'Backup-Flash',
    })
    backupModel.focus()
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /模型.*备用网关.*Backup-Flash/ }),
      ).toBeTruthy(),
    )
    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    expect(fetch).toHaveBeenCalledWith(
      '/api/agents/a1/draft?workspaceId=w1',
      expect.objectContaining({
        body: expect.stringContaining('"modelProvider":"provider-backup"'),
      }),
    )
  })

  it('shows image input capability icons for vision models', async () => {
    const user = userEvent.setup()

    renderUi(
      <AgentPromptForm
        workspaceId="w1"
        agentId="a1"
        initialInstructions="展示模型能力。"
        initialProvider="oneapi-comate"
        initialModelId="DeepSeek-V4-Flash-Vision-Exp"
        initialThinkingLevel="off"
        modelOptions={[
          {
            provider: 'oneapi-comate',
            providerLabel: '内部模型网关',
            modelId: 'DeepSeek-V4-Flash-Vision-Exp',
            baseUrl: 'https://oneapi-comate.baidu-int.com/v1',
          },
          {
            provider: 'oneapi-comate',
            providerLabel: '内部模型网关',
            modelId: 'DeepSeek-V4-Flash',
            baseUrl: 'https://oneapi-comate.baidu-int.com/v1',
          },
        ]}
      />,
    )

    const trigger = screen.getByRole('button', {
      name: /模型.*DeepSeek-V4-Flash-Vision-Exp/,
    })
    expect(within(trigger).getByLabelText('支持图片')).toBeTruthy()

    await user.click(trigger)
    await user.hover(
      await screen.findByRole('menuitem', { name: /内部模型网关/ }),
    )
    const visionModel = (
      await screen.findByText('DeepSeek-V4-Flash-Vision-Exp', {
        exact: true,
        selector: '[role="menuitemradio"] span',
      })
    ).closest<HTMLElement>('[role="menuitemradio"]')
    const textModel = screen
      .getByText('DeepSeek-V4-Flash', {
        exact: true,
        selector: '[role="menuitemradio"] span',
      })
      .closest<HTMLElement>('[role="menuitemradio"]')

    if (!visionModel || !textModel) throw new Error('model menu item missing')
    expect(within(visionModel).getByLabelText('支持图片')).toBeTruthy()
    expect(within(textModel).queryByLabelText('支持图片')).toBeNull()
  })
})
