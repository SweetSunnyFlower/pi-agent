# Multi-Agent Platform on TanStack Start and Pi Durable

Date: 2026-10-19

Status: Approved design, pending written-spec review

## 1. Summary

Build a workspace-scoped multi-Agent platform inside the existing TanStack Start application. Pi Durable is the only Agent runtime. Users create Agents from the web UI by supplying an Agent name, prompt, model settings, tools, Skills, and optional channels. Published Agent configuration is immutable and pinned per conversation.

The first supported response channels are:

- Web: HTTP submission with SSE status and response streaming.
- Baidu InfoFlow: one bot and one WebSocket client per Agent; group messages trigger only when the bot is mentioned; the final response is sent as one complete message.

All paths share one canonical inbound/outbound contract. Pi Durable stores conversation, task, and document state before a response is exposed. A platform-owned durable outbox handles channel delivery.

The platform is deployed as one Node process for the initial release. Tenant isolation starts at the workspace level even though all workspaces run in the same application.

## 2. Goals

- Create and version Agents entirely from the platform UI.
- Store Agent prompts as user-entered text, not selected templates.
- Let Agent versions bind fixed versions of tools and Skills.
- Support platform-managed built-in capabilities and approved remote HTTP, OpenAPI, and MCP capabilities.
- Keep channel protocols outside the Agent core.
- Run many Agents and conversations in one long-lived Pi Durable Harness.
- Survive process crashes without losing accepted input or completed Agent answers.
- Attribute every conversation to a workspace and enforce workspace/RBAC boundaries.
- Authenticate production users from the zero-trust gateway JWT.
- Support deterministic local authentication through environment configuration.
- Keep secrets out of source code, logs, prompts, transcripts, and public API responses.

## 3. Non-Goals

- Multi-organization SaaS billing and organization lifecycle.
- Horizontal multi-writer access to one Pi Durable SQLite storage.
- Token-by-token streaming to InfoFlow.
- Free-form tenant code upload or arbitrary plugin execution.
- Automatic merging of conversations from different channels.
- Exactly-once delivery for external channel side effects where the provider offers no idempotency key.
- A web UI for editing code-backed built-in tool implementations.

## 4. Confirmed Product Decisions

1. Agent creation and editing use platform UI backed by the database.
2. The Agent prompt is free-form text entered by the creator.
3. Built-in capabilities are registered by platform code. Approved remote HTTP, OpenAPI, and MCP capabilities can also be selected.
4. Agent configuration is fixed per conversation by `agent_version_id`.
5. The platform has one organization with multiple workspaces.
6. InfoFlow has one dedicated bot per Agent.
7. InfoFlow private messages are always actionable.
8. InfoFlow group messages are actionable only when the current bot is mentioned.
9. InfoFlow group conversations are scoped by `agentId + groupId + senderId`.
10. InfoFlow sends only the final complete answer, not streaming text.
11. Existing Web conversations use SSE for live state. InfoFlow uses durable final delivery.
12. Agent prompt order is:
    `platform safety rules -> selected Skill sections -> Agent-entered instructions`.
13. Production authentication trusts only a zero-trust gateway JWT injected as `x-zt-authorization`.
14. Local authentication is selected explicitly by environment mode and uses a configured username.
15. InfoFlow bot credentials are entered when configuring the Agent and stored encrypted in the database.

## 5. System Architecture

```text
Web HTTP / SSE                 InfoFlow SDK + WebSocket
       |                                  |
       +-------- Channel Adapters --------+
                          |
                          v
                Canonical InboundEvent
                          |
                          v
        Workspace / identity / Agent routing
                          |
                          v
               Pi Durable Harness
       conversations, tasks, documents, usage
                          |
                          v
               Canonical OutboundEvent
                          |
             +------------+------------+
             |                         |
        Web SSE adapter         InfoFlow egress adapter
```

### 5.1 Runtime boundaries

- Channel adapters perform protocol validation, normalization, credentials, and transport delivery.
- The platform control plane manages workspaces, Agent definitions, versions, capability bindings, and channel bindings.
- Pi Durable owns Agent execution, conversation state, task recovery, transcripts, compaction, and usage.
- A platform reply worker maps settled Pi submissions to outbound deliveries.
- A platform outbox worker delivers final messages through the appropriate channel.
- The Agent core must not import the InfoFlow SDK or inspect channel-specific payloads.

