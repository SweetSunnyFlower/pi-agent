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
import type { WSClientOptions } from '@baidu/infoflow-sdk-nodejs'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase } from '#/db'
import { channelConnections, inboundEvents } from '#/db/schema'
import { parseServerEnv } from '#/server/env.server'
import {
  createAgent,
  publishAgentVersion,
} from '#/server/platform/agent-version.server'
import { saveInfoFlowChannel } from '#/server/platform/channel.server'
import { ensureDevelopmentSeed, resolvePrincipal } from '#/server/platform/workspace-access.server'
import { SecretBox } from '#/server/secrets/secret-box.server'

import { InfoFlowSupervisor } from './infoflow-supervisor.server'
import type { InfoFlowWsClient } from './infoflow-supervisor.server'

const key = Buffer.alloc(32, 2).toString('base64')
const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  APP_DATABASE_PATH: ':memory:',
  CHANNEL_SECRET_KEK: key,
})

type Handler = (event: unknown) => void | Promise<void>

class FakeWsClient implements InfoFlowWsClient {
  readonly options: WSClientOptions
  readonly handlers = new Map<string, Set<Handler>>()
  state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' =
    'disconnected'
  disconnected = false

  constructor(options: WSClientOptions) {
    this.options = options
  }

  async connect() {
    this.state = 'connected'
    await this.emit('connected', { connectionId: 'fake-connection' })
  }

  disconnect() {
    this.disconnected = true
    this.state = 'disconnected'
    void this.emit('disconnected', {
      connectionId: 'fake-connection',
    })
  }

  getState() {
    return this.state
  }

  on(event: string, callback: Handler) {
    const handlers = this.handlers.get(event) ?? new Set<Handler>()
    handlers.add(callback)
    this.handlers.set(event, handlers)
    return this
  }

  async emit(event: string, payload: unknown) {
    for (const handler of this.handlers.get(event) ?? []) {
      await handler(payload)
    }
    if (event !== '*') {
      for (const handler of this.handlers.get('*') ?? []) {
        await handler(payload)
      }
    }
  }
}

