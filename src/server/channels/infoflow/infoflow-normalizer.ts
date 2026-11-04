export type InfoFlowNormalizeContext = {
  agentId: string
  agentChannelId: string
  connectionId: string
  externalAgentId: string
}

export type NormalizedInfoFlowEvent = {
  agentId: string
  agentChannelId: string
  connectionId: string
  externalEventId: string
  externalThreadId: string
  senderExternalId: string
  chatType: 'private' | 'group'
  replyTargetType: 'user' | 'group'
  replyTargetId: string
  contentText: string
  images?: InfoFlowImageSource[]
  mergeKey?: string
  rawMetadataJson: Record<string, unknown>
  scopeKey: string
  occurredAt: Date
}

export type InfoFlowImageSource = {
  sourceUrl?: string
  data?: string
  mimeType?: string
}

export type IncomingInfoFlowEvent = {
  type: string
  timestamp: number
  data: {
    chatType: string
    msgType: string
    raw: Record<string, unknown>
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function mimeTypeForImage(value: unknown): string | undefined {
  const format = text(value).toLocaleLowerCase().replace(/^\./, '')
  if (format === 'png') return 'image/png'
  if (format === 'jpg' || format === 'jpeg') return 'image/jpeg'
  if (format === 'gif') return 'image/gif'
  if (format === 'webp') return 'image/webp'
  return undefined
}

function imageSourceFromRecord(
  value: Record<string, unknown>,
): InfoFlowImageSource | undefined {
  const sourceUrl =
    text(value.ImgDownloadurl) ||
    text(value.imgDownloadurl) ||
    text(value.ImgDownloadUrl) ||
    text(value.downloadurl) ||
    text(value.downloadUrl) ||
    text(value.PicUrl) ||
    text(value.picUrl)
  const mimeType =
    mimeTypeForImage(value.t) ||
    mimeTypeForImage(value.imageType) ||
    mimeTypeForImage(value.mimeType)
  if (sourceUrl) {
    return { sourceUrl, ...(mimeType ? { mimeType } : {}) }
  }
  const content = text(value.Content) || text(value.content)
  const dataUrl = content.match(
    /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/,
  )
  if (dataUrl) {
    return { data: dataUrl[2], mimeType: dataUrl[1] }
  }
  if (
    mimeType &&
    content.length > 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(content)
  ) {
    return { data: content, mimeType }
  }
  return undefined
}

function imageSourcesFromBody(body: unknown[]): InfoFlowImageSource[] {
  return body.flatMap((item) => {
    const block = record(item)
    if (text(block.type).toLocaleUpperCase() !== 'IMAGE') return []
    const source = imageSourceFromRecord(block)
    return source ? [source] : []
  })
}

function time(value: unknown, fallback: number): Date {
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

function privateMessage(
  event: IncomingInfoFlowEvent,
  context: InfoFlowNormalizeContext,
): NormalizedInfoFlowEvent | null {
  const raw = event.data.raw
  const sender =
    text(raw.FromUserId) || text(raw.fromUserId) || text(raw.FromUserName)
  const rawContent = text(raw.Content) || text(raw.content)
  const msgType = (
    event.data.msgType ||
    text(raw.MsgType) ||
    text(raw.msgType)
  ).toLocaleLowerCase()
  const image = msgType === 'image' ? imageSourceFromRecord(raw) : undefined
  const content = image ? '' : rawContent
  if (!sender || (!content && !image) || sender.startsWith('bot#')) return null

  const baseExternalEventId =
    text(raw.MsgId) ||
    text(raw.messageid) ||
    `${sender}:${text(raw.CreateTime) || event.timestamp}:${content}`
  const externalEventId = image
    ? `${baseExternalEventId}:image`
    : baseExternalEventId
  return {
    ...context,
    externalEventId,
    externalThreadId: sender,
    senderExternalId: sender,
    chatType: 'private',
    replyTargetType: 'user',
    replyTargetId: sender,
    contentText: content || '请分析这张图片。',
    ...(image ? { images: [image] } : {}),
    mergeKey: baseExternalEventId,
    rawMetadataJson: raw,
    scopeKey: `infoflow:private:${sender}`,
    occurredAt: time(raw.CreateTime ?? raw.createTime, event.timestamp),
  }
}

function groupText(body: unknown[]): string {
  return body
    .map((item) => {
      const block = record(item)
      const type = text(block.type).toLocaleUpperCase()
      return !type || ['TEXT', 'MD', 'MARKDOWN', 'URL'].includes(type)
        ? text(block.content)
        : ''
    })
    .filter(Boolean)
    .join('')
}

function mentionsBot(
  header: Record<string, unknown>,
  body: unknown[],
  externalAgentId: string,
): boolean {
  const expected = Number(externalAgentId)
  const headerAt = record(header.at)
  const atIds = Array.isArray(headerAt.atagentids) ? headerAt.atagentids : []
  if (atIds.some((value) => Number(value) === expected)) return true

  return body.some((item) => {
    const block = record(item)
    return (
      text(block.type).toLocaleUpperCase() === 'AT' &&
      Number(block.robotid ?? block.agentId ?? block.agentid) === expected
    )
  })
}

function groupMessage(
  event: IncomingInfoFlowEvent,
  context: InfoFlowNormalizeContext,
): NormalizedInfoFlowEvent | null {
  const raw = event.data.raw
  const eventType = (
    text(raw.eventtype) || text(raw.eventType)
  ).toLocaleUpperCase()
  if (eventType && eventType !== 'MESSAGE_RECEIVE') return null

  const message = record(raw.message)
  const header = record(message.header)
  const body = Array.isArray(message.body) ? message.body : []
  const groupId = String(raw.groupid ?? raw.groupId ?? header.toid ?? '')
  const sender =
    text(header.fromuserid) ||
    text(header.fromUserId) ||
    text(message.FromUserId) ||
    text(message.fromUserId)
  if (!groupId || !sender || sender.startsWith('bot#')) return null
  if (!mentionsBot(header, body, context.externalAgentId)) return null

  const images = imageSourcesFromBody(body)
  const content =
    groupText(body) ||
    text(message.Content) ||
    text(message.content) ||
    text(message.Markdown)
  if (!content.trim() && images.length === 0) return null
  const baseExternalEventId =
    text(header.messageid) ||
    text(raw.eventId) ||
    `${groupId}:${sender}:${text(raw.time) || event.timestamp}:${content}`
  const externalEventId =
    images.length > 0 ? `${baseExternalEventId}:image` : baseExternalEventId

  return {
    ...context,
    externalEventId,
    externalThreadId: groupId,
    senderExternalId: sender,
    chatType: 'group',
    replyTargetType: 'group',
    replyTargetId: groupId,
    contentText: content.trim() || '请分析这张图片。',
    ...(images.length > 0 ? { images } : {}),
    mergeKey: baseExternalEventId,
    rawMetadataJson: raw,
    scopeKey: `infoflow:group:${groupId}:sender:${sender}`,
    occurredAt: time(
      raw.time ?? raw.eventTime ?? message.CreateTime,
      event.timestamp,
    ),
  }
}

export function normalizeInfoFlowEvent(
  event: IncomingInfoFlowEvent,
  context: InfoFlowNormalizeContext,
): NormalizedInfoFlowEvent | null {
  if (event.data.chatType === 'private') {
    return privateMessage(event, context)
  }
  if (event.data.chatType === 'group') {
    return groupMessage(event, context)
  }
  return null
}