### 5.2 Database boundary

The first release uses one SQLite database file:

- Drizzle owns platform tables.
- Pi Durable uses the same database file with the schema prefix `pi_`.
- Platform and Pi tables never share table names.
- Only one process opens this database.
- WAL mode is enabled.

Application tables use `workspace_id` for tenant isolation. Pi Durable conversation IDs are linked through platform `conversation_bindings`; they are not reusable as external channel IDs.

## 6. Authentication and Authorization

### 6.1 Auth modes

Authentication is implemented behind one server-only interface:

```text
authenticateRequest(request) -> AuthenticatedPrincipal | null
```

Supported modes:

- `AUTH_MODE=gateway`
- `AUTH_MODE=development`

There is no implicit fallback mode. An unsupported or missing mode fails startup.

### 6.2 Gateway mode

The application reads the JWT from the `x-zt-authorization` header.

Verification requirements:

- Verify the JWT signature with the configured shared secret.
- Accept only the exact configured algorithm.
- Allow only HS256, HS384, or HS512 in the initial release.
- Require `exp` and `username` claims.
- Validate `iss` and `aud` when configured.
- Reject an expired token.
- Map `username` to an internal user record.
- Never log the token or raw authorization header.

The gateway must overwrite client-supplied `x-zt-authorization` values. Network policy must ensure only the gateway can reach the application origin directly.

The existing `mixagent` implementation in `/Users/gao/baidu/personal-code/mixagent/src/server/auth/index.ts` is the behavioral reference for header name, claim validation, and fail-closed behavior.

### 6.3 Development mode

Development mode constructs an identity directly from environment configuration:

```text
AUTH_MODE=development
DEV_AUTH_USERNAME=your.username
DEV_WORKSPACE_SLUG=default
```

The development identity still passes through normal workspace membership and RBAC checks. Development mode never grants implicit platform administrator access.

Startup must fail if `AUTH_MODE=development` and `NODE_ENV=production`. Missing JWT must never cause a fallback to the development identity.

A development seed creates the configured user and workspace membership when the records are absent. Production never runs that seed automatically.

The seeded development membership uses the `workspace_admin` role. It does not receive `platform_admin`, and production data is never modified.

### 6.4 Workspace authorization

The authenticated user may belong to multiple workspaces.

`/api/auth/me` returns:

```text
user
workspaces
currentWorkspace
roles
authMode
```

Workspace is selected through `/w/:workspaceSlug/...` routes or an equivalent server-side request context. A workspace identifier supplied by the browser is never trusted without a `workspace_members` check.

Roles:

- `platform_admin`: manage the platform capability catalog and provider connections.
- `workspace_admin`: manage workspace members, Agents, credentials, and channel bindings.
- `editor`: create, edit, and publish Agent drafts in the workspace.
- `user`: use Agents allowed in the workspace.

Every Agent, capability, credential, conversation, inbound event, outbox row, and audit event is scoped by `workspace_id`.

Agents have a workspace-level visibility policy:

- `workspace`: every workspace member may use the published Agent.
- `restricted`: only the creator, workspace administrators, and users with an `agent_access_grants` row may use it.

The default is `workspace`.

### 6.5 InfoFlow identity

InfoFlow messages are not zero-trust browser sessions. The sender is identified by `fromUserId`.

The platform maps channel identity through:

```text
channel_user_identities
  workspace_id
  channel
  external_user_id
  user_id
```

Exact username matching is the default mapping. If no mapping exists, access is denied. The system does not auto-create users or permissions from channel messages.

### 6.6 SSE and request protection

- Every HTTP API and SSE connection authenticates independently.
- SSE checks identity expiry while the stream remains open.
- State-changing requests and SSE validate `Origin` against `APP_ORIGIN`.
- The client obtains identity only from `/api/auth/me`, never from localStorage, request bodies, or query parameters.
- The existing `/mcp` endpoint must require authentication or an internal API token before it is exposed.

## 7. Agent and Version Model

### 7.1 Entity relationship

```text
agents 1 --- N agent_versions
agent_versions N --- N capability_versions
agents 1 --- N agent_channels
agent_channels 1 --- 0..1 channel_connections
agents 1 --- N conversation_bindings
```

`agents` is the stable business identity. `agent_versions` is the executable configuration.

`agents.visibility` is either `workspace` or `restricted`. It defaults to `workspace`.

