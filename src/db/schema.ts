import { sql } from 'drizzle-orm'
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)

export const workspaces = sqliteTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('workspaces_slug_uq').on(table.slug)],
)

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    name: text('name'),
    email: text('email'),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('users_username_uq').on(table.username)],
)

export const workspaceMembers = sqliteTable(
  'workspace_members',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', {
      enum: ['platform_admin', 'workspace_admin', 'editor', 'user'],
    }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })],
)

export const aiProviders = sqliteTable(
  'ai_providers',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    baseUrl: text('base_url').notNull(),
    tokenJson: text('token_json', { mode: 'json' }).notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    lastTestedAt: integer('last_tested_at', { mode: 'timestamp_ms' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex('ai_providers_workspace_name_uq').on(
      table.workspaceId,
      table.name,
    ),
  ],
)

export const agents = sqliteTable(
  'agents',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    visibility: text('visibility', {
      enum: ['workspace', 'restricted'],
    })
      .notNull()
      .default('workspace'),
    status: text('status', {
      enum: ['draft', 'active', 'disabled'],
    })
      .notNull()
      .default('draft'),
    currentPublishedVersionId: text('current_published_version_id'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex('agents_workspace_name_uq').on(table.workspaceId, table.name),
  ],
)

export const agentVersions = sqliteTable(
  'agent_versions',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    instructions: text('instructions').notNull(),
    modelProvider: text('model_provider').notNull(),
    modelId: text('model_id').notNull(),
    thinkingLevel: text('thinking_level', {
      enum: ['off', 'minimal', 'low', 'medium', 'high'],
    }).notNull(),
    responsePolicyJson: text('response_policy_json', {
      mode: 'json',
    }).notNull(),
    workspacePolicyJson: text('workspace_policy_json', {
      mode: 'json',
    }).notNull(),
    manifestJson: text('manifest_json', { mode: 'json' }).notNull(),
    manifestHash: text('manifest_hash').notNull(),
    changeBaselineJson: text('change_baseline_json', { mode: 'json' })
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    status: text('status', {
      enum: ['draft', 'published', 'retired'],
    })
      .notNull()
      .default('draft'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    uniqueIndex('agent_versions_number_uq').on(
      table.agentId,
      table.versionNumber,
    ),
  ],
)

export const capabilities = sqliteTable(
  'capabilities',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: ['tool', 'skill'],
    }).notNull(),
    slug: text('slug').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('capabilities_workspace_kind_slug_uq').on(
      table.workspaceId,
      table.kind,
      table.slug,
    ),
  ],
)

export const capabilityVersions = sqliteTable(
  'capability_versions',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    capabilityId: text('capability_id')
      .notNull()
      .references(() => capabilities.id, { onDelete: 'cascade' }),
    version: text('version').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    source: text('source', {
      enum: ['builtin', 'http', 'openapi', 'mcp', 'workspace'],
    }).notNull(),
    runtimeName: text('runtime_name').notNull(),
    inputSchemaJson: text('input_schema_json', { mode: 'json' }).notNull(),
    configSchemaJson: text('config_schema_json', { mode: 'json' }).notNull(),
    definitionJson: text('definition_json', { mode: 'json' }).notNull(),
    status: text('status', {
      enum: ['active', 'disabled'],
    })
      .notNull()
      .default('active'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('capability_versions_number_uq').on(
      table.capabilityId,
      table.version,
    ),
    uniqueIndex('capability_versions_runtime_name_uq').on(
      table.workspaceId,
      table.runtimeName,
    ),
  ],
)

export const agentVersionCapabilities = sqliteTable(
  'agent_version_capabilities',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentVersionId: text('agent_version_id')
      .notNull()
      .references(() => agentVersions.id, { onDelete: 'cascade' }),
    capabilityVersionId: text('capability_version_id')
      .notNull()
      .references(() => capabilityVersions.id, { onDelete: 'cascade' }),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    configJson: text('config_json', { mode: 'json' }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({
      columns: [table.agentVersionId, table.capabilityVersionId],
    }),
  ],
)

export const agentChannels = sqliteTable(
  'agent_channels',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    channel: text('channel', {
      enum: ['web', 'infoflow'],
    }).notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    configJson: text('config_json', { mode: 'json' }).notNull(),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex('agent_channels_agent_channel_uq').on(
      table.agentId,
      table.channel,
    ),
  ],
)

export const channelConnections = sqliteTable(
  'channel_connections',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentChannelId: text('agent_channel_id')
      .notNull()
      .references(() => agentChannels.id, { onDelete: 'cascade' }),
    channel: text('channel', {
      enum: ['infoflow'],
    }).notNull(),
    externalAgentId: text('external_agent_id').notNull(),
    credentialsJson: text('credentials_json', { mode: 'json' }).notNull(),
    status: text('status', {
      enum: ['disconnected', 'connecting', 'connected', 'error'],
    })
      .notNull()
      .default('disconnected'),
    statusMessage: text('status_message'),
    displayName: text('display_name'),
    iconUrl: text('icon_url'),
    lastTestedAt: integer('last_tested_at', { mode: 'timestamp_ms' }),
    connectedAt: integer('connected_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex('channel_connections_agent_channel_uq').on(
      table.agentChannelId,
    ),
    uniqueIndex('channel_connections_external_agent_uq').on(
      table.channel,
      table.externalAgentId,
    ),
  ],
)

