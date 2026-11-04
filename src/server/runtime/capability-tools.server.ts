import { createHash } from 'node:crypto'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { defineExtension, defineTool } from '@earendil-works/pi-durable'
import type { Registry, ToolRegistration } from '@earendil-works/pi-durable'
import { and, asc, eq } from 'drizzle-orm'
import { Type } from 'typebox'

import type { createDatabase } from '#/db'
import {
  agentVersionCapabilities,
  capabilities,
  capabilityVersions,
} from '#/db/schema'

type AppDatabase = ReturnType<typeof createDatabase>
type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export function modelToolName(runtimeName: string): string {
  const normalized =
    runtimeName
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[-_]+|[-_]+$/g, '') || 'tool'
  if (normalized.length <= 64) return normalized

  const hash = createHash('sha1').update(runtimeName).digest('hex').slice(0, 8)
  return `${normalized.slice(0, 55)}_${hash}`
}

function recordValue(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object' || !(key in value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' ? field : undefined
}

function textResult(value: unknown) {
  return {
    output: [
      {
        type: 'text' as const,
        text:
          typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  }
}

async function executeHttpTool(
  definition: unknown,
  args: Record<string, unknown>,
  fetchImpl: FetchLike,
) {
  const endpoint = recordValue(definition, 'endpoint')
  const method = recordValue(definition, 'method') ?? 'POST'
  if (!endpoint) throw new Error('tool endpoint is missing')

  const url = new URL(endpoint)
  const headers: Record<string, string> = { accept: 'application/json' }
  let body: string | undefined
  if (method === 'GET' || method === 'DELETE') {
    for (const [key, value] of Object.entries(args)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value))
      }
    }
  } else {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(args)
  }
  const response = await fetchImpl(url.toString(), {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      `tool request failed (${response.status}): ${text.slice(0, 500)}`,
    )
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return text ? JSON.parse(text) : null
  }
  return text
}

async function executeOpenApiTool(
  definition: unknown,
  args: Record<string, unknown>,
  fetchImpl: FetchLike,
) {
  const serverUrl = recordValue(definition, 'serverUrl')
  const path = recordValue(definition, 'path')
  const method = recordValue(definition, 'method') ?? 'GET'
  if (!serverUrl || !path) throw new Error('OpenAPI tool definition is invalid')

  const pathArgs =
    args.path && typeof args.path === 'object'
      ? (args.path as Record<string, unknown>)
      : {}
  const queryArgs =
    args.query && typeof args.query === 'object'
      ? (args.query as Record<string, unknown>)
      : {}
  const headerArgs =
    args.headers && typeof args.headers === 'object'
      ? (args.headers as Record<string, unknown>)
      : {}
  let resolvedPath = path
  for (const [key, value] of Object.entries(pathArgs)) {
    resolvedPath = resolvedPath.replace(
      `{${key}}`,
      encodeURIComponent(String(value)),
    )
  }
  const url = new URL(resolvedPath, `${serverUrl.replace(/\/+$/, '')}/`)
  for (const [key, value] of Object.entries(queryArgs)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value))
    }
  }
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...Object.fromEntries(
      Object.entries(headerArgs).map(([key, value]) => [key, String(value)]),
    ),
  }
  const body = args.body === undefined ? undefined : JSON.stringify(args.body)
  if (body) headers['content-type'] = 'application/json'

  const response = await fetchImpl(url.toString(), {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      `OpenAPI request failed (${response.status}): ${text.slice(0, 500)}`,
    )
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return text ? JSON.parse(text) : null
  }
  return text
}

async function executeMcpTool(
  definition: unknown,
  args: Record<string, unknown>,
) {
  const serverUrl = recordValue(definition, 'serverUrl')
  const transport = recordValue(definition, 'transport')
  const toolName = recordValue(definition, 'toolName')
  if (!serverUrl || !toolName) throw new Error('MCP tool definition is invalid')

  const client = new Client({
    name: 'pi-agent-platform',
    version: '1.0.0',
  })
  const url = new URL(serverUrl)
  const mcpTransport =
    transport === 'sse'
      ? new SSEClientTransport(url)
      : new StreamableHTTPClientTransport(url)
  try {
    await client.connect(mcpTransport)
    return await client.callTool({ name: toolName, arguments: args })
  } finally {
    await client.close().catch(() => undefined)
  }
}

function toolRegistration(
  row: {
    runtimeName: string
    description: string
    source: 'builtin' | 'http' | 'openapi' | 'mcp' | 'workspace'
    inputSchemaJson: unknown
    definitionJson: unknown
  },
  fetchImpl: FetchLike,
): ToolRegistration | undefined {
  if (row.source === 'builtin' || row.source === 'workspace') return undefined
  return defineTool({
    name: modelToolName(row.runtimeName),
    description: row.description,
    parameters: Type.Unsafe<Record<string, unknown>>(
      row.inputSchemaJson as Parameters<typeof Type.Unsafe>[0],
    ),
    replay: 'unsafe',
    execute: async (args) => {
      const result =
        row.source === 'mcp'
          ? await executeMcpTool(row.definitionJson, args)
          : row.source === 'openapi'
            ? await executeOpenApiTool(row.definitionJson, args, fetchImpl)
            : await executeHttpTool(row.definitionJson, args, fetchImpl)
      return textResult(result)
    },
  })
}

export async function ensureCapabilityTools(
  db: AppDatabase,
  registry: Registry,
  fetchImpl: FetchLike = fetch,
) {
  const rows = db
    .select({
      runtimeName: capabilityVersions.runtimeName,
      description: capabilityVersions.description,
      source: capabilityVersions.source,
      inputSchemaJson: capabilityVersions.inputSchemaJson,
      definitionJson: capabilityVersions.definitionJson,
    })
    .from(capabilityVersions)
    .innerJoin(
      capabilities,
      eq(capabilityVersions.capabilityId, capabilities.id),
    )
    .where(eq(capabilities.kind, 'tool'))
    .all()

  for (const row of rows) {
    if (registry.snapshot().extension(row.runtimeName)) continue
    const tool = toolRegistration(row, fetchImpl)
    if (!tool) continue
    registry.install(
      defineExtension({
        name: row.runtimeName,
        tools: [tool],
      }),
    )
  }
}

export async function selectedToolRegistrations(
  db: AppDatabase,
  registry: Registry,
  agentVersionId: string,
) {
  const rows = db
    .select({ runtimeName: capabilityVersions.runtimeName })
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
        eq(capabilities.kind, 'tool'),
      ),
    )
    .orderBy(asc(agentVersionCapabilities.sortOrder))
    .all()
  const snapshot = registry.snapshot()
  return rows.flatMap((row) => {
    const extension = snapshot.extension(row.runtimeName)
    const tool = extension?.tools?.[0]
    return tool ? [tool] : []
  })
}
