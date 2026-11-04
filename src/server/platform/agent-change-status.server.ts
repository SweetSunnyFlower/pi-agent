import { createHash } from 'node:crypto'

import { and, asc, desc, eq } from 'drizzle-orm'

import type { createDatabase } from '#/db'
import {
  agentChannels,
  agentVersionCapabilities,
  agentVersions,
  agents,
  capabilities,
  capabilityVersions,
  channelConnections,
} from '#/db/schema'
import type {
  AgentChangeModule,
  AgentChangeStatus,
} from '#/lib/agents/agent-change'

import { requireWorkspaceAccess } from './workspace-access.server'
import type { AppPrincipal } from './workspace-access.server'

type AppDatabase = ReturnType<typeof createDatabase>

export type {
  AgentChangeModule,
  AgentChangeStatus,
} from '#/lib/agents/agent-change'

export type AgentModuleHashes = Record<AgentChangeModule, string>

const moduleOrder: AgentChangeModule[] = [
  'prompt',
  'tools',
  'skills',
  'channels',
]

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    )
  }
  return value
}

export function md5Fingerprint(value: unknown): string {
  return createHash('md5')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')
}

function promptHash(version: {
  instructions: string
  modelProvider: string
  modelId: string
  thinkingLevel: string
}): string {
  return md5Fingerprint({
    instructions: version.instructions,
    modelProvider: version.modelProvider,
    modelId: version.modelId,
    thinkingLevel: version.thinkingLevel,
  })
}

function bindingsHash(
  db: AppDatabase,
  agentVersionId: string,
  kind: 'tool' | 'skill',
): string {
  const bindings = db
    .select({
      capabilityVersionId: agentVersionCapabilities.capabilityVersionId,
      enabled: agentVersionCapabilities.enabled,
      configJson: agentVersionCapabilities.configJson,
      sortOrder: agentVersionCapabilities.sortOrder,
    })
    .from(agentVersionCapabilities)
    .innerJoin(
      capabilityVersions,
      eq(agentVersionCapabilities.capabilityVersionId, capabilityVersions.id),
    )
    .innerJoin(
      capabilities,
      eq(capabilityVersions.capabilityId, capabilities.id),
    )
    .where(
      and(
        eq(agentVersionCapabilities.agentVersionId, agentVersionId),
        eq(capabilities.kind, kind),
      ),
    )
    .orderBy(
      asc(agentVersionCapabilities.sortOrder),
      asc(agentVersionCapabilities.capabilityVersionId),
    )
    .all()

  return md5Fingerprint(bindings)
}

export function channelModuleHash(
  db: AppDatabase,
  workspaceId: string,
  agentId: string,
): string {
  const channelRows = db
    .select()
    .from(agentChannels)
    .where(
      and(
        eq(agentChannels.workspaceId, workspaceId),
        eq(agentChannels.agentId, agentId),
      ),
    )
    .orderBy(asc(agentChannels.channel))
    .all()

  const snapshot = channelRows.map((channel) => {
    const connection = db
      .select({
        externalAgentId: channelConnections.externalAgentId,
        credentialsJson: channelConnections.credentialsJson,
      })
      .from(channelConnections)
      .where(eq(channelConnections.agentChannelId, channel.id))
      .get()
    return {
      channel: channel.channel,
      enabled: channel.enabled,
      configJson: channel.configJson,
      externalAgentId: connection?.externalAgentId ?? null,
      credentialsJson: connection?.credentialsJson ?? null,
    }
  })

  return md5Fingerprint({
    web: {
      channel: 'web',
      enabled: true,
    },
    configuredChannels: snapshot,
  })
}

export function moduleHashesForVersion(
  db: AppDatabase,
  workspaceId: string,
  agentId: string,
  version: {
    id: string
    instructions: string
    modelProvider: string
    modelId: string
    thinkingLevel: string
  },
): AgentModuleHashes {
  return {
    prompt: promptHash(version),
    tools: bindingsHash(db, version.id, 'tool'),
    skills: bindingsHash(db, version.id, 'skill'),
    channels: channelModuleHash(db, workspaceId, agentId),
  }
}

export function emptyModuleHashes(): AgentModuleHashes {
  return {
    prompt: promptHash({
      instructions: '',
      modelProvider: '',
      modelId: '',
      thinkingLevel: 'off',
    }),
    tools: md5Fingerprint([]),
    skills: md5Fingerprint([]),
    channels: md5Fingerprint({
      web: {
        channel: 'web',
        enabled: true,
      },
      configuredChannels: [],
    }),
  }
}

function hashesEqual(
  baseline: Partial<AgentModuleHashes>,
  current: AgentModuleHashes,
): AgentChangeStatus {
  const changedModules = moduleOrder.filter(
    (module) => baseline[module] !== current[module],
  )
  return {
    hasChanges: changedModules.length > 0,
    changedModules,
  }
}

export async function getAgentModuleHashes(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
): Promise<{
  baseline: AgentModuleHashes
  current: AgentModuleHashes
  status: AgentChangeStatus
}> {
  await requireWorkspaceAccess(db, principal, workspaceId, [
    'workspace_admin',
    'editor',
  ])

  const agent = db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
    .get()
  if (!agent) throw new Error('agent not found')

  const draft = db
    .select()
    .from(agentVersions)
    .where(
      and(
        eq(agentVersions.agentId, agentId),
        eq(agentVersions.workspaceId, workspaceId),
        eq(agentVersions.status, 'draft'),
      ),
    )
    .orderBy(desc(agentVersions.versionNumber))
    .get()
  if (!draft) {
    return {
      baseline: emptyModuleHashes(),
      current: emptyModuleHashes(),
      status: { hasChanges: false, changedModules: [] },
    }
  }

  const storedBaseline = draft.changeBaselineJson as Partial<AgentModuleHashes>
  const baseline = moduleOrder.every(
    (module) => typeof storedBaseline[module] === 'string',
  )
    ? (storedBaseline as AgentModuleHashes)
    : (() => {
        const published = agent.currentPublishedVersionId
          ? db
              .select()
              .from(agentVersions)
              .where(eq(agentVersions.id, agent.currentPublishedVersionId))
              .get()
          : undefined
        const fallback = published
          ? {
              prompt: promptHash(published),
              tools: bindingsHash(db, published.id, 'tool'),
              skills: bindingsHash(db, published.id, 'skill'),
              channels: channelModuleHash(db, workspaceId, agentId),
            }
          : emptyModuleHashes()
        db.update(agentVersions)
          .set({ changeBaselineJson: fallback })
          .where(eq(agentVersions.id, draft.id))
          .run()
        return fallback
      })()

  const current = moduleHashesForVersion(db, workspaceId, agentId, draft)
  return {
    baseline,
    current,
    status: hashesEqual(baseline, current),
  }
}

export async function getAgentChangeStatus(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
): Promise<AgentChangeStatus> {
  return (await getAgentModuleHashes(db, principal, workspaceId, agentId))
    .status
}
