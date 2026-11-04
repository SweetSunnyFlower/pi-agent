import { z } from 'zod'

import type { createDatabase } from '#/db'
import type { Models } from '@earendil-works/pi-ai'
import type { Harness, Registry } from '@earendil-works/pi-durable'
import { authenticateRequest } from '#/server/auth/authenticate.server'
import type { ServerEnv } from '#/server/env.server'
import {
  WebAnswerError,
  getPendingWebUiInteraction,
  getWebConversationMessages,
  listWebConversations,
  respondToWebUiInteraction,
  sendWebMessage,
  streamWebConversationEvents,
  uiInteractionResponseSchema,
  waitForWebAnswer,
  createWebChatInputSchema,
} from '#/server/runtime/chat.server'
import { resolvePrincipal } from '#/server/platform/workspace-access.server'
import type { AppPrincipal } from '#/server/platform/workspace-access.server'

type BaseDependencies = {
  db: ReturnType<typeof createDatabase>
  env: ServerEnv
  workspaceId: string
  harness: Harness
  registry?: Registry
  models?: Models
}

type AgentDependencies = BaseDependencies & { agentId: string }
type ConversationDependencies = BaseDependencies & { conversationId: string }

async function principalFor(
  request: Request,
  dependencies: BaseDependencies,
): Promise<AppPrincipal | Response> {
  const identity = await authenticateRequest(request.headers, dependencies.env)
  if (!identity) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const principal = await resolvePrincipal(
    dependencies.db,
    identity,
    dependencies.env,
  )
  if (!principal) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  return principal
}

function originAllowed(request: Request, env: ServerEnv): boolean {
  const origin = request.headers.get('origin')
  return !origin || origin === new URL(env.APP_ORIGIN).origin
}

export function errorResponse(error: unknown): Response {
  if (error instanceof z.ZodError) {
    return Response.json({ error: 'validation_error' }, { status: 400 })
  }
  if (
    error instanceof Error &&
    [
      'conversation not found',
      'submission not found',
      'ui interaction not found',
    ].includes(error.message)
  ) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  if (error instanceof Error && error.message === 'invalid ui response') {
    return Response.json({ error: 'invalid_ui_response' }, { status: 400 })
  }
  if (
    error instanceof Error &&
    error.message === 'ui interaction is not pending'
  ) {
    return Response.json(
      { error: 'ui_interaction_not_pending' },
      { status: 409 },
    )
  }
  if (error instanceof Error && error.message === 'agent not published') {
    return Response.json({ error: 'agent_not_published' }, { status: 409 })
  }
  if (error instanceof Error && error.message === 'forbidden') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  if (error instanceof Error && error.message === 'model not available') {
    return Response.json({ error: 'model_not_available' }, { status: 409 })
  }
  if (
    error instanceof Error &&
    error.message === 'model does not support images'
  ) {
    return Response.json(
      {
        error: 'model_does_not_support_images',
        message: '当前模型不支持图片输入，请切换视觉模型后重试。',
      },
      { status: 409 },
    )
  }
  if (
    error instanceof Error &&
    error.message.startsWith('submission unanswered')
  ) {
    return Response.json({ error: 'submission_unanswered' }, { status: 409 })
  }
  if (error instanceof WebAnswerError) {
    return Response.json(
      { error: error.code, message: error.message },
      { status: 409 },
    )
  }
  return Response.json({ error: 'internal_error' }, { status: 500 })
}

export function getChatConfigHandler(env: ServerEnv): Response {
  return Response.json({
    maxImagesPerMessage: env.CHAT_MAX_IMAGES_PER_MESSAGE,
  })
}

export async function postChatHandler(
  request: Request,
  dependencies: AgentDependencies,
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    const input = createWebChatInputSchema(
      dependencies.env.CHAT_MAX_IMAGES_PER_MESSAGE,
    ).parse(await request.json())
    const result = await sendWebMessage(
      dependencies.db,
      principal,
      dependencies.workspaceId,
      dependencies.agentId,
      input,
      dependencies.harness,
      dependencies.registry,
      dependencies.models,
      dependencies.env.CHAT_MAX_IMAGES_PER_MESSAGE,
    )
    return Response.json(result, { status: 202 })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function getConversationHandler(
  request: Request,
  dependencies: ConversationDependencies,
): Promise<Response> {
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    return Response.json(
      await getWebConversationMessages(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        dependencies.conversationId,
        dependencies.harness,
      ),
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function listConversationsHandler(
  request: Request,
  dependencies: AgentDependencies,
): Promise<Response> {
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    return Response.json(
      await listWebConversations(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        dependencies.agentId,
        dependencies.harness,
      ),
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function getConversationUiHandler(
  request: Request,
  dependencies: ConversationDependencies,
): Promise<Response> {
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    return Response.json({
      interaction: await getPendingWebUiInteraction(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        dependencies.conversationId,
      ),
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function postConversationUiHandler(
  request: Request,
  dependencies: ConversationDependencies,
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal

  try {
    const interactionId = new URL(request.url).pathname.split('/').at(-1)
    if (!interactionId) {
      return Response.json({ error: 'interaction_required' }, { status: 400 })
    }
    const response = uiInteractionResponseSchema.parse(await request.json())
    return Response.json(
      await respondToWebUiInteraction(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        dependencies.conversationId,
        interactionId,
        response,
        dependencies.harness,
        dependencies.registry,
        dependencies.models,
      ),
      { status: 202 },
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function waitConversationHandler(
  request: Request,
  dependencies: ConversationDependencies,
): Promise<Response> {
  if (!originAllowed(request, dependencies.env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal
  const submissionId = new URL(request.url).searchParams.get('submissionId')
  if (!submissionId) {
    return Response.json({ error: 'submission_required' }, { status: 400 })
  }

  try {
    return Response.json(
      await waitForWebAnswer(
        dependencies.db,
        principal,
        dependencies.workspaceId,
        dependencies.conversationId,
        submissionId,
        dependencies.harness,
      ),
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function conversationEventsHandler(
  request: Request,
  dependencies: ConversationDependencies,
): Promise<Response> {
  const principal = await principalFor(request, dependencies)
  if (principal instanceof Response) return principal
  const submissionId = new URL(request.url).searchParams.get('submissionId')
  if (!submissionId) {
    return Response.json({ error: 'submission_required' }, { status: 400 })
  }

  const encoder = new TextEncoder()
  let closed = false
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = () => {
        if (closed) return
        closed = true
        controller.close()
      }
      const send = (event: string, data: unknown) => {
        if (closed) return
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        )
      }

      try {
        const session = await streamWebConversationEvents(
          dependencies.db,
          principal,
          dependencies.workspaceId,
          dependencies.conversationId,
          submissionId,
          dependencies.harness,
          (event) => send(event.type, event),
        )
        request.signal.addEventListener(
          'abort',
          () => {
            void session.close().finally(close)
          },
          { once: true },
        )
        await session.completion
        await session.close()
        close()
      } catch (error) {
        send('failed', {
          type: 'failed',
          code: 'agent_failed',
          message: 'Agent 回答失败，请稍后重试。',
        })
        close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
    },
  })
}
