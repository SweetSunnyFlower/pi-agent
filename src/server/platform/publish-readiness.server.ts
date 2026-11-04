import { and, desc, eq } from 'drizzle-orm'

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
import type { AgentChangeModule } from '#/lib/agents/agent-change'

import { getAgentChangeStatus } from './agent-change-status.server'
import { requireWorkspaceAccess } from './workspace-access.server'
import type { AppPrincipal } from './workspace-access.server'

type AppDatabase = ReturnType<typeof createDatabase>

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

function promptExcerpt(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 180 ? `${normalized.slice(0, 180)}…` : normalized
}

export async function getPublishReadiness(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
): Promise<PublishReadiness> {
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
  const published = agent.currentPublishedVersionId
    ? db
        .select()
        .from(agentVersions)
        .where(eq(agentVersions.id, agent.currentPublishedVersionId))
        .get()
    : undefined
  const version = draft ?? published
  if (!version) throw new Error('agent has no version')

  const bindings = db
    .select({
      kind: capabilities.kind,
      runtimeName: capabilityVersions.runtimeName,
      versionStatus: capabilityVersions.status,
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
    .where(eq(agentVersionCapabilities.agentVersionId, version.id))
    .all()

  const channelRows = db
    .select()
    .from(agentChannels)
    .where(eq(agentChannels.agentId, agentId))
    .all()
  const infoflowChannel = channelRows.find(
    (channel) => channel.channel === 'infoflow',
  )
  const infoflowConnection = infoflowChannel
    ? db
        .select()
        .from(channelConnections)
        .where(eq(channelConnections.agentChannelId, infoflowChannel.id))
        .get()
    : undefined
  const channels = [
    'Web',
    ...(infoflowChannel?.enabled && infoflowConnection ? ['如流'] : []),
  ]
  const capabilitiesValid =
    version.status !== 'draft' ||
    bindings.every((binding) => binding.versionStatus === 'active')
  const infoflowValid =
    !infoflowChannel?.enabled ||
    Boolean(
      infoflowConnection?.externalAgentId && infoflowConnection.credentialsJson,
    )
  const changeStatus = await getAgentChangeStatus(
    db,
    principal,
    workspaceId,
    agentId,
  )

  const checks: PublishCheck[] = [
    {
      id: 'name',
      label: 'Agent 名称',
      passed: Boolean(agent.name.trim()),
      detail: agent.name.trim() ? agent.name : '请填写 Agent 名称',
    },
    {
      id: 'prompt',
      label: '提示词',
      passed: Boolean(version.instructions.trim()),
      detail: version.instructions.trim() ? '已填写' : '提示词不能为空',
    },
    {
      id: 'model',
      label: '模型与思考等级',
      passed: Boolean(
        version.modelProvider.trim() &&
        version.modelId.trim() &&
        version.thinkingLevel,
      ),
      detail:
        version.modelProvider && version.modelId
          ? `${version.modelProvider} / ${version.modelId}`
          : '请选择模型',
    },
    {
      id: 'capabilities',
      label: '工具与技能版本',
      passed: capabilitiesValid,
      detail: capabilitiesValid
        ? `${bindings.filter((item) => item.kind === 'tool').length} 个工具，${bindings.filter((item) => item.kind === 'skill').length} 个技能`
        : '存在不可用的能力版本',
    },
    {
      id: 'channels',
      label: '响应渠道',
      passed: channels.length > 0,
      detail: channels.join(' + '),
    },
    {
      id: 'infoflow',
      label: '如流凭据',
      passed: infoflowValid,
      detail: infoflowChannel?.enabled
        ? infoflowValid
          ? '机器人凭据已配置'
          : '已启用如流，但凭据不完整'
        : '未启用',
    },
  ]

  return {
    state: draft ? 'draft' : 'published',
    ready:
      Boolean(draft) &&
      changeStatus.hasChanges &&
      checks.every((check) => check.passed),
    hasChanges: changeStatus.hasChanges,
    changedModules: changeStatus.changedModules,
    checks,
    summary: {
      versionNumber: version.versionNumber,
      name: agent.name,
      promptExcerpt: promptExcerpt(version.instructions),
      modelProvider: version.modelProvider,
      modelId: version.modelId,
      thinkingLevel: version.thinkingLevel,
      tools: bindings.filter((item) => item.kind === 'tool').length,
      skills: bindings.filter((item) => item.kind === 'skill').length,
      channels,
    },
  }
}
