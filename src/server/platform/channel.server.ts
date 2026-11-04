import { randomUUID } from 'node:crypto'

import { Client } from '@baidu/infoflow-sdk-nodejs'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import type { createDatabase } from '#/db'
import {
  agentChannels,
  agents,
  auditLogs,
  channelConnections,
} from '#/db/schema'
import type { ServerEnv } from '#/server/env.server'
import { notifyInfoFlowChannelChanged } from '#/server/channels/infoflow/infoflow-supervisor.server'
import type {
  SealedSecret,
  SecretBox,
} from '#/server/secrets/secret-box.server'

import { requireWorkspaceAccess } from './workspace-access.server'
import type { AppPrincipal } from './workspace-access.server'

type AppDatabase = ReturnType<typeof createDatabase>
type ConnectionStatus =
  'not_configured' | 'disconnected' | 'connecting' | 'connected' | 'error'

export type AgentChannels = {
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
    status: ConnectionStatus
    statusMessage?: string
    lastTestedAt?: string
    connectedAt?: string
  }
}

export const infoFlowChannelInputSchema = z.object({
  enabled: z.boolean(),
  infoflowAgentId: z
    .string()
    .trim()
    .regex(/^[1-9]\d{0,31}$/)
    .optional(),
  appKey: z.string().trim().max(300).optional(),
  appSecret: z.string().trim().max(500).optional(),
})

type InfoFlowClient = {
  robot: {
    getInfo: () => Promise<{
      agentId: number | string
      name: string
      iconUrl?: string
    }>
  }
}

export type InfoFlowClientFactory = (options: {
  appKey: string
  appSecret: string
  agentId: string
  baseUrl: string
}) => InfoFlowClient

const defaultClientFactory: InfoFlowClientFactory = (options) =>
  new Client(options)

function maskSecret(value: string): string {
  if (value.length < 8) return '••••'
  return `${value.slice(0, 3)}••••${value.slice(-4)}`
}

function connectionAad(connectionId: string): string {
  return `channel_connection:${connectionId}`
}

async function requireAgent(
  db: AppDatabase,
  workspaceId: string,
  agentId: string,
) {
  const agent = db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
    .get()
  if (!agent) throw new Error('agent not found')
  return agent
}

function credentialsFor(
  credentialsJson: unknown,
  connectionId: string,
  box: SecretBox,
) {
  const sealed = credentialsJson as SealedSecret
  const plaintext = box.open(sealed, connectionAad(connectionId))
  return JSON.parse(plaintext) as { appKey: string; appSecret: string }
}

function channelRow(db: AppDatabase, workspaceId: string, agentId: string) {
  return db
    .select()
    .from(agentChannels)
    .where(
      and(
        eq(agentChannels.workspaceId, workspaceId),
        eq(agentChannels.agentId, agentId),
        eq(agentChannels.channel, 'infoflow'),
      ),
    )
    .get()
}

function connectionRow(db: AppDatabase, agentChannelId: string) {
  return db
    .select()
    .from(channelConnections)
    .where(eq(channelConnections.agentChannelId, agentChannelId))
    .get()
}

export async function getAgentChannels(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
  box: SecretBox,
): Promise<AgentChannels> {
  await requireWorkspaceAccess(db, principal, workspaceId, [
    'workspace_admin',
    'editor',
    'user',
  ])
  await requireAgent(db, workspaceId, agentId)
  const channel = channelRow(db, workspaceId, agentId)
  const connection = channel ? connectionRow(db, channel.id) : undefined

  if (!channel || !connection) {
    return {
      web: { channel: 'web', enabled: true, status: 'ready' },
      infoflow: {
        channel: 'infoflow',
        enabled: channel?.enabled ?? false,
        configured: false,
        status: 'not_configured',
      },
    }
  }

  const credentials = credentialsFor(
    connection.credentialsJson,
    connection.id,
    box,
  )
  return {
    web: { channel: 'web', enabled: true, status: 'ready' },
    infoflow: {
      channel: 'infoflow',
      enabled: channel.enabled,
      configured: true,
      infoflowAgentId: connection.externalAgentId,
      appKeyMasked: maskSecret(credentials.appKey),
      ...(connection.displayName
        ? { displayName: connection.displayName }
        : {}),
      ...(connection.iconUrl ? { iconUrl: connection.iconUrl } : {}),
      status: connection.status,
      ...(connection.statusMessage
        ? { statusMessage: connection.statusMessage }
        : {}),
      ...(connection.lastTestedAt
        ? { lastTestedAt: connection.lastTestedAt.toISOString() }
        : {}),
      ...(connection.connectedAt
        ? { connectedAt: connection.connectedAt.toISOString() }
        : {}),
    },
  }
}

