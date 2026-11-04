import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Clock3,
  History,
  ImageIcon,
  LoaderCircle,
  MessageCircle,
  Plus,
  RefreshCw,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ClipboardEvent, FormEvent, KeyboardEvent } from 'react'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  ChatLoadingSkeleton,
  ConversationHistorySkeleton,
} from '#/components/loading/page-skeletons'
import { Textarea } from '#/components/ui/textarea'
import {
  getConversationMessages,
  getChatConfig,
  getModelConfig,
  getPendingUiInteractionRequest,
  listAgentConversationsRequest,
  respondToUiInteractionRequest,
  sendChatMessageRequest,
} from '#/lib/api/platform-client'
import { DEFAULT_CHAT_MAX_IMAGES_PER_MESSAGE } from '#/lib/chat/limits'
import type {
  AgentConversationSummary,
  ChatImageAttachment,
  ChatMessage,
  ChatUsage,
  ModelOption,
} from '#/lib/api/platform-client'
import { modelSupportsImageInput } from '#/lib/agents/model-capabilities'
import type {
  UiInteractionRecord,
  UiInteractionResponse,
} from '#/lib/chat/ui-interaction'
import { cn } from '#/lib/utils'

import { AgentUiInteractionCard } from './agent-ui-interaction-card'
import { MarkdownMessage } from './markdown-message'
import { ModelChangeDivider } from './model-change-divider'
import { ThinkingActivity } from './thinking-activity'

function parseEvent<T>(event: MessageEvent): T | null {
  try {
    return JSON.parse(event.data) as T
  } catch {
    return null
  }
}

type HistoryState =
  | { status: 'idle'; conversations: AgentConversationSummary[] }
  | { status: 'loading'; conversations: AgentConversationSummary[] }
  | { status: 'ready'; conversations: AgentConversationSummary[] }
  | { status: 'error'; conversations: AgentConversationSummary[] }

type DraftImage = ChatImageAttachment & {
  id: string
  name: string
}

type ChatModel = {
  provider: string
  modelId: string
}

function sameModel(
  left: ChatModel | undefined,
  right: ChatModel | undefined,
): boolean {
  return Boolean(
    left &&
    right &&
    left.provider === right.provider &&
    left.modelId === right.modelId,
  )
}

function latestAssistantModel(messages: ChatMessage[]): ChatModel | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (
      message.role === 'assistant' &&
      message.modelProvider &&
      message.modelId
    ) {
      return {
        provider: message.modelProvider,
        modelId: message.modelId,
      }
    }
  }
  return undefined
}

const supportedImageTypes = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]
const maxImageBytes = 4 * 1024 * 1024

async function readDraftImage(file: File): Promise<DraftImage> {
  if (!supportedImageTypes.includes(file.type)) {
    throw new Error('仅支持 PNG、JPEG、WebP 或 GIF 图片。')
  }
  if (file.size > maxImageBytes) {
    throw new Error('单张图片不能超过 4MB。')
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('图片读取失败，请重新选择。'))
    reader.onerror = () => reject(new Error('图片读取失败，请重新选择。'))
    reader.readAsDataURL(file)
  })
  const separator = dataUrl.indexOf(',')
  if (separator < 0) throw new Error('图片读取失败，请重新选择。')

  return {
    id: `${file.name}:${file.lastModified}:${crypto.randomUUID()}`,
    name: file.name,
    mimeType: file.type,
    data: dataUrl.slice(separator + 1),
  }
}

function formatConversationTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function AgentChatPanel({
  workspaceId,
  agentId,
  agentName,
  versionId,
  defaultProvider,
  defaultModelId,
  supportsImages = true,
}: {
  workspaceId: string
  agentId: string
  agentName: string
  versionId?: string
  defaultProvider?: string
  defaultModelId?: string
  supportsImages?: boolean
}) {
  const initialModel: ModelOption | undefined =
    defaultProvider && defaultModelId
      ? {
          provider: defaultProvider,
          providerLabel: '当前模型',
          modelId: defaultModelId,
          baseUrl: '',
        }
      : undefined
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [images, setImages] = useState<DraftImage[]>([])
  const maxImagesPerMessageRef = useRef(DEFAULT_CHAT_MAX_IMAGES_PER_MESSAGE)
  const chatConfigLoadedRef = useRef(false)
  const [uploadingImages, setUploadingImages] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [pendingUiInteraction, setPendingUiInteraction] =
    useState<UiInteractionRecord | null>(null)
  const [respondingToUi, setRespondingToUi] = useState(false)
  const [uiInteractionError, setUiInteractionError] = useState<string | null>(
    null,
  )
  const [submitting, setSubmitting] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [selectedModel, setSelectedModel] = useState<ModelOption | undefined>(
    initialModel,
  )
  const [activeModel, setActiveModel] = useState<ChatModel | undefined>(
    initialModel
      ? {
          provider: initialModel.provider,
          modelId: initialModel.modelId,
        }
      : undefined,
  )
  const [modelNotice, setModelNotice] = useState<string | null>(null)
  const [loadingConversation, setLoadingConversation] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyState, setHistoryState] = useState<HistoryState>({
    status: 'idle',
    conversations: [],
  })
  const sourceRef = useRef<EventSource | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const storageKey = versionId
    ? `pi-agent-chat:${agentId}:${versionId}`
    : `pi-agent-chat:${agentId}`
  const imagesSupported = selectedModel
    ? modelSupportsImageInput(selectedModel.modelId)
    : supportsImages

  useEffect(() => {
    const stored = sessionStorage.getItem(storageKey)
    if (!stored) return
    const lifecycle = new AbortController()
    const isCancelled = () => lifecycle.signal.aborted
    setConversationId(stored)
    setLoadingConversation(true)
    void (async () => {
      try {
        const previousMessages = await getConversationMessages(
          workspaceId,
          stored,
        )
        if (isCancelled()) return
        setMessages(previousMessages)
        const storedModel = latestAssistantModel(previousMessages)
        if (storedModel) {
          setActiveModel(storedModel)
          setSelectedModel({
            provider: storedModel.provider,
            providerLabel: '当前会话模型',
            modelId: storedModel.modelId,
            baseUrl: '',
          })
        }
        try {
          const interaction = await getPendingUiInteractionRequest(
            workspaceId,
            stored,
          )
          if (!isCancelled()) setPendingUiInteraction(interaction)
        } catch {
          if (!isCancelled()) setPendingUiInteraction(null)
        }
      } catch {
        if (!isCancelled()) sessionStorage.removeItem(storageKey)
      } finally {
        if (!isCancelled()) setLoadingConversation(false)
      }
    })()
    return () => {
      lifecycle.abort()
      sourceRef.current?.close()
    }
  }, [storageKey, workspaceId])

  useEffect(() => {
    if (!imagesSupported) setImages([])
  }, [imagesSupported])

  useEffect(() => {
    if (!defaultProvider && !defaultModelId) return
    let active = true
    getModelConfig(workspaceId)
      .then((config) => {
        if (!active) return
        const options = Array.isArray(config.options) ? config.options : []
        if (options.length === 0) return
        setModelOptions(options)
        setSelectedModel((current) => {
          const target = current ?? initialModel ?? options[0]
          return (
            options.find(
              (option) =>
                option.provider === target.provider &&
                option.modelId === target.modelId,
            ) ?? target
          )
        })
      })
      .catch(() => {
        // The published version model remains usable if catalog loading fails.
      })
    return () => {
      active = false
    }
  }, [
    defaultModelId,
    defaultProvider,
    initialModel?.modelId,
    initialModel?.provider,
    workspaceId,
  ])

  function patchAssistant(
    id: string,
    patch: Partial<Extract<ChatMessage, { role: 'assistant' }>>,
  ) {
    setMessages((current) =>
      current.map((message) =>
        message.id === id && message.role === 'assistant'
          ? { ...message, ...patch }
          : message,
      ),
    )
  }

  function appendAssistantText(id: string, text: string) {
    setMessages((current) =>
      current.map((message) =>
        message.id === id && message.role === 'assistant'
          ? { ...message, text: `${message.text}${text}` }
          : message,
      ),
    )
  }

  function appendAssistantThinking(id: string, text: string) {
    setMessages((current) =>
      current.map((message) =>
        message.id === id && message.role === 'assistant'
          ? {
              ...message,
              thinking: `${message.thinking ?? ''}${text}`,
            }
          : message,
      ),
    )
  }

  function insertModelChange(model: ChatModel, beforeMessageId: string) {
    setActiveModel(model)
    setMessages((current) => {
      const targetIndex = current.findIndex(
        (message) => message.id === beforeMessageId,
      )
      const divider: ChatMessage = {
        id: `model-change-${beforeMessageId}`,
        role: 'model-change',
        modelProvider: model.provider,
        modelId: model.modelId,
        timestamp: Date.now(),
      }
      if (targetIndex < 0) {
        const previous = current.at(-1)
        return previous?.role === 'model-change' &&
          previous.modelProvider === model.provider &&
          previous.modelId === model.modelId
          ? current
          : [...current, divider]
      }
      if (targetIndex > 0) {
        const previous = current[targetIndex - 1]
        if (
          previous.role === 'model-change' &&
          previous.modelProvider === model.provider &&
          previous.modelId === model.modelId
        ) {
          return current
        }
      }
      return [
        ...current.slice(0, targetIndex),
        divider,
        ...current.slice(targetIndex),
      ]
    })
  }

  function watchSubmission(
    submitted: { conversationId: string; submissionId: string },
    assistantId: string,
    localUserId?: string,
  ) {
    sourceRef.current?.close()
    const source = new EventSource(
      `/api/conversations/${encodeURIComponent(submitted.conversationId)}/events?workspaceId=${encodeURIComponent(workspaceId)}&submissionId=${encodeURIComponent(submitted.submissionId)}`,
    )
    sourceRef.current = source
    source.addEventListener('snapshot', (messageEvent) => {
      const data = parseEvent<{
        messages: ChatMessage[]
        partial?: string
        thinkingPartial?: string
        usage?: ChatUsage
        model?: ChatModel
        uiInteraction?: UiInteractionRecord
      }>(messageEvent)
      if (!data) return
      if (data.model) setActiveModel(data.model)
      if (data.uiInteraction) {
        setPendingUiInteraction(data.uiInteraction)
        setUiInteractionError(null)
      }
      setMessages((current) => {
        const existingPending = current.find(
          (message) => message.id === assistantId,
        )
        const pending =
          existingPending?.role === 'assistant'
            ? existingPending
            : {
                id: assistantId,
                role: 'assistant' as const,
                text: '',
                timestamp: Date.now(),
              }
        const nextMessages = [...data.messages]
        const localModelChange = localUserId
          ? current.find(
              (message) =>
                message.id === `model-change-${localUserId}` &&
                message.role === 'model-change',
            )
          : undefined
        if (localModelChange) {
          let lastUserIndex = -1
          for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
            if (nextMessages[index].role === 'user') {
              lastUserIndex = index
              break
            }
          }
          if (lastUserIndex >= 0) {
            nextMessages.splice(lastUserIndex, 0, localModelChange)
          }
        }
        return [
          ...nextMessages,
          {
            ...pending,
            text: data.partial ?? pending.text,
            ...(data.thinkingPartial ? { thinking: data.thinkingPartial } : {}),
            ...(data.usage ? { usage: data.usage } : {}),
            ...(data.model
              ? {
                  modelProvider: data.model.provider,
                  modelId: data.model.modelId,
                }
              : {}),
          },
        ]
      })
    })
    source.addEventListener('delta', (messageEvent) => {
      const data = parseEvent<{ text: string }>(messageEvent)
      if (data?.text) appendAssistantText(assistantId, data.text)
    })
    source.addEventListener('thinking', (messageEvent) => {
      const data = parseEvent<{ text: string }>(messageEvent)
      if (data?.text) appendAssistantThinking(assistantId, data.text)
    })
    source.addEventListener('usage', (messageEvent) => {
      const data = parseEvent<{ usage: ChatUsage }>(messageEvent)
      if (data?.usage) patchAssistant(assistantId, { usage: data.usage })
    })
    source.addEventListener('agent_changed', (messageEvent) => {
      const data = parseEvent<{
        modelProvider: string
        modelId: string
      }>(messageEvent)
      if (data && localUserId) {
        insertModelChange(
          {
            provider: data.modelProvider,
            modelId: data.modelId,
          },
          localUserId,
        )
      }
    })
    source.addEventListener('ui_request', (messageEvent) => {
      const data = parseEvent<{
        interaction: UiInteractionRecord
      }>(messageEvent)
      if (data?.interaction) {
        setPendingUiInteraction(data.interaction)
        setUiInteractionError(null)
      }
    })
    source.addEventListener('done', (messageEvent) => {
      const data = parseEvent<{
        text: string
        thinking?: string
        usage?: ChatUsage
        modelProvider?: string
        modelId?: string
      }>(messageEvent)
      patchAssistant(assistantId, {
        text: data?.text ?? '',
        ...(data?.thinking ? { thinking: data.thinking } : {}),
        ...(data?.usage ? { usage: data.usage } : {}),
        ...(data?.modelProvider ? { modelProvider: data.modelProvider } : {}),
        ...(data?.modelId ? { modelId: data.modelId } : {}),
      })
      if (data?.modelProvider && data.modelId) {
        setActiveModel({
          provider: data.modelProvider,
          modelId: data.modelId,
        })
      }
      setStreaming(false)
      setSubmitting(false)
      source.close()
      if (sourceRef.current === source) sourceRef.current = null
    })
    source.addEventListener('failed', (messageEvent) => {
      const data = parseEvent<{ message?: string }>(messageEvent)
      setError(data?.message ?? 'Agent 回答失败，请稍后重试。')
      setStreaming(false)
      setSubmitting(false)
      setMessages((current) =>
        current.filter((message) => message.id !== assistantId),
      )
      source.close()
      if (sourceRef.current === source) sourceRef.current = null
    })
    source.addEventListener('error', () => {
      if (sourceRef.current !== source) return
      setError('回复流中断，请重试或刷新会话。')
      setStreaming(false)
      setSubmitting(false)
      setMessages((current) =>
        current.filter((message) => message.id !== assistantId),
      )
      source.close()
      if (sourceRef.current === source) sourceRef.current = null
    })
  }

  async function configuredImageLimit(): Promise<number> {
    if (chatConfigLoadedRef.current) return maxImagesPerMessageRef.current
    chatConfigLoadedRef.current = true
    try {
      const config = await getChatConfig()
      const limit = config.maxImagesPerMessage
      if (Number.isInteger(limit) && limit >= 1) {
        maxImagesPerMessageRef.current = limit
        setImages((current) => current.slice(0, limit))
      }
    } catch {
      // Keep the shared default when chat configuration is unavailable.
    }
    return maxImagesPerMessageRef.current
  }

  async function addImages(files: File[]) {
    if (files.length === 0) return
    if (!imagesSupported) {
      setError('当前模型不支持图片输入，请先切换 Vision 模型。')
      return
    }
    const imageLimit = await configuredImageLimit()
    if (images.length + files.length > imageLimit) {
      setError(`每条消息最多上传 ${imageLimit} 张图片。`)
      return
    }

    setUploadingImages(true)
    setError(null)
    try {
      const nextImages = await Promise.all(files.map(readDraftImage))
      setImages((current) => [...current, ...nextImages].slice(0, imageLimit))
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : '图片上传失败，请重新选择。',
      )
    } finally {
      setUploadingImages(false)
    }
  }

  function selectModel(model: ModelOption) {
    setSelectedModel(model)
    setModelNotice(`${model.modelId} 已切换，下一条消息生效`)
    if (!modelSupportsImageInput(model.modelId)) setImages([])
  }

  const availableModels =
    selectedModel &&
    !modelOptions.some(
      (model) =>
        model.provider === selectedModel.provider &&
        model.modelId === selectedModel.modelId,
    )
      ? [selectedModel, ...modelOptions]
      : modelOptions
  const providerGroups = Array.from(
    availableModels
      .reduce(
        (groups, model) => {
          const group = groups.get(model.provider) ?? {
            provider: model.provider,
            providerLabel: model.providerLabel,
            models: [] as ModelOption[],
          }
          group.models.push(model)
          groups.set(model.provider, group)
          return groups
        },
        new Map<
          string,
          {
            provider: string
            providerLabel: string
            models: ModelOption[]
          }
        >(),
      )
      .values(),
  )

  async function submitMessage(submitEvent?: FormEvent<HTMLFormElement>) {
    submitEvent?.preventDefault()
    const content = input.trim()
    if (
      (!content && images.length === 0) ||
      submitting ||
      streaming ||
      uploadingImages ||
      pendingUiInteraction
    ) {
      return
    }

    const userId = `local-user-${Date.now()}`
    const assistantId = `pending-assistant-${Date.now()}`
    const pendingImages = images
    const localAttachments: ChatImageAttachment[] = pendingImages.map(
      ({ data, mimeType, name }) => ({ data, mimeType, name }),
    )
    const requestAttachments: ChatImageAttachment[] = pendingImages.map(
      ({ data, mimeType }) => ({ data, mimeType }),
    )
    const selectedChatModel: ChatModel | undefined = selectedModel
      ? {
          provider: selectedModel.provider,
          modelId: selectedModel.modelId,
        }
      : undefined
    const showModelChange = Boolean(
      conversationId &&
      selectedChatModel &&
      activeModel &&
      !sameModel(activeModel, selectedChatModel),
    )
    setMessages((current) => [
      ...current,
      ...(showModelChange && selectedChatModel
        ? [
            {
              id: `model-change-${userId}`,
              role: 'model-change' as const,
              modelProvider: selectedChatModel.provider,
              modelId: selectedChatModel.modelId,
              timestamp: Date.now(),
            },
          ]
        : []),
      {
        id: userId,
        role: 'user',
        text: content,
        timestamp: Date.now(),
        ...(localAttachments.length > 0
          ? { attachments: localAttachments }
          : {}),
      },
      {
        id: assistantId,
        role: 'assistant',
        text: '',
        timestamp: Date.now(),
        ...(selectedChatModel
          ? {
              modelProvider: selectedChatModel.provider,
              modelId: selectedChatModel.modelId,
            }
          : {}),
      },
    ])
    if (selectedChatModel && showModelChange) {
      setActiveModel(selectedChatModel)
    }
    setInput('')
    setImages([])
    setSubmitting(true)
    setStreaming(true)
    setError(null)

    try {
      const submitted = await sendChatMessageRequest(workspaceId, agentId, {
        conversationId: conversationId ?? undefined,
        message: content,
        ...(requestAttachments.length > 0
          ? { attachments: requestAttachments }
          : {}),
        ...(selectedModel
          ? {
              modelProvider: selectedModel.provider,
              modelId: selectedModel.modelId,
            }
          : {}),
        idempotencyKey: crypto.randomUUID(),
      })
      setConversationId(submitted.conversationId)
      sessionStorage.setItem(storageKey, submitted.conversationId)
      watchSubmission(submitted, assistantId, userId)
    } catch {
      setError('消息发送失败，请稍后重试。')
      setInput(content)
      setImages(pendingImages)
      setStreaming(false)
      setSubmitting(false)
      setMessages((current) =>
        current.filter((message) => message.id !== assistantId),
      )
    }
  }

  async function respondToUiInteraction(response: UiInteractionResponse) {
    if (!conversationId || !pendingUiInteraction || respondingToUi) return
    const interaction = pendingUiInteraction
    const assistantId = `pending-assistant-${Date.now()}`
    setRespondingToUi(true)
    setUiInteractionError(null)
    setError(null)
    try {
      const submitted = await respondToUiInteractionRequest(
        workspaceId,
        conversationId,
        interaction.id,
        response,
      )
      setPendingUiInteraction(null)
      setConversationId(submitted.conversationId)
      sessionStorage.setItem(storageKey, submitted.conversationId)
      setMessages((current) => [
        ...current,
        {
          id: assistantId,
          role: 'assistant',
          text: '',
          timestamp: Date.now(),
        },
      ])
      setSubmitting(true)
      setStreaming(true)
      watchSubmission(submitted, assistantId)
    } catch {
      setUiInteractionError('选择提交失败，请稍后重试。')
    } finally {
      setRespondingToUi(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submitMessage()
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.items)
      .filter(
        (item) =>
          item.kind === 'file' &&
          item.type.toLocaleLowerCase().startsWith('image/'),
      )
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
    if (files.length === 0) return

    const hasText = Boolean(event.clipboardData.getData('text/plain'))
    if (!imagesSupported) {
      if (!hasText) event.preventDefault()
      return
    }

    if (!hasText) {
      event.preventDefault()
    }
    void addImages(files)
  }

  function newConversation() {
    sourceRef.current?.close()
    sourceRef.current = null
    sessionStorage.removeItem(storageKey)
    setConversationId(null)
    setMessages([])
    setInput('')
    setImages([])
    setUploadingImages(false)
    setPendingUiInteraction(null)
    setRespondingToUi(false)
    setUiInteractionError(null)
    setModelNotice(null)
    setError(null)
    setLoadingConversation(false)
    setStreaming(false)
    setSubmitting(false)
    setActiveModel(
      defaultProvider && defaultModelId
        ? { provider: defaultProvider, modelId: defaultModelId }
        : undefined,
    )
  }

  async function loadHistory() {
    setHistoryState((current) => ({
      status: 'loading',
      conversations: current.conversations,
    }))
    try {
      const conversations = await listAgentConversationsRequest(
        workspaceId,
        agentId,
      )
      setHistoryState({ status: 'ready', conversations })
    } catch {
      setHistoryState((current) => ({
        status: 'error',
        conversations: current.conversations,
      }))
    }
  }

  function openHistory() {
    setHistoryOpen(true)
    void loadHistory()
  }

  async function openConversation(conversation: AgentConversationSummary) {
    sourceRef.current?.close()
    sourceRef.current = null
    setHistoryOpen(false)
    setError(null)
    setStreaming(false)
    setSubmitting(false)
    setLoadingConversation(true)
    setMessages([])
    setImages([])
    try {
      const [previousMessages, interaction] = await Promise.all([
        getConversationMessages(workspaceId, conversation.id),
        getPendingUiInteractionRequest(workspaceId, conversation.id).catch(
          () => null,
        ),
      ])
      setConversationId(conversation.id)
      setPendingUiInteraction(interaction)
      setUiInteractionError(null)
      setSelectedModel(
        modelOptions.find(
          (model) =>
            model.provider === conversation.modelProvider &&
            model.modelId === conversation.modelId,
        ) ?? {
          provider: conversation.modelProvider,
          providerLabel: '历史会话模型',
          modelId: conversation.modelId,
          baseUrl: '',
        },
      )
      setModelNotice(null)
      sessionStorage.setItem(storageKey, conversation.id)
      setMessages(previousMessages)
      setActiveModel(
        latestAssistantModel(previousMessages) ?? {
          provider: conversation.modelProvider,
          modelId: conversation.modelId,
        },
      )
    } catch {
      setError('历史对话加载失败，请稍后重试。')
    } finally {
      setLoadingConversation(false)
    }
  }

  return (
    <>
      <div className="agent-panel flex min-h-[calc(100vh-15rem)] flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-4 border-b border-[var(--line)] px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-[var(--sea-ink)] text-white">
              <Bot aria-hidden="true" className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">{agentName}</h2>
              <p className="text-[10px] text-[var(--sea-ink-soft)]">
                {streaming
                  ? 'Agent 正在思考…'
                  : loadingConversation
                    ? '正在加载历史对话…'
                    : '已绑定当前发布版本'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={openHistory}
            >
              <History aria-hidden="true" />
              历史对话
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={newConversation}
            >
              <Plus aria-hidden="true" />
              新对话
            </Button>
          </div>
        </header>

        <div
          className="flex-1 space-y-5 overflow-y-auto px-5 py-6 sm:px-8"
          aria-live="polite"
        >
          {loadingConversation ? (
            <ChatLoadingSkeleton />
          ) : messages.length === 0 ? (
            <div className="flex h-full min-h-72 flex-col items-center justify-center text-center">
              <span className="grid size-12 place-items-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--lagoon-deep)]">
                <Sparkles aria-hidden="true" className="size-5" />
              </span>
              <h3 className="mt-4 text-sm font-semibold">开始一段新对话</h3>
              <p className="mt-1 max-w-sm text-xs leading-5 text-[var(--sea-ink-soft)]">
                输入消息后会先持久化入参，再由 Pi Durable 执行并返回回答。
              </p>
            </div>
          ) : (
            messages.map((message) => {
              if (message.role === 'model-change') {
                return (
                  <ModelChangeDivider
                    key={message.id}
                    modelId={message.modelId}
                  />
                )
              }

              const isAssistant = message.role === 'assistant'
              return (
                <article
                  key={message.id}
                  className={cn(
                    'flex gap-3',
                    message.role === 'user' && 'justify-end',
                  )}
                >
                  {isAssistant ? (
                    <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-[var(--sea-ink)] text-white">
                      <Bot aria-hidden="true" className="size-3.5" />
                    </span>
                  ) : null}
                  <div
                    className={cn(
                      'max-w-[82%] space-y-2 rounded-2xl px-4 py-3 text-sm leading-6',
                      isAssistant
                        ? 'bg-white/45'
                        : 'whitespace-pre-wrap bg-[var(--sea-ink)] text-white',
                    )}
                  >
                    {message.role === 'user' && message.attachments?.length ? (
                      <div className="grid max-w-72 grid-cols-2 gap-2">
                        {message.attachments.map((attachment, index) => (
                          <img
                            key={`${message.id}:${index}`}
                            src={`data:${attachment.mimeType};base64,${attachment.data}`}
                            alt={attachment.name || `图片附件 ${index + 1}`}
                            className="aspect-square w-full rounded-xl border border-white/20 object-cover"
                          />
                        ))}
                      </div>
                    ) : null}
                    {message.role === 'assistant' &&
                    message.thinking?.trim() ? (
                      <ThinkingActivity
                        thinking={message.thinking}
                        usage={message.usage}
                      />
                    ) : null}
                    {message.text ? (
                      isAssistant ? (
                        <MarkdownMessage content={message.text} />
                      ) : (
                        message.text
                      )
                    ) : isAssistant && !message.thinking?.trim() ? (
                      <span className="inline-flex items-center gap-2 text-[var(--sea-ink-soft)]">
                        <LoaderCircle
                          aria-hidden="true"
                          className="size-3.5 animate-spin"
                        />
                        思考中…
                      </span>
                    ) : null}
                  </div>
                  {message.role === 'user' ? (
                    <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)]">
                      <UserRound aria-hidden="true" className="size-3.5" />
                    </span>
                  ) : null}
                </article>
              )
            })
          )}
          {pendingUiInteraction ? (
            <AgentUiInteractionCard
              interaction={pendingUiInteraction}
              submitting={respondingToUi}
              error={uiInteractionError}
              onSubmit={respondToUiInteraction}
            />
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="px-5 pb-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <form
          onSubmit={submitMessage}
          className="bg-[var(--surface)] p-4 sm:p-5"
        >
          <div className="rounded-[24px] border border-[var(--line)] bg-white/70 p-2.5 shadow-[0_10px_30px_rgba(30,90,72,0.06)] transition-colors focus-within:border-[var(--lagoon-deep)]">
            {images.length > 0 ? (
              <div
                className="mb-2 flex gap-2 overflow-x-auto px-1 pt-1"
                aria-label="待发送图片"
              >
                {images.map((image) => (
                  <div
                    key={image.id}
                    className="group relative size-16 shrink-0 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]"
                  >
                    <img
                      src={`data:${image.mimeType};base64,${image.data}`}
                      alt={image.name}
                      className="size-full object-cover"
                    />
                    <button
                      type="button"
                      aria-label={`移除 ${image.name}`}
                      onClick={() =>
                        setImages((current) =>
                          current.filter((item) => item.id !== image.id),
                        )
                      }
                      className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-black/65 text-white opacity-90 transition-opacity hover:opacity-100"
                    >
                      <X aria-hidden="true" className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <input
              ref={fileInputRef}
              type="file"
              aria-label="选择图片文件"
              accept={supportedImageTypes.join(',')}
              multiple
              disabled={!imagesSupported}
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? [])
                event.target.value = ''
                void addImages(files)
              }}
            />
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              aria-label="输入消息"
              disabled={Boolean(pendingUiInteraction)}
              placeholder={
                pendingUiInteraction
                  ? '请先完成上方的选择'
                  : '输入消息，Enter 发送，Shift + Enter 换行'
              }
              rows={3}
              className="min-h-20 w-full resize-none border-0 bg-transparent px-2 pt-2 pb-1 text-[15px] leading-6 shadow-none focus-visible:ring-0"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="上传图片"
                  disabled={
                    !imagesSupported ||
                    uploadingImages ||
                    submitting ||
                    streaming ||
                    Boolean(pendingUiInteraction)
                  }
                  className="size-9 shrink-0 rounded-full text-[var(--sea-ink-soft)] hover:bg-[var(--link-bg-hover)] hover:text-[var(--sea-ink)]"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadingImages ? (
                    <LoaderCircle aria-hidden="true" className="animate-spin" />
                  ) : (
                    <Plus aria-hidden="true" />
                  )}
                </Button>
              </div>

              <div className="flex min-w-0 items-center gap-1.5">
                {selectedModel ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`模型：${selectedModel.modelId}`}
                        className="h-8 max-w-56 rounded-full px-2.5 font-medium text-[var(--sea-ink-soft)]"
                      >
                        <span className="truncate">
                          {selectedModel.modelId}
                        </span>
                        {modelSupportsImageInput(selectedModel.modelId) ? (
                          <ImageIcon
                            aria-label="支持图片"
                            className="size-3.5 text-[var(--lagoon-deep)]"
                          />
                        ) : null}
                        <ChevronDown
                          aria-hidden="true"
                          className="size-3.5 opacity-50"
                        />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="max-h-[min(28rem,65vh)] w-72 overflow-y-auto"
                    >
                      <DropdownMenuLabel>切换会话模型</DropdownMenuLabel>
                      {providerGroups.map((group) => (
                        <DropdownMenuSub key={group.provider}>
                          <DropdownMenuSubTrigger>
                            <span className="min-w-0 flex-1 truncate">
                              {group.providerLabel}
                            </span>
                            {selectedModel.provider === group.provider ? (
                              <Check
                                aria-label="当前供应商"
                                className="size-3.5 text-[var(--palm)]"
                              />
                            ) : (
                              <span className="font-mono text-[9px] text-[var(--sea-ink-soft)]">
                                {group.models.length}
                              </span>
                            )}
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="max-h-[min(24rem,60vh)] min-w-64 overflow-y-auto">
                            <DropdownMenuLabel className="normal-case">
                              {group.providerLabel}
                            </DropdownMenuLabel>
                            <DropdownMenuRadioGroup
                              value={`${selectedModel.provider}:${selectedModel.modelId}`}
                            >
                              {group.models.map((model) => (
                                <DropdownMenuRadioItem
                                  key={`${model.provider}:${model.modelId}`}
                                  value={`${model.provider}:${model.modelId}`}
                                  onSelect={() => selectModel(model)}
                                  onClick={() => selectModel(model)}
                                >
                                  <span className="min-w-0 flex-1 truncate">
                                    {model.modelId}
                                  </span>
                                  {modelSupportsImageInput(model.modelId) ? (
                                    <ImageIcon
                                      aria-label="支持图片"
                                      className="size-3.5 text-[var(--lagoon-deep)]"
                                    />
                                  ) : null}
                                </DropdownMenuRadioItem>
                              ))}
                            </DropdownMenuRadioGroup>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}

                <Button
                  type="submit"
                  size="icon"
                  aria-label="发送"
                  disabled={
                    (!input.trim() && images.length === 0) ||
                    uploadingImages ||
                    submitting ||
                    streaming ||
                    Boolean(pendingUiInteraction)
                  }
                  className="size-9 shrink-0 rounded-full bg-[var(--sea-ink)] text-white hover:bg-[var(--lagoon-deep)] disabled:opacity-35"
                >
                  {submitting ? (
                    <LoaderCircle aria-hidden="true" className="animate-spin" />
                  ) : (
                    <ArrowUp aria-hidden="true" />
                  )}
                </Button>
              </div>
            </div>
          </div>
          {!imagesSupported ? (
            <p className="mt-2 px-2 text-[10px] leading-4 text-[var(--sea-ink-soft)]">
              当前模型不支持图片输入，请选择 Vision 模型后重新发布。
            </p>
          ) : null}
          {modelNotice ? (
            <p
              role="status"
              className="mt-2 px-2 text-[10px] leading-4 text-[var(--lagoon-deep)]"
            >
              {modelNotice}
            </p>
          ) : null}
        </form>
      </div>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="agent-history-dialog">
          <DialogHeader className="border-b border-[var(--line)] px-5 py-5 pr-14">
            <DialogTitle>历史对话</DialogTitle>
            <DialogDescription>
              当前 Agent 由你发起并持久化保存的 Web 对话，按最近更新时间排序。
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {historyState.status === 'loading' &&
            historyState.conversations.length === 0 ? (
              <ConversationHistorySkeleton />
            ) : null}

            {historyState.status === 'error' ? (
              <div
                role="alert"
                className="m-3 flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--line)] px-5 py-8 text-center text-xs text-destructive"
              >
                <span>历史对话加载失败，请稍后重试。</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadHistory()}
                >
                  <RefreshCw aria-hidden="true" />
                  重新加载
                </Button>
              </div>
            ) : null}

            {historyState.status === 'ready' &&
            historyState.conversations.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
                <span className="grid size-11 place-items-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--lagoon-deep)]">
                  <MessageCircle aria-hidden="true" className="size-5" />
                </span>
                <h3 className="mt-4 text-sm font-semibold">暂无历史对话</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--sea-ink-soft)]">
                  发送第一条消息后，对话会出现在这里。
                </p>
              </div>
            ) : null}

            {historyState.conversations.length > 0 ? (
              <div className="space-y-1.5">
                {historyState.conversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    aria-current={
                      conversation.id === conversationId ? 'true' : undefined
                    }
                    className="agent-history-item"
                    onClick={() => void openConversation(conversation)}
                  >
                    <span className="agent-history-marker">
                      <MessageCircle aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <strong>{conversation.title}</strong>
                        <span className="shrink-0 text-[9px] text-[var(--sea-ink-soft)]">
                          {formatConversationTime(conversation.updatedAt)}
                        </span>
                      </span>
                      <span className="mt-1 line-clamp-2 text-[11px] leading-5 text-[var(--sea-ink-soft)]">
                        {conversation.preview || '暂无回答'}
                      </span>
                      <span className="mt-1.5 flex items-center gap-1 text-[9px] text-[var(--kicker)]">
                        <Clock3 aria-hidden="true" />
                        {conversation.messageCount} 条消息
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
