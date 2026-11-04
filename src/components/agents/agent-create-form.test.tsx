// @vitest-environment jsdom

import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderUi } from '#/test/ui'

import { AgentCreateForm } from './agent-create-form'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AgentCreateForm', () => {
  it('creates a draft and reports the new Agent id', async () => {
    const onCreated = vi.fn()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ id: 'agent-1' }, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentCreateForm
        workspaceId="workspace-1"
        onCreated={onCreated}
        onCancel={() => undefined}
      />,
    )

    await user.type(screen.getByLabelText('Agent 名称'), 'Reviewer')
    await user.type(screen.getByLabelText('描述'), 'Reviews product changes.')
    await user.click(screen.getByRole('button', { name: '创建草稿' }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/agents',
      {
        credentials: 'include',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Reviewer',
          description: 'Reviews product changes.',
          visibility: 'workspace',
        }),
      },
    )
    expect(onCreated).toHaveBeenCalledWith({ id: 'agent-1' })
  })

  it('shows a required-name error without making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentCreateForm
        workspaceId="w1"
        onCreated={() => undefined}
        onCancel={() => undefined}
      />,
    )
    await user.click(screen.getByRole('button', { name: '创建草稿' }))

    expect(screen.getByText('请输入 Agent 名称。')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
