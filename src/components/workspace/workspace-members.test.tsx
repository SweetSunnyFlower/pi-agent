// @vitest-environment jsdom

import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceMemberRecord } from '#/lib/api/platform-client'
import { renderUi } from '#/test/ui'

import { WorkspaceMembers } from './workspace-members'

const admin = {
  userId: 'u1',
  username: 'alice',
  name: 'Alice',
  email: null,
  role: 'workspace_admin' as const,
  createdAt: '2026-10-20T02:00:00.000Z',
}

const bob = {
  userId: 'u2',
  username: 'bob',
  name: 'Bob',
  email: null,
  role: 'user' as const,
  createdAt: '2026-10-20T03:00:00.000Z',
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
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  )
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('WorkspaceMembers', () => {
  it('lists members and adds one by username', async () => {
    let members: WorkspaceMemberRecord[] = [admin]
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== '/api/workspaces/w1/members') {
        return Promise.resolve(
          Response.json({ error: 'not_found' }, { status: 404 }),
        )
      }
      if (init?.method === 'POST') {
        members = [...members, bob]
        return Promise.resolve(Response.json(bob))
      }
      return Promise.resolve(Response.json(members))
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(<WorkspaceMembers workspaceId="w1" />)

    expect(await screen.findByText('alice')).toBeTruthy()
    await user.type(screen.getByLabelText('成员用户名'), 'bob')
    await user.click(screen.getByRole('button', { name: '添加成员' }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/w1/members',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ username: 'bob', role: 'user' }),
        }),
      ),
    )
    expect(await screen.findByText('bob')).toBeTruthy()
  })

  it('updates a role and removes a member', async () => {
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === '/api/workspaces/w1/members/u2' && init?.method === 'DELETE') {
          return Promise.resolve(new Response(null, { status: 204 }))
        }
        if (url === '/api/workspaces/w1/members' && init?.method === 'POST') {
          return Promise.resolve(Response.json({ ...bob, role: 'editor' }))
        }
        return Promise.resolve(Response.json([admin, bob]))
      },
    )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(<WorkspaceMembers workspaceId="w1" />)

    await screen.findByText('bob')
    await user.click(screen.getByRole('combobox', { name: '角色 bob' }))
    await user.click(await screen.findByRole('option', { name: '编辑者' }))
    await user.click(screen.getByRole('button', { name: '保存 bob 角色' }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/w1/members',
        expect.objectContaining({
          body: JSON.stringify({ username: 'bob', role: 'editor' }),
        }),
      ),
    )

    await user.click(screen.getByRole('button', { name: '移除 bob' }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/w1/members/u2',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    )
  })
})
