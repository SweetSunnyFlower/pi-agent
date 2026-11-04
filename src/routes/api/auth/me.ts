import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import { handleAuthMe } from '#/server/http/auth-http.server'

export const Route = createFileRoute('/api/auth/me')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handleAuthMe(request, {
          db: getDatabase(),
          env: getServerEnv(),
        }),
    },
  },
})
