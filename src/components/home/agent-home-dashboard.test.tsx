// @vitest-environment jsdom

import { act, cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderUi } from '#/test/ui'

import { AgentHomeDashboard } from './agent-home-dashboard'

const auth = {
  user: {
    id: 'u1',
    username: 'alice',
    name: 'Alice',
    email: null,
  },
  workspaces: [
    {
      workspaceId: 'w1',
      slug: 'fde',
      name: '产品研发',
      role: 'workspace_admin' as const,
    },
  ],
  authMode: 'development' as const,
}

const agents = [
  {
    id: 'a1',
    workspaceId: 'w1',
    name: '需求评审官',
    description: '从产品、研发和测试角度评审需求。',
    visibility: 'workspace' as const,
    status: 'active' as const,
    currentPublishedVersionId: 'v-public',
    createdBy: 'u1',
    enabledChannels: ['web', 'infoflow'] as const,
    versions: [
      {
        id: 'v-public',
        versionNumber: 2,
        instructions: '评审需求',
        modelProvider: 'oneapi-comate',
        modelId: 'DeepSeek-V4-Pro',
        thinkingLevel: 'high' as const,
        status: 'published' as const,
        manifestJson: {
          capabilities: [
            {
              runtimeName: 'search',
              kind: 'tool' as const,
              version: '1.0.0',
            },
            {
              runtimeName: 'review',
              kind: 'skill' as const,
              version: '1.0.0',
            },
          ],
        },
      },
    ],
  },
  {
    id: 'a2',
    workspaceId: 'w1',
    name: '周报助手',
    description: '整理团队周报。',
    visibility: 'workspace' as const,
    status: 'draft' as const,
    currentPublishedVersionId: null,
    createdBy: 'u1',
    enabledChannels: ['web'] as const,
    versions: [
      {
        id: 'v-draft',
        versionNumber: 1,
        instructions: '整理周报',
        modelProvider: 'oneapi-comate',
        modelId: 'DeepSeek-V4-Flash',
        thinkingLevel: 'medium' as const,
        status: 'draft' as const,
      },
    ],
  },
]

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AgentHomeDashboard', () => {
  it('lists published and draft Agents with the correct entry actions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/api/auth/me') return Promise.resolve(Response.json(auth))
        if (url === '/api/workspaces/w1/agents') {
          return Promise.resolve(Response.json(agents))
        }
        return Promise.resolve(
          Response.json({ error: 'not_found' }, { status: 404 }),
        )
      }),
    )

    renderUi(<AgentHomeDashboard />)

    const chatLink = await screen.findByRole('link', {
      name: '开始对话',
    })
    expect(chatLink.getAttribute('href')).toBe(
      '/w/fde/agents/a1/chat?mode=view',
    )
    expect(
      screen.getByRole('link', { name: '继续配置' }).getAttribute('href'),
    ).toBe('/w/fde/agents/a2/basic?mode=edit')
    expect(
      screen
        .getByRole('link', { name: '配置 需求评审官' })
        .getAttribute('href'),
    ).toBe('/w/fde/agents/a1/basic?mode=edit')
    expect(
      screen.getByRole('link', { name: '供应商' }).getAttribute('href'),
    ).toBe('/w/fde/providers')
    expect(
      screen.getByRole('link', { name: '成员' }).getAttribute('href'),
    ).toBe('/w/fde/members')
    expect(screen.getByText('需求评审官')).toBeTruthy()
    expect(screen.getByText('周报助手')).toBeTruthy()
    expect(screen.getAllByText('Web + 如流')).toHaveLength(2)
    expect(screen.getByText('1 工具 · 1 技能')).toBeTruthy()
  })

  it('shows an accessible workspace skeleton before authentication resolves', async () => {
    let resolveAuth: ((response: Response) => void) | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        if (String(input) === '/api/auth/me') {
          return new Promise<Response>((resolve) => {
            resolveAuth = resolve
          })
        }
        return Promise.resolve(Response.json([]))
      }),
    )

    renderUi(<AgentHomeDashboard />)

    expect(
      screen.getByRole('status', { name: '正在加载工作区' }),
    ).toBeTruthy()

    await act(async () => {
      resolveAuth?.(Response.json(auth))
    })

    expect(await screen.findByText('产品研发')).toBeTruthy()
  })
})
