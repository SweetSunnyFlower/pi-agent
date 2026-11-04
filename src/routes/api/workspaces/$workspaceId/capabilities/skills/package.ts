import { createFileRoute } from '@tanstack/react-router'

import { getDatabase } from '#/db'
import { getServerEnv } from '#/server/env.server'
import { uploadSkillPackageHandler } from '#/server/http/skill-http.server'

export const Route = createFileRoute(
  '/api/workspaces/$workspaceId/capabilities/skills/package',
)({
  server: {
    handlers: {
      POST: ({ request, params }) => {
        const env = getServerEnv()
        return uploadSkillPackageHandler(request, {
          db: getDatabase(),
          env,
          workspaceId: params.workspaceId,
          skillsRoot: env.APP_SKILLS_PATH,
        })
      },
    },
  },
})
