import { LogLevel, WSClient } from '@baidu/infoflow-sdk-nodejs'
import type { WSClientOptions } from '@baidu/infoflow-sdk-nodejs'
import { and, eq } from 'drizzle-orm'

import { getDatabase } from '#/db'
import type { createDatabase } from '#/db'
import { agentChannels, channelConnections } from '#/db/schema'
import { getServerEnv } from '#/server/env.server'
import type { ServerEnv } from '#/server/env.server'
import { getPiRuntime } from '#/server/runtime/pi-runtime.server'
import type { PiRuntime } from '#/server/runtime/pi-runtime.server'
import { SecretBox } from '#/server/secrets/secret-box.server'

import { normalizeInfoFlowEvent } from './infoflow-normalizer'
import type {
  IncomingInfoFlowEvent,
  NormalizedInfoFlowEvent,
} from './infoflow-normalizer'
import {
  acceptInfoFlowEvent,
  acceptInfoFlowWelcome,
  recoverInterruptedDeliveries,
  runInfoFlowWorker,
} from './infoflow-runtime.server'
import type {
  InfoFlowSenderFactory,
  InfoFlowWelcomeEvent,
} from './infoflow-runtime.server'

type AppDatabase = ReturnType<typeof createDatabase>

export type InfoFlowWsClient = {
  connect: () => Promise<void>
  disconnect: () => void
  getState: () => 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
  on: (
    event: string,
    callback: (event: unknown) => void | Promise<void>,
  ) => unknown
}

export type InfoFlowWsFactory = (options: WSClientOptions) => InfoFlowWsClient

type ManagedConnection = {
  agentId: string
  workspaceId: string
  agentChannelId: string
  connectionId: string
  externalAgentId: string
  connectionRevision: string
  client: InfoFlowWsClient
  connectPromise?: Promise<void>
  lastConnectAttemptAt: number
}

type DesiredConnection = {
  workspaceId: string
  agentId: string
  agentChannelId: string
  connectionId: string
  externalAgentId: string
  credentialsJson: unknown
}

export type InfoFlowSupervisorOptions = {
  db: AppDatabase
  runtime: Pick<PiRuntime, 'harness' | 'registry'>
  env: ServerEnv
  box: SecretBox
  createWs?: InfoFlowWsFactory
  senderFactory?: InfoFlowSenderFactory
  workerIntervalMs?: number
  reconcileIntervalMs?: number
  messageMergeWindowMs?: number
}

declare global {
  var __infoFlowSupervisorPromise__: Promise<InfoFlowSupervisor> | undefined
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError'
}

