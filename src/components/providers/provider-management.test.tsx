// @vitest-environment jsdom

import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderUi } from '#/test/ui'

import { ProviderManagement } from './provider-management'

const existingProvider = {
  id: 'provider-1',
  name: '主网关',
  baseUrl: 'https://primary.example.com/v1',
  tokenMasked: 'sk-••••1234',
  enabled: true,
  createdAt: '2026-10-20T02:00:00.000Z',
  updatedAt: '2026-10-20T02:00:00.000Z',
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

describe('ProviderManagement', () => {
  it('lists providers and creates another provider', async () => {
    let providers = [existingProvider]
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/workspaces/w1/providers' && init?.method === 'POST') {
        const created = {
          id: 'provider-2',
          name: '备用网关',
          baseUrl: 'https://backup.example.com/v1',
          tokenMasked: 'sk-••••5678',
          enabled: true,
          createdAt: '2026-10-20T03:00:00.000Z',
          updatedAt: '2026-10-20T03:00:00.000Z',
        }
        providers = [...providers, created]
        return Promise.resolve(Response.json(created, { status: 201 }))
      }
      if (url === '/api/workspaces/w1/providers') {
        return Promise.resolve(Response.json(providers))
      }
      return Promise.resolve(
        Response.json({ error: 'not_found' }, { status: 404 }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(<ProviderManagement workspaceId="w1" />)

    expect(await screen.findByText('主网关')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '添加供应商' }))
    await user.type(screen.getByLabelText('供应商名称'), '备用网关')
    await user.type(
      screen.getByLabelText('Base URL'),
      'https://backup.example.com/v1',
    )
    await user.type(screen.getByLabelText('API Token'), 'sk-backup-secret-5678')
    await user.click(screen.getByRole('button', { name: '保存供应商' }))

    expect(await screen.findByText('备用网关')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/w1/providers',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: '备用网关',
          baseUrl: 'https://backup.example.com/v1',
          enabled: true,
          token: 'sk-backup-secret-5678',
        }),
      }),
    )
  })

  it('edits without exposing or resubmitting the saved token and tests connectivity', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (
        url === '/api/providers/provider-1?workspaceId=w1' &&
        init?.method === 'PUT'
      ) {
        return Promise.resolve(
          Response.json({
            ...existingProvider,
            name: '主网关新版',
            baseUrl: 'https://primary-new.example.com/v1',
          }),
        )
      }
      if (
        url === '/api/providers/provider-1/test?workspaceId=w1' &&
        init?.method === 'POST'
      ) {
        return Promise.resolve(Response.json({ ok: true, modelCount: 4 }))
      }
      return Promise.resolve(Response.json([existingProvider]))
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(<ProviderManagement workspaceId="w1" />)
    await screen.findByText('主网关')
    expect(screen.queryByText('sk-secret-1234')).toBeNull()

    await user.click(screen.getByRole('button', { name: '编辑主网关' }))
    const tokenInput = screen.getByLabelText<HTMLInputElement>('API Token')
    expect(tokenInput.value).toBe('')
    expect(tokenInput.placeholder).toBe('留空则保留现有 Token')
    await user.clear(screen.getByLabelText('供应商名称'))
    await user.type(screen.getByLabelText('供应商名称'), '主网关新版')
    await user.clear(screen.getByLabelText('Base URL'))
    await user.type(
      screen.getByLabelText('Base URL'),
      'https://primary-new.example.com/v1',
    )
    await user.click(screen.getByRole('button', { name: '保存供应商' }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/providers/provider-1?workspaceId=w1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            name: '主网关新版',
            baseUrl: 'https://primary-new.example.com/v1',
            enabled: true,
          }),
        }),
      ),
    )

    await user.click(screen.getByRole('button', { name: '测试主网关' }))
    expect(await screen.findByText('连接成功，发现 4 个模型')).toBeTruthy()
  })

  it('shows a provider list skeleton while loading', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>(() => {
            // Keep the provider request pending for the assertion.
          }),
      ),
    )

    renderUi(<ProviderManagement workspaceId="w1" />)

    expect(
      screen.getByRole('status', { name: '正在加载供应商' }),
    ).toBeTruthy()
  })
})
