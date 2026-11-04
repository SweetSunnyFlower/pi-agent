import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ApiError,
  createAiProviderRequest,
  createAgentRequest,
  createNextVersionRequest,
  getConversationMessages,
  createHttpToolRequest,
  createSkillRequest,
  deleteAgentCapabilityRequest,
  getAgentTools,
  getAgentSkills,
  getAgentVersionSkills,
  getAgentVersionTools,
  getAgentChannels,
  getAgentRequest,
  listAgentConversationsRequest,
  listAiProvidersRequest,
  getAuthMe,
  getModelConfig,
  getPendingUiInteractionRequest,
  getPublishReadiness,
  importMcpToolsRequest,
  importOpenApiToolsRequest,
  listAgentsRequest,
  previewMcpServerRequest,
  previewOpenApiRequest,
  publishAgentRequest,
  replaceAgentToolsRequest,
  replaceAgentSkillsRequest,
  reviseAgentToolRequest,
  respondToUiInteractionRequest,
  saveInfoFlowChannelRequest,
  sendChatMessageRequest,
  testAiProviderRequest,
  testInfoFlowConnectionRequest,
  updateAiProviderRequest,
  updateAgentDraftRequest,
  uploadSkillPackageRequest,
} from './platform-client'

afterEach(() => {
  vi.unstubAllGlobals()
})

const sampleTool = {
  id: 'capability-1',
  versionId: 'version-1',
  name: 'Issue Search',
  description: 'Search reviewed issues.',
  source: 'openapi' as const,
  version: '1.0.0',
  runtimeName: 'platform.tool.openapi.issue-api-list-issues@1.0.0',
  selected: false,
}