export async function saveInfoFlowChannel(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
  input: z.infer<typeof infoFlowChannelInputSchema>,
  box: SecretBox,
): Promise<AgentChannels> {
  await requireWorkspaceAccess(db, principal, workspaceId, [
    'platform_admin',
    'workspace_admin',
  ])
  await requireAgent(db, workspaceId, agentId)
  const parsed = infoFlowChannelInputSchema.parse(input)
  const now = new Date()

  try {
    db.transaction((tx) => {
      const existingChannel = channelRow(
        tx as unknown as AppDatabase,
        workspaceId,
        agentId,
      )
      const channelId = existingChannel?.id ?? randomUUID()
      const existingConnection = existingChannel
        ? connectionRow(tx as unknown as AppDatabase, channelId)
        : undefined
      const existingCredentials = existingConnection
        ? credentialsFor(
            existingConnection.credentialsJson,
            existingConnection.id,
            box,
          )
        : undefined
      const infoflowAgentId =
        parsed.infoflowAgentId ?? existingConnection?.externalAgentId
      const appKey = parsed.appKey?.trim() || existingCredentials?.appKey
      const appSecret =
        parsed.appSecret?.trim() || existingCredentials?.appSecret

      if (parsed.enabled && (!infoflowAgentId || !appKey || !appSecret)) {
        throw new Error('incomplete infoflow configuration')
      }

      if (!existingChannel) {
        tx.insert(agentChannels)
          .values({
            id: channelId,
            workspaceId,
            agentId,
            channel: 'infoflow',
            enabled: parsed.enabled,
            configJson: { triggerMode: 'group_mention' },
            createdAt: now,
            updatedAt: now,
          })
          .run()
      } else {
        tx.update(agentChannels)
          .set({ enabled: parsed.enabled, updatedAt: now })
          .where(eq(agentChannels.id, channelId))
          .run()
      }

      if (infoflowAgentId && appKey && appSecret) {
        const connectionId = existingConnection?.id ?? randomUUID()
        const credentialsChanged =
          !existingConnection ||
          !existingCredentials ||
          appKey !== existingCredentials.appKey ||
          appSecret !== existingCredentials.appSecret
        const credentialsJson: SealedSecret =
          existingConnection && !credentialsChanged
            ? (existingConnection.credentialsJson as SealedSecret)
            : box.seal(
                JSON.stringify({ appKey, appSecret }),
                connectionAad(connectionId),
              )

        if (existingConnection) {
          tx.update(channelConnections)
            .set({
              externalAgentId: infoflowAgentId,
              credentialsJson,
              status: 'disconnected',
              statusMessage: null,
              updatedAt: now,
            })
            .where(eq(channelConnections.id, connectionId))
            .run()
        } else {
          tx.insert(channelConnections)
            .values({
              id: connectionId,
              workspaceId,
              agentChannelId: channelId,
              channel: 'infoflow',
              externalAgentId: infoflowAgentId,
              credentialsJson,
              status: 'disconnected',
              createdAt: now,
              updatedAt: now,
            })
            .run()
        }
      }

      tx.insert(auditLogs)
        .values({
          id: randomUUID(),
          workspaceId,
          actorUserId: principal.userId,
          action: 'agent_channel.infoflow.save',
          targetType: 'agent',
          targetId: agentId,
          detailsJson: {
            enabled: parsed.enabled,
            configured: Boolean(infoflowAgentId && appKey && appSecret),
          },
          createdAt: now,
        })
        .run()
    })
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLocaleLowerCase().includes('unique')
    ) {
      throw new Error('infoflow agent already in use')
    }
    throw error
  }

  notifyInfoFlowChannelChanged(agentId)
  return getAgentChannels(db, principal, workspaceId, agentId, box)
}

export async function testInfoFlowConnection(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
  env: ServerEnv,
  box: SecretBox,
  createClient: InfoFlowClientFactory = defaultClientFactory,
) {
  await requireWorkspaceAccess(db, principal, workspaceId, [
    'platform_admin',
    'workspace_admin',
  ])
  await requireAgent(db, workspaceId, agentId)
  const channel = channelRow(db, workspaceId, agentId)
  const connection = channel ? connectionRow(db, channel.id) : undefined
  if (!connection) throw new Error('infoflow not configured')

  const credentials = credentialsFor(
    connection.credentialsJson,
    connection.id,
    box,
  )

  try {
    const client = createClient({
      appKey: credentials.appKey,
      appSecret: credentials.appSecret,
      agentId: connection.externalAgentId,
      baseUrl: env.INFOFLOW_API_BASE_URL,
    })
    const info = await client.robot.getInfo()
    if (String(info.agentId) !== connection.externalAgentId) {
      throw new Error('robot identity mismatch')
    }

    db.update(channelConnections)
      .set({
        status: 'disconnected',
        statusMessage: 'credentials_ok',
        displayName: info.name,
        iconUrl: info.iconUrl,
        lastTestedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(channelConnections.id, connection.id))
      .run()

    return {
      ok: true as const,
      infoflowAgentId: String(info.agentId),
      name: info.name,
      iconUrl: info.iconUrl,
    }
  } catch {
    db.update(channelConnections)
      .set({
        status: 'error',
        statusMessage: 'credential_test_failed',
        updatedAt: new Date(),
      })
      .where(eq(channelConnections.id, connection.id))
      .run()
    throw new Error('InfoFlow credentials invalid')
  }
}
