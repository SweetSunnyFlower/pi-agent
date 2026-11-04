// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderUi } from '#/test/ui'

import { AgentChatPanel } from './agent-chat-panel'

class MockEventSource {
  static instances: MockEventSource[] = []
  readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>()
  closed = false

  constructor(readonly url: string) {
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  close() {
    this.closed = true
  }

  emit(type: string, data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

beforeEach(() => {
  MockEventSource.instances = []
  vi.stubGlobal('EventSource', MockEventSource)
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AgentChatPanel', () => {
  it('uses the server-provided image limit', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/chat/config') {
        return Promise.resolve(Response.json({ maxImagesPerMessage: 5 }))
      }
      if (url === '/api/model-config?workspaceId=w1') {
        return Promise.resolve(
          Response.json({
            configured: true,
            options: [
              {
                provider: 'oneapi-comate',
                providerLabel: '内部模型网关',
                modelId: 'DeepSeek-V4-Flash-Vision-Exp',
                baseUrl: 'https://gateway.example.com/v1',
              },
            ],
          }),
        )
      }
      return Promise.resolve(
        Response.json({ error: 'not_found' }, { status: 404 }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentChatPanel
        workspaceId="w1"
        agentId="a1"
        agentName="产品评审助手"
        defaultProvider="oneapi-comate"
        defaultModelId="DeepSeek-V4-Flash-Vision-Exp"
      />,
    )

    const files = Array.from(
      { length: 6 },
      (_, index) =>
        new File([new Uint8Array([137, 80, 78, 71])], `image-${index}.png`, {
          type: 'image/png',
        }),
    )
    await user.upload(screen.getByLabelText('选择图片文件'), files)

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/chat/config',
        expect.objectContaining({ credentials: 'include' }),
      ),
    )
    expect(await screen.findByText('每条消息最多上传 5 张图片。')).toBeTruthy()
  })

  it('shows a chat skeleton while restoring a stored conversation', () => {
    sessionStorage.setItem('pi-agent-chat:a1', 'conversation-stored')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>(() => {
            // Keep the stored-conversation request pending for the assertion.
          }),
      ),
    )

    renderUi(
      <AgentChatPanel workspaceId="w1" agentId="a1" agentName="产品评审助手" />,
    )

    expect(screen.getByRole('status', { name: '正在加载对话' })).toBeTruthy()
  })

  it('shows a conversation history skeleton while opening history', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>(() => {
            // Keep the history request pending for the assertion.
          }),
      ),
    )
    const user = userEvent.setup()

    renderUi(
      <AgentChatPanel workspaceId="w1" agentId="a1" agentName="产品评审助手" />,
    )

    await user.click(screen.getByRole('button', { name: '历史对话' }))

    expect(
      screen.getByRole('status', { name: '正在加载历史对话' }),
    ).toBeTruthy()
  })

  it('adds screenshots pasted from the clipboard', async () => {
    renderUi(
      <AgentChatPanel
        workspaceId="w1"
        agentId="a1"
        agentName="产品评审助手"
        defaultProvider="oneapi-comate"
        defaultModelId="DeepSeek-V4-Flash-Vision-Exp"
      />,
    )

    const image = new File(
      [new Uint8Array([137, 80, 78, 71])],
      'screenshot.png',
      {
        type: 'image/png',
      },
    )
    const clipboardData = {
      items: [
        {
          kind: 'file',
          type: 'image/png',
          getAsFile: () => image,
        },
      ],
      files: [image],
      types: ['Files'],
      getData: () => '',
    }

    fireEvent.paste(screen.getByLabelText('输入消息'), { clipboardData })

    expect(
      await screen.findByRole('img', { name: 'screenshot.png' }),
    ).toBeTruthy()
  })

  it('disables image upload and explains when the model is text-only', () => {
    renderUi(
      <AgentChatPanel
        workspaceId="w1"
        agentId="a1"
        agentName="产品评审助手"
        defaultProvider="oneapi-comate"
        defaultModelId="DeepSeek-V4-Flash"
      />,
    )

    expect(
      screen.getByRole('button', { name: '上传图片' }).hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen.getByText(
        '当前模型不支持图片输入，请选择 Vision 模型后重新发布。',
      ),
    ).toBeTruthy()

    const image = new File([new Uint8Array([137, 80, 78, 71])], 'pasted.png', {
      type: 'image/png',
    })
    fireEvent.paste(screen.getByLabelText('输入消息'), {
      clipboardData: {
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => image,
          },
        ],
        files: [image],
        types: ['Files'],
        getData: () => '',
      },
    })

    expect(screen.queryByRole('img', { name: 'pasted.png' })).toBeNull()
    expect(
      screen.queryByText('当前模型不支持图片输入，请先切换 Vision 模型。'),
    ).toBeNull()
  })

  it('uses a round up-arrow composer with image upload', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === '/api/model-config?workspaceId=w1') {
        return Promise.resolve(
          Response.json({
            configured: true,
            options: [
              {
                provider: 'oneapi-comate',
                providerLabel: '内部模型网关',
                modelId: 'DeepSeek-V4-Flash-Vision-Exp',
                baseUrl: 'https://gateway.example.com/v1',
              },
            ],
          }),
        )
      }
      return Promise.resolve(
        Response.json(
          {
            conversationId: 'conversation-image',
            submissionId: 'submission-image',
          },
          { status: 202 },
        ),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentChatPanel
        workspaceId="w1"
        agentId="a1"
        agentName="产品评审助手"
        defaultProvider="oneapi-comate"
        defaultModelId="DeepSeek-V4-Flash-Vision-Exp"
      />,
    )

    const sendButton = screen.getByRole('button', { name: '发送' })
    expect(sendButton.className).toContain('rounded-full')
    expect(screen.getByRole('button', { name: '上传图片' })).toBeTruthy()
    expect(screen.getByLabelText('输入消息').className).toContain('min-h-20')

    const image = new File([new Uint8Array([137, 80, 78, 71])], 'screen.png', {
      type: 'image/png',
    })
    await user.upload(screen.getByLabelText('选择图片文件'), image)

    expect(await screen.findByRole('img', { name: 'screen.png' })).toBeTruthy()
    await user.click(sendButton)

    const request = fetchMock.mock.calls.find(
      ([input]) => String(input) === '/api/chat/a1?workspaceId=w1',
    )?.[1] as RequestInit
    expect(JSON.parse(String(request.body))).toEqual({
      message: '',
      attachments: [
        {
          mimeType: 'image/png',
          data: expect.any(String),
        },
      ],
      idempotencyKey: expect.any(String),
      modelProvider: 'oneapi-comate',
      modelId: 'DeepSeek-V4-Flash-Vision-Exp',
    })
  })

  it('submits a message and renders streamed SSE output', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        {
          conversationId: 'conversation-1',
          submissionId: 'submission-1',
        },
        { status: 202 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentChatPanel workspaceId="w1" agentId="a1" agentName="产品评审助手" />,
    )

    await user.type(screen.getByLabelText('输入消息'), '帮我评审需求')
    await user.click(screen.getByRole('button', { name: '发送' }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat/a1?workspaceId=w1',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"message":"帮我评审需求"'),
      }),
    )
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
    const source = MockEventSource.instances[0]
    expect(source.url).toContain('/api/conversations/conversation-1/events')

    act(() => {
      source.emit('snapshot', {
        type: 'snapshot',
        messages: [],
      })
      source.emit('delta', { type: 'delta', text: '需求风险已确认。' })
      source.emit('done', { type: 'done', text: '需求风险已确认。' })
    })

    expect(await screen.findByText('需求风险已确认。')).toBeTruthy()
    expect(source.closed).toBe(true)
    expect(sessionStorage.getItem('pi-agent-chat:a1')).toBe('conversation-1')
  })

  it('restores a pending UI request with its stored conversation', async () => {
    sessionStorage.setItem('pi-agent-chat:a1', 'conversation-ui-restore')
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (
          url === '/api/conversations/conversation-ui-restore?workspaceId=w1'
        ) {
          return Promise.resolve(
            Response.json([
              {
                id: '1',
                role: 'user',
                text: '帮我部署',
                timestamp: 1,
              },
            ]),
          )
        }
        if (
          url === '/api/conversations/conversation-ui-restore/ui?workspaceId=w1'
        ) {
          return Promise.resolve(
            Response.json({
              interaction: {
                id: 'ui-restored',
                kind: 'single_select',
                request: {
                  kind: 'single_select',
                  title: '选择部署环境',
                  options: [
                    { id: 'dev', label: '开发环境' },
                    { id: 'prod', label: '生产环境' },
                  ],
                },
                status: 'pending',
                createdAt: '2026-10-20T02:00:00.000Z',
              },
            }),
          )
        }
        return Promise.resolve(
          Response.json({ error: 'not_found' }, { status: 404 }),
        )
      }),
    )

    renderUi(
      <AgentChatPanel workspaceId="w1" agentId="a1" agentName="产品评审助手" />,
    )

    expect(
      await screen.findByRole('heading', { name: '选择部署环境' }),
    ).toBeTruthy()
    await waitFor(() => expect(screen.getByText('开发环境')).toBeTruthy())
  })

  it('answers a live UI request and watches the next Agent reply', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/chat/a1?workspaceId=w1') {
        return Promise.resolve(
          Response.json(
            {
              conversationId: 'conversation-ui-live',
              submissionId: 'submission-before-ui',
            },
            { status: 202 },
          ),
        )
      }
      if (
        url ===
        '/api/conversations/conversation-ui-live/ui/ui-live?workspaceId=w1'
      ) {
        return Promise.resolve(
          Response.json(
            {
              conversationId: 'conversation-ui-live',
              submissionId: 'submission-after-ui',
            },
            { status: 202 },
          ),
        )
      }
      return Promise.resolve(
        Response.json({ error: 'not_found' }, { status: 404 }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentChatPanel workspaceId="w1" agentId="a1" agentName="产品评审助手" />,
    )

    await user.type(screen.getByLabelText('输入消息'), '帮我部署')
    await user.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
    const firstSource = MockEventSource.instances[0]
    act(() => {
      firstSource.emit('snapshot', {
        type: 'snapshot',
        messages: [],
      })
      firstSource.emit('ui_request', {
        type: 'ui_request',
        interaction: {
          id: 'ui-live',
          kind: 'single_select',
          request: {
            kind: 'single_select',
            title: '选择部署环境',
            options: [
              { id: 'dev', label: '开发环境' },
              { id: 'prod', label: '生产环境' },
            ],
          },
          status: 'pending',
          createdAt: '2026-10-20T02:00:00.000Z',
        },
      })
      firstSource.emit('done', {
        type: 'done',
        text: '请先选择部署环境。',
      })
    })

    await user.click(await screen.findByRole('radio', { name: /开发环境/ }))
    await user.click(screen.getByRole('button', { name: '提交' }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/conversations/conversation-ui-live/ui/ui-live?workspaceId=w1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          kind: 'single_select',
          selectedOptionId: 'dev',
        }),
      }),
    )
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2))
    const secondSource = MockEventSource.instances[1]
    expect(secondSource.url).toContain('submissionId=submission-after-ui')
    act(() => {
      secondSource.emit('snapshot', {
        type: 'snapshot',
        messages: [
          {
            id: '2',
            role: 'user',
            text: '用户对“选择部署环境”选择了：开发环境。',
            timestamp: 2,
          },
        ],
      })
      secondSource.emit('done', {
        type: 'done',
        text: '将使用开发环境继续部署。',
      })
    })

    expect(await screen.findByText('将使用开发环境继续部署。')).toBeTruthy()
    expect(screen.queryByText('选择部署环境')).toBeNull()
  })

  it('renders streamed thinking, usage, and model changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        {
          conversationId: 'conversation-thinking',
          submissionId: 'submission-thinking',
        },
        { status: 202 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentChatPanel workspaceId="w1" agentId="a1" agentName="产品评审助手" />,
    )

    await user.type(screen.getByLabelText('输入消息'), '展示分析过程')
    await user.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))

    const source = MockEventSource.instances[0]
    act(() => {
      source.emit('snapshot', {
        type: 'snapshot',
        messages: [],
        thinkingPartial: '第一行思考',
        usage: {
          input: 1200,
          output: 348,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 1548,
          costTotal: 0.02,
        },
      })
      source.emit('thinking', {
        type: 'thinking',
        text: '\n第二行结论',
      })
      source.emit('usage', {
        type: 'usage',
        usage: {
          input: 1200,
          output: 400,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 1600,
          costTotal: 0.02,
        },
      })
      source.emit('agent_changed', {
        type: 'agent_changed',
        modelProvider: 'oneapi-comate',
        modelId: 'DeepSeek-V4-Flash-Vision-Exp',
      })
    })

    expect(await screen.findByLabelText('思考过程')).toBeTruthy()
    expect(screen.getByTestId('thinking-track').style.transform).toBe(
      'translateY(-24px)',
    )
    expect(screen.getByText('输入 1.2k')).toBeTruthy()
    expect(screen.getByText('输出 400')).toBeTruthy()
    expect(screen.getByText('总计 1.6k')).toBeTruthy()
    expect(
      screen.getByRole('separator', {
        name: '模型切换到 DeepSeek-V4-Flash-Vision-Exp',
      }),
    ).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '展开思考过程' }))
    expect(screen.getByTestId('thinking-expanded').textContent).toContain(
      '第一行思考\n第二行结论',
    )
  })

  it('inserts a model divider before the next user message after switching models', async () => {
    sessionStorage.setItem('pi-agent-chat:a1', 'conversation-switch')
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/conversations/conversation-switch?workspaceId=w1') {
        return Promise.resolve(
          Response.json([
            {
              id: '1',
              role: 'user',
              text: '旧问题',
              timestamp: 1,
            },
            {
              id: '2',
              role: 'assistant',
              text: '旧回答',
              modelProvider: 'oneapi-comate',
              modelId: 'DeepSeek-V4-Flash',
              timestamp: 2,
            },
          ]),
        )
      }
      if (url === '/api/model-config?workspaceId=w1') {
        return Promise.resolve(
          Response.json({
            configured: true,
            options: [
              {
                provider: 'oneapi-comate',
                providerLabel: '内部模型网关',
                modelId: 'DeepSeek-V4-Flash',
                baseUrl: 'https://gateway.example.com/v1',
              },
              {
                provider: 'oneapi-comate',
                providerLabel: '内部模型网关',
                modelId: 'DeepSeek-V4-Flash-Vision-Exp',
                baseUrl: 'https://gateway.example.com/v1',
              },
            ],
          }),
        )
      }
      if (url === '/api/chat/a1?workspaceId=w1') {
        return Promise.resolve(
          Response.json(
            {
              conversationId: 'conversation-switch',
              submissionId: 'submission-switch',
            },
            { status: 202 },
          ),
        )
      }
      return Promise.resolve(
        Response.json({ error: 'not_found' }, { status: 404 }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentChatPanel
        workspaceId="w1"
        agentId="a1"
        agentName="产品评审助手"
        defaultProvider="oneapi-comate"
        defaultModelId="DeepSeek-V4-Flash"
      />,
    )

    expect(await screen.findByText('旧回答')).toBeTruthy()
    await user.click(
      screen.getByRole('button', {
        name: '模型：DeepSeek-V4-Flash',
      }),
    )
    await user.click(screen.getByText('内部模型网关'))
    fireEvent.click(
      await screen.findByRole('menuitemradio', {
        name: /DeepSeek-V4-Flash-Vision-Exp/,
      }),
    )
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(document.body.style.pointerEvents).not.toBe('none'),
    )
    expect(
      await screen.findByRole('button', {
        name: '模型：DeepSeek-V4-Flash-Vision-Exp',
      }),
    ).toBeTruthy()

    await user.type(screen.getByLabelText('输入消息'), '新模型问题')
    await user.click(screen.getByRole('button', { name: '发送' }))

    expect(
      await screen.findByRole('separator', {
        name: '模型切换到 DeepSeek-V4-Flash-Vision-Exp',
      }),
    ).toBeTruthy()
    const separator = screen.getByRole('separator')
    const newMessage = screen.getByText('新模型问题')
    expect(
      separator.compareDocumentPosition(newMessage) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('shows the application failure instead of reporting a transport break', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        {
          conversationId: 'conversation-2',
          submissionId: 'submission-2',
        },
        { status: 202 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentChatPanel workspaceId="w1" agentId="a1" agentName="产品评审助手" />,
    )

    await user.type(screen.getByLabelText('输入消息'), '测试模型不可用')
    await user.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))

    const source = MockEventSource.instances[0]
    act(() => {
      source.emit('snapshot', {
        type: 'snapshot',
        messages: [],
      })
      source.emit('failed', {
        type: 'failed',
        code: 'model_unavailable',
        message:
          '当前会话使用的模型已不可用。请点击“新对话”使用最新发布版本，或重新选择模型并发布。',
      })
    })

    expect(
      await screen.findByText(
        '当前会话使用的模型已不可用。请点击“新对话”使用最新发布版本，或重新选择模型并发布。',
      ),
    ).toBeTruthy()
    expect(screen.queryByText('回复流中断，请重试或刷新会话。')).toBeNull()
    expect(source.closed).toBe(true)
  })

  it('clears the thinking placeholder when the SSE transport breaks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        {
          conversationId: 'conversation-3',
          submissionId: 'submission-3',
        },
        { status: 202 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentChatPanel workspaceId="w1" agentId="a1" agentName="产品评审助手" />,
    )

    await user.type(screen.getByLabelText('输入消息'), '测试传输中断')
    await user.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))

    const source = MockEventSource.instances[0]
    act(() => {
      source.emit('snapshot', {
        type: 'snapshot',
        messages: [],
      })
      source.emit('error', null)
    })

    expect(
      await screen.findByText('回复流中断，请重试或刷新会话。'),
    ).toBeTruthy()
    expect(screen.queryByText('思考中…')).toBeNull()
    expect(source.closed).toBe(true)
  })

  it('renders assistant Markdown instead of showing the source', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            conversationId: 'conversation-4',
            submissionId: 'submission-4',
          },
          { status: 202 },
        ),
      ),
    )
    const user = userEvent.setup()

    renderUi(
      <AgentChatPanel workspaceId="w1" agentId="a1" agentName="产品评审助手" />,
    )

    await user.type(screen.getByLabelText('输入消息'), '输出 Markdown')
    await user.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))

    const source = MockEventSource.instances[0]
    act(() => {
      source.emit('snapshot', {
        type: 'snapshot',
        messages: [],
      })
      source.emit('done', {
        type: 'done',
        text: '# 评审结论\n\n**高风险**\n\n- 登录边界\n- 回滚方案',
      })
    })

    const heading = await screen.findByRole('heading', {
      level: 1,
      name: /评审结论/,
    })
    expect(heading).toBeTruthy()
    expect(
      heading
        .closest('.markdown-message')
        ?.parentElement?.classList.contains('border'),
    ).toBe(false)
    expect(screen.getByText('高风险').tagName).toBe('STRONG')
    expect(screen.getByText('登录边界').tagName).toBe('LI')
    expect(screen.queryByText('# 评审结论')).toBeNull()
  })

  it('restores the active conversation model after a page refresh', async () => {
    sessionStorage.setItem('pi-agent-chat:a1', 'conversation-model-restore')
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        if (
          String(input) ===
          '/api/conversations/conversation-model-restore?workspaceId=w1'
        ) {
          return Promise.resolve(
            Response.json([
              {
                id: '1',
                role: 'user',
                text: '旧问题',
                timestamp: 1,
              },
              {
                id: '2',
                role: 'assistant',
                text: '旧回答',
                thinking: '旧思考',
                usage: {
                  input: 100,
                  output: 20,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 120,
                  costTotal: 0,
                },
                modelProvider: 'oneapi-comate',
                modelId: 'DeepSeek-V4-Flash',
                timestamp: 2,
              },
            ]),
          )
        }
        if (String(input) === '/api/model-config?workspaceId=w1') {
          return Promise.resolve(
            Response.json({
              configured: true,
              options: [],
            }),
          )
        }
        return Promise.resolve(
          Response.json({ error: 'not_found' }, { status: 404 }),
        )
      }),
    )

    renderUi(
      <AgentChatPanel
        workspaceId="w1"
        agentId="a1"
        agentName="产品评审助手"
        defaultProvider="oneapi-comate"
        defaultModelId="DeepSeek-V4-Flash-Vision-Exp"
      />,
    )

    expect(
      await screen.findByRole('button', {
        name: '模型：DeepSeek-V4-Flash',
      }),
    ).toBeTruthy()
    expect(screen.getByLabelText('思考过程')).toBeTruthy()
  })

  it('opens conversation history and restores a previous conversation', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/agents/a1/conversations?workspaceId=w1') {
        return Promise.resolve(
          Response.json([
            {
              id: 'conversation-history',
              title: '登录需求评审',
              preview: '需要补充回滚方案。',
              modelProvider: 'oneapi-comate',
              modelId: 'DeepSeek-V4-Flash-Vision-Exp',
              messageCount: 2,
              updatedAt: '2026-10-20T02:00:00.000Z',
            },
          ]),
        )
      }
      if (url === '/api/conversations/conversation-history?workspaceId=w1') {
        return Promise.resolve(
          Response.json([
            {
              id: '1',
              role: 'user',
              text: '登录需求评审',
              timestamp: 1,
            },
            {
              id: '2',
              role: 'assistant',
              text: '需要补充回滚方案。',
              timestamp: 2,
            },
          ]),
        )
      }
      return Promise.resolve(
        Response.json({ error: 'not_found' }, { status: 404 }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentChatPanel workspaceId="w1" agentId="a1" agentName="产品评审助手" />,
    )

    await user.click(screen.getByRole('button', { name: '历史对话' }))
    expect(await screen.findByRole('dialog', { name: '历史对话' })).toBeTruthy()
    await user.click(
      await screen.findByRole('button', { name: /登录需求评审/ }),
    )

    expect(await screen.findByText('需要补充回滚方案。')).toBeTruthy()
    expect(sessionStorage.getItem('pi-agent-chat:a1')).toBe(
      'conversation-history',
    )
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '历史对话' })).toBeNull(),
    )
  })

  it('uses the historical conversation model capability for upload', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/agents/a1/conversations?workspaceId=w1') {
        return Promise.resolve(
          Response.json([
            {
              id: 'conversation-text-model',
              title: '旧版文本对话',
              preview: '旧模型回答',
              messageCount: 0,
              modelProvider: 'oneapi-comate',
              modelId: 'DeepSeek-V4-Flash',
              updatedAt: '2026-10-20T02:00:00.000Z',
            },
          ]),
        )
      }
      if (url === '/api/conversations/conversation-text-model?workspaceId=w1') {
        return Promise.resolve(Response.json([]))
      }
      return Promise.resolve(
        Response.json({ error: 'not_found' }, { status: 404 }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentChatPanel
        workspaceId="w1"
        agentId="a1"
        agentName="产品评审助手"
        versionId="vision-version"
        defaultProvider="oneapi-comate"
        defaultModelId="DeepSeek-V4-Flash-Vision-Exp"
      />,
    )

    expect(
      screen.getByRole('button', { name: '上传图片' }).hasAttribute('disabled'),
    ).toBe(false)
    await user.click(screen.getByRole('button', { name: '历史对话' }))
    await user.click(
      await screen.findByRole('button', { name: /旧版文本对话/ }),
    )

    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: '上传图片' })
          .hasAttribute('disabled'),
      ).toBe(true),
    )
    expect(
      screen.getByText(
        '当前模型不支持图片输入，请选择 Vision 模型后重新发布。',
      ),
    ).toBeTruthy()
  })

  it('switches the conversation model from the composer', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/model-config?workspaceId=w1') {
        return Promise.resolve(
          Response.json({
            configured: true,
            options: [
              {
                provider: 'oneapi-comate',
                providerLabel: '内部模型网关',
                modelId: 'DeepSeek-V4-Flash-Vision-Exp',
                baseUrl: 'https://gateway.example.com/v1',
              },
              {
                provider: 'oneapi-comate',
                providerLabel: '内部模型网关',
                modelId: 'DeepSeek-V4-Flash',
                baseUrl: 'https://gateway.example.com/v1',
              },
            ],
          }),
        )
      }
      if (url === '/api/chat/a1?workspaceId=w1' && init?.method === 'POST') {
        return Promise.resolve(
          Response.json(
            {
              conversationId: 'conversation-switch',
              submissionId: 'submission-switch',
            },
            { status: 202 },
          ),
        )
      }
      return Promise.resolve(
        Response.json({ error: 'not_found' }, { status: 404 }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentChatPanel
        workspaceId="w1"
        agentId="a1"
        agentName="产品评审助手"
        versionId="vision-version"
        defaultProvider="oneapi-comate"
        defaultModelId="DeepSeek-V4-Flash-Vision-Exp"
      />,
    )

    await user.click(
      await screen.findByRole('button', { name: /模型.*Vision-Exp/ }),
    )
    await user.hover(
      await screen.findByRole('menuitem', { name: /内部模型网关/ }),
    )
    const textModel = await screen.findByRole('menuitemradio', {
      name: 'DeepSeek-V4-Flash',
    })
    textModel.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(
      screen.getByRole('button', { name: '模型：DeepSeek-V4-Flash' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: '上传图片' }).hasAttribute('disabled'),
    ).toBe(true)

    await user.type(screen.getByLabelText('输入消息'), '切换模型测试')
    await user.click(screen.getByRole('button', { name: '发送' }))

    const chatCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/chat/a1?workspaceId=w1' &&
        init?.method === 'POST',
    )
    expect(JSON.parse(String(chatCall?.[1]?.body))).toEqual(
      expect.objectContaining({
        modelProvider: 'oneapi-comate',
        modelId: 'DeepSeek-V4-Flash',
      }),
    )
  })
})
