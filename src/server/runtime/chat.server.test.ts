import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
  createModels,
} from '@earendil-works/pi-ai'
import {
  createRegistry,
  Harness,
  MemoryStorage,
} from '@earendil-works/pi-durable'
import type { ConversationId } from '@earendil-works/pi-durable'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase } from '#/db'
import { conversationBindings, uiInteractions } from '#/db/schema'
import { parseServerEnv } from '#/server/env.server'
import {
  createAgent,
  publishAgentVersion,
} from '#/server/platform/agent-version.server'
import {
  createHttpTool,
  replaceDraftTools,
} from '#/server/platform/capability.server'
import {
  ensureDevelopmentSeed,
  resolvePrincipal,
} from '#/server/platform/workspace-access.server'

import {
  getWebConversationMessages,
  listWebConversations,
  sendWebMessage,
  waitForWebAnswer,
} from './chat.server'

const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  APP_DATABASE_PATH: ':memory:',
  CHANNEL_SECRET_KEK: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
})

describe('Web chat runtime', () => {
  let db: ReturnType<typeof createDatabase>
  let harness: Harness
  let registry: ReturnType<typeof createRegistry>
  let models: ReturnType<typeof createModels>
  let faux: ReturnType<typeof fauxProvider>
  let principal: Awaited<ReturnType<typeof resolvePrincipal>>
  let workspaceId: string
  let agentId: string

  beforeEach(async () => {
    db = createDatabase(':memory:')
    migrate(db, { migrationsFolder: './drizzle' })
    await ensureDevelopmentSeed(db, env)
    principal = await resolvePrincipal(
      db,
      {
        username: 'alice',
        name: null,
        email: null,
        expiresAt: Date.now() + 60_000,
        authMode: 'development',
      },
      env,
    )
    workspaceId = principal!.workspaces[0].workspaceId

    faux = fauxProvider({
      provider: 'oneapi-comate',
      models: [
        { id: 'faux-chat', reasoning: true },
        { id: 'faux-chat-2', reasoning: true },
      ],
    })
    models = createModels()
    models.setProvider(faux.provider)
    registry = createRegistry()
    harness = await Harness.open(
      new MemoryStorage(),
      { models, registry },
      BACKGROUND_CONTEXT,
    )

    const agent = await createAgent(db, principal!, workspaceId, {
      name: 'Reviewer',
      instructions: 'Review changes.',
      modelProvider: 'oneapi-comate',
      modelId: 'faux-chat',
      thinkingLevel: 'medium',
    })
    agentId = agent.id
    await publishAgentVersion(db, principal!, workspaceId, agentId)
  })

  afterEach(async () => {
    await harness.close(BACKGROUND_CONTEXT)
    db.$client.close()
  })

  it('persists a conversation and returns the durable final answer', async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxText('这是 Agent 的最终回答。')]),
    ])

    const submitted = await sendWebMessage(
      db,
      principal!,
      workspaceId,
      agentId,
      {
        conversationId: undefined,
        message: '请评审这个需求。',
        idempotencyKey: '6b1eb5d0-ecb7-4a70-b0cf-5e4c2430de65',
      },
      harness,
    )
    expect(submitted.conversationId).toBeTruthy()
    expect(submitted.submissionId).toBeTruthy()

    const answer = await waitForWebAnswer(
      db,
      principal!,
      workspaceId,
      submitted.conversationId,
      submitted.submissionId,
      harness,
    )
    expect(answer.text).toBe('这是 Agent 的最终回答。')

    const messages = await getWebConversationMessages(
      db,
      principal!,
      workspaceId,
      submitted.conversationId,
      harness,
    )
    expect(messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ])
  })

  it('restores thinking and usage from durable history', async () => {
    const response = fauxAssistantMessage([
      fauxThinking('先确认输入。\n再检查风险。'),
      fauxText('这是带思考过程的回答。'),
    ])
    response.usage = {
      input: 120,
      output: 40,
      cacheRead: 12,
      cacheWrite: 4,
      reasoning: 16,
      totalTokens: 176,
      cost: {
        input: 0.001,
        output: 0.002,
        cacheRead: 0.0001,
        cacheWrite: 0.0002,
        total: 0.0033,
      },
    }
    faux.setResponses([response])

    const submitted = await sendWebMessage(
      db,
      principal!,
      workspaceId,
      agentId,
      {
        message: '展示思考过程',
        idempotencyKey: '995d110c-c4f0-4508-9256-aa5bdb3975f1',
      },
      harness,
    )
    await waitForWebAnswer(
      db,
      principal!,
      workspaceId,
      submitted.conversationId,
      submitted.submissionId,
      harness,
    )

    const messages = await getWebConversationMessages(
      db,
      principal!,
      workspaceId,
      submitted.conversationId,
      harness,
    )
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      text: '这是带思考过程的回答。',
      thinking: '先确认输入。\n再检查风险。',
      modelProvider: 'oneapi-comate',
      modelId: 'faux-chat',
      usage: expect.objectContaining({
        input: expect.any(Number),
        output: expect.any(Number),
        cacheRead: expect.any(Number),
        cacheWrite: expect.any(Number),
        totalTokens: expect.any(Number),
        costTotal: expect.any(Number),
      }),
    })
  })

  it('restores model changes as dividers in durable history', async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxText('默认模型回答。')]),
      fauxAssistantMessage([fauxText('切换后回答。')]),
    ])
    const first = await sendWebMessage(
      db,
      principal!,
      workspaceId,
      agentId,
      {
        message: '第一轮',
        idempotencyKey: 'b2826e4c-a4d4-466b-92f7-ea0e0a934dd7',
      },
      harness,
    )
    await waitForWebAnswer(
      db,
      principal!,
      workspaceId,
      first.conversationId,
      first.submissionId,
      harness,
    )

    const second = await sendWebMessage(
      db,
      principal!,
      workspaceId,
      agentId,
      {
        conversationId: first.conversationId,
        message: '第二轮',
        modelProvider: 'oneapi-comate',
        modelId: 'faux-chat-2',
        idempotencyKey: 'bf3a64ca-a58b-4bac-a90d-97546dbf287c',
      },
      harness,
      undefined,
      models,
    )
    await waitForWebAnswer(
      db,
      principal!,
      workspaceId,
      second.conversationId,
      second.submissionId,
      harness,
    )

    const messages = await getWebConversationMessages(
      db,
      principal!,
      workspaceId,
      first.conversationId,
      harness,
    )
    expect(messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'model-change',
      'user',
      'assistant',
    ])
    expect(messages[2]).toMatchObject({
      role: 'model-change',
      modelProvider: 'oneapi-comate',
      modelId: 'faux-chat-2',
    })
  })

  it('deduplicates retries by idempotency key', async () => {
    faux.setResponses([fauxAssistantMessage([fauxText('只回答一次。')])])
    const input = {
      conversationId: undefined,
      message: '重复请求',
      idempotencyKey: '3158c2f5-5f38-4c23-8697-0477f05d24ce',
    }

    const first = await sendWebMessage(
      db,
      principal!,
      workspaceId,
      agentId,
      input,
      harness,
    )
    const second = await sendWebMessage(
      db,
      principal!,
      workspaceId,
      agentId,
      { ...input, conversationId: first.conversationId },
      harness,
    )

    expect(second.conversationId).toBe(first.conversationId)
    expect(second.submissionId).toBe(first.submissionId)
  })

  it('persists uploaded images as part of the durable user message', async () => {
    faux.setResponses([fauxAssistantMessage([fauxText('图片已收到。')])])
    const data =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2mQAAAAASUVORK5CYII='

    const submitted = await sendWebMessage(
      db,
      principal!,
      workspaceId,
      agentId,
      {
        message: '',
        attachments: [{ mimeType: 'image/png', data }],
        idempotencyKey: '4fb16dc5-1b69-4b5e-8f49-77d52ce6d823',
      },
      harness,
    )
    await waitForWebAnswer(
      db,
      principal!,
      workspaceId,
      submitted.conversationId,
      submitted.submissionId,
      harness,
    )

    const messages = await getWebConversationMessages(
      db,
      principal!,
      workspaceId,
      submitted.conversationId,
      harness,
    )
    expect(messages[0]).toEqual(
      expect.objectContaining({
        role: 'user',
        text: '请分析这张图片。',
        attachments: [{ mimeType: 'image/png', data }],
      }),
    )
  })

  it('switches the model of an existing conversation', async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxText('默认模型回答。')]),
      fauxAssistantMessage([fauxText('切换后回答。')]),
    ])
    const first = await sendWebMessage(
      db,
      principal!,
      workspaceId,
      agentId,
      {
        message: '第一轮',
        idempotencyKey: '2c03c767-4061-48e7-89d8-ea732fa87d2d',
      },
      harness,
    )
    await waitForWebAnswer(
      db,
      principal!,
      workspaceId,
      first.conversationId,
      first.submissionId,
      harness,
    )

    await sendWebMessage(
      db,
      principal!,
      workspaceId,
      agentId,
      {
        conversationId: first.conversationId,
        message: '第二轮',
        modelProvider: 'oneapi-comate',
        modelId: 'faux-chat-2',
        idempotencyKey: '2f10310c-cb2f-49c4-a795-0df98dc12cf2',
      },
      harness,
      undefined,
      models,
    )

    const binding = db
      .select()
      .from(conversationBindings)
      .where(eq(conversationBindings.id, first.conversationId))
      .get()
    const conversation = await harness.conversation(
      Number(binding?.piConversationId) as ConversationId,
      BACKGROUND_CONTEXT,
    )
    expect((await conversation!.agent(BACKGROUND_CONTEXT)).model).toEqual({
      provider: 'oneapi-comate',
      modelId: 'faux-chat-2',
    })
  })

  it('lists the current user conversations with summaries, newest first', async () => {
    faux.setResponses([
      fauxAssistantMessage([
        fauxText('**第一段回答** [详情](https://example.com)'),
      ]),
      fauxAssistantMessage([fauxText('第二段回答')]),
    ])
    const first = await sendWebMessage(
      db,
      principal!,
      workspaceId,
      agentId,
      {
        message: '第一段需求评审',
        idempotencyKey: '238f06cd-a386-41cd-bdf0-363ca2ade70c',
      },
      harness,
    )
    await waitForWebAnswer(
      db,
      principal!,
      workspaceId,
      first.conversationId,
      first.submissionId,
      harness,
    )
    const second = await sendWebMessage(
      db,
      principal!,
      workspaceId,
      agentId,
      {
        message: '第二段上线风险',
        idempotencyKey: '9eb394a0-f430-4511-86bf-6f52bc9a2dc3',
      },
      harness,
    )
    await waitForWebAnswer(
      db,
      principal!,
      workspaceId,
      second.conversationId,
      second.submissionId,
      harness,
    )

    const history = await listWebConversations(
      db,
      principal!,
      workspaceId,
      agentId,
      harness,
    )

    expect(history.map((conversation) => conversation.id)).toEqual([
      second.conversationId,
      first.conversationId,
    ])
    expect(history[0]).toMatchObject({
      title: '第二段上线风险',
      preview: '第二段回答',
      messageCount: 2,
    })
    expect(history[1]).toMatchObject({
      title: '第一段需求评审',
      preview: '第一段回答 详情',
      messageCount: 2,
    })
  })

  it('executes a selected HTTP tool through Pi Durable', async () => {
    const agent = await createAgent(db, principal!, workspaceId, {
      name: `Tool Agent ${Math.random()}`,
      instructions: 'Use the echo tool.',
      modelProvider: 'oneapi-comate',
      modelId: 'faux-chat',
      thinkingLevel: 'medium',
    })
    const tool = await createHttpTool(db, principal!, workspaceId, {
      name: 'Echo',
      description: 'Echo text.',
      endpoint: 'https://api.example.com/echo',
      method: 'POST',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    })
    await replaceDraftTools(db, principal!, workspaceId, agent.id, {
      capabilityVersionIds: [tool.versionId],
    })
    await publishAgentVersion(db, principal!, workspaceId, agent.id)

    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ echoed: 'hello' }))
    vi.stubGlobal('fetch', fetchMock)
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('platform_tool_http_echo_1_0_0', { text: 'hello' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage([fauxText('工具返回 hello')]),
    ])

    const submitted = await sendWebMessage(
      db,
      principal!,
      workspaceId,
      agent.id,
      {
        message: '调用工具',
        idempotencyKey: '20f461fe-1806-4c80-9b66-aee3b93bfe6f',
      },
      harness,
      registry,
    )
    const answer = await waitForWebAnswer(
      db,
      principal!,
      workspaceId,
      submitted.conversationId,
      submitted.submissionId,
      harness,
    )

    expect(answer.text).toBe('工具返回 hello')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/echo',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'hello' }),
      }),
    )
    const messages = await getWebConversationMessages(
      db,
      principal!,
      workspaceId,
      submitted.conversationId,
      harness,
    )
    expect(messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ])
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      text: '工具返回 hello',
    })
    vi.unstubAllGlobals()
  })

  it('persists an ask_user interaction requested by the model', async () => {
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall('platform_ask_user', {
            kind: 'single_select',
            title: '选择部署环境',
            description: '请选择本次要使用的环境。',
            options: [
              { id: 'dev', label: '开发环境' },
              { id: 'prod', label: '生产环境' },
            ],
          }),
        ],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage([fauxText('请在上方选择部署环境。')]),
    ])

    const submitted = await sendWebMessage(
      db,
      principal!,
      workspaceId,
      agentId,
      {
        message: '帮我部署',
        idempotencyKey: 'bd0ba1a5-3b58-4e84-8447-14b4307cc287',
      },
      harness,
      registry,
    )
    await waitForWebAnswer(
      db,
      principal!,
      workspaceId,
      submitted.conversationId,
      submitted.submissionId,
      harness,
    )

    expect(db.select().from(uiInteractions).get()).toMatchObject({
      kind: 'single_select',
      status: 'pending',
      requestJson: {
        kind: 'single_select',
        title: '选择部署环境',
      },
    })
  })

  it('reports a published Agent whose model is no longer available', async () => {
    const agent = await createAgent(db, principal!, workspaceId, {
      name: `Unavailable Model ${Math.random()}`,
      instructions: 'Use the configured model.',
      modelProvider: 'oneapi-comate',
      modelId: 'removed-model',
      thinkingLevel: 'medium',
    })
    await publishAgentVersion(db, principal!, workspaceId, agent.id)
    const submitted = await sendWebMessage(
      db,
      principal!,
      workspaceId,
      agent.id,
      {
        message: '测试不可用模型',
        idempotencyKey: 'f180610a-975c-475d-9290-113f53ecae07',
      },
      harness,
    )

    await expect(
      waitForWebAnswer(
        db,
        principal!,
        workspaceId,
        submitted.conversationId,
        submitted.submissionId,
        harness,
      ),
    ).rejects.toMatchObject({
      code: 'model_unavailable',
      message:
        '当前会话使用的模型已不可用。请点击“新对话”使用最新发布版本，或重新选择模型并发布。',
    })
  })
})