function infoFlowLog(
  action: string,
  details: Record<string, unknown>,
): void {
  console.log(`[infoflow] ${action} ${JSON.stringify(details)}`)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function identifier(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : ''
}

function eventTime(value: unknown, fallback: number): Date {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : fallback
  const milliseconds = parsed > 10_000_000_000 ? parsed : parsed * 1000
  const date = new Date(Number.isFinite(milliseconds) ? milliseconds : fallback)
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date
}

function memberIdsFrom(value: unknown): string[] {
  const ids = new Set<string>()
  const idKeys = new Set([
    'fromuserid',
    'memberid',
    'memberids',
    'userid',
    'userids',
  ])
  const visit = (current: unknown, key = ''): void => {
    if (Array.isArray(current)) {
      for (const item of current) visit(item, key)
      return
    }
    if (current && typeof current === 'object') {
      for (const [childKey, child] of Object.entries(
        current as Record<string, unknown>,
      )) {
        visit(child, childKey)
      }
      return
    }
    if (!idKeys.has(key.toLocaleLowerCase().replaceAll(/[_-]/g, ''))) return
    for (const id of identifier(current)
      .split(/[|,]/)
      .map((item) => item.trim())
      .filter(Boolean)) {
      ids.add(id)
    }
  }
  visit(value)
  return [...ids]
}

function groupMemberWelcome(
  rawEvent: Record<string, unknown>,
  externalAgentId: string,
): InfoFlowWelcomeEvent | undefined {
  const data = record(rawEvent.data)
  const payload = record(data.payload)
  const eventType = (
    text(data.eventType) ||
    text(payload.eventType) ||
    text(payload.eventtype)
  ).toLocaleUpperCase()
  if (
    text(rawEvent.type) !== 'group.event.member_add' &&
    eventType !== 'GROUP_MEMBER_ADD'
  ) {
    return undefined
  }

  const groupId =
    identifier(data.groupId) ||
    identifier(payload.groupid) ||
    identifier(payload.groupId) ||
    identifier(record(record(payload.message).header).toid)
  const mentionUserIds = memberIdsFrom(payload).filter(
    (id) => id !== externalAgentId && !id.startsWith('bot#'),
  )
  if (!groupId || mentionUserIds.length === 0) return undefined

  const occurredAt = eventTime(
    payload.time ?? payload.eventTime ?? rawEvent.timestamp,
    Date.now(),
  )
  const responseText = '欢迎加入！发送 /reset 可以开启新的会话上下文。'
  return {
    externalEventId:
      identifier(payload.eventId) ||
      identifier(payload.eventid) ||
      identifier(payload.MsgId) ||
      identifier(payload.logId) ||
      `group-member-add:${groupId}:${mentionUserIds.join(',')}:${occurredAt.getTime()}`,
    externalThreadId: groupId,
    senderExternalId: mentionUserIds[0],
    chatType: 'group',
    replyTargetType: 'group',
    replyTargetId: groupId,
    auditText: `GROUP_MEMBER_ADD:${mentionUserIds.join(',')}`,
    responseText,
    mentionUserIds,
    rawMetadataJson: rawEvent,
    occurredAt,
  }
}

function privateWelcome(
  rawEvent: Record<string, unknown>,
): InfoFlowWelcomeEvent | undefined {
  if (text(rawEvent.type) !== 'private.event') return undefined
  const raw = record(record(rawEvent.data).raw)
  const eventType =
    text(raw.EventType) ||
    text(raw.eventType) ||
    text(raw.eventtype) ||
    text(raw.Event) ||
    text(raw.event)
  if (
    !/(FOLLOW|SUBSCRIBE|ENTER|JOIN|ADD_ROBOT|ROBOT_ADD)/i.test(eventType)
  ) {
    return undefined
  }

  const sender =
    text(raw.FromUserId) ||
    text(raw.fromUserId) ||
    text(raw.UserId) ||
    text(raw.userId)
  if (!sender || sender.startsWith('bot#')) return undefined

  const occurredAt = eventTime(
    raw.CreateTime ?? raw.createTime ?? rawEvent.timestamp,
    Date.now(),
  )
  const responseText = '欢迎使用！发送 /reset 可以开启新的会话上下文。'
  return {
    externalEventId:
      text(raw.MsgId) ||
      text(raw.messageid) ||
      text(raw.eventId) ||
      `private-enter:${sender}:${eventType}:${occurredAt.getTime()}`,
    externalThreadId: sender,
    senderExternalId: sender,
    chatType: 'private',
    replyTargetType: 'user',
    replyTargetId: sender,
    auditText: `private.event:${eventType}`,
    responseText,
    rawMetadataJson: rawEvent,
    occurredAt,
  }
}

function welcomeEvent(
  rawEvent: Record<string, unknown>,
  externalAgentId: string,
): InfoFlowWelcomeEvent | undefined {
  return (
    groupMemberWelcome(rawEvent, externalAgentId) ?? privateWelcome(rawEvent)
  )
}

function mergedInfoFlowEvent(
  current: NormalizedInfoFlowEvent,
  next: NormalizedInfoFlowEvent,
): NormalizedInfoFlowEvent {
  const mergeKey =
    current.mergeKey ??
    next.mergeKey ??
    current.externalEventId.replace(/:image$/, '')
  const textParts = [current.contentText, next.contentText]
    .map((value) => value.trim())
    .filter((value) => value && value !== '请分析这张图片。')
  const contentText =
    [...new Set(textParts)].join('\n') || '请分析这张图片。'
  const imageKey = (image: NonNullable<NormalizedInfoFlowEvent['images']>[number]) =>
    image.data ?? image.sourceUrl ?? ''
  const images = [...(current.images ?? []), ...(next.images ?? [])].filter(
    (image, index, all) =>
      all.findIndex((candidate) => imageKey(candidate) === imageKey(image)) ===
      index,
  )
  const hasText = textParts.length > 0
  const textEvent = next.contentText.trim() ? next : current

  return {
    ...current,
    externalEventId:
      images.length > 0 && !hasText
        ? `${mergeKey}:image`
        : mergeKey,
    contentText,
    ...(images.length > 0 ? { images } : { images: undefined }),
    mergeKey,
    occurredAt:
      current.occurredAt <= next.occurredAt
        ? current.occurredAt
        : next.occurredAt,
    rawMetadataJson: textEvent.rawMetadataJson,
  }
}

function defaultWsFactory(options: WSClientOptions): InfoFlowWsClient {
  return new WSClient(options)
}

export class InfoFlowSupervisor {
  readonly #db: AppDatabase
  readonly #runtime: Pick<PiRuntime, 'harness' | 'registry'>
  readonly #env: ServerEnv
  readonly #box: SecretBox
  readonly #createWs: InfoFlowWsFactory
  readonly #senderFactory: InfoFlowSenderFactory | undefined
  readonly #workerIntervalMs: number
  readonly #reconcileIntervalMs: number
  readonly #messageMergeWindowMs: number
  readonly #connections = new Map<string, ManagedConnection>()
  readonly #pendingMessages = new Map<
    string,
    {
      runtime: ManagedConnection
      event: NormalizedInfoFlowEvent
      timer: NodeJS.Timeout
    }
  >()

  #started = false
  #stopped = false
  #workerTimer: NodeJS.Timeout | undefined
  #reconcileTimer: NodeJS.Timeout | undefined
  #workerPromise: Promise<void> | undefined
  #reconcilePromise: Promise<void> | undefined

  constructor(options: InfoFlowSupervisorOptions) {
    this.#db = options.db
    this.#runtime = options.runtime
    this.#env = options.env
    this.#box = options.box
    this.#createWs = options.createWs ?? defaultWsFactory
    this.#senderFactory = options.senderFactory
    this.#workerIntervalMs = options.workerIntervalMs ?? 2_000
    this.#reconcileIntervalMs = options.reconcileIntervalMs ?? 15_000
    this.#messageMergeWindowMs = options.messageMergeWindowMs ?? 750
  }

  async start(): Promise<void> {
    if (this.#started) return
    this.#started = true
    this.#stopped = false
    const desired = this.#desiredConnections()
    infoFlowLog('supervisor starting', {
      connectionCount: desired.length,
      agents: desired.map((connection) => ({
        agentId: connection.agentId,
        externalAgentId: connection.externalAgentId,
      })),
      workerIntervalMs: this.#workerIntervalMs,
      reconcileIntervalMs: this.#reconcileIntervalMs,
      messageMergeWindowMs: this.#messageMergeWindowMs,
    })
    recoverInterruptedDeliveries(this.#db)
    this.#runWorkerSoon()
    await this.reconcile()
    this.#workerTimer = setInterval(
      () => this.#runWorkerSoon(),
      this.#workerIntervalMs,
    )
    this.#reconcileTimer = setInterval(
      () => void this.reconcile(),
      this.#reconcileIntervalMs,
    )
    this.#workerTimer.unref()
    this.#reconcileTimer.unref()
  }

  async stop(): Promise<void> {
    this.#stopped = true
    if (this.#workerTimer) clearInterval(this.#workerTimer)
    if (this.#reconcileTimer) clearInterval(this.#reconcileTimer)
    this.#workerTimer = undefined
    this.#reconcileTimer = undefined

    const pending = [...this.#pendingMessages.values()]
    this.#pendingMessages.clear()
    for (const message of pending) clearTimeout(message.timer)
    await Promise.allSettled(
      pending.map(({ runtime, event }) =>
        this.#acceptNormalizedEvent(runtime, event),
      ),
    )
    for (const runtime of this.#connections.values()) {
      runtime.client.disconnect()
    }
    this.#connections.clear()
    await this.#workerPromise?.catch(() => undefined)
    await this.#reconcilePromise?.catch(() => undefined)
  }

  async reconcile(): Promise<void> {
    if (this.#stopped) return
    if (this.#reconcilePromise) return this.#reconcilePromise

    this.#reconcilePromise = this.#reconcileOnce().finally(() => {
      this.#reconcilePromise = undefined
    })
    return this.#reconcilePromise
  }

  async runWorkerNow(): Promise<void> {
    if (this.#stopped) return
    if (this.#workerPromise) return this.#workerPromise

    this.#workerPromise = runInfoFlowWorker(
      this.#db,
      this.#runtime.harness,
      this.#runtime.registry,
      this.#env,
      this.#box,
      this.#senderFactory,
    )
      .catch((error) => {
        console.error(`[infoflow] worker failed: ${errorName(error)}`)
      })
      .finally(() => {
        this.#workerPromise = undefined
      })
    return this.#workerPromise
  }

  async #reconcileOnce(): Promise<void> {
    const desired = this.#desiredConnections()
    const desiredById = new Map(
      desired.map((connection) => [connection.agentId, connection]),
    )

    for (const [agentId, runtime] of this.#connections) {
      const next = desiredById.get(agentId)
      if (
        !next ||
        next.connectionId !== runtime.connectionId ||
        this.#revision(next) !== runtime.connectionRevision
      ) {
        runtime.client.disconnect()
        this.#connections.delete(agentId)
      }
    }

    const connectTasks: Promise<void>[] = []
    for (const connection of desired) {
      let runtime = this.#connections.get(connection.agentId)
      if (!runtime) {
        runtime = this.#createManagedConnection(connection)
        this.#connections.set(connection.agentId, runtime)
      }

      if (
        runtime.client.getState() === 'connected' ||
        runtime.client.getState() === 'connecting' ||
        runtime.client.getState() === 'reconnecting' ||
        runtime.connectPromise
      ) {
        continue
      }

      if (
        runtime.lastConnectAttemptAt > 0 &&
        Date.now() - runtime.lastConnectAttemptAt < this.#reconcileIntervalMs
      ) {
        continue
      }

      runtime.connectPromise = this.#connect(runtime).finally(() => {
        if (this.#connections.get(runtime.agentId) === runtime) {
          runtime.connectPromise = undefined
        }
      })
      connectTasks.push(runtime.connectPromise)
    }

    await Promise.allSettled(connectTasks)
  }

  #desiredConnections(): DesiredConnection[] {
    return this.#db
      .select({
        workspaceId: agentChannels.workspaceId,
        agentId: agentChannels.agentId,
        agentChannelId: agentChannels.id,
        connectionId: channelConnections.id,
        externalAgentId: channelConnections.externalAgentId,
        credentialsJson: channelConnections.credentialsJson,
      })
      .from(agentChannels)
      .innerJoin(
        channelConnections,
        eq(channelConnections.agentChannelId, agentChannels.id),
      )
      .where(
        and(
          eq(agentChannels.channel, 'infoflow'),
          eq(agentChannels.enabled, true),
        ),
      )
      .all()
  }

  #revision(connection: DesiredConnection): string {
    return `${connection.externalAgentId}:${JSON.stringify(connection.credentialsJson)}`
  }

  #createManagedConnection(connection: DesiredConnection): ManagedConnection {
    const credentials = JSON.parse(
      this.#box.open(
        connection.credentialsJson as Parameters<SecretBox['open']>[0],
        `channel_connection:${connection.connectionId}`,
      ),
    ) as { appKey: string; appSecret: string }

    const client = this.#createWs({
      appKey: credentials.appKey,
      appSecret: credentials.appSecret,
      baseUrl: this.#env.INFOFLOW_API_BASE_URL,
      wsGateway: this.#env.INFOFLOW_WS_GATEWAY,
      wsConnectDomain: this.#env.INFOFLOW_WS_CONNECT_DOMAIN,
      autoRegister: true,
      autoAck: true,
      maxReconnectAttempts: -1,
      autoRegisterDelay: 1_000,
      loggerLevel:
        this.#env.LOG_LEVEL === 'trace' ? LogLevel.debug : LogLevel.warn,
    })
    infoFlowLog('connection created', {
      agentId: connection.agentId,
      connectionId: connection.connectionId,
      externalAgentId: connection.externalAgentId,
      wsGateway: this.#env.INFOFLOW_WS_GATEWAY,
    })
    const runtime: ManagedConnection = {
      agentId: connection.agentId,
      workspaceId: connection.workspaceId,
      agentChannelId: connection.agentChannelId,
      connectionId: connection.connectionId,
      externalAgentId: connection.externalAgentId,
      connectionRevision: this.#revision(connection),
      client,
      lastConnectAttemptAt: 0,
    }

    const onMessage = (event: unknown) => this.#handleMessage(runtime, event)
    client.on('*', onMessage)
    client.on('connected', () => {
      infoFlowLog('connection connected', {
        agentId: runtime.agentId,
        externalAgentId: runtime.externalAgentId,
      })
      this.#setStatus(runtime, 'connected', null, new Date())
      this.#runWorkerSoon()
    })
    client.on('disconnected', () => {
      infoFlowLog('connection disconnected', {
        agentId: runtime.agentId,
        externalAgentId: runtime.externalAgentId,
      })
      this.#setStatus(runtime, 'disconnected', 'socket_disconnected')
    })
    client.on('error', (event) => {
      infoFlowLog('connection error', {
        agentId: runtime.agentId,
        externalAgentId: runtime.externalAgentId,
        event:
          event && typeof event === 'object'
            ? event
            : { value: String(event) },
      })
      this.#setStatus(runtime, 'error', 'socket_error')
      if (
        event &&
        typeof event === 'object' &&
        'error' in event &&
        (event as { error?: unknown }).error instanceof Error
      ) {
        const message = (event as { error: Error }).error.message
        if (/credential|auth|app.?key|app.?secret/i.test(message)) {
          this.#setStatus(runtime, 'error', 'credentials_rejected')
        }
      }
    })

    return runtime
  }

  async #connect(runtime: ManagedConnection): Promise<void> {
    if (this.#connections.get(runtime.agentId) !== runtime) return
    runtime.lastConnectAttemptAt = Date.now()
    this.#setStatus(runtime, 'connecting', 'socket_connecting')
    infoFlowLog('connection connecting', {
      agentId: runtime.agentId,
      externalAgentId: runtime.externalAgentId,
    })
    try {
      await runtime.client.connect()
      if (
        this.#connections.get(runtime.agentId) === runtime &&
        runtime.client.getState() === 'connected'
      ) {
        this.#setStatus(runtime, 'connected', null, new Date())
      }
    } catch (error) {
      this.#setStatus(runtime, 'error', 'socket_connect_failed')
      console.error(
        `[infoflow] connect failed for agent ${runtime.agentId}: ${errorName(error)}`,
      )
    }
  }

  async #handleMessage(
    runtime: ManagedConnection,
    rawEvent: unknown,
  ): Promise<void> {
    if (this.#connections.get(runtime.agentId) !== runtime) return
    if (
      !rawEvent ||
      typeof rawEvent !== 'object' ||
      !('data' in rawEvent)
    ) {
      return
    }
    const raw = rawEvent as Record<string, unknown>
    const eventType =
      typeof raw.type === 'string' ? raw.type : 'unknown.infoflow.event'
    infoFlowLog('message received', {
      agentId: runtime.agentId,
      externalAgentId: runtime.externalAgentId,
      eventType,
      event: raw,
    })
    try {
      const welcome = welcomeEvent(raw, runtime.externalAgentId)
      if (welcome) {
        infoFlowLog('welcome event normalized', {
          agentId: runtime.agentId,
          externalAgentId: runtime.externalAgentId,
          eventType,
          externalEventId: welcome.externalEventId,
          chatType: welcome.chatType,
          replyTargetId: welcome.replyTargetId,
          mentionUserIds: welcome.mentionUserIds,
        })
        const accepted = await acceptInfoFlowWelcome(
          this.#db,
          runtime.workspaceId,
          runtime.agentId,
          welcome,
        )
        infoFlowLog('welcome event accepted', {
          agentId: runtime.agentId,
          externalEventId: welcome.externalEventId,
          accepted,
        })
        if (accepted) this.#runWorkerSoon()
        return
      }
      const normalized = normalizeInfoFlowEvent(
        rawEvent as IncomingInfoFlowEvent,
        {
          agentId: runtime.agentId,
          agentChannelId: runtime.agentChannelId,
          connectionId: runtime.connectionId,
          externalAgentId: runtime.externalAgentId,
        },
      )
      if (!normalized) {
        infoFlowLog('message ignored', {
          agentId: runtime.agentId,
          externalAgentId: runtime.externalAgentId,
          eventType,
        })
        return
      }
      infoFlowLog('message normalized', {
        agentId: runtime.agentId,
        externalAgentId: normalized.externalEventId,
        chatType: normalized.chatType,
        senderExternalId: normalized.senderExternalId,
        replyTargetId: normalized.replyTargetId,
        scopeKey: normalized.scopeKey,
        contentText: normalized.contentText,
      })
      await this.#queueNormalizedEvent(runtime, normalized, eventType)
    } catch (error) {
      this.#failEventIngest(runtime, error)
    }
  }

  async #queueNormalizedEvent(
    runtime: ManagedConnection,
    event: NormalizedInfoFlowEvent,
    eventType: string,
  ): Promise<void> {
    if (this.#messageMergeWindowMs <= 0) {
      await this.#acceptNormalizedEvent(runtime, event)
      return
    }

    const mergeKey =
      event.mergeKey ?? event.externalEventId.replace(/:image$/, '')
    const pendingKey = `${runtime.agentId}:${mergeKey}`
    const pending = this.#pendingMessages.get(pendingKey)
    if (pending) clearTimeout(pending.timer)
    const merged = pending ? mergedInfoFlowEvent(pending.event, event) : event
    const timer = setTimeout(() => {
      this.#pendingMessages.delete(pendingKey)
      void this.#acceptNormalizedEvent(runtime, merged).catch((error) => {
        this.#failEventIngest(runtime, error)
      })
    }, this.#messageMergeWindowMs)
    this.#pendingMessages.set(pendingKey, {
      runtime,
      event: merged,
      timer,
    })
    infoFlowLog(pending ? 'message merged' : 'message queued', {
      agentId: runtime.agentId,
      eventType,
      mergeKey,
      contentText: merged.contentText,
      imageCount: merged.images?.length ?? 0,
      mergeWindowMs: this.#messageMergeWindowMs,
    })
  }

  async #acceptNormalizedEvent(
    runtime: ManagedConnection,
    event: NormalizedInfoFlowEvent,
  ): Promise<void> {
    const accepted = await acceptInfoFlowEvent(
      this.#db,
      runtime.workspaceId,
      runtime.agentId,
      event,
      this.#runtime.harness,
      this.#runtime.registry,
      this.#env,
      this.#box,
    )
    infoFlowLog('message accepted', {
      agentId: runtime.agentId,
      externalEventId: event.externalEventId,
      contentText: event.contentText,
      imageCount: event.images?.length ?? 0,
      accepted,
    })
    if (accepted) this.#runWorkerSoon()
  }

  #failEventIngest(runtime: ManagedConnection, error: unknown): void {
    this.#setStatus(runtime, 'error', 'event_ingest_failed')
    console.error(`[infoflow] event ingest failed: ${errorName(error)}`)
  }

  #setStatus(
    runtime: ManagedConnection,
    status: 'disconnected' | 'connecting' | 'connected' | 'error',
    statusMessage: string | null,
    connectedAt?: Date,
  ): void {
    if (this.#connections.get(runtime.agentId) !== runtime) return
    this.#db
      .update(channelConnections)
      .set({
        status,
        statusMessage,
        connectedAt:
          status === 'connected' ? (connectedAt ?? new Date()) : null,
        updatedAt: new Date(),
      })
      .where(eq(channelConnections.id, runtime.connectionId))
      .run()
  }

  #runWorkerSoon(): void {
    if (this.#stopped) return
    queueMicrotask(() => {
      void this.runWorkerNow()
    })
  }
}

async function createDefaultSupervisor(): Promise<InfoFlowSupervisor> {
  const env = getServerEnv()
  const runtime = await getPiRuntime()
  return new InfoFlowSupervisor({
    db: getDatabase(),
    runtime,
    env,
    box: new SecretBox(env.CHANNEL_SECRET_KEK),
  })
}

export async function startInfoFlowSupervisor(): Promise<InfoFlowSupervisor> {
  if (!globalThis.__infoFlowSupervisorPromise__) {
    globalThis.__infoFlowSupervisorPromise__ = createDefaultSupervisor()
      .then(async (supervisor) => {
        await supervisor.start()
        return supervisor
      })
      .catch((error) => {
        globalThis.__infoFlowSupervisorPromise__ = undefined
        throw error
      })
  }
  return globalThis.__infoFlowSupervisorPromise__
}

export function notifyInfoFlowChannelChanged(agentId: string): void {
  const supervisorPromise = globalThis.__infoFlowSupervisorPromise__
  if (!supervisorPromise) return
  void supervisorPromise
    .then((supervisor) => supervisor.reconcile())
    .catch(() => {
      console.error(`[infoflow] reconcile failed for agent ${agentId}`)
    })
}
