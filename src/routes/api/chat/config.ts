import { createFileRoute } from '@tanstack/react-router'

import { getServerEnv } from '#/server/env.server'
import { getChatConfigHandler } from '#/server/http/chat-http.server'

export const Route = createFileRoute('/api/chat/config')({
  server: {
    handlers: {
      GET: () => getChatConfigHandler(getServerEnv()),
    },
  },
})
