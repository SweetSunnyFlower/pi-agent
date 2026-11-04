// @vitest-environment jsdom

import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderUi } from '#/test/ui'

import { AgentBasicForm } from './agent-basic-form'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AgentBasicForm', () => {
  it('saves the editable Agent identity fields', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/workspaces/w1/members') {
        return Promise.resolve(
          Response.json([
            {
              userId: 'u1',
              username: 'alice',
              name: 'Alice',
              email: null,
              role: 'workspace_admin',
              createdAt: '2026-10-20T02:00:00.000Z',
            },
          ]),
        )
      }
      if (url === '/api/agents/a1/access?workspaceId=w1') {
        return Promise.resolve(Response.json({ userIds: [] }))
      }
      return Promise.resolve(
        Response.json({
          id: 'v1',
          versionNumber: 1,
          instructions: '',
          modelProvider: '',
          modelId: '',
          thinkingLevel: 'off',
          status: 'draft',
        }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const onSaved = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    renderUi(
      <AgentBasicForm
        workspaceId="w1"
        agentId="a1"
        initialName="产品评审助手"
        initialDescription="评审产品变更。"
        initialVisibility="workspace"
        canManageAccess
        onSaved={onSaved}
      />,
    )

    await user.clear(screen.getByLabelText('Agent 名称'))
    await user.type(screen.getByLabelText('Agent 名称'), '数字人评审助手')
    await user.clear(screen.getByLabelText('描述'))
    await user.type(screen.getByLabelText('描述'), '评审数字人需求与风险。')
    await user.click(screen.getByRole('button', { name: /指定成员/ }))
    await user.click(screen.getByRole('button', { name: '保存基本信息' }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/agents/a1/draft?workspaceId=w1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            name: '数字人评审助手',
            description: '评审数字人需求与风险。',
            visibility: 'restricted',
            memberUserIds: [],
          }),
        }),
      ),
    )
    expect(await screen.findByText('基本信息已保存')).toBeTruthy()
    expect(onSaved).toHaveBeenCalled()
  })

  it('does not save an empty Agent name', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentBasicForm
        workspaceId="w1"
        agentId="a1"
        initialName="产品评审助手"
        initialDescription=""
        initialVisibility="workspace"
      />,
    )

    await user.clear(screen.getByLabelText('Agent 名称'))
    await user.click(screen.getByRole('button', { name: '保存基本信息' }))

    expect(screen.getByText('请输入 Agent 名称。')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('saves selected members for a restricted Agent', async () => {
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === '/api/workspaces/w1/members') {
          return Promise.resolve(
            Response.json([
              {
                userId: 'u1',
                username: 'alice',
                name: 'Alice',
                email: null,
                role: 'workspace_admin',
                createdAt: '2026-10-20T02:00:00.000Z',
              },
              {
                userId: 'u2',
                username: 'bob',
                name: 'Bob',
                email: null,
                role: 'user',
                createdAt: '2026-10-20T03:00:00.000Z',
              },
            ]),
          )
        }
        if (url === '/api/agents/a1/access?workspaceId=w1') {
          return Promise.resolve(Response.json({ userIds: [] }))
        }
        if (
          url === '/api/agents/a1/draft?workspaceId=w1' &&
          init?.method === 'PATCH'
        ) {
          return Promise.resolve(
            Response.json({
              id: 'v1',
              versionNumber: 1,
              instructions: '',
              modelProvider: '',
              modelId: '',
              thinkingLevel: 'off',
              status: 'draft',
            }),
          )
        }
        return Promise.resolve(
          Response.json({ error: 'not_found' }, { status: 404 }),
        )
      },
    )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentBasicForm
        workspaceId="w1"
        agentId="a1"
        initialName="产品评审助手"
        initialDescription=""
        initialVisibility="workspace"
        canManageAccess
      />,
    )

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/w1/members',
        expect.anything(),
      ),
    )
    await user.click(screen.getByRole('button', { name: /指定成员/ }))
    await user.click(screen.getByRole('checkbox', { name: '授权 Bob 访问' }))
    await user.click(screen.getByRole('button', { name: '保存基本信息' }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/agents/a1/draft?workspaceId=w1',
        expect.objectContaining({
          body: expect.stringContaining('"memberUserIds":["u2"]'),
        }),
      ),
    )
  })
})
