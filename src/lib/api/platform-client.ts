import type { AgentManifest } from '#/lib/agents/agent-manifest'
import type { AgentChangeModule } from '#/lib/agents/agent-change'
import type {
  UiInteractionRecord,
  UiInteractionResponse,
} from '#/lib/chat/ui-interaction'

export type WorkspaceAccess = {
  workspaceId: string
  slug: string
  name: string
  role: 'platform_admin' | 'workspace_admin' | 'editor' | 'user'
}

export type WorkspaceMemberRecord = {
  userId: string
  username: string
  name: string | null
  email: string | null
  role: WorkspaceAccess['role']
  createdAt: string
}

export type SaveWorkspaceMemberInput = {
  username: string
  role: WorkspaceAccess['role']
}

export type AuthMeResponse = {
  user: {
    id: string
    username: string
    name: string | null
    email: string | null
  }
  workspaces: WorkspaceAccess[]
  authMode: 'gateway' | 'development'
}

export type AgentVersionRecord = {
  id: string
  versionNumber: number
  instructions: string
  modelProvider: string
  modelId: string
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high'
  status: 'draft' | 'published' | 'retired'
  publishedAt?: string
  manifestJson?: AgentManifest
}

export type AgentRecord = {
  id: string
  workspaceId: string
  name: string
  description: string
  visibility: 'workspace' | 'restricted'
  status: 'draft' | 'active' | 'disabled'
  currentPublishedVersionId: string | null
  createdBy: string
  versions: AgentVersionRecord[]
  enabledChannels?: Array<'web' | 'infoflow'>
}

export type CreateAgentInput = {
  name: string
  description?: string
  visibility: 'workspace' | 'restricted'
}

export type CreateAgentResponse = {
  id: string
  workspaceId: string
  name: string
  description: string
  status: 'draft'
  visibility: 'workspace' | 'restricted'
  draftVersionId: string
}

export type AgentDraftPatch = {
  name?: string
  description?: string
  instructions?: string
  modelProvider?: string
  modelId?: string
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high'
  visibility?: 'workspace' | 'restricted'
  memberUserIds?: string[]
}

export type ModelOption = {
  provider: string
  providerLabel: string
  modelId: string
  baseUrl: string
}

export type ModelConfigResponse = {
  configured: boolean
  options: ModelOption[]
  errors?: Array<{
    providerId: string
    providerLabel: string
    code: 'provider_unavailable' | 'invalid_response'
  }>
}

export type AiProviderRecord = {
  id: string
  name: string
  baseUrl: string
  tokenMasked: string
  enabled: boolean
  lastTestedAt?: string
  createdAt: string
  updatedAt: string
}

export type SaveAiProviderInput = {
  name: string
  baseUrl: string
  token?: string
  enabled: boolean
}

export type AiProviderTestResult = {
  ok: true
  modelCount: number
}

export type ToolCatalogItem = {
  id: string
  versionId: string
  name: string
  description: string
  source: 'builtin' | 'http' | 'openapi' | 'mcp'
  version: string
  runtimeName: string
  method?: string
  endpoint?: string
  inputSchema: Record<string, unknown>
  definition: Record<string, unknown>
  selected: boolean
}

export type CreateHttpToolInput = {
  name: string
  description: string
  endpoint: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  inputSchema: Record<string, unknown>
}

export type ReviseToolInput =
  | ({ kind: 'http' } & CreateHttpToolInput)
  | {
      kind: 'openapi'
      documentUrl: string
      operationKey: string
    }
  | {
      kind: 'mcp'
      serverUrl: string
      transport: McpTransport
      toolName: string
    }

export type SkillCatalogItem = {
  id: string
  versionId: string
  name: string
  description: string
  source: 'builtin' | 'workspace'
  version: string
  runtimeName: string
  content: string
  packagePath?: string
  files?: Array<{
    path: string
    size: number
    sha256: string
  }>
  selected: boolean
  sortOrder?: number
}

export type CreateSkillInput = {
  name: string
  description: string
  content: string
}

export type ChannelConnectionStatus =
  'not_configured' | 'disconnected' | 'connecting' | 'connected' | 'error'

