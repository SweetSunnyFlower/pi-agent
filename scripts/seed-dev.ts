import { config } from 'dotenv'

import { createDatabase } from '../src/db/index'
import { getServerEnv } from '../src/server/env.server'
import {
  ensureDevelopmentSeed,
  INITIAL_WORKSPACE_NAME,
  INITIAL_WORKSPACE_SLUG,
} from '../src/server/platform/workspace-access.server'

config({ path: ['.env.local', '.env'] })

const env = getServerEnv()
if (env.AUTH_MODE !== 'development') {
  throw new Error('dev:seed requires AUTH_MODE=development')
}

const db = createDatabase(env.APP_DATABASE_PATH)
try {
  await ensureDevelopmentSeed(db, env)
  console.log(
    `development user ${env.DEV_AUTH_USERNAME} is ready in workspace ${INITIAL_WORKSPACE_SLUG} (${INITIAL_WORKSPACE_NAME})`,
  )
} finally {
  db.$client.close()
}