### 7.2 Agent version lifecycle

Statuses:

- `draft`: editable.
- `published`: immutable and available for new conversations.
- `retired`: unavailable for new conversations while existing references remain readable.

Rules:

- Publishing creates an immutable snapshot.
- Editing a published version requires copying it into a new draft.
- New conversations bind to the Agent's current published version.
- Existing conversations keep their original `agent_version_id`.
- Retiring a version does not immediately remove its capability definitions from the registry.
- A capability version referenced by a non-archived conversation remains loadable.

### 7.3 Prompt assembly

For each conversation:

```text
platform safety/tool-use sections
+ selected Skill sections
+ agent_versions.instructions
```

Pi Durable's AgentState renders the stored `instructions` after extension-provided prompt sections, which matches the confirmed ordering.

User-entered Agent instructions are stored verbatim in `agent_versions.instructions` and copied into the Pi conversation's AgentState when that conversation is created. Publishing a new version cannot mutate an existing conversation's prompt.

Channel output rules are enforced by channel adapters and are not inserted into the LLM prompt.

### 7.4 Model configuration

An Agent version stores:

```text
model_provider
model_id
thinking_level
```

Provider API credentials belong to encrypted `provider_connections`, not Agent versions. A conversation keeps its selected model reference. If a model is removed by its provider, the conversation fails visibly and requires an explicit migration.

## 8. Capability Catalog

Tools and Skills share one catalog but differ in behavior:

- `tool`: exposes an executable action to the model.
- `skill`: contributes prompt sections, methods, domain guidance, and optionally associated tools.

Capability sources:

- `builtin`: code registered by the platform.
- `http`: a reviewed HTTP action.
- `openapi`: tools derived from an approved OpenAPI document.
- `mcp`: tools from an approved remote MCP server.

### 8.1 Immutable capability versions

Each `capability_version` stores a frozen schema, endpoint profile, configuration schema, and implementation reference. Live endpoint changes do not silently mutate an existing capability version.

An Agent version binds exact `capability_version_id` values and ordered configuration.

### 8.2 Versioned runtime names

Pi Durable stores extension and tool names rather than implementation objects. Runtime names must include the capability version:

```text
platform.tool.http.issue-search@1.0.0
platform.skill.code-review@2.1.0
platform.mcp.github@1.3.0
```

Unversioned names are forbidden because installing a replacement with the same name would change the tools available to an existing pinned conversation.

### 8.3 Executing capabilities

- Local capability implementations are installed into the Pi registry during runtime startup.
- Remote capability credentials are decrypted only at invocation time.
- Tool input is validated against the frozen schema.
- Side-effecting tools default to `replay: unsafe` unless explicitly reviewed as idempotent.
- Tools cannot widen their own permissions.
- A Skill cannot grant a tool that is not separately bound to the Agent version.

## 9. Channels

### 9.1 Canonical inbound event

```text
InboundEvent
  id
  workspaceId
  agentId
  agentVersionId
  channel
  agentChannelId
  connectionId
  externalEventId
  externalThreadId
  senderExternalId
  chatType
  replyTargetType
  replyTargetId
  contentParts
  attachments
  occurredAt
  rawMetadata
```

The same contract is used for Web and InfoFlow. Channel-specific raw payloads are retained for audit and recovery but are not passed directly to the Agent.

### 9.2 Web adapter

Submission flow:

```text
POST /api/chat/:agentId
-> authenticate
-> verify workspace and Agent access
-> resolve or create Web conversation binding
-> require the client-generated idempotency key
-> persist inbound event
-> submit to Pi Durable
-> return conversationId and submissionId
```

For Web, `externalEventId` is a required client-generated UUID reused across request retries. For InfoFlow, it is the provider message ID (`raw.MsgId` for private messages and `message.header.messageid` for group messages).

SSE flow:

```text
GET /api/conversations/:conversationId/events
-> authenticate
-> verify conversation ownership
-> replay committed state
-> stream subsequent committed changes
```

The Web adapter may project text deltas from Pi live state. Reconnecting clients recover from committed conversation state.

### 9.3 InfoFlow adapter

One `channel_connection` maps to one Agent and one dedicated `WSClient`.

Inbound actions:

1. Register `private.*` and `group.*` listeners before connecting.
2. Normalize the event.
3. Ignore non-actionable group events.
4. Persist the inbound event.
5. Submit to Pi Durable with a stable request ID.
6. Return from the WebSocket handler.