describe('platform API client', () => {
  it('loads the authenticated user and workspaces', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        user: { id: 'u1', username: 'alice' },
        workspaces: [
          {
            workspaceId: 'w1',
            slug: 'fde',
            name: 'Default',
            role: 'workspace_admin',
          },
        ],
        authMode: 'development',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await getAuthMe()

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', {
      credentials: 'include',
    })
    expect(result.workspaces[0].slug).toBe('fde')
  })

  it('creates an Agent with a JSON request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ id: 'a1' }, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await createAgentRequest('w1', {
      name: 'Reviewer',
      description: 'Reviews changes.',
      visibility: 'workspace',
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/w1/agents', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Reviewer',
        description: 'Reviews changes.',
        visibility: 'workspace',
      }),
    })
  })

  it('loads the Agent catalog for a workspace', async () => {
    const agents = [{ id: 'a1', name: 'Reviewer' }]
    const fetchMock = vi.fn().mockResolvedValue(Response.json(agents))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listAgentsRequest('w1')).resolves.toEqual(agents)
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/w1/agents', {
      credentials: 'include',
    })
  })

  it('throws ApiError with server error code', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: 'forbidden' }, { status: 403 }),
        ),
    )

    await expect(getAgentRequest('w1', 'a1')).rejects.toEqual(
      new ApiError('forbidden', 403),
    )
  })

  it('loads an Agent with workspace query', async () => {
    const agent = {
      id: 'a1',
      workspaceId: 'w1',
      name: 'Reviewer',
      description: 'Reviews changes.',
      versions: [],
    }
    const fetchMock = vi.fn().mockResolvedValue(Response.json(agent))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAgentRequest('w1', 'a1')).resolves.toEqual(agent)
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/a1?workspaceId=w1', {
      credentials: 'include',
    })
  })

  it('loads the safe model configuration without the token', async () => {
    const modelConfig = {
      configured: true,
      options: [
        {
          provider: 'oneapi-comate',
          providerLabel: '内部模型网关',
          modelId: 'DeepSeek-V4-Flash-内部',
          baseUrl: 'https://oneapi-comate.baidu-int.com/v1',
        },
      ],
    }
    const fetchMock = vi.fn().mockResolvedValue(Response.json(modelConfig))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getModelConfig('w1')).resolves.toEqual(modelConfig)
    expect(fetchMock).toHaveBeenCalledWith('/api/model-config?workspaceId=w1', {
      credentials: 'include',
    })
  })

  it('updates a draft prompt and model', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        id: 'v1',
        status: 'draft',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await updateAgentDraftRequest('w1', 'a1', {
      instructions: '你是一个产品评审助手。',
      modelProvider: 'oneapi-comate',
      modelId: 'DeepSeek-V4-Flash-内部',
      thinkingLevel: 'medium',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/draft?workspaceId=w1',
      {
        credentials: 'include',
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          instructions: '你是一个产品评审助手。',
          modelProvider: 'oneapi-comate',
          modelId: 'DeepSeek-V4-Flash-内部',
          thinkingLevel: 'medium',
        }),
      },
    )
  })

  it('loads the Agent tool catalog and bindings', async () => {
    const tools = [
      {
        id: 'capability-1',
        versionId: 'version-1',
        name: 'Issue Search',
        description: 'Search reviewed issues.',
        source: 'http',
        version: '1.0.0',
        runtimeName: 'platform.tool.http.issue-search@1.0.0',
        selected: true,
      },
    ]
    const fetchMock = vi.fn().mockResolvedValue(Response.json(tools))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAgentTools('w1', 'a1')).resolves.toEqual(tools)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/draft/capabilities?workspaceId=w1',
      { credentials: 'include' },
    )
  })

  it('loads tools bound to a specific Agent version', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([]))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      getAgentVersionTools('w1', 'a1', 'version-1'),
    ).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/versions/version-1/capabilities?workspaceId=w1',
      { credentials: 'include' },
    )
  })

  it('creates an HTTP tool definition', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ versionId: 'version-1' }))
    vi.stubGlobal('fetch', fetchMock)

    await createHttpToolRequest('w1', {
      name: 'Issue Search',
      description: 'Search reviewed issues.',
      endpoint: 'https://api.example.com/issues/search',
      method: 'POST',
      inputSchema: { type: 'object', properties: {} },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/w1/capabilities/tools',
      {
        credentials: 'include',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Issue Search',
          description: 'Search reviewed issues.',
          endpoint: 'https://api.example.com/issues/search',
          method: 'POST',
          inputSchema: { type: 'object', properties: {} },
        }),
      },
    )
  })

  it('replaces the tools bound to the Agent draft', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([]))
    vi.stubGlobal('fetch', fetchMock)

    await replaceAgentToolsRequest('w1', 'a1', ['version-1'])

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/draft/capabilities?workspaceId=w1',
      {
        credentials: 'include',
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ capabilityVersionIds: ['version-1'] }),
      },
    )
  })

  it('revises a tool and rebinds the Agent draft', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([]))
    vi.stubGlobal('fetch', fetchMock)

    await reviseAgentToolRequest('w1', 'a1', 'version-1', {
      kind: 'http',
      name: 'Issue Search v2',
      description: 'Search issues using v2.',
      endpoint: 'https://api.example.com/v2/issues',
      method: 'GET',
      inputSchema: { type: 'object', properties: {} },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/draft/capabilities/version-1?workspaceId=w1',
      {
        credentials: 'include',
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'http',
          name: 'Issue Search v2',
          description: 'Search issues using v2.',
          endpoint: 'https://api.example.com/v2/issues',
          method: 'GET',
          inputSchema: { type: 'object', properties: {} },
        }),
      },
    )
  })

  it('deletes tool and Skill catalog entries through the Agent draft', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json([]))
    vi.stubGlobal('fetch', fetchMock)

    await deleteAgentCapabilityRequest('w1', 'a1', 'tool', 'version-1')
    await deleteAgentCapabilityRequest('w1', 'a1', 'skill', 'version-2')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/agents/a1/draft/capabilities/version-1?workspaceId=w1',
      {
        credentials: 'include',
        method: 'DELETE',
      },
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/agents/a1/draft/skills/version-2?workspaceId=w1',
      {
        credentials: 'include',
        method: 'DELETE',
      },
    )
  })

  it('previews an OpenAPI document', async () => {
    const preview = {
      title: 'Issue API',
      version: '1.0.0',
      serverUrl: 'https://api.example.com/v1',
      operations: [],
    }
    const fetchMock = vi.fn().mockResolvedValue(Response.json(preview))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      previewOpenApiRequest('w1', 'https://api.example.com/openapi.json'),
    ).resolves.toEqual(preview)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/w1/capabilities/openapi/preview',
      {
        credentials: 'include',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          documentUrl: 'https://api.example.com/openapi.json',
        }),
      },
    )
  })

  it('imports selected OpenAPI operations', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([sampleTool]))
    vi.stubGlobal('fetch', fetchMock)

    await importOpenApiToolsRequest(
      'w1',
      'https://api.example.com/openapi.json',
      ['GET /issues'],
    )

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/w1/capabilities/openapi/import',
      {
        credentials: 'include',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          documentUrl: 'https://api.example.com/openapi.json',
          operationKeys: ['GET /issues'],
        }),
      },
    )
  })

  it('previews MCP server tools', async () => {
    const preview = {
      serverName: 'internal-tools',
      serverVersion: '1.0.0',
      transport: 'streamable-http',
      tools: [],
    }
    const fetchMock = vi.fn().mockResolvedValue(Response.json(preview))
    vi.stubGlobal('fetch', fetchMock)

    await previewMcpServerRequest('w1', {
      serverUrl: 'https://mcp.example.com/mcp',
      transport: 'streamable-http',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/w1/capabilities/mcp/preview',
      {
        credentials: 'include',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          serverUrl: 'https://mcp.example.com/mcp',
          transport: 'streamable-http',
        }),
      },
    )
  })

  it('imports selected MCP tools', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([sampleTool]))
    vi.stubGlobal('fetch', fetchMock)

    await importMcpToolsRequest('w1', {
      serverUrl: 'https://mcp.example.com/mcp',
      transport: 'streamable-http',
      toolNames: ['search_issues'],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/w1/capabilities/mcp/import',
      {
        credentials: 'include',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          serverUrl: 'https://mcp.example.com/mcp',
          transport: 'streamable-http',
          toolNames: ['search_issues'],
        }),
      },
    )
  })

  it('loads ordered Skills for an Agent draft', async () => {
    const skills = [
      {
        id: 'skill-1',
        versionId: 'skill-version-1',
        name: 'Security review',
        description: 'Check security.',
        source: 'workspace',
        version: '1.0.0',
        runtimeName: 'platform.skill.workspace.security-review@1.0.0',
        content: 'Review authorization.',
        selected: true,
        sortOrder: 0,
      },
    ]
    const fetchMock = vi.fn().mockResolvedValue(Response.json(skills))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAgentSkills('w1', 'a1')).resolves.toEqual(skills)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/draft/skills?workspaceId=w1',
      { credentials: 'include' },
    )
  })

  it('loads Skills bound to a specific Agent version', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([]))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      getAgentVersionSkills('w1', 'a1', 'version-1'),
    ).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/versions/version-1/skills?workspaceId=w1',
      { credentials: 'include' },
    )
  })

  it('creates a Skill with prompt content', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ versionId: 'skill-version-1' }))
    vi.stubGlobal('fetch', fetchMock)

    await createSkillRequest('w1', {
      name: 'Security review',
      description: 'Check security.',
      content: 'Review authorization.',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/w1/capabilities/skills',
      {
        credentials: 'include',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Security review',
          description: 'Check security.',
          content: 'Review authorization.',
        }),
      },
    )
  })

  it('uploads a Skill ZIP package as multipart form data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        id: 'skill-1',
        name: 'security-review',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['zip-data'], 'security-review.zip', {
      type: 'application/zip',
    })

    await uploadSkillPackageRequest('w1', file)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/w1/capabilities/skills/package',
      expect.objectContaining({
        credentials: 'include',
        method: 'POST',
        body: expect.any(FormData),
      }),
    )
    const body = fetchMock.mock.calls[0][1]?.body as FormData
    expect((body.get('file') as File).name).toBe('security-review.zip')
  })

  it('replaces ordered Skill bindings on the Agent draft', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([]))
    vi.stubGlobal('fetch', fetchMock)

    await replaceAgentSkillsRequest('w1', 'a1', [
      'skill-version-2',
      'skill-version-1',
    ])

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/draft/skills?workspaceId=w1',
      {
        credentials: 'include',
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          capabilityVersionIds: ['skill-version-2', 'skill-version-1'],
        }),
      },
    )
  })

  it('loads the Agent channel configuration', async () => {
    const channels = {
      web: { channel: 'web', enabled: true, status: 'ready' },
      infoflow: {
        channel: 'infoflow',
        enabled: false,
        configured: false,
        status: 'not_configured',
      },
    }
    const fetchMock = vi.fn().mockResolvedValue(Response.json(channels))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAgentChannels('w1', 'a1')).resolves.toEqual(channels)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/channels?workspaceId=w1',
      { credentials: 'include' },
    )
  })

  it('saves encrypted InfoFlow channel settings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}))
    vi.stubGlobal('fetch', fetchMock)

    await saveInfoFlowChannelRequest('w1', 'a1', {
      enabled: true,
      infoflowAgentId: '50655',
      appKey: 'app-key',
      appSecret: 'app-secret',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/channels/infoflow?workspaceId=w1',
      {
        credentials: 'include',
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          infoflowAgentId: '50655',
          appKey: 'app-key',
          appSecret: 'app-secret',
        }),
      },
    )
  })

  it('tests the saved InfoFlow credentials', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ ok: true, infoflowAgentId: '50655' }))
    vi.stubGlobal('fetch', fetchMock)

    await testInfoFlowConnectionRequest('w1', 'a1')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/channels/infoflow/test?workspaceId=w1',
      {
        credentials: 'include',
        method: 'POST',
      },
    )
  })

  it('loads publish readiness checks', async () => {
    const readiness = {
      state: 'draft',
      ready: true,
      checks: [],
      summary: {
        versionNumber: 1,
        name: 'Reviewer',
        promptExcerpt: 'Review changes.',
        modelProvider: 'oneapi-comate',
        modelId: 'DeepSeek-V4-Pro',
        thinkingLevel: 'high',
        tools: 0,
        skills: 0,
        channels: ['Web'],
      },
    }
    const fetchMock = vi.fn().mockResolvedValue(Response.json(readiness))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getPublishReadiness('w1', 'a1')).resolves.toEqual(readiness)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/publish-readiness?workspaceId=w1',
      { credentials: 'include' },
    )
  })

  it('publishes the current draft', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        id: 'v1',
        status: 'published',
        versionNumber: 1,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await publishAgentRequest('w1', 'a1')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/publish?workspaceId=w1',
      {
        credentials: 'include',
        method: 'POST',
      },
    )
  })

  it('creates a new draft from the published version', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        id: 'v2',
        status: 'draft',
        versionNumber: 2,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await createNextVersionRequest('w1', 'a1')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/versions?workspaceId=w1',
      {
        credentials: 'include',
        method: 'POST',
      },
    )
  })

  it('submits a Web chat message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        {
          conversationId: 'c1',
          submissionId: 's1',
        },
        { status: 202 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await sendChatMessageRequest('w1', 'a1', {
      message: '你好',
      idempotencyKey: 'f1527738-dd26-426f-aa7b-55f73c9a8c6f',
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/chat/a1?workspaceId=w1', {
      credentials: 'include',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: '你好',
        idempotencyKey: 'f1527738-dd26-426f-aa7b-55f73c9a8c6f',
      }),
    })
  })

  it('loads persisted Web conversation messages', async () => {
    const messages = [
      {
        id: '1',
        role: 'user',
        text: '你好',
        timestamp: 1,
      },
    ]
    const fetchMock = vi.fn().mockResolvedValue(Response.json(messages))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getConversationMessages('w1', 'c1')).resolves.toEqual(messages)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/conversations/c1?workspaceId=w1',
      { credentials: 'include' },
    )
  })

  it('loads and answers a persisted UI interaction', async () => {
    const interaction = {
      id: 'ui-1',
      kind: 'single_select',
      request: {
        kind: 'single_select',
        title: '选择部署环境',
        options: [{ id: 'dev', label: '开发环境' }],
      },
      status: 'pending',
      createdAt: '2026-10-20T02:00:00.000Z',
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ interaction }))
      .mockResolvedValueOnce(
        Response.json(
          { conversationId: 'c1', submissionId: 's2' },
          { status: 202 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(getPendingUiInteractionRequest('w1', 'c1')).resolves.toEqual(
      interaction,
    )
    await expect(
      respondToUiInteractionRequest('w1', 'c1', 'ui-1', {
        kind: 'single_select',
        selectedOptionId: 'dev',
      }),
    ).resolves.toEqual({ conversationId: 'c1', submissionId: 's2' })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/conversations/c1/ui?workspaceId=w1',
      { credentials: 'include' },
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/conversations/c1/ui/ui-1?workspaceId=w1',
      {
        credentials: 'include',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'single_select',
          selectedOptionId: 'dev',
        }),
      },
    )
  })

  it('lists Web conversations for an Agent', async () => {
    const conversations = [
      {
        id: 'c1',
        title: '评审登录需求',
        preview: '需要补充回滚方案。',
        modelProvider: 'oneapi-comate',
        modelId: 'DeepSeek-V4-Flash',
        messageCount: 4,
        updatedAt: '2026-10-20T02:00:00.000Z',
      },
    ]
    const fetchMock = vi.fn().mockResolvedValue(Response.json(conversations))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listAgentConversationsRequest('w1', 'a1')).resolves.toEqual(
      conversations,
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/conversations?workspaceId=w1',
      { credentials: 'include' },
    )
  })

  it('manages workspace AI providers', async () => {
    const provider = {
      id: 'provider-1',
      name: '主网关',
      baseUrl: 'https://models.example.com/v1',
      tokenMasked: 'sk-••••1234',
      enabled: true,
      createdAt: '2026-10-20T02:00:00.000Z',
      updatedAt: '2026-10-20T02:00:00.000Z',
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json([provider]))
      .mockResolvedValueOnce(Response.json(provider, { status: 201 }))
      .mockResolvedValueOnce(Response.json(provider))
      .mockResolvedValueOnce(Response.json({ ok: true, modelCount: 3 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listAiProvidersRequest('w1')).resolves.toEqual([provider])
    await createAiProviderRequest('w1', {
      name: '主网关',
      baseUrl: 'https://models.example.com/v1',
      token: 'sk-secret-1234',
      enabled: true,
    })
    await updateAiProviderRequest('w1', 'provider-1', {
      name: '主网关',
      baseUrl: 'https://models.example.com/v1',
      enabled: false,
    })
    await expect(testAiProviderRequest('w1', 'provider-1')).resolves.toEqual({
      ok: true,
      modelCount: 3,
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/workspaces/w1/providers',
      { credentials: 'include' },
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/workspaces/w1/providers',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/providers/provider-1?workspaceId=w1',
      expect.objectContaining({ method: 'PUT' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/providers/provider-1/test?workspaceId=w1',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