describe('InfoFlow supervisor', () => {
  let db: ReturnType<typeof createDatabase>
  let harness: Harness
  let registry: ReturnType<typeof createRegistry>
  let faux: ReturnType<typeof fauxProvider>
  let principal: Awaited<ReturnType<typeof resolvePrincipal>>
  let workspaceId: string
  let agentId: string
  let supervisor: InfoFlowSupervisor | undefined
  let clients: FakeWsClient[]

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
      name: 'InfoFlow Reviewer',
      instructions: 'Reply in full.',
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
    clients = []
  })

  afterEach(async () => {
    await supervisor?.stop()
    await harness.close(BACKGROUND_CONTEXT)
    db.$client.close()
  })

  function createSupervisor(
    send: (payload: {
      targetType: 'user' | 'group'
      targetId: string
      text: string
      msgType: 'md' | 'MD'
      mentionUserIds?: string[]
    }) => Promise<string>,
    messageMergeWindowMs = 0,
  ) {
    supervisor = new InfoFlowSupervisor({
      db,
      runtime: { harness, registry },
      env,
      box: new SecretBox(key),
      createWs: (options) => {
        const client = new FakeWsClient(options)
        clients.push(client)
        return client
      },
      senderFactory: async () => ({ send }),
      workerIntervalMs: 60_000,
      reconcileIntervalMs: 60_000,
      messageMergeWindowMs,
    })
    return supervisor
  }

  it('owns one WS per Agent and sends the complete final answer', async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxText('完整的 Markdown 回答')]),
    ])
    const send = vi.fn().mockResolvedValue('provider-message-1')
    const instance = createSupervisor(send)
    await instance.start()

    expect(clients).toHaveLength(1)
    expect(clients[0].options).toMatchObject({
      appKey: 'app-key-123456',
      appSecret: 'app-secret-123456',
      autoRegister: true,
      autoAck: true,
      maxReconnectAttempts: -1,
    })
    expect(db.select().from(channelConnections).get()?.status).toBe('connected')

    await clients[0].emit('private.text', {
      type: 'private.text',
      timestamp: Date.now(),
      data: {
        chatType: 'private',
        msgType: 'text',
        raw: {
          MsgId: 'message-1',
          FromUserId: 'alice',
          Content: '请完整回答',
          CreateTime: String(Date.now()),
        },
      },
    })
    await instance.runWorkerNow()

    expect(send).toHaveBeenCalledWith({
      targetType: 'user',
      targetId: 'alice',
      text: '完整的 Markdown 回答',
      msgType: 'md',
    })
  })

  it('logs incoming InfoFlow messages at the receive boundary', async () => {
    const instance = createSupervisor(vi.fn().mockResolvedValue('sent'))
    await instance.start()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    try {
      await clients[0].emit('private.text', {
        type: 'private.text',
        timestamp: Date.now(),
        data: {
          chatType: 'private',
          msgType: 'text',
          raw: {
            MsgId: 'log-message-1',
            FromUserId: 'alice',
            Content: '日志测试消息',
            CreateTime: String(Date.now()),
          },
        },
      })

      const logged = logSpy.mock.calls.map((call) =>
        call.map((value) => String(value)),
      )
      expect(
        logged.some((call) =>
          call.some((value) =>
            value.includes('[infoflow] message received'),
          ),
        ),
      ).toBe(true)
      expect(
        logged.some((call) =>
          call.some((value) =>
            value.includes('"externalEventId":"log-message-1"'),
          ),
        ),
      ).toBe(true)
      expect(
        logged.some((call) =>
          call.some((value) =>
            value.includes('"contentText":"日志测试消息"'),
          ),
        ),
      ).toBe(true)
    } finally {
      logSpy.mockRestore()
    }
  })

  it('merges image and text events with the same provider message ID', async () => {
    const instance = createSupervisor(
      vi.fn().mockResolvedValue('sent'),
      20,
    )
    await instance.start()
    const data =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2mQAAAAASUVORK5CYII='
    const timestamp = Date.now()
    const msgId = 'shared-message-id'

    await clients[0].emit('private.image', {
      type: 'private.image',
      timestamp,
      data: {
        chatType: 'private',
        msgType: 'image',
        raw: {
          MsgId: msgId,
          FromUserId: 'alice',
          MsgType: 'image',
          t: 'png',
          Content: data,
          CreateTime: String(timestamp),
        },
      },
    })
    await clients[0].emit('private.text', {
      type: 'private.text',
      timestamp: timestamp + 50,
      data: {
        chatType: 'private',
        msgType: 'text',
        raw: {
          MsgId: msgId,
          FromUserId: 'alice',
          MsgType: 'text',
          Content: '分析并且上报',
          CreateTime: String(timestamp),
        },
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 50))

    const events = db.select().from(inboundEvents).all()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      externalEventId: msgId,
      contentText: '分析并且上报',
      attachmentsJson: [{ data, mimeType: 'image/png' }],
    })
  })

  it('welcomes a new group member and mentions them', async () => {
    const send = vi.fn().mockResolvedValue('welcome-sent')
    const instance = createSupervisor(send)
    await instance.start()

    await clients[0].emit('group.event.member_add', {
      type: 'group.event.member_add',
      timestamp: Date.now(),
      data: {
        chatType: 'group',
        eventType: 'GROUP_MEMBER_ADD',
        groupId: 998877,
        payload: {
          eventId: 'member-add-1',
          eventtype: 'GROUP_MEMBER_ADD',
          groupid: 998877,
          memberIds: ['new-user'],
        },
      },
    })
    await instance.runWorkerNow()

    expect(send).toHaveBeenCalledWith({
      targetType: 'group',
      targetId: '998877',
      text: '欢迎加入！发送 /reset 可以开启新的会话上下文。',
      msgType: 'MD',
      mentionUserIds: ['new-user'],
    })
    expect(db.select().from(inboundEvents).get()).toMatchObject({
      externalEventId: 'member-add-1',
      senderExternalId: 'new-user',
      chatType: 'group',
      replyTargetType: 'group',
      replyTargetId: '998877',
      status: 'answered',
      responseText: '欢迎加入！发送 /reset 可以开启新的会话上下文。',
    })
    expect(faux.state.callCount).toBe(0)
  })

  it('welcomes a user entering the robot through a private event', async () => {
    const send = vi.fn().mockResolvedValue('private-welcome-sent')
    const instance = createSupervisor(send)
    await instance.start()

    await clients[0].emit('private.event', {
      type: 'private.event',
      timestamp: Date.now(),
      data: {
        chatType: 'private',
        msgType: 'event',
        raw: {
          MsgId: 'enter-robot-1',
          FromUserId: 'new-user',
          MsgType: 'event',
          EventType: 'ENTER_ROBOT',
        },
      },
    })
    await instance.runWorkerNow()

    expect(send).toHaveBeenCalledWith({
      targetType: 'user',
      targetId: 'new-user',
      text: '欢迎使用！发送 /reset 可以开启新的会话上下文。',
      msgType: 'md',
    })
    expect(db.select().from(inboundEvents).get()).toMatchObject({
      externalEventId: 'enter-robot-1',
      senderExternalId: 'new-user',
      chatType: 'private',
      replyTargetType: 'user',
      replyTargetId: 'new-user',
      status: 'answered',
      responseText: '欢迎使用！发送 /reset 可以开启新的会话上下文。',
    })
    expect(faux.state.callCount).toBe(0)
  })

  it('deduplicates repeated welcome events', async () => {
    const send = vi.fn().mockResolvedValue('welcome-sent')
    const instance = createSupervisor(send)
    await instance.start()
    const event = {
      type: 'group.event.member_add',
      timestamp: Date.now(),
      data: {
        chatType: 'group',
        eventType: 'GROUP_MEMBER_ADD',
        groupId: 998877,
        payload: {
          eventId: 'member-add-duplicate',
          eventtype: 'GROUP_MEMBER_ADD',
          groupid: 998877,
          memberIds: ['new-user'],
        },
      },
    }

    await clients[0].emit('group.event.member_add', event)
    await clients[0].emit('group.event.member_add', event)
    await instance.runWorkerNow()

    expect(send).toHaveBeenCalledTimes(1)
    expect(db.select().from(inboundEvents).all()).toHaveLength(1)
  })

  it('keeps welcome events without a provider ID distinct across joins', async () => {
    const send = vi.fn().mockResolvedValue('welcome-sent')
    const instance = createSupervisor(send)
    await instance.start()
    const welcome = (time: number) => ({
      type: 'group.event.member_add',
      timestamp: time,
      data: {
        chatType: 'group',
        eventType: 'GROUP_MEMBER_ADD',
        groupId: 998877,
        payload: {
          eventtype: 'GROUP_MEMBER_ADD',
          groupid: 998877,
          memberIds: ['new-user'],
          time,
        },
      },
    })

    await clients[0].emit('group.event.member_add', welcome(1_000))
    await clients[0].emit('group.event.member_add', welcome(2_000))
    await instance.runWorkerNow()

    expect(send).toHaveBeenCalledTimes(2)
    expect(db.select().from(inboundEvents).all()).toHaveLength(2)
  })

  it('does not mention the bot when it is present in the member list', async () => {
    const send = vi.fn().mockResolvedValue('welcome-sent')
    const instance = createSupervisor(send)
    await instance.start()

    await clients[0].emit('group.event.member_add', {
      type: 'group.event.member_add',
      timestamp: Date.now(),
      data: {
        chatType: 'group',
        eventType: 'GROUP_MEMBER_ADD',
        groupId: 998877,
        payload: {
          eventId: 'member-add-with-bot',
          eventtype: 'GROUP_MEMBER_ADD',
          groupid: 998877,
          memberIds: ['50655', 'new-user'],
        },
      },
    })
    await instance.runWorkerNow()

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        mentionUserIds: ['new-user'],
      }),
    )
  })

  it('ignores unrelated private events', async () => {
    const send = vi.fn().mockResolvedValue('unexpected-send')
    const instance = createSupervisor(send)
    await instance.start()

    await clients[0].emit('private.event', {
      type: 'private.event',
      timestamp: Date.now(),
      data: {
        chatType: 'private',
        msgType: 'event',
        raw: {
          MsgId: 'menu-click-1',
          FromUserId: 'alice',
          MsgType: 'event',
          EventType: 'MENU_CLICK',
        },
      },
    })
    await instance.runWorkerNow()

    expect(send).not.toHaveBeenCalled()
    expect(db.select().from(inboundEvents).all()).toHaveLength(0)
  })

  it('logs the WS connection lifecycle during startup', async () => {
    const instance = createSupervisor(vi.fn().mockResolvedValue('sent'))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    try {
      await instance.start()

      const logged = logSpy.mock.calls.map((call) => String(call[0]))
      expect(
        logged.some((value) =>
          value.includes('[infoflow] supervisor starting'),
        ),
      ).toBe(true)
      expect(
        logged.some((value) =>
          value.includes('"externalAgentId":"50655"'),
        ),
      ).toBe(true)
      expect(
        logged.some((value) =>
          value.includes('[infoflow] connection connecting'),
        ),
      ).toBe(true)
      expect(
        logged.some((value) =>
          value.includes('[infoflow] connection connected'),
        ),
      ).toBe(true)
    } finally {
      logSpy.mockRestore()
    }
  })

  it('registers one wildcard handler for every InfoFlow event', async () => {
    const instance = createSupervisor(vi.fn().mockResolvedValue('sent'))
    await instance.start()

    expect(clients[0].handlers.has('*')).toBe(true)
    expect(clients[0].handlers.has('private.text')).toBe(false)
    expect(clients[0].handlers.has('group.text')).toBe(false)
    expect(clients[0].handlers.has('group.mixed')).toBe(false)
  })

  it('restarts exactly one connection after credentials change', async () => {
    const instance = createSupervisor(vi.fn().mockResolvedValue('sent'))
    await instance.start()
    expect(clients).toHaveLength(1)

    await saveInfoFlowChannel(
      db,
      principal!,
      workspaceId,
      agentId,
      {
        enabled: true,
        infoflowAgentId: '50655',
        appKey: 'app-key-123456',
        appSecret: 'rotated-secret-123456',
      },
      new SecretBox(key),
    )
    await instance.reconcile()

    expect(clients[0].disconnected).toBe(true)
    expect(clients).toHaveLength(2)
    expect(clients[1].options.appSecret).toBe('rotated-secret-123456')

    await saveInfoFlowChannel(
      db,
      principal!,
      workspaceId,
      agentId,
      { enabled: false },
      new SecretBox(key),
    )
    await instance.reconcile()

    expect(clients[1].disconnected).toBe(true)
    expect(db.select().from(channelConnections).get()?.status).toBe(
      'disconnected',
    )
  })
})
