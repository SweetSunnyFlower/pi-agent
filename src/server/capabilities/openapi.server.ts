import { z } from 'zod'
import { parse as parseYaml } from 'yaml'

import type { createDatabase } from '#/db'
import {
  createToolVersionRevision,
  createToolVersions,
  normalizeToolSlug,
} from '#/server/platform/capability.server'
import type { ToolCatalogItem } from '#/server/platform/capability.server'
import type { AppPrincipal } from '#/server/platform/workspace-access.server'

type AppDatabase = ReturnType<typeof createDatabase>
export type OpenApiFetchDocument = (
  url: string,
  init: RequestInit,
) => Promise<Response>

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

export const openApiDocumentInputSchema = z.object({
  documentUrl: z.string().url(),
})

export const openApiImportInputSchema = openApiDocumentInputSchema.extend({
  operationKeys: z.array(z.string().min(1)).min(1).max(200),
})

export const openApiRevisionInputSchema = openApiDocumentInputSchema.extend({
  operationKey: z.string().min(1),
})

const httpMethods = ['get', 'post', 'put', 'patch', 'delete'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function resolveLocalRef(
  value: unknown,
  document: Record<string, unknown>,
  stack = new Set<string>(),
  depth = 0,
): unknown {
  if (depth > 20) throw new Error('OpenAPI reference depth exceeded')
  if (Array.isArray(value)) {
    return value.map((item) =>
      resolveLocalRef(item, document, stack, depth + 1),
    )
  }
  if (!isRecord(value)) return value

  const reference = value.$ref
  if (typeof reference === 'string') {
    if (!reference.startsWith('#/')) {
      throw new Error('external OpenAPI references are not supported')
    }
    if (stack.has(reference)) return { type: 'object' }
    const target = reference
      .slice(2)
      .split('/')
      .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
      .reduce<unknown>(
        (current, key) => (isRecord(current) ? current[key] : undefined),
        document,
      )
    if (target === undefined) {
      throw new Error(`OpenAPI reference not found: ${reference}`)
    }
    return resolveLocalRef(
      target,
      document,
      new Set([...stack, reference]),
      depth + 1,
    )
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      resolveLocalRef(item, document, stack, depth + 1),
    ]),
  )
}

function emptyObjectSchema() {
  return {
    type: 'object',
    properties: {},
    additionalProperties: false,
  }
}

function operationInputSchema(
  parameters: Record<string, unknown>[],
  requestBody: Record<string, unknown> | undefined,
) {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  const groupedParameters = {
    path: {} as Record<string, unknown>,
    query: {} as Record<string, unknown>,
    header: {} as Record<string, unknown>,
  }

  for (const parameter of parameters) {
    const location = parameter.in
    const name = parameter.name
    if (
      !['path', 'query', 'header'].includes(String(location)) ||
      typeof name !== 'string'
    ) {
      continue
    }
    const group = groupedParameters[location as keyof typeof groupedParameters]
    group[name] = isRecord(parameter.schema) ? parameter.schema : {}
    if (parameter.required === true) {
      const groupName = location as string
      if (!required.includes(groupName)) required.push(groupName)
    }
  }

  for (const [location, group] of Object.entries(groupedParameters)) {
    if (Object.keys(group).length > 0) {
      properties[location] = {
        type: 'object',
        properties: group,
        additionalProperties: false,
      }
    }
  }

  if (requestBody) {
    const content = isRecord(requestBody.content)
      ? requestBody.content
      : undefined
    const jsonContent = content?.['application/json']
    if (isRecord(jsonContent) && isRecord(jsonContent.schema)) {
      properties.body = jsonContent.schema
      if (requestBody.required === true) required.push('body')
    }
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  }
}

function serverUrlFromDocument(
  document: Record<string, unknown>,
  documentUrl: string,
): string {
  const servers = Array.isArray(document.servers) ? document.servers : []
  const first = isRecord(servers[0]) ? servers[0] : undefined
  const configured = typeof first?.url === 'string' ? first.url : '/'
  return new URL(configured, documentUrl).toString().replace(/\/+$/, '')
}

