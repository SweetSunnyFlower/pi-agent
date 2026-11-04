import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from '@earendil-works/pi-ai'
import {
  createRegistry,
  Harness,
  MemoryStorage,
} from '@earendil-works/pi-durable'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '#/db'
import { parseServerEnv } from '#/server/env.server'
import {
  createAgent,
  publishAgentVersion,
} from '#/server/platform/agent-version.server'
import {
  ensureDevelopmentSeed,
  resolvePrincipal,
} from '#/server/platform/workspace-access.server'

import {
  conversationEventsHandler,
  getConversationUiHandler,
  getChatConfigHandler,
  getConversationHandler,
  listConversationsHandler,
  postChatHandler,
  postConversationUiHandler,
  waitConversationHandler,
} from './chat-http.server'

const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  APP_DATABASE_PATH: ':memory:',
  CHANNEL_SECRET_KEK: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
})

function request(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('chat HTTP services', () => {
  let db: ReturnType<typeof createDatabase>
  let harness: Harness
  let faux: ReturnType<typeof fauxProvider>
  let models: ReturnType<typeof createModels>
  let registry: ReturnType<typeof createRegistry>
  let workspaceId: string
  let agentId: string
  let principal: Awaited<ReturnType<typeof resolvePrincipal>>

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
      models: [{ id: 'faux-chat', reasoning: true }],
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

  it('returns the configured image limit', async () => {
    const response = getChatConfigHandler({
      ...env,
      CHAT_MAX_IMAGES_PER_MESSAGE: 7,
    })

    await expect(response.json()).resolves.toEqual({
      maxImagesPerMessage: 7,
    })
  })

  it('rejects attachments above the configured image limit', async () => {
    const data =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2mQAAAAASUVORK5CYII='
    const response = await postChatHandler(
      request(
        `http://localhost:3000/api/chat/${agentId}?workspaceId=${workspaceId}`,
        'POST',
        {
          message: '分析图片。',
          attachments: Array.from({ length: 3 }, () => ({
            mimeType: 'image/png',
            data,
          })),
          idempotencyKey: '8f8e72f5-d6ae-4ab6-bf7d-7f9d9679a0fa',
        },
      ),
      {
        db,
        env: { ...env, CHAT_MAX_IMAGES_PER_MESSAGE: 2 },
        workspaceId,
        agentId,
        harness,
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'validation_error',
    })
  })

  it('submits, waits for, and reloads a Web conversation', async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxText('持久化后的最终回答。')]),
    ])
    const postResponse = await postChatHandler(
      request(
        `http://localhost:3000/api/chat/${agentId}?workspaceId=${workspaceId}`,
        'POST',
        {
          message: '请评审。',
          idempotencyKey: '7cb828a1-2c75-4832-989f-53f1c020c7d2',
        },
      ),
      { db, env, workspaceId, agentId, harness, registry, models },
    )
    expect(postResponse.status).toBe(202)
    const submitted = (await postResponse.json()) as {
      conversationId: string
      submissionId: string
    }

    const waitResponse = await waitConversationHandler(
      request(
        `http://localhost:3000/api/conversations/${submitted.conversationId}/wait?workspaceId=${workspaceId}&submissionId=${submitted.submissionId}`,
        'POST',
      ),
      {
        db,
        env,
        workspaceId,
        conversationId: submitted.conversationId,
        harness,
      },
    )
    expect(waitResponse.status).toBe(200)
    await expect(waitResponse.json()).resolves.toEqual(
      expect.objectContaining({ text: '持久化后的最终回答。' }),
    )

    const conversationResponse = await getConversationHandler(
      request(
        `http://localhost:3000/api/conversations/${submitted.conversationId}?workspaceId=${workspaceId}`,
        'GET',
      ),
      {
        db,
        env,
        workspaceId,
        conversationId: submitted.conversationId,
        harness,
      },
    )
    expect(conversationResponse.status).toBe(200)
    const messages = (await conversationResponse.json()) as Array<{
      role: string
      text: string
    }>
    expect(messages.map((message) => message.text)).toEqual([
      '请评审。',
      '持久化后的最终回答。',
    ])
  })

  it('streams a complete SSE response', async () => {
    faux.setResponses([
      fauxAssistantMessage([
        fauxThinking('检查输入。\n确认风险。'),
        fauxText('流式最终回答。'),
      ]),
    ])
    const postResponse = await postChatHandler(
      request(
        `http://localhost:3000/api/chat/${agentId}?workspaceId=${workspaceId}`,
        'POST',
        {
          message: '开始流式回答。',
          idempotencyKey: 'e91bb6c7-9eb5-4332-b2a0-0030142238ca',
        },
      ),
      { db, env, workspaceId, agentId, harness, registry, models },
    )
    const submitted = (await postResponse.json()) as {
      conversationId: string
      submissionId: string
    }

    const eventResponse = await conversationEventsHandler(
      request(
        `http://localhost:3000/api/conversations/${submitted.conversationId}/events?workspaceId=${workspaceId}&submissionId=${submitted.submissionId}`,
        'GET',
      ),
      {
        db,
        env,
        workspaceId,
        conversationId: submitted.conversationId,
        harness,
      },
    )
    expect(eventResponse.headers.get('content-type')).toContain(
      'text/event-stream',
    )
    const body = await eventResponse.text()
    expect(body).toContain('event: snapshot')
    expect(body).toContain('event: done')
    expect(body).toContain('流式最终回答。')
    expect(body).toContain('"thinking":"检查输入。\\n确认风险。"')
    expect(body).toContain('"totalTokens":')
  })

  it('streams a durable UI request when ask_user runs', async () => {
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall('platform_ask_user', {
            kind: 'confirm',
            title: '确认继续发布',
            confirmLabel: '继续',
            cancelLabel: '取消',
          }),
        ],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage([fauxText('请确认是否继续发布。')]),
    ])
    const postResponse = await postChatHandler(
      request(
        `http://localhost:3000/api/chat/${agentId}?workspaceId=${workspaceId}`,
        'POST',
        {
          message: '准备发布。',
          idempotencyKey: 'f85e33da-71ef-4a58-b467-d9fc0e7970cc',
        },
      ),
      { db, env, workspaceId, agentId, harness, registry, models },
    )
    const submitted = (await postResponse.json()) as {
      conversationId: string
      submissionId: string
    }

    const eventResponse = await conversationEventsHandler(
      request(
        `http://localhost:3000/api/conversations/${submitted.conversationId}/events?workspaceId=${workspaceId}&submissionId=${submitted.submissionId}`,
        'GET',
      ),
      {
        db,
        env,
        workspaceId,
        conversationId: submitted.conversationId,
        harness,
      },
    )
    const body = await eventResponse.text()

    expect(body).toContain('event: ui_request')
    expect(body).toContain('"title":"确认继续发布"')
    expect(body).toContain('"confirmLabel":"继续"')
  })

  it('persists, restores, and answers a structured UI request', async () => {
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
            submitLabel: '确认环境',
          }),
        ],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage([fauxText('请先选择部署环境。')]),
      fauxAssistantMessage([fauxText('将使用开发环境继续部署。')]),
    ])
    const postResponse = await postChatHandler(
      request(
        `http://localhost:3000/api/chat/${agentId}?workspaceId=${workspaceId}`,
        'POST',
        {
          message: '帮我部署。',
          idempotencyKey: '5423125d-b42e-4c11-97bf-d6fcbbd86cc6',
        },
      ),
      { db, env, workspaceId, agentId, harness, registry, models },
    )
    const submitted = (await postResponse.json()) as {
      conversationId: string
      submissionId: string
    }
    await waitConversationHandler(
      request(
        `http://localhost:3000/api/conversations/${submitted.conversationId}/wait?workspaceId=${workspaceId}&submissionId=${submitted.submissionId}`,
        'POST',
      ),
      {
        db,
        env,
        workspaceId,
        conversationId: submitted.conversationId,
        harness,
      },
    )

    const getResponse = await getConversationUiHandler(
      request(
        `http://localhost:3000/api/conversations/${submitted.conversationId}/ui?workspaceId=${workspaceId}`,
        'GET',
      ),
      {
        db,
        env,
        workspaceId,
        conversationId: submitted.conversationId,
        harness,
      },
    )
    expect(getResponse.status).toBe(200)
    const restored = (await getResponse.json()) as {
      interaction: {
        id: string
        status: string
        request: {
          title: string
          submitLabel?: string
        }
      }
    }
    expect(restored.interaction).toMatchObject({
      status: 'pending',
      request: {
        title: '选择部署环境',
        submitLabel: '确认环境',
      },
    })

    const invalidResponse = await postConversationUiHandler(
      request(
        `http://localhost:3000/api/conversations/${submitted.conversationId}/ui/${restored.interaction.id}?workspaceId=${workspaceId}`,
        'POST',
        {
          kind: 'single_select',
          selectedOptionId: 'unknown',
        },
      ),
      {
        db,
        env,
        workspaceId,
        conversationId: submitted.conversationId,
        harness,
      },
    )
    expect(invalidResponse.status).toBe(400)
    await expect(invalidResponse.json()).resolves.toEqual({
      error: 'invalid_ui_response',
    })

    const answerResponse = await postConversationUiHandler(
      request(
        `http://localhost:3000/api/conversations/${submitted.conversationId}/ui/${restored.interaction.id}?workspaceId=${workspaceId}`,
        'POST',
        {
          kind: 'single_select',
          selectedOptionId: 'dev',
          otherText: '需要先做灰度验证',
        },
      ),
      {
        db,
        env,
        workspaceId,
        conversationId: submitted.conversationId,
        harness,
      },
    )
    expect(answerResponse.status).toBe(202)
    const answerSubmission = (await answerResponse.json()) as {
      conversationId: string
      submissionId: string
    }

    const answer = await waitConversationHandler(
      request(
        `http://localhost:3000/api/conversations/${submitted.conversationId}/wait?workspaceId=${workspaceId}&submissionId=${answerSubmission.submissionId}`,
        'POST',
      ),
      {
        db,
        env,
        workspaceId,
        conversationId: submitted.conversationId,
        harness,
      },
    )
    await expect(answer.json()).resolves.toMatchObject({
      text: '将使用开发环境继续部署。',
    })
    const conversation = await getConversationHandler(
      request(
        `http://localhost:3000/api/conversations/${submitted.conversationId}?workspaceId=${workspaceId}`,
        'GET',
      ),
      {
        db,
        env,
        workspaceId,
        conversationId: submitted.conversationId,
        harness,
      },
    )
    const messages = (await conversation.json()) as Array<{
      role: string
      text: string
    }>
    expect(
      messages.find(
        (message) =>
          message.role === 'user' && message.text.includes('需要先做灰度验证'),
      )?.text,
    ).toContain('用户对“选择部署环境”选择了：开发环境。')

    const duplicateResponse = await postConversationUiHandler(
      request(
        `http://localhost:3000/api/conversations/${submitted.conversationId}/ui/${restored.interaction.id}?workspaceId=${workspaceId}`,
        'POST',
        {
          kind: 'single_select',
          selectedOptionId: 'dev',
        },
      ),
      {
        db,
        env,
        workspaceId,
        conversationId: submitted.conversationId,
        harness,
      },
    )
    await expect(duplicateResponse.json()).resolves.toEqual(answerSubmission)
  })

  it('lists conversations for the current Agent and user', async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxText('第一轮结论。')]),
      fauxAssistantMessage([fauxText('第二轮结论。')]),
    ])
    for (const [message, idempotencyKey] of [
      ['第一轮需求。', '4c05e1c9-76bc-40eb-8d83-b19c48c48ef5'],
      ['第二轮风险。', '2d5014b2-1ea2-49d9-8f9f-e76e3cac8d38'],
    ]) {
      const postResponse = await postChatHandler(
        request(
          `http://localhost:3000/api/chat/${agentId}?workspaceId=${workspaceId}`,
          'POST',
          { message, idempotencyKey },
        ),
        { db, env, workspaceId, agentId, harness },
      )
      const submitted = (await postResponse.json()) as {
        conversationId: string
        submissionId: string
      }
      await waitConversationHandler(
        request(
          `http://localhost:3000/api/conversations/${submitted.conversationId}/wait?workspaceId=${workspaceId}&submissionId=${submitted.submissionId}`,
          'POST',
        ),
        {
          db,
          env,
          workspaceId,
          conversationId: submitted.conversationId,
          harness,
        },
      )
    }

    const response = await listConversationsHandler(
      request(
        `http://localhost:3000/api/agents/${agentId}/conversations?workspaceId=${workspaceId}`,
        'GET',
      ),
      { db, env, workspaceId, agentId, harness },
    )

    expect(response.status).toBe(200)
    const conversations = (await response.json()) as Array<{
      title: string
      preview: string
    }>
    expect(conversations).toHaveLength(2)
    expect(conversations[0]).toMatchObject({
      title: '第二轮风险。',
      preview: '第二轮结论。',
    })
  })

  it('streams a named application failure for an unavailable model', async () => {
    const agent = await createAgent(db, principal!, workspaceId, {
      name: `Missing Model ${Math.random()}`,
      instructions: 'Use a missing model.',
      modelProvider: 'oneapi-comate',
      modelId: 'removed-model',
      thinkingLevel: 'medium',
    })
    await publishAgentVersion(db, principal!, workspaceId, agent.id)
    const postResponse = await postChatHandler(
      request(
        `http://localhost:3000/api/chat/${agent.id}?workspaceId=${workspaceId}`,
        'POST',
        {
          message: '测试不可用模型。',
          idempotencyKey: '3fed6108-6b11-465d-aa94-f5c6f4f4b47d',
        },
      ),
      { db, env, workspaceId, agentId: agent.id, harness },
    )
    const submitted = (await postResponse.json()) as {
      conversationId: string
      submissionId: string
    }

    const eventResponse = await conversationEventsHandler(
      request(
        `http://localhost:3000/api/conversations/${submitted.conversationId}/events?workspaceId=${workspaceId}&submissionId=${submitted.submissionId}`,
        'GET',
      ),
      {
        db,
        env,
        workspaceId,
        conversationId: submitted.conversationId,
        harness,
      },
    )
    const body = await eventResponse.text()

    expect(body).toContain('event: failed')
    expect(body).not.toContain('event: error')
    expect(body).toContain('"code":"model_unavailable"')
    expect(body).toContain(
      '当前会话使用的模型已不可用。请点击“新对话”使用最新发布版本，或重新选择模型并发布。',
    )
  })
})
