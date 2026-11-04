import { parseArgs } from 'node:util'

import { config } from 'dotenv'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import { createDatabase } from '../src/db/index'
import { getServerEnv } from '../src/server/env.server'
import {
  createWorkspace,
  INITIAL_WORKSPACE_NAME,
  INITIAL_WORKSPACE_SLUG,
} from '../src/server/platform/workspace-access.server'

config({ path: ['.env.local', '.env'] })

const { values } = parseArgs({
  options: {
    slug: { type: 'string', default: INITIAL_WORKSPACE_SLUG },
    name: { type: 'string', default: INITIAL_WORKSPACE_NAME },
    'admin-username': { type: 'string' },
    'rename-from': { type: 'string' },
  },
})

const env = getServerEnv()
const adminUsername = values['admin-username'] ?? env.DEV_AUTH_USERNAME
if (!adminUsername) {
  throw new Error(
    'workspace admin username is required; pass --admin-username or set DEV_AUTH_USERNAME',
  )
}

const db = createDatabase(env.APP_DATABASE_PATH)
try {
  migrate(db, { migrationsFolder: './drizzle' })
  const workspace = createWorkspace(db, {
    slug: values.slug,
    name: values.name,
    adminUsername,
    renameFromSlug: values['rename-from'],
  })
  console.log(
    `workspace ${workspace.slug} (${workspace.name}) is ready for ${workspace.username}`,
  )
} finally {
  db.$client.close()
}