The SDK sends ACK after all asynchronous handlers resolve. Therefore the handler waits for durable inbound admission and Pi submission, but never waits for the Agent answer.

Group trigger rule:

- Process only `MESSAGE_RECEIVE` group messages.
- Require an `AT` content element whose `atagentids` includes the current bot's external Agent ID.
- Ignore `ALL_MESSAGE_FORWARD` copies and the bot's own messages.

Connection settings:

```text
autoRegister: true
autoAck: true
maxReconnectAttempts: -1
```

The supervisor observes `connected`, `disconnected`, and `error`. It does not create a replacement client on every ordinary disconnect because the SDK owns heartbeat and reconnect behavior.

Outbound flow:

```text
private:
client.im.message.sendToUser(userId, { content }, 'md')

group:
client.im.message.sendToGroup(groupId, { content }, 'MD')
```

The final message is complete and non-streaming. If the Agent produces unsupported rich content, the adapter renders approved text/Markdown fallback and records the downgrade.

### 9.4 Conversation keys

```text
Web:
web:<conversation_id>

InfoFlow private:
infoflow:private:<sender_id>

InfoFlow group:
infoflow:group:<group_id>:sender:<sender_id>
```

The conversation key determines transcript ownership. `replyTargetId` is stored separately because a group conversation's input belongs to one speaker while its reply destination is the whole group.

## 10. Durable Inbound and Outbound Flow

### 10.1 Inbound state

```text
received -> submitting -> submitted -> answered
                    \-> failed
```

The unique idempotency key is:

```text
(agent_channel_id, external_event_id)
```

The Pi submission request ID is:

```text
inbound:<inbound_event_id>
```

Recovery behavior:

- A crash before inbound commit produces no ACK, so InfoFlow redelivers.
- A crash after inbound commit reuses the stored event.
- A crash after Pi submission but before saving the submission ID reuses the same request ID.

### 10.2 Reply worker

The reply worker:

1. Finds inbound records in `submitted` state without a delivery.
2. Reacquires the Pi submission through its persisted ID.
3. Waits for or reads the settled submission.
4. Reads the final `AssistantEntry`.
5. Converts it to canonical `OutputPart[]`.
6. Upserts one outbound delivery keyed by `inbound_event_id`.

The worker must survive process restart and must not depend on an in-memory event subscription.

### 10.3 Outbound state

```text
pending -> sending -> sent
                    \-> retry
                    \-> uncertain
                    \-> failed
```

`outbound_deliveries` stores:

```text
id
workspace_id
inbound_event_id
conversation_id
channel
target_type
target_id
payload_json
status
attempt_count
lease_until
provider_message_id
last_error
created_at
sent_at
```

Only one process owns outbox processing. Leases prevent concurrent workers in future deployments.

InfoFlow does not expose an application-supplied idempotency key in the current public send methods. A network timeout after request dispatch is therefore ambiguous. The initial policy is:

- Retry failures known to occur before dispatch.
- Mark post-dispatch timeouts and connection loss as `uncertain`.
- Do not automatically repeat an uncertain send.
- Allow an administrator to inspect and manually resend.

This favors avoiding duplicate replies over guaranteeing retry of an ambiguous send.

## 11. Database Model

### 11.1 Workspace and identity

- `workspaces`
- `users`
- `workspace_members`
- `channel_user_identities`
- `audit_logs`

### 11.2 Agent and capabilities

- `agents`
- `agent_versions`
- `capabilities`
- `capability_versions`
- `agent_version_capabilities`
- `agent_access_grants`
- `provider_connections`
- `workspace_secrets`

### 11.3 Channels and conversation mapping

- `agent_channels`
- `channel_connections`
- `conversation_bindings`
- `inbound_events`
- `outbound_deliveries`

Required uniqueness:

```text
channel_connections:
  unique(agent_channel_id)
  unique(channel, external_agent_id)

agent_channels:
  unique(agent_id, channel)

conversation_bindings:
  unique(workspace_id, agent_id, channel, scope_key)

inbound_events:
  unique(agent_channel_id, external_event_id)

outbound_deliveries:
  unique(inbound_event_id)
```

Secrets:

