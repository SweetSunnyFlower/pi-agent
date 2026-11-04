import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { z } from 'zod'

import type { createDatabase } from '#/db'
import {
  createToolVersionRevision,
  createToolVersions,
  normalizeToolSlug,
} from '#/server/platform/capability.server'
import type { ToolCatalogItem } from '#/server/platform/capability.server'
import type { AppPrincipal } from '#/server/platform/workspace-access.server'

type AppDatabase = ReturnType<typeof createDatabase>

export type McpTransport = 'streamable-http' | 'sse'

export type DiscoveredMcpTool = {
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

export type DiscoveredMcpServer = {
  serverName: string
  serverVersion?: string
  tools: DiscoveredMcpTool[]
}

export type McpPreview = DiscoveredMcpServer & {
  transport: McpTransport
}

export type DiscoverMcpServer = (
  input: z.infer<typeof mcpServerInputSchema>,
) => Promise<DiscoveredMcpServer>

export const mcpServerInputSchema = z.object({
  serverUrl: z.string().url(),
  transport: z.enum(['streamable-http', 'sse']).default('streamable-http'),
})

export const mcpImportInputSchema = mcpServerInputSchema.extend({
  toolNames: z.array(z.string().min(1)).min(1).max(100),
})

export const mcpRevisionInputSchema = mcpServerInputSchema.extend({
  toolName: z.string().min(1),
})

function emptyObjectSchema() {
  return {
    type: 'object',
    properties: {},
    additionalProperties: false,
  }
}

export async function discoverRemoteMcpServer(
  input: z.infer<typeof mcpServerInputSchema>,
): Promise<DiscoveredMcpServer> {
  const url = new URL(input.serverUrl)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('invalid MCP server URL')
  }

  const client = new Client(
    { name: 'pi-agent-platform', version: '1.0.0' },
    { capabilities: {} },
  )
  const transport =
    input.transport === 'sse'
      ? new SSEClientTransport(url)
      : new StreamableHTTPClientTransport(url)

  try {
    await client.connect(transport)
    const tools: DiscoveredMcpTool[] = []
    let cursor: string | undefined

    do {
      const page = await client.listTools(cursor ? { cursor } : undefined)
      tools.push(
        ...page.tools.map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      )
      cursor = page.nextCursor
    } while (cursor)

    const server = client.getServerVersion()
    return {
      serverName: server?.name ?? url.hostname,
      serverVersion: server?.version,
      tools,
    }
  } catch {
    throw new Error('MCP server unavailable')
  } finally {
    await client.close().catch(() => undefined)
  }
}

export async function previewMcpServer(
  input: z.infer<typeof mcpServerInputSchema>,
  discover: DiscoverMcpServer = discoverRemoteMcpServer,
): Promise<McpPreview> {
  const parsed = mcpServerInputSchema.parse(input)
  const discovered = await discover(parsed)
  return { ...discovered, transport: parsed.transport }
}

export async function importMcpTools(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  input: z.infer<typeof mcpImportInputSchema>,
  discover: DiscoverMcpServer = discoverRemoteMcpServer,
): Promise<ToolCatalogItem[]> {
  const parsed = mcpImportInputSchema.parse(input)
  const preview = await previewMcpServer(parsed, discover)
  const selectedNames = new Set(parsed.toolNames)
  const selected = preview.tools.filter((tool) => selectedNames.has(tool.name))
  if (selected.length !== selectedNames.size) {
    throw new Error('invalid MCP tool')
  }

  const serverSlug = normalizeToolSlug(preview.serverName)
  return createToolVersions(
    db,
    principal,
    workspaceId,
    selected.map((tool) => ({
      name: tool.title?.trim() || tool.name,
      description: tool.description ?? '',
      source: 'mcp',
      slug: normalizeToolSlug(`${serverSlug}-${tool.name}`),
      runtimeName: `platform.tool.mcp.${serverSlug}.${normalizeToolSlug(tool.name)}@1.0.0`,
      inputSchema: tool.inputSchema,
      configSchema: emptyObjectSchema(),
      definition: {
        kind: 'mcp',
        serverUrl: parsed.serverUrl,
        endpoint: parsed.serverUrl,
        transport: parsed.transport,
        toolName: tool.name,
      },
    })),
  )
}

export async function reviseMcpTool(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
  versionId: string,
  input: z.infer<typeof mcpRevisionInputSchema>,
  discover: DiscoverMcpServer = discoverRemoteMcpServer,
): Promise<ToolCatalogItem[]> {
  const parsed = mcpRevisionInputSchema.parse(input)
  const preview = await previewMcpServer(parsed, discover)
  const tool = preview.tools.find((item) => item.name === parsed.toolName)
  if (!tool) throw new Error('invalid MCP tool')

  return createToolVersionRevision(
    db,
    principal,
    workspaceId,
    agentId,
    versionId,
    {
      name: tool.title?.trim() || tool.name,
      description: tool.description ?? '',
      source: 'mcp',
      inputSchema: tool.inputSchema,
      configSchema: emptyObjectSchema(),
      definition: {
        kind: 'mcp',
        serverUrl: parsed.serverUrl,
        endpoint: parsed.serverUrl,
        transport: parsed.transport,
        toolName: tool.name,
      },
    },
  )
}
