// @vitest-environment jsdom

import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderUi } from '#/test/ui'

import { AgentChannelsForm } from './agent-channels-form'

const emptyConfig = {
  web: {
    channel: 'web' as const,
    enabled: true as const,
    status: 'ready' as const,
  },
  infoflow: {
    channel: 'infoflow' as const,
    enabled: false,
    configured: false,
    status: 'not_configured' as const,
  },
}

const configuredConfig = {
  web: {
    channel: 'web' as const,
    enabled: true as const,
    status: 'ready' as const,
  },
  infoflow: {
    channel: 'infoflow' as const,
    enabled: true,
    configured: true,
    infoflowAgentId: '50655',
    appKeyMasked: '8e5••••b1e4',
    displayName: '产品评审机器人',
    status: 'disconnected' as const,
    statusMessage: 'credentials_ok',
    lastTestedAt: '2026-10-19T09:00:00.000Z',
  },
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AgentChannelsForm', () => {
  it('shows saved channel details without editing or testing actions', () => {
    renderUi(
      <AgentChannelsForm
        workspaceId="w1"
        agentId="a1"
        initialConfig={configuredConfig}
        readOnly
      />,
    )

    expect(screen.getByText('50655')).toBeTruthy()
    expect(screen.getByText('8e5••••b1e4')).toBeTruthy()
    expect(screen.getByText('产品评审机器人')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '编辑凭据' })).toBeNull()
    expect(screen.queryByRole('button', { name: '测试连接' })).toBeNull()
    expect(screen.queryByRole('button', { name: '保存渠道配置' })).toBeNull()
  })

  it('keeps the enable switch outside the credential editor', async () => {
    const user = userEvent.setup()
    renderUi(
      <AgentChannelsForm
        workspaceId="w1"
        agentId="a1"
        initialConfig={configuredConfig}
      />,
    )

    expect(
      screen.getByRole('switch', { name: '启用如流机器人' }),
    ).toBeTruthy()
    expect(screen.queryByLabelText('如流 Agent ID')).toBeNull()
    expect(screen.queryByLabelText('App Key')).toBeNull()

    await user.click(screen.getByRole('button', { name: '编辑凭据' }))

    expect(screen.getByLabelText('如流 Agent ID')).toBeTruthy()
    expect(screen.getByLabelText('App Key')).toBeTruthy()
    expect(screen.queryByText('50655')).toBeNull()
    expect(screen.queryByText('8e5••••b1e4')).toBeNull()
    expect(
      screen.getByRole('switch', { name: '启用如流机器人' }),
    ).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.getByText('50655')).toBeTruthy()
    expect(screen.getByText('8e5••••b1e4')).toBeTruthy()
  })

  it('persists the enable toggle without opening credential inputs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        ...configuredConfig,
        infoflow: {
          ...configuredConfig.infoflow,
          enabled: false,
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentChannelsForm
        workspaceId="w1"
        agentId="a1"
        initialConfig={configuredConfig}
      />,
    )

    await user.click(
      screen.getByRole('switch', { name: '启用如流机器人' }),
    )

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/channels/infoflow?workspaceId=w1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          enabled: false,
          infoflowAgentId: '50655',
          appKey: '',
          appSecret: '',
        }),
      }),
    )
    expect(screen.queryByLabelText('如流 Agent ID')).toBeNull()
    expect(await screen.findByText('渠道配置已保存')).toBeTruthy()
  })

  it('saves a new InfoFlow bot configuration', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        ...configuredConfig,
        infoflow: {
          ...configuredConfig.infoflow,
          enabled: true,
          configured: true,
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentChannelsForm
        workspaceId="w1"
        agentId="a1"
        initialConfig={emptyConfig}
      />,
    )

    await user.click(screen.getByRole('button', { name: '配置如流机器人' }))
    await user.type(screen.getByLabelText('如流 Agent ID'), '50655')
    await user.type(screen.getByLabelText('App Key'), 'app-key-123456')
    await user.type(screen.getByLabelText('App Secret'), 'app-secret-123456')
    await user.click(screen.getByRole('switch', { name: '启用如流机器人' }))
    await user.click(screen.getByRole('button', { name: '保存渠道配置' }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/channels/infoflow?workspaceId=w1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          enabled: true,
          infoflowAgentId: '50655',
          appKey: 'app-key-123456',
          appSecret: 'app-secret-123456',
        }),
      }),
    )
    expect(screen.getByText('渠道配置已保存')).toBeTruthy()
  })

  it('tests saved credentials and shows only masked keys', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        ok: true,
        infoflowAgentId: '50655',
        name: '产品评审机器人',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentChannelsForm
        workspaceId="w1"
        agentId="a1"
        initialConfig={configuredConfig}
      />,
    )

    expect(screen.getByText('8e5••••b1e4')).toBeTruthy()
    expect(screen.queryByText('app-secret-123456')).toBeNull()
    await user.click(screen.getByRole('button', { name: '测试连接' }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/channels/infoflow/test?workspaceId=w1',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(await screen.findByText('凭据有效：产品评审机器人')).toBeTruthy()
  })
})