- `workspace_secrets` stores ciphertext, IV, authentication tag, and key version.
- The AES-256-GCM key is supplied by `CHANNEL_SECRET_KEK`.
- Public APIs return masked values only.
- Secret plaintext is never included in Agent prompts, tool output, logs, audit records, or transcript entries.

## 12. Runtime Modules

```text
src/server/
  auth/
    identity.server.ts
    gateway-auth.server.ts
    development-auth.server.ts
    require-principal.server.ts

  runtime/
    application-runtime.server.ts
    nitro-startup.ts
    pi-harness.server.ts
    capability-registry.server.ts
    conversation-service.server.ts
    reply-worker.server.ts
    outbox-worker.server.ts

  platform/
    agent-service.server.ts
    agent-version-service.server.ts
    capability-service.server.ts
    channel-service.server.ts
    workspace-service.server.ts

  channels/
    types.ts
    web-adapter.server.ts
    infoflow-supervisor.server.ts
    infoflow-normalizer.server.ts
    infoflow-egress.server.ts

  secrets/
    secret-box.server.ts
```

The Nitro startup plugin starts the application runtime once, similar to the existing `mixagent` `src/server/nitro-startup.ts` pattern. It must:

1. Open the database.
2. Open and resume the Pi Harness.
3. Install active capability versions.
4. Recover unfinished inbound records.
5. Start the reply and outbox workers.
6. Reconcile enabled InfoFlow connections.
7. Stop all of the above from the Nitro `close` hook.

The runtime is stored on `globalThis` or protected by a module-level idempotency guard so development HMR does not create duplicate WebSocket clients or workers.

## 13. Public API

```text
GET    /api/auth/me

GET    /api/workspaces
GET    /api/workspaces/:workspaceId/agents
POST   /api/workspaces/:workspaceId/agents
GET    /api/agents/:agentId
PATCH  /api/agents/:agentId/draft
POST   /api/agents/:agentId/publish
POST   /api/agents/:agentId/versions

GET    /api/capabilities
GET    /api/capability-versions

POST   /api/channels/infoflow/validate
POST   /api/agents/:agentId/channels/infoflow
PATCH  /api/channels/infoflow/:connectionId
DELETE /api/channels/infoflow/:connectionId

POST   /api/chat/:agentId
GET    /api/conversations/:conversationId
GET    /api/conversations/:conversationId/events
POST   /api/conversations/:conversationId/abort
```

Every route authenticates and performs workspace-scoped authorization. Errors use stable machine-readable codes and never include secrets.

## 14. Environment Configuration

Implementation must add a committed `.env.example` containing placeholders and comments only. Implementation must never commit `.env`.

Required example keys:

```dotenv
# Runtime
NODE_ENV=development
PORT=3000
APP_ORIGIN=http://localhost:3000
LOG_LEVEL=info

# Authentication
# development: use DEV_AUTH_USERNAME for local debugging
# gateway: trust x-zt-authorization injected by the zero-trust gateway
AUTH_MODE=development
DEV_AUTH_USERNAME=your.username
DEV_WORKSPACE_SLUG=default

# Used only when AUTH_MODE=gateway
AUTH_JWT_SECRET=replace-with-gateway-jwt-secret
AUTH_JWT_ALGORITHM=HS256
AUTH_JWT_ISSUER=replace-with-gateway-issuer
AUTH_JWT_AUDIENCE=replace-with-gateway-audience

# Database and encryption
APP_DATABASE_PATH=./data/platform.sqlite
CHANNEL_SECRET_KEK=replace-with-base64-encoded-32-byte-key

# InfoFlow global endpoints
INFOFLOW_API_BASE_URL=https://apiin.im.baidu.com/api/v1
INFOFLOW_WS_GATEWAY=infoflow-open-gateway.weiyun.baidu.com
INFOFLOW_WS_CONNECT_DOMAIN=infoflow-open-gateway.weiyun.baidu.com:8869
```

`.env.example` must explicitly state:

- `INFOFLOW_AGENT_ID`, `INFOFLOW_APP_KEY`, and `INFOFLOW_APP_SECRET` are not application-wide environment variables.
- Those three values are entered when configuring an Agent's InfoFlow channel and are stored encrypted in the database.
- Model provider credentials are entered through provider connection management and stored encrypted.
- `AUTH_MODE=development` is forbidden with `NODE_ENV=production`.

## 15. Error Handling