async function loadOpenApiDocument(
  documentUrl: string,
  fetchDocument: OpenApiFetchDocument,
): Promise<{
  document: Record<string, unknown>
  title: string
  version: string
  serverUrl: string
}> {
  const url = new URL(documentUrl)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('invalid OpenAPI document URL')
  }

  const response = await fetchDocument(url.toString(), {
    headers: {
      accept: 'application/json, application/yaml, text/yaml, */*',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error('OpenAPI document unavailable')

  const text = await response.text()
  if (text.length > 2_000_000) throw new Error('OpenAPI document too large')

  let parsed: unknown
  try {
    parsed = parseYaml(text)
  } catch {
    throw new Error('invalid OpenAPI document')
  }
  if (!isRecord(parsed)) throw new Error('invalid OpenAPI document')
  if (typeof parsed.openapi !== 'string' || !parsed.openapi.startsWith('3.')) {
    throw new Error('only OpenAPI 3.x documents are supported')
  }

  const info = isRecord(parsed.info) ? parsed.info : {}
  const title =
    typeof info.title === 'string' && info.title.trim()
      ? info.title.trim()
      : 'OpenAPI'
  const version =
    typeof info.version === 'string' && info.version.trim()
      ? info.version.trim()
      : 'unknown'

  return {
    document: resolveLocalRef(parsed, parsed) as Record<string, unknown>,
    title,
    version,
    serverUrl: serverUrlFromDocument(parsed, documentUrl),
  }
}

export async function previewOpenApiDocument(
  input: z.infer<typeof openApiDocumentInputSchema>,
  fetchDocument: OpenApiFetchDocument = fetch,
): Promise<OpenApiPreview> {
  const parsedInput = openApiDocumentInputSchema.parse(input)
  const loaded = await loadOpenApiDocument(
    parsedInput.documentUrl,
    fetchDocument,
  )
  const paths = isRecord(loaded.document.paths) ? loaded.document.paths : {}
  const operations: OpenApiOperationPreview[] = []

  for (const [routePath, pathItemValue] of Object.entries(paths)) {
    if (!isRecord(pathItemValue)) continue
    const pathParameters = Array.isArray(pathItemValue.parameters)
      ? pathItemValue.parameters.filter(isRecord)
      : []

    for (const method of httpMethods) {
      const operation = pathItemValue[method]
      if (!isRecord(operation)) continue
      const operationParameters = Array.isArray(operation.parameters)
        ? operation.parameters.filter(isRecord)
        : []
      const requestBody = isRecord(operation.requestBody)
        ? operation.requestBody
        : undefined
      const operationId =
        typeof operation.operationId === 'string'
          ? operation.operationId
          : undefined
      const summary =
        typeof operation.summary === 'string' ? operation.summary.trim() : ''
      const description =
        typeof operation.description === 'string'
          ? operation.description.trim()
          : ''

      operations.push({
        key: `${method.toLocaleUpperCase()} ${routePath}`,
        operationId,
        name:
          summary ||
          operationId ||
          `${method.toLocaleUpperCase()} ${routePath}`,
        description,
        method: method.toLocaleUpperCase(),
        path: routePath,
        inputSchema: operationInputSchema(
          [...pathParameters, ...operationParameters],
          requestBody,
        ),
      })
    }
  }

  return {
    title: loaded.title,
    version: loaded.version,
    serverUrl: loaded.serverUrl,
    operations,
  }
}

export async function importOpenApiTools(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  input: z.infer<typeof openApiImportInputSchema>,
  fetchDocument: OpenApiFetchDocument = fetch,
): Promise<ToolCatalogItem[]> {
  const parsedInput = openApiImportInputSchema.parse(input)
  const preview = await previewOpenApiDocument(
    { documentUrl: parsedInput.documentUrl },
    fetchDocument,
  )
  const selectedKeys = new Set(parsedInput.operationKeys)
  const selected = preview.operations.filter((operation) =>
    selectedKeys.has(operation.key),
  )
  if (selected.length !== selectedKeys.size) {
    throw new Error('invalid OpenAPI operation')
  }

  const titleSlug = normalizeToolSlug(preview.title)
  return createToolVersions(
    db,
    principal,
    workspaceId,
    selected.map((operation) => ({
      name: operation.name,
      description: operation.description,
      source: 'openapi',
      slug: normalizeToolSlug(
        `${titleSlug}-${operation.operationId ?? `${operation.method}-${operation.path}`}`,
      ),
      inputSchema: operation.inputSchema,
      configSchema: emptyObjectSchema(),
      definition: {
        kind: 'openapi',
        documentUrl: parsedInput.documentUrl,
        documentTitle: preview.title,
        operationId: operation.operationId,
        serverUrl: preview.serverUrl,
        method: operation.method,
        path: operation.path,
        endpoint: `${preview.serverUrl}${operation.path}`,
      },
    })),
  )
}

export async function reviseOpenApiTool(
  db: AppDatabase,
  principal: AppPrincipal,
  workspaceId: string,
  agentId: string,
  versionId: string,
  input: z.infer<typeof openApiRevisionInputSchema>,
  fetchDocument: OpenApiFetchDocument = fetch,
): Promise<ToolCatalogItem[]> {
  const parsed = openApiRevisionInputSchema.parse(input)
  const preview = await previewOpenApiDocument(
    { documentUrl: parsed.documentUrl },
    fetchDocument,
  )
  const operation = preview.operations.find(
    (item) => item.key === parsed.operationKey,
  )
  if (!operation) throw new Error('invalid OpenAPI operation')

  return createToolVersionRevision(
    db,
    principal,
    workspaceId,
    agentId,
    versionId,
    {
      name: operation.name,
      description: operation.description,
      source: 'openapi',
      inputSchema: operation.inputSchema,
      configSchema: emptyObjectSchema(),
      definition: {
        kind: 'openapi',
        documentUrl: parsed.documentUrl,
        documentTitle: preview.title,
        operationId: operation.operationId,
        serverUrl: preview.serverUrl,
        method: operation.method,
        path: operation.path,
        endpoint: `${preview.serverUrl}${operation.path}`,
      },
    },
  )
}
