// @vitest-environment jsdom

import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderUi } from '#/test/ui'

import { AgentToolsForm } from './agent-tools-form'

const tool = {
  id: 'capability-1',
  versionId: 'version-1',
  name: 'Issue Search',
  description: 'Search reviewed issues.',
  source: 'http' as const,
  version: '1.0.0',
  runtimeName: 'platform.tool.http.issue-search@1.0.0',
  method: 'POST',
  endpoint: 'https://api.example.com/issues/search',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' } },
  },
  definition: {
    kind: 'http',
    method: 'POST',
    endpoint: 'https://api.example.com/issues/search',
  },
  selected: false,
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

describe('AgentToolsForm', () => {
  it('shows only enabled tools without editing controls in read-only mode', () => {
    renderUi(
      <AgentToolsForm
        workspaceId="w1"
        agentId="a1"
        initialTools={[
          { ...tool, selected: true },
          {
            ...tool,
            id: 'capability-2',
            versionId: 'version-2',
            name: 'Unused Tool',
          },
        ]}
        readOnly
      />,
    )

    expect(screen.getByText('Issue Search')).toBeTruthy()
    expect(screen.queryByText('Unused Tool')).toBeNull()
    expect(screen.queryByRole('button', { name: '添加工具' })).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('button', { name: '保存工具配置' })).toBeNull()
    expect(screen.getByText('已启用', { selector: 'span' })).toBeTruthy()
  })

  it('offers four source-specific add flows', async () => {
    const user = userEvent.setup()

    renderUi(<AgentToolsForm workspaceId="w1" agentId="a1" initialTools={[]} />)

    await user.click(screen.getByRole('button', { name: '添加工具' }))
    expect(screen.getByRole('button', { name: '选择内置工具' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '选择 HTTP 工具' })).toBeTruthy()
    expect(
      screen.getByRole('button', { name: '选择 OpenAPI 文档' }),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: '选择 MCP 服务' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '选择内置工具' }))
    expect(screen.getByText('平台尚未注册内置工具')).toBeTruthy()
  })

  it('saves selected tool versions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([tool]))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentToolsForm workspaceId="w1" agentId="a1" initialTools={[tool]} />,
    )

    await user.click(screen.getByRole('switch', { name: '启用 Issue Search' }))
    await user.click(screen.getByRole('button', { name: '保存工具配置' }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/draft/capabilities?workspaceId=w1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ capabilityVersionIds: ['version-1'] }),
      }),
    )
    expect(screen.getByText('工具配置已保存')).toBeTruthy()
  })

  it('creates an HTTP tool from the inline configuration', async () => {
    const createdTool = { ...tool, name: 'Order Lookup', id: 'capability-2' }
    const fetchMock = vi.fn().mockResolvedValue(Response.json(createdTool))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(<AgentToolsForm workspaceId="w1" agentId="a1" initialTools={[]} />)

    await user.click(screen.getByRole('button', { name: '添加工具' }))
    await user.click(screen.getByRole('button', { name: '选择 HTTP 工具' }))
    await user.type(screen.getByLabelText('工具名称'), 'Order Lookup')
    await user.type(screen.getByLabelText('工具描述'), 'Look up an order.')
    await user.type(
      screen.getByLabelText('接口地址'),
      'https://api.example.com/orders',
    )
    await user.click(screen.getByRole('button', { name: '保存工具定义' }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/w1/capabilities/tools',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"name":"Order Lookup"'),
      }),
    )
    expect(await screen.findByText('Order Lookup')).toBeTruthy()
  })

  it('edits an HTTP tool and replaces its Agent binding', async () => {
    const revisedTool = {
      ...tool,
      versionId: 'version-2',
      name: 'Issue Search v2',
      description: 'Search issues using v2.',
      version: '1.0.1',
      runtimeName: 'platform.tool.http.issue-search@1.0.1',
      method: 'GET',
      endpoint: 'https://api.example.com/v2/issues',
      definition: {
        kind: 'http',
        method: 'GET',
        endpoint: 'https://api.example.com/v2/issues',
      },
      selected: true,
    }
    const fetchMock = vi.fn().mockResolvedValue(Response.json([revisedTool]))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentToolsForm
        workspaceId="w1"
        agentId="a1"
        initialTools={[{ ...tool, selected: true }]}
      />,
    )

    await user.click(screen.getByRole('button', { name: '编辑 Issue Search' }))
    expect(screen.getByDisplayValue('Issue Search')).toBeTruthy()
    expect(
      screen.getByDisplayValue('https://api.example.com/issues/search'),
    ).toBeTruthy()

    const name = screen.getByLabelText('工具名称')
    await user.clear(name)
    await user.type(name, 'Issue Search v2')
    await user.click(screen.getByRole('button', { name: '保存新版本' }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/draft/capabilities/version-1?workspaceId=w1',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('"name":"Issue Search v2"'),
      }),
    )
    expect(await screen.findByText('Issue Search v2')).toBeTruthy()
    expect(screen.getByText('HTTP · v1.0.1')).toBeTruthy()
    expect(screen.getByText('工具配置已保存')).toBeTruthy()
  })

  it('reimports an OpenAPI tool as a new bound version', async () => {
    const original = {
      ...sampleOpenApiTool,
      name: 'List issues',
      selected: true,
      definition: {
        kind: 'openapi',
        documentUrl: 'https://api.example.com/openapi.json',
        operationId: 'listIssues',
        method: 'GET',
        path: '/issues',
        endpoint: 'https://api.example.com/v1/issues',
      },
    }
    const preview = {
      title: 'Issue API',
      version: '2.1.0',
      serverUrl: 'https://api.example.com/v1',
      operations: [
        {
          key: 'GET /issues',
          operationId: 'listIssues',
          name: 'List issues v2',
          description: 'List issues from the updated document.',
          method: 'GET',
          path: '/issues',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    }
    const revised = {
      ...original,
      versionId: 'openapi-version-2',
      name: 'List issues v2',
      description: 'List issues from the updated document.',
      version: '1.0.1',
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(preview))
      .mockResolvedValueOnce(Response.json([revised]))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentToolsForm
        workspaceId="w1"
        agentId="a1"
        initialTools={[original]}
      />,
    )

    await user.click(screen.getByRole('button', { name: '编辑 List issues' }))
    expect(
      screen.getByDisplayValue('https://api.example.com/openapi.json'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: '取消编辑' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '读取接口' }))
    expect(await screen.findByText('List issues v2')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '保存新版本' }))

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/agents/a1/draft/capabilities/version-1?workspaceId=w1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          kind: 'openapi',
          documentUrl: 'https://api.example.com/openapi.json',
          operationKey: 'GET /issues',
        }),
      }),
    )
    expect(await screen.findByText('OpenAPI · v1.0.1')).toBeTruthy()
  })

  it('reimports an MCP tool as a new bound version', async () => {
    const original = {
      ...tool,
      source: 'mcp' as const,
      name: 'Search docs',
      selected: true,
      runtimeName: 'platform.tool.mcp.internal-tools.search-docs@1.0.0',
      definition: {
        kind: 'mcp',
        serverUrl: 'https://mcp.example.com/mcp',
        endpoint: 'https://mcp.example.com/mcp',
        transport: 'streamable-http',
        toolName: 'search_docs',
      },
    }
    const preview = {
      serverName: 'internal-tools',
      serverVersion: '2.1.0',
      transport: 'streamable-http',
      tools: [
        {
          name: 'search_docs',
          title: 'Search docs v2',
          description: 'Search the updated documentation.',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    }
    const revised = {
      ...original,
      versionId: 'mcp-version-2',
      name: 'Search docs v2',
      description: 'Search the updated documentation.',
      version: '1.0.1',
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(preview))
      .mockResolvedValueOnce(Response.json([revised]))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentToolsForm
        workspaceId="w1"
        agentId="a1"
        initialTools={[original]}
      />,
    )

    await user.click(screen.getByRole('button', { name: '编辑 Search docs' }))
    expect(screen.getByDisplayValue('https://mcp.example.com/mcp')).toBeTruthy()
    expect(screen.getByRole('button', { name: '取消编辑' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '连接并发现' }))
    expect(await screen.findByText('Search docs v2')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '保存新版本' }))

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/agents/a1/draft/capabilities/version-1?workspaceId=w1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          kind: 'mcp',
          serverUrl: 'https://mcp.example.com/mcp',
          transport: 'streamable-http',
          toolName: 'search_docs',
        }),
      }),
    )
    expect(await screen.findByText('MCP · v1.0.1')).toBeTruthy()
  })

  it('deletes a workspace tool after confirmation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([]))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentToolsForm
        workspaceId="w1"
        agentId="a1"
        initialTools={[{ ...tool, selected: true }]}
      />,
    )

    await user.click(screen.getByRole('button', { name: '删除 Issue Search' }))
    expect(
      await screen.findByRole('heading', { name: '删除工具？' }),
    ).toBeTruthy()
    expect(document.querySelector('.agent-alert-dialog-content')).toBeTruthy()
    expect(document.querySelector('.agent-dialog-content')).toBeNull()
    await user.click(screen.getByRole('button', { name: '确认删除' }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/draft/capabilities/version-1?workspaceId=w1',
      expect.objectContaining({ method: 'DELETE' }),
    )
    await waitFor(() => expect(screen.queryByText('Issue Search')).toBeNull())
    expect(screen.getByText('工具配置已保存')).toBeTruthy()
  })

  it('previews and imports selected OpenAPI operations', async () => {
    const preview = {
      title: 'Issue API',
      version: '1.0.0',
      serverUrl: 'https://api.example.com/v1',
      operations: [
        {
          key: 'GET /issues',
          operationId: 'listIssues',
          name: 'List issues',
          description: 'List project issues.',
          method: 'GET',
          path: '/issues',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    }
    const imported = { ...sampleOpenApiTool, name: 'List issues' }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(preview))
      .mockResolvedValueOnce(Response.json([imported]))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(<AgentToolsForm workspaceId="w1" agentId="a1" initialTools={[]} />)

    await user.click(screen.getByRole('button', { name: '添加工具' }))
    await user.click(screen.getByRole('button', { name: '选择 OpenAPI 文档' }))
    await user.type(
      screen.getByLabelText('OpenAPI 文档地址'),
      'https://api.example.com/openapi.json',
    )
    await user.click(screen.getByRole('button', { name: '读取接口' }))
    expect(await screen.findByText('List issues')).toBeTruthy()
    await user.click(screen.getByRole('switch', { name: '选择 GET /issues' }))
    await user.click(screen.getByRole('button', { name: '导入 1 个接口' }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/w1/capabilities/openapi/import',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(await screen.findByText('List issues')).toBeTruthy()
  })

  it('discovers and imports selected MCP tools', async () => {
    const preview = {
      serverName: 'internal-tools',
      serverVersion: '2.0.0',
      transport: 'streamable-http',
      tools: [
        {
          name: 'search_docs',
          title: 'Search docs',
          description: 'Search internal documentation.',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    }
    const imported = {
      ...tool,
      name: 'Search docs',
      source: 'mcp' as const,
      runtimeName: 'platform.tool.mcp.internal-tools.search-docs@1.0.0',
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(preview))
      .mockResolvedValueOnce(Response.json([imported]))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(<AgentToolsForm workspaceId="w1" agentId="a1" initialTools={[]} />)

    await user.click(screen.getByRole('button', { name: '添加工具' }))
    await user.click(screen.getByRole('button', { name: '选择 MCP 服务' }))
    await user.type(
      screen.getByLabelText('MCP 服务地址'),
      'https://mcp.example.com/mcp',
    )
    await user.click(screen.getByRole('button', { name: '连接并发现' }))
    expect(await screen.findByText('Search docs')).toBeTruthy()
    await user.click(screen.getByRole('switch', { name: '选择 search_docs' }))
    await user.click(screen.getByRole('button', { name: '导入 1 个工具' }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/w1/capabilities/mcp/import',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(await screen.findByText('Search docs')).toBeTruthy()
  })
})

const sampleOpenApiTool = {
  ...tool,
  source: 'openapi' as const,
  runtimeName: 'platform.tool.openapi.issue-api-list-issues@1.0.0',
}
