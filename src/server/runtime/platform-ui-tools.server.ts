import { randomUUID } from 'node:crypto'

import { defineExtension, defineTool } from '@earendil-works/pi-durable'
import type { Registry, ToolRegistration } from '@earendil-works/pi-durable'
import { and, eq } from 'drizzle-orm'
import { Type } from 'typebox'

import type { createDatabase } from '#/db'
import { conversationBindings, uiInteractions } from '#/db/schema'
import type {
  UiInteractionDefinition,
  UiFormField,
  UiInteractionRecord,
} from '#/lib/chat/ui-interaction'

type AppDatabase = ReturnType<typeof createDatabase>

const extensionName = 'platform.ui'
const askUserToolName = 'platform_ask_user'

const interactionParameters = Type.Object(
  {
    kind: Type.Union([
      Type.Literal('single_select'),
      Type.Literal('multi_select'),
      Type.Literal('confirm'),
      Type.Literal('form'),
    ]),
    title: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.Optional(Type.String({ maxLength: 2_000 })),
    options: Type.Optional(
      Type.Array(
        Type.Object({
          id: Type.String({ minLength: 1, maxLength: 100 }),
          label: Type.String({ minLength: 1, maxLength: 200 }),
          description: Type.Optional(Type.String({ maxLength: 1_000 })),
        }),
        { maxItems: 20 },
      ),
    ),
    fields: Type.Optional(
      Type.Array(
        Type.Object({
          id: Type.String({ minLength: 1, maxLength: 100 }),
          label: Type.String({ minLength: 1, maxLength: 200 }),
          type: Type.Union([
            Type.Literal('text'),
            Type.Literal('textarea'),
            Type.Literal('number'),
          ]),
          placeholder: Type.Optional(Type.String({ maxLength: 500 })),
          required: Type.Optional(Type.Boolean()),
        }),
        { maxItems: 12 },
      ),
    ),
    minSelections: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
    maxSelections: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
    submitLabel: Type.Optional(Type.String({ maxLength: 100 })),
    confirmLabel: Type.Optional(Type.String({ maxLength: 100 })),
    cancelLabel: Type.Optional(Type.String({ maxLength: 100 })),
  },
  { additionalProperties: false },
)

function normalizeDefinition(
  args: Record<string, unknown>,
): UiInteractionDefinition {
  const kind = String(args.kind)
  const title = typeof args.title === 'string' ? args.title.trim() : ''
  if (!title) throw new Error('ask_user title is required')
  const description =
    typeof args.description === 'string' ? args.description.trim() : undefined
  const base = { title, ...(description ? { description } : {}) }
  const submitLabel =
    typeof args.submitLabel === 'string' && args.submitLabel.trim()
      ? args.submitLabel.trim()
      : undefined

  if (kind === 'single_select' || kind === 'multi_select') {
    const options = Array.isArray(args.options)
      ? args.options.flatMap((value) => {
          if (!value || typeof value !== 'object') return []
          const option = value as Record<string, unknown>
          const id = typeof option.id === 'string' ? option.id.trim() : ''
          const label =
            typeof option.label === 'string' ? option.label.trim() : ''
          if (!id || !label) return []
          const optionDescription =
            typeof option.description === 'string'
              ? option.description.trim()
              : undefined
          return [
            {
              id,
              label,
              ...(optionDescription ? { description: optionDescription } : {}),
            },
          ]
        })
      : []
    if (options.length === 0) throw new Error('ask_user options are required')
    if (kind === 'single_select') {
      return {
        ...base,
        kind,
        options,
        ...(submitLabel ? { submitLabel } : {}),
      }
    }
    const minSelections =
      typeof args.minSelections === 'number' ? args.minSelections : undefined
    const maxSelections =
      typeof args.maxSelections === 'number' ? args.maxSelections : undefined
    return {
      ...base,
      kind,
      options,
      ...(minSelections !== undefined ? { minSelections } : {}),
      ...(maxSelections !== undefined ? { maxSelections } : {}),
      ...(submitLabel ? { submitLabel } : {}),
    }
  }

  if (kind === 'confirm') {
    return {
      ...base,
      kind,
      ...(typeof args.confirmLabel === 'string'
        ? { confirmLabel: args.confirmLabel }
        : {}),
      ...(typeof args.cancelLabel === 'string'
        ? { cancelLabel: args.cancelLabel }
        : {}),
    }
  }

  const fields = Array.isArray(args.fields)
    ? args.fields.flatMap((value) => {
        if (!value || typeof value !== 'object') return []
        const field = value as Record<string, unknown>
        const id = typeof field.id === 'string' ? field.id.trim() : ''
        const label = typeof field.label === 'string' ? field.label.trim() : ''
        const type: UiFormField['type'] | undefined =
          field.type === 'textarea' || field.type === 'number'
            ? field.type
            : field.type === 'text'
              ? 'text'
              : undefined
        if (!id || !label || !type) return []
        return [
          {
            id,
            label,
            type,
            ...(typeof field.placeholder === 'string'
              ? { placeholder: field.placeholder }
              : {}),
            ...(typeof field.required === 'boolean'
              ? { required: field.required }
              : {}),
          },
        ]
      })
    : []
  if (fields.length === 0) throw new Error('ask_user form fields are required')
  return {
    ...base,
    kind: 'form',
    fields,
    ...(submitLabel ? { submitLabel } : {}),
  }
}