export const conversationBindings = sqliteTable(
  'conversation_bindings',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    agentVersionId: text('agent_version_id')
      .notNull()
      .references(() => agentVersions.id),
    channel: text('channel', {
      enum: ['web', 'infoflow', 'open'],
    }).notNull(),
    scopeKey: text('scope_key').notNull(),
    piConversationId: text('pi_conversation_id').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex('conversation_bindings_scope_uq').on(
      table.workspaceId,
      table.agentId,
      table.channel,
      table.scopeKey,
    ),
    uniqueIndex('conversation_bindings_pi_id_uq').on(table.piConversationId),
  ],
)

export const inboundEvents = sqliteTable(
  'inbound_events',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    agentChannelId: text('agent_channel_id')
      .notNull()
      .references(() => agentChannels.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id')
      .notNull()
      .references(() => channelConnections.id, { onDelete: 'cascade' }),
    channel: text('channel', { enum: ['infoflow'] }).notNull(),
    externalEventId: text('external_event_id').notNull(),
    externalThreadId: text('external_thread_id').notNull(),
    senderExternalId: text('sender_external_id').notNull(),
    chatType: text('chat_type', {
      enum: ['private', 'group'],
    }).notNull(),
    replyTargetType: text('reply_target_type', {
      enum: ['user', 'group'],
    }).notNull(),
    replyTargetId: text('reply_target_id').notNull(),
    contentText: text('content_text').notNull(),
    attachmentsJson: text('attachments_json', { mode: 'json' })
      .$type<
        Array<{
          data?: string
          sourceUrl?: string
          mimeType?: string
        }>
      >()
      .notNull()
      .default(sql`'[]'`),
    rawMetadataJson: text('raw_metadata_json', { mode: 'json' }).notNull(),
    status: text('status', {
      enum: ['received', 'submitting', 'submitted', 'answered', 'failed'],
    })
      .notNull()
      .default('received'),
    conversationBindingId: text('conversation_binding_id').references(
      () => conversationBindings.id,
    ),
    submissionId: text('submission_id'),
    responseText: text('response_text'),
    error: text('error'),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex('inbound_events_external_uq').on(
      table.agentChannelId,
      table.externalEventId,
    ),
  ],
)

export const outboundDeliveries = sqliteTable(
  'outbound_deliveries',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    inboundEventId: text('inbound_event_id')
      .notNull()
      .references(() => inboundEvents.id, { onDelete: 'cascade' }),
    conversationBindingId: text('conversation_binding_id').references(
      () => conversationBindings.id,
      { onDelete: 'cascade' },
    ),
    channel: text('channel', { enum: ['infoflow'] }).notNull(),
    targetType: text('target_type', {
      enum: ['user', 'group'],
    }).notNull(),
    targetId: text('target_id').notNull(),
    payloadJson: text('payload_json', { mode: 'json' }).notNull(),
    status: text('status', {
      enum: ['pending', 'sending', 'sent', 'retry', 'uncertain', 'failed'],
    })
      .notNull()
      .default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    providerMessageId: text('provider_message_id'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    uniqueIndex('outbound_deliveries_inbound_uq').on(table.inboundEventId),
  ],
)

export const uiInteractions = sqliteTable(
  'ui_interactions',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    conversationBindingId: text('conversation_binding_id')
      .notNull()
      .references(() => conversationBindings.id, { onDelete: 'cascade' }),
    toolCallId: text('tool_call_id').notNull(),
    kind: text('kind', {
      enum: ['single_select', 'multi_select', 'confirm', 'form'],
    }).notNull(),
    requestJson: text('request_json', { mode: 'json' }).notNull(),
    status: text('status', {
      enum: ['pending', 'answered', 'cancelled', 'expired'],
    })
      .notNull()
      .default('pending'),
    responseJson: text('response_json', { mode: 'json' }),
    submissionId: text('submission_id'),
    createdAt: createdAt(),
    answeredAt: integer('answered_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    uniqueIndex('ui_interactions_tool_call_uq').on(
      table.conversationBindingId,
      table.toolCallId,
    ),
    uniqueIndex('ui_interactions_pending_uq')
      .on(table.conversationBindingId)
      .where(sql`${table.status} = 'pending'`),
  ],
)

export const agentAccessGrants = sqliteTable(
  'agent_access_grants',
  {
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.agentId, table.userId] })],
)

export const agentApiTokens = sqliteTable('agent_api_tokens', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: text('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  username: text('username').notNull(),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
})

export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  actorUserId: text('actor_user_id')
    .notNull()
    .references(() => users.id),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  detailsJson: text('details_json', { mode: 'json' }),
  createdAt: createdAt(),
})