- Authentication failure returns `401`.
- Workspace or Agent access failure returns `403` without revealing whether the resource exists.
- Missing resources return `404`.
- Invalid channel payload returns a protocol error without acknowledging durable admission.
- Pi submission failure leaves the inbound record retryable.
- InfoFlow WebSocket connection failure marks the channel `error` but does not disable the Agent.
- Reply extraction failure leaves the inbound record in a retryable or failed state with a safe error code.
- Outbox lease expiration returns an interrupted delivery to a recovery scan.
- Ambiguous InfoFlow sends become `uncertain`, never silently duplicated.

## 16. Testing

### Authentication

- Valid gateway JWT establishes identity.
- Missing, expired, wrong-algorithm, wrong-signature, and incomplete JWTs fail closed.
- Development identity is accepted only in development mode.
- Development mode cannot start with `NODE_ENV=production`.
- A user cannot access an unrelated workspace.
- A user cannot access an unshared Agent.

### Agent versioning

- Editing a draft does not affect published versions.
- Publishing creates an immutable version.
- Existing conversations continue using their original version.
- New conversations use the latest published version.
- Old and new capability versions coexist in the Registry.

### InfoFlow ingestion

- Private text events are actionable.
- Group events without a bot mention are ignored.
- Group events mentioning another bot are ignored.
- Group events mentioning the current bot are accepted.
- Duplicate `MsgId` values create one inbound event and one submission.
- The SDK handler does not wait for the final Agent answer.
- ACK occurs only after durable inbound admission.
- Golden tests use sanitized real private and group payloads.

### Recovery

- Crash before inbound commit causes redelivery.
- Crash after inbound commit resumes submission.
- Crash after Pi submission but before local ID storage recovers through `requestId`.
- Crash after answer but before outbox creation recreates the delivery.
- Crash during outbox send becomes retryable or uncertain according to failure stage.

### Isolation and security

- Cross-workspace reads and writes fail.
- Secrets do not appear in API responses, logs, prompts, transcripts, or audit rows.
- `/mcp` and all other server endpoints are protected.
- SSE rejects invalid identity, wrong Origin, and expired identity.

## 17. Deployment

Initial deployment target:

```text
Node.js >= 22.19
one long-lived Nitro Node process
one persistent SQLite file
one InfoFlow WSClient per enabled Agent
one reply worker
one outbox worker
```

Node is required for production because the InfoFlow SDK uses Node WebSocket upgrade behavior. Bun is not used to run the production server.

Horizontal scaling requires a future design change:

- Multiple web/gateway replicas may terminate HTTP and SSE.
- One central Agent runtime or one owner per storage shard must execute Pi Durable work.
- SQLite must not be opened concurrently by multiple writer processes.
- A custom storage adapter is required if platform and Pi state move to a shared database service.

## 18. Acceptance Criteria

The first release is complete when:

1. An authenticated workspace user can create and publish a database-configured Agent with a prompt, model, tools, and Skills.
2. An older conversation remains pinned to its original Agent version after a new version is published.
3. A Web user can submit a message, receive SSE events, reconnect, and recover committed history.
4. A configured InfoFlow bot connects through one dedicated WSClient.
5. Private InfoFlow messages and group messages mentioning that bot are durably admitted.
6. Group conversations are isolated by group and sender while replies return to the group.
7. InfoFlow receives one complete final Markdown response per accepted message.
8. Process restart resumes accepted submissions and pending delivery work.
9. Zero-trust JWT authentication works in gateway mode.
10. Local development authenticates as `DEV_AUTH_USERNAME` without a gateway.
11. Workspace and Agent authorization remain enforced in both auth modes.
12. InfoFlow credentials and model credentials are encrypted at rest.
13. `.env.example` documents all required configuration without containing real credentials.

## 19. Delivery Sequence

This platform is too large for one implementation increment. The architecture remains one design, but implementation is split into separately planned phases:

1. Foundation: auth modes, workspace/RBAC, database, Agent/version draft and publish, Pi Harness startup, and Web conversation/SSE.
2. Capability catalog: tools, Skills, versioned Registry entries, encrypted capability and provider credentials, and capability validation.
3. InfoFlow: encrypted bot configuration, WS supervisor, inbound normalization, reply worker, outbox, and final Markdown delivery.
4. Production hardening: recovery fault injection, load testing, secret rotation, audit UI, administration UI, and deployment runbooks.

Each phase receives its own implementation plan and verification gate before the next phase starts.
