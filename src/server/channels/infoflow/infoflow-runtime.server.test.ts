import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
} from '@earendil-works/pi-ai'
import {
  createRegistry,
  Harness,
  MemoryStorage,
} from '@earendil-works/pi-durable'
import type { ConversationId } from '@earendil-works/pi-durable'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase } from '#/db'
import {
  conversationBindings,
  inboundEvents,
  outboundDeliveries,
} from '#/db/schema'
import { parseServerEnv } from '#/server/env.server'
import {
  createAgent,
  createNextVersion,
  publishAgentVersion,
} from '#/server/platform/agent-version.server'
import {
  createHttpTool,
  replaceDraftTools,
} from '#/server/platform/capability.server'
import { saveInfoFlowChannel } from '#/server/platform/channel.server'
import { ensureDevelopmentSeed, resolvePrincipal } from '#/server/platform/workspace-access.server'
import { SecretBox } from '#/server/secrets/secret-box.server'

import {
  acceptInfoFlowEvent,
  runInfoFlowWorker,
} from './infoflow-runtime.server'

const key = Buffer.alloc(32, 1).toString('base64')
const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  APP_DATABASE_PATH: ':memory:',
  CHANNEL_SECRET_KEK: key,
})

describe('InfoFlow durable runtime', () => {
  let db: ReturnType<typeof createDatabase>
  let harness: Harness
  let registry: ReturnType<typeof createRegistry>
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
      models: [{ id: 'faux-chat', reasoning: true }],
    })
    const models = createModels()
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
    await saveInfoFlowChannel(
      db,
      principal!,
      workspaceId,
      agentId,
      {
        enabled: true,
        infoflowAgentId: '50655',
        appKey: 'app-key-123456',
        appSecret: 'app-secret-123456',
      },
      new SecretBox(key),
    )
  })

  afterEach(async () => {
    await harness.close(BACKGROUND_CONTEXT)
    db.$client.close()
  })

  it('durably submits one event and sends one final Markdown reply', async () => {
    faux.setResponses([fauxAssistantMessage([fauxText('完整最终回答')])])
    const sendFinal = vi.fn().mockResolvedValue('provider-message-1')
    const event = {
      agentId,
      agentChannelId: '',
      connectionId: '',
      externalEventId: 'message-1',
      externalThreadId: 'alice',
      senderExternalId: 'alice',
      chatType: 'private' as const,
      replyTargetType: 'user' as const,
      replyTargetId: 'alice',
      contentText: '请评审',
      rawMetadataJson: { MsgId: 'message-1' },
      scopeKey: 'infoflow:private:alice',
      occurredAt: new Date(),
    }

    const accepted = await acceptInfoFlowEvent(
      db,
      workspaceId,
      agentId,
      event,
      harness,
      registry,
      env,
      new SecretBox(key),
    )
    expect(accepted).toBe(true)
    await runInfoFlowWorker(
      db,
      harness,
      registry,
      env,
      new SecretBox(key),
      async () => ({ send: sendFinal }),
    )

    const inbound = db.select().from(inboundEvents).get()
    expect(inbound?.status).toBe('answered')
    expect(inbound?.responseText).toBe('完整最终回答')
    const outbound = db.select().from(outboundDeliveries).get()
    expect(outbound?.status).toBe('sent')
    expect(sendFinal).toHaveBeenCalledWith({
      targetType: 'user',
      targetId: 'alice',
      text: '完整最终回答',
      msgType: 'md',
    })
  })

  it('persists an image attachment and submits it to Pi', async () => {
    const data =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2mQAAAAASUVORK5CYII='
    faux.setResponses([
      fauxAssistantMessage([fauxText('图片分析完成')]),
    ])
    await acceptInfoFlowEvent(
      db,
      workspaceId,
      agentId,
      {
        agentId,
        agentChannelId: '',
        connectionId: '',
        externalEventId: 'image-1:image',
        externalThreadId: 'alice',
        senderExternalId: 'alice',
        chatType: 'private',
        replyTargetType: 'user',
        replyTargetId: 'alice',
        contentText: '请分析这张图片。',
        images: [{ data, mimeType: 'image/png' }],
        rawMetadataJson: { MsgId: 'image-1', MsgType: 'image' },
        scopeKey: 'infoflow:private:alice',
        occurredAt: new Date(),
      },
      harness,
      registry,
      env,
      new SecretBox(key),
    )
    await runInfoFlowWorker(
      db,
      harness,
      registry,
      env,
      new SecretBox(key),
      async () => ({ send: vi.fn().mockResolvedValue('sent-image') }),
    )

    const inbound = db.select().from(inboundEvents).get()
    expect(inbound?.attachmentsJson).toEqual([
      { data, mimeType: 'image/png' },
    ])
    const binding = db.select().from(conversationBindings).get()
    const conversation = await harness.conversation(
      Number(binding?.piConversationId) as ConversationId,
      BACKGROUND_CONTEXT,
    )
    const context = await conversation!.context(BACKGROUND_CONTEXT)
    expect(context.entries[0].model?.[0]?.content).toEqual([
      { type: 'text', text: '请分析这张图片。' },
      { type: 'image', data, mimeType: 'image/png' },
    ])
  })

  it('does not admit the same provider message twice', async () => {
    const event = {
      agentId,
      agentChannelId: '',
      connectionId: '',
      externalEventId: 'duplicate-1',
      externalThreadId: 'alice',
      senderExternalId: 'alice',
      chatType: 'private' as const,
      replyTargetType: 'user' as const,
      replyTargetId: 'alice',
      contentText: 'hello',
      rawMetadataJson: {},
      scopeKey: 'infoflow:private:alice',
      occurredAt: new Date(),
    }

    await expect(
      acceptInfoFlowEvent(
        db,
        workspaceId,
        agentId,
        event,
        harness,
        registry,
        env,
        new SecretBox(key),
      ),
    ).resolves.toBe(true)
    await expect(
      acceptInfoFlowEvent(
        db,
        workspaceId,
        agentId,
        event,
        harness,
        registry,
        env,
        new SecretBox(key),
      ),
    ).resolves.toBe(false)
    expect(db.select().from(inboundEvents).all()).toHaveLength(1)
  })

  it('restores capability tools for an existing conversation after runtime restart', async () => {
    await createNextVersion(db, principal!, workspaceId, agentId)
    const tool = await createHttpTool(db, principal!, workspaceId, {
      name: 'Knowledge writer',
      description: 'Write a knowledge entry.',
      endpoint: 'https://api.example.com/knowledge',
      method: 'POST',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    })
    await replaceDraftTools(db, principal!, workspaceId, agentId, {
      capabilityVersionIds: [tool.versionId],
    })
    await publishAgentVersion(db, principal!, workspaceId, agentId)
    const baseEvent = {
      agentId,
      agentChannelId: '',
      connectionId: '',
      externalThreadId: 'alice',
      senderExternalId: 'alice',
      chatType: 'private' as const,
      replyTargetType: 'user' as const,
      replyTargetId: 'alice',
      contentText: 'hello',
      rawMetadataJson: {},
      scopeKey: 'infoflow:private:alice',
      occurredAt: new Date(),
    }
    await acceptInfoFlowEvent(
      db,
      workspaceId,
      agentId,
      { ...baseEvent, externalEventId: 'tool-message-1' },
      harness,
      registry,
      env,
      new SecretBox(key),
    )
    const installed = registry.snapshot().installed()
    expect(installed).toHaveLength(1)
    registry.uninstall(installed[0])
    expect(registry.snapshot().installed()).toHaveLength(0)

    await acceptInfoFlowEvent(
      db,
      workspaceId,
      agentId,
      { ...baseEvent, externalEventId: 'tool-message-2' },
      harness,
      registry,
      env,
      new SecretBox(key),
    )

    expect(registry.snapshot().installed()).toHaveLength(1)
    expect(registry.snapshot().tools()[0]?.tool.name).toBe(
      'platform_tool_http_knowledge-writer_1_0_0',
    )
  })

  it('resets the conversation for /reset without calling the model', async () => {
    const send = vi.fn().mockResolvedValue('reset-reply')
    await acceptInfoFlowEvent(
      db,
      workspaceId,
      agentId,
      {
        agentId,
        agentChannelId: '',
        connectionId: '',
        externalEventId: 'reset-1',
        externalThreadId: 'alice',
        senderExternalId: 'alice',
        chatType: 'private',
        replyTargetType: 'user',
        replyTargetId: 'alice',
        contentText: '/reset',
        rawMetadataJson: { MsgId: 'reset-1', Content: '/reset' },
        scopeKey: 'infoflow:private:alice',
        occurredAt: new Date(),
      },
      harness,
      registry,
      env,
      new SecretBox(key),
    )
    await runInfoFlowWorker(
      db,
      harness,
      registry,
      env,
      new SecretBox(key),
      async () => ({ send }),
    )

    expect(faux.state.callCount).toBe(0)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'user',
        targetId: 'alice',
        text: '会话已重置，下一条消息将开启新的上下文。',
      }),
    )
    expect(db.select().from(inboundEvents).get()).toMatchObject({
      status: 'answered',
      responseText: '会话已重置，下一条消息将开启新的上下文。',
    })
  })

  it('retries a failed outbound delivery', async () => {
    faux.setResponses([fauxAssistantMessage([fauxText('重试成功')])])
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary provider failure'))
      .mockResolvedValue('provider-message-2')
    await acceptInfoFlowEvent(
      db,
      workspaceId,
      agentId,
      {
        agentId,
        agentChannelId: '',
        connectionId: '',
        externalEventId: 'retry-1',
        externalThreadId: 'alice',
        senderExternalId: 'alice',
        chatType: 'private',
        replyTargetType: 'user',
        replyTargetId: 'alice',
        contentText: 'retry',
        rawMetadataJson: {},
        scopeKey: 'infoflow:private:alice',
        occurredAt: new Date(),
      },
      harness,
      registry,
      env,
      new SecretBox(key),
    )

    await runInfoFlowWorker(
      db,
      harness,
      registry,
      env,
      new SecretBox(key),
      async () => ({ send }),
    )
    expect(db.select().from(outboundDeliveries).get()).toMatchObject({
      status: 'retry',
      attemptCount: 1,
    })

    await runInfoFlowWorker(
      db,
      harness,
      registry,
      env,
      new SecretBox(key),
      async () => ({ send }),
    )
    expect(db.select().from(outboundDeliveries).get()).toMatchObject({
      status: 'sent',
      attemptCount: 2,
      providerMessageId: 'provider-message-2',
    })
  })

  it('does not resend an ambiguous timed-out delivery', async () => {
    faux.setResponses([fauxAssistantMessage([fauxText('不确定是否送达')])])
    const send = vi.fn().mockRejectedValue(new Error('request timeout'))
    await acceptInfoFlowEvent(
      db,
      workspaceId,
      agentId,
      {
        agentId,
        agentChannelId: '',
        connectionId: '',
        externalEventId: 'timeout-1',
        externalThreadId: 'alice',
        senderExternalId: 'alice',
        chatType: 'private',
        replyTargetType: 'user',
        replyTargetId: 'alice',
        contentText: 'timeout',
        rawMetadataJson: {},
        scopeKey: 'infoflow:private:alice',
        occurredAt: new Date(),
      },
      harness,
      registry,
      env,
      new SecretBox(key),
    )

    await runInfoFlowWorker(
      db,
      harness,
      registry,
      env,
      new SecretBox(key),
      async () => ({ send }),
    )
    await runInfoFlowWorker(
      db,
      harness,
      registry,
      env,
      new SecretBox(key),
      async () => ({ send }),
    )

    expect(db.select().from(outboundDeliveries).get()?.status).toBe('uncertain')
    expect(send).toHaveBeenCalledTimes(1)
  })
})