export function interactionRecord(
  row: typeof uiInteractions.$inferSelect,
): UiInteractionRecord {
  return {
    id: row.id,
    kind: row.kind,
    request: row.requestJson as UiInteractionDefinition,
    status: row.status,
    ...(row.responseJson
      ? {
          response: row.responseJson as UiInteractionRecord['response'],
        }
      : {}),
    createdAt: row.createdAt.toISOString(),
    ...(row.answeredAt ? { answeredAt: row.answeredAt.toISOString() } : {}),
  }
}

function askUserTool(db: AppDatabase): ToolRegistration {
  return defineTool({
    name: askUserToolName,
    description:
      'Ask the user to choose options, confirm an action, or fill a short form. Use this whenever a decision must come from the user. Do not invent the user response.',
    parameters: interactionParameters,
    replay: 'safe',
    execute: async (args, api) => {
      const binding = db
        .select()
        .from(conversationBindings)
        .where(
          eq(conversationBindings.piConversationId, String(api.conversationId)),
        )
        .get()
      if (!binding) throw new Error('conversation binding is missing')
      const request = normalizeDefinition(args)
      const existing = db
        .select()
        .from(uiInteractions)
        .where(
          and(
            eq(uiInteractions.conversationBindingId, binding.id),
            eq(uiInteractions.toolCallId, api.callId),
          ),
        )
        .get()
      const interaction =
        existing ??
        db
          .insert(uiInteractions)
          .values({
            id: randomUUID(),
            workspaceId: binding.workspaceId,
            conversationBindingId: binding.id,
            toolCallId: api.callId,
            kind: request.kind,
            requestJson: request,
            status: 'pending',
          })
          .returning()
          .get()
      return {
        output: [
          {
            type: 'text' as const,
            text: '已向用户展示交互组件，等待用户提交。',
          },
        ],
        details: {
          uiInteraction: interactionRecord(interaction),
        },
      }
    },
  })
}

export function ensurePlatformUiTools(db: AppDatabase, registry: Registry) {
  if (registry.snapshot().extension(extensionName)) return
  registry.install(
    defineExtension({
      name: extensionName,
      tools: [askUserTool(db)],
    }),
  )
}

export function platformUiToolRegistrations(
  registry: Registry,
): readonly ToolRegistration[] {
  return registry.snapshot().extension(extensionName)?.tools ?? []
}