export type AgentChannelsResponse = {
  web: {
    channel: 'web'
    enabled: true
    status: 'ready'
  }
  infoflow: {
    channel: 'infoflow'
    enabled: boolean
    configured: boolean
    infoflowAgentId?: string
    appKeyMasked?: string
    displayName?: string
    iconUrl?: string
    status: ChannelConnectionStatus
    statusMessage?: string
    lastTestedAt?: string
    connectedAt?: string
  }
}

export type SaveInfoFlowChannelInput = {
  enabled: boolean
  infoflowAgentId?: string
  appKey?: string
  appSecret?: string
}

export type InfoFlowConnectionTestResult = {
  ok: true
  infoflowAgentId: string
  name: string
  iconUrl?: string
}

export type PublishCheck = {
  id: string
  label: string
  passed: boolean
  detail: string
}

export type PublishSummary = {
  versionNumber: number
  name: string
  promptExcerpt: string
  modelProvider: string
  modelId: string
  thinkingLevel: string
  tools: number
  skills: number
  channels: string[]
}

export type PublishReadiness = {
  state: 'draft' | 'published'
  ready: boolean
  hasChanges: boolean
  changedModules: AgentChangeModule[]
  checks: PublishCheck[]
  summary: PublishSummary
}

export type ChatUsage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning?: number
  totalTokens: number
  costTotal: number
}

export type ChatMessage =
  | {
      id: string
      role: 'user'
      text: string
      timestamp: number
      attachments?: ChatImageAttachment[]
    }
  | {
      id: string
      role: 'assistant'
      text: string
      thinking?: string
      usage?: ChatUsage
      modelProvider?: string
      modelId?: string
      timestamp: number
    }
  | {
      id: string
      role: 'model-change'
      modelProvider: string
      modelId: string
      timestamp: number
    }

export type ChatImageAttachment = {
  data: string
  mimeType: string
  name?: string
}

export type AgentConversationSummary = {
  id: string
  title: string
  preview: string
  modelProvider: string
  modelId: string
  messageCount: number
  updatedAt: string
}

export type SendChatMessageInput = {
  conversationId?: string
  message: string
  attachments?: ChatImageAttachment[]
  modelProvider?: string
  modelId?: string
  idempotencyKey: string
}

export type ChatSubmissionResponse = {
  conversationId: string
  submissionId: string
}

export type ChatConfigResponse = {
  maxImagesPerMessage: number
}

export type AgentAccessResponse = {
  userIds: string[]
}

export type OpenApiOperationPreview = {
  key: string
  operationId?: string
  name: string
  description: string
  method: string
  path: string
  inputSchema: Record<string, unknown>
}

export type OpenApiPreview = {
  title: string
  version: string
  serverUrl: string
  operations: OpenApiOperationPreview[]
}

export type McpTransport = 'streamable-http' | 'sse'

export type McpToolPreview = {
  name: string
  title?: string
  description?: string
  inputSchema: {
    type: 'object'
    properties?: Record<string, object>
    required?: string[]
    [key: string]: unknown
  }
}

export type McpPreview = {
  serverName: string
  serverVersion?: string
  transport: McpTransport
  tools: McpToolPreview[]
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(detail ?? code)
    this.name = 'ApiError'
  }
}

async function request<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, {
    credentials: 'include',
    ...init,
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string
      message?: string
    } | null
    throw new ApiError(
      body?.error ?? 'request_failed',
      response.status,
      body?.message,
    )
  }

  return (await response.json()) as T
}

async function requestVoid(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, {
    credentials: 'include',
    ...init,
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string
      message?: string
    } | null
    throw new ApiError(
      body?.error ?? 'request_failed',
      response.status,
      body?.message,
    )
  }
}

export function getAuthMe(): Promise<AuthMeResponse> {
  return request<AuthMeResponse>('/api/auth/me')
}

export function listAgentsRequest(workspaceId: string): Promise<AgentRecord[]> {
  return request<AgentRecord[]>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents`,
  )
}

export function createAgentRequest(
  workspaceId: string,
  input: CreateAgentInput,
): Promise<CreateAgentResponse> {
  return request<CreateAgentResponse>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export function getAgentRequest(
  workspaceId: string,
  agentId: string,
): Promise<AgentRecord> {
  return request<AgentRecord>(
    `/api/agents/${encodeURIComponent(agentId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
  )
}

export function getAgentAccessRequest(
  workspaceId: string,
  agentId: string,
): Promise<AgentAccessResponse> {
  return request<AgentAccessResponse>(
    `/api/agents/${encodeURIComponent(agentId)}/access?workspaceId=${encodeURIComponent(workspaceId)}`,
  )
}

export function listWorkspaceMembersRequest(
  workspaceId: string,
): Promise<WorkspaceMemberRecord[]> {
  return request<WorkspaceMemberRecord[]>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/members`,
  )
}

export function saveWorkspaceMemberRequest(
  workspaceId: string,
  input: SaveWorkspaceMemberInput,
): Promise<WorkspaceMemberRecord> {
  return request<WorkspaceMemberRecord>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/members`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export function removeWorkspaceMemberRequest(
  workspaceId: string,
  userId: string,
): Promise<void> {
  return requestVoid(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  )
}

export function getModelConfig(
  workspaceId: string,
): Promise<ModelConfigResponse> {
  return request<ModelConfigResponse>(
    `/api/model-config?workspaceId=${encodeURIComponent(workspaceId)}`,
  )
}

export function getChatConfig(): Promise<ChatConfigResponse> {
  return request<ChatConfigResponse>('/api/chat/config')
}

export function listAiProvidersRequest(
  workspaceId: string,
): Promise<AiProviderRecord[]> {
  return request<AiProviderRecord[]>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/providers`,
  )
}

export function createAiProviderRequest(
  workspaceId: string,
  input: SaveAiProviderInput,
): Promise<AiProviderRecord> {
  return request<AiProviderRecord>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/providers`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export function updateAiProviderRequest(
  workspaceId: string,
  providerId: string,
  input: SaveAiProviderInput,
): Promise<AiProviderRecord> {
  return request<AiProviderRecord>(
    `/api/providers/${encodeURIComponent(providerId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export function testAiProviderRequest(
  workspaceId: string,
  providerId: string,
): Promise<AiProviderTestResult> {
  return request<AiProviderTestResult>(
    `/api/providers/${encodeURIComponent(providerId)}/test?workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: 'POST' },
  )
}

export function updateAgentDraftRequest(
  workspaceId: string,
  agentId: string,
  patch: AgentDraftPatch,
): Promise<AgentVersionRecord> {
  return request<AgentVersionRecord>(
    `/api/agents/${encodeURIComponent(agentId)}/draft?workspaceId=${encodeURIComponent(workspaceId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    },
  )
}

export function getAgentTools(
  workspaceId: string,
  agentId: string,
): Promise<ToolCatalogItem[]> {
  return request<ToolCatalogItem[]>(
    `/api/agents/${encodeURIComponent(agentId)}/draft/capabilities?workspaceId=${encodeURIComponent(workspaceId)}`,
  )
}

export function getAgentVersionTools(
  workspaceId: string,
  agentId: string,
  versionId: string,
): Promise<ToolCatalogItem[]> {
  return request<ToolCatalogItem[]>(
    `/api/agents/${encodeURIComponent(agentId)}/versions/${encodeURIComponent(versionId)}/capabilities?workspaceId=${encodeURIComponent(workspaceId)}`,
  )
}

export function createHttpToolRequest(
  workspaceId: string,
  input: CreateHttpToolInput,
): Promise<ToolCatalogItem> {
  return request<ToolCatalogItem>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/capabilities/tools`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export function replaceAgentToolsRequest(
  workspaceId: string,
  agentId: string,
  capabilityVersionIds: string[],
): Promise<ToolCatalogItem[]> {
  return request<ToolCatalogItem[]>(
    `/api/agents/${encodeURIComponent(agentId)}/draft/capabilities?workspaceId=${encodeURIComponent(workspaceId)}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capabilityVersionIds }),
    },
  )
}

export function reviseAgentToolRequest(
  workspaceId: string,
  agentId: string,
  versionId: string,
  input: ReviseToolInput,
): Promise<ToolCatalogItem[]> {
  return request<ToolCatalogItem[]>(
    `/api/agents/${encodeURIComponent(agentId)}/draft/capabilities/${encodeURIComponent(versionId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export function deleteAgentCapabilityRequest(
  workspaceId: string,
  agentId: string,
  kind: 'tool',
  versionId: string,
): Promise<ToolCatalogItem[]>
export function deleteAgentCapabilityRequest(
  workspaceId: string,
  agentId: string,
  kind: 'skill',
  versionId: string,
): Promise<SkillCatalogItem[]>
export function deleteAgentCapabilityRequest(
  workspaceId: string,
  agentId: string,
  kind: 'tool' | 'skill',
  versionId: string,
): Promise<Array<ToolCatalogItem | SkillCatalogItem>> {
  const segment = kind === 'tool' ? 'capabilities' : 'skills'
  return request<Array<ToolCatalogItem | SkillCatalogItem>>(
    `/api/agents/${encodeURIComponent(agentId)}/draft/${segment}/${encodeURIComponent(versionId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: 'DELETE' },
  )
}

export function getAgentSkills(
  workspaceId: string,
  agentId: string,
): Promise<SkillCatalogItem[]> {
  return request<SkillCatalogItem[]>(
    `/api/agents/${encodeURIComponent(agentId)}/draft/skills?workspaceId=${encodeURIComponent(workspaceId)}`,
  )
}

export function getAgentVersionSkills(
  workspaceId: string,
  agentId: string,
  versionId: string,
): Promise<SkillCatalogItem[]> {
  return request<SkillCatalogItem[]>(
    `/api/agents/${encodeURIComponent(agentId)}/versions/${encodeURIComponent(versionId)}/skills?workspaceId=${encodeURIComponent(workspaceId)}`,
  )
}

export function createSkillRequest(
  workspaceId: string,
  input: CreateSkillInput,
): Promise<SkillCatalogItem> {
  return request<SkillCatalogItem>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/capabilities/skills`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export function uploadSkillPackageRequest(
  workspaceId: string,
  file: File,
): Promise<SkillCatalogItem> {
  const form = new FormData()
  form.set('file', file)
  return request<SkillCatalogItem>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/capabilities/skills/package`,
    {
      method: 'POST',
      body: form,
    },
  )
}

export function replaceAgentSkillsRequest(
  workspaceId: string,
  agentId: string,
  capabilityVersionIds: string[],
): Promise<SkillCatalogItem[]> {
  return request<SkillCatalogItem[]>(
    `/api/agents/${encodeURIComponent(agentId)}/draft/skills?workspaceId=${encodeURIComponent(workspaceId)}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capabilityVersionIds }),
    },
  )
}

export function getAgentChannels(
  workspaceId: string,
  agentId: string,
): Promise<AgentChannelsResponse> {
  return request<AgentChannelsResponse>(
    `/api/agents/${encodeURIComponent(agentId)}/channels?workspaceId=${encodeURIComponent(workspaceId)}`,
  )
}

export function saveInfoFlowChannelRequest(
  workspaceId: string,
  agentId: string,
  input: SaveInfoFlowChannelInput,
): Promise<AgentChannelsResponse> {
  return request<AgentChannelsResponse>(
    `/api/agents/${encodeURIComponent(agentId)}/channels/infoflow?workspaceId=${encodeURIComponent(workspaceId)}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export function testInfoFlowConnectionRequest(
  workspaceId: string,
  agentId: string,
): Promise<InfoFlowConnectionTestResult> {
  return request<InfoFlowConnectionTestResult>(
    `/api/agents/${encodeURIComponent(agentId)}/channels/infoflow/test?workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: 'POST' },
  )
}

export type AgentApiToken = {
  id: string
  name: string
  username: string
  createdAt: string
  expiresAt: string | null
  revokedAt: string | null
  lastUsedAt: string | null
}

export type AgentApiTokensResponse = {
  enabled: boolean
  tokens: AgentApiToken[]
}

export type CreateAgentApiTokenInput = {
  name: string
  username: string
  expiresInDays: 30 | 90 | 365 | null
}

function apiTokensUrl(workspaceId: string, agentId: string, tokenId?: string) {
  const suffix = tokenId ? `/${encodeURIComponent(tokenId)}` : ''
  return `/api/agents/${encodeURIComponent(agentId)}/api-tokens${suffix}?workspaceId=${encodeURIComponent(workspaceId)}`
}

export function listAgentApiTokensRequest(
  workspaceId: string,
  agentId: string,
): Promise<AgentApiTokensResponse> {
  return request<AgentApiTokensResponse>(apiTokensUrl(workspaceId, agentId))
}

export function createAgentApiTokenRequest(
  workspaceId: string,
  agentId: string,
  input: CreateAgentApiTokenInput,
): Promise<{ token: string; record: AgentApiToken }> {
  return request(apiTokensUrl(workspaceId, agentId), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function revokeAgentApiTokenRequest(
  workspaceId: string,
  agentId: string,
  tokenId: string,
): Promise<AgentApiToken> {
  return request<AgentApiToken>(apiTokensUrl(workspaceId, agentId, tokenId), {
    method: 'DELETE',
  })
}

export function getPublishReadiness(
  workspaceId: string,
  agentId: string,
): Promise<PublishReadiness> {
  return request<PublishReadiness>(
    `/api/agents/${encodeURIComponent(agentId)}/publish-readiness?workspaceId=${encodeURIComponent(workspaceId)}`,
  )
}

export function publishAgentRequest(
  workspaceId: string,
  agentId: string,
): Promise<AgentVersionRecord> {
  return request<AgentVersionRecord>(
    `/api/agents/${encodeURIComponent(agentId)}/publish?workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: 'POST' },
  )
}

export function createNextVersionRequest(
  workspaceId: string,
  agentId: string,
): Promise<AgentVersionRecord> {
  return request<AgentVersionRecord>(
    `/api/agents/${encodeURIComponent(agentId)}/versions?workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: 'POST' },
  )
}

export function sendChatMessageRequest(
  workspaceId: string,
  agentId: string,
  input: SendChatMessageInput,
): Promise<ChatSubmissionResponse> {
  return request<ChatSubmissionResponse>(
    `/api/chat/${encodeURIComponent(agentId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export function getConversationMessages(
  workspaceId: string,
  conversationId: string,
): Promise<ChatMessage[]> {
  return request<ChatMessage[]>(
    `/api/conversations/${encodeURIComponent(conversationId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
  )
}

export async function getPendingUiInteractionRequest(
  workspaceId: string,
  conversationId: string,
): Promise<UiInteractionRecord | null> {
  const result = await request<{
    interaction: UiInteractionRecord | null
  }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/ui?workspaceId=${encodeURIComponent(workspaceId)}`,
  )
  return result.interaction
}

export function respondToUiInteractionRequest(
  workspaceId: string,
  conversationId: string,
  interactionId: string,
  response: UiInteractionResponse,
): Promise<ChatSubmissionResponse> {
  return request<ChatSubmissionResponse>(
    `/api/conversations/${encodeURIComponent(conversationId)}/ui/${encodeURIComponent(interactionId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(response),
    },
  )
}

export function listAgentConversationsRequest(
  workspaceId: string,
  agentId: string,
): Promise<AgentConversationSummary[]> {
  return request<AgentConversationSummary[]>(
    `/api/agents/${encodeURIComponent(agentId)}/conversations?workspaceId=${encodeURIComponent(workspaceId)}`,
  )
}

export function previewOpenApiRequest(
  workspaceId: string,
  documentUrl: string,
): Promise<OpenApiPreview> {
  return request<OpenApiPreview>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/capabilities/openapi/preview`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documentUrl }),
    },
  )
}

export function importOpenApiToolsRequest(
  workspaceId: string,
  documentUrl: string,
  operationKeys: string[],
): Promise<ToolCatalogItem[]> {
  return request<ToolCatalogItem[]>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/capabilities/openapi/import`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documentUrl, operationKeys }),
    },
  )
}

export function previewMcpServerRequest(
  workspaceId: string,
  input: { serverUrl: string; transport: McpTransport },
): Promise<McpPreview> {
  return request<McpPreview>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/capabilities/mcp/preview`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export function importMcpToolsRequest(
  workspaceId: string,
  input: {
    serverUrl: string
    transport: McpTransport
    toolNames: string[]
  },
): Promise<ToolCatalogItem[]> {
  return request<ToolCatalogItem[]>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/capabilities/mcp/import`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}
