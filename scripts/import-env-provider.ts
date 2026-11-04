import { and, eq } from 'drizzle-orm'

import { createDatabase } from '../src/db/index'
import { aiProviders } from '../src/db/schema'
import { getServerEnv } from '../src/server/env.server'
import { saveAiProvider } from '../src/server/platform/ai-provider.server'
import {
  ensureDevelopmentSeed,
  INITIAL_WORKSPACE_SLUG,
  resolvePrincipal,
} from '../src/server/platform/workspace-access.server'
import { SecretBox } from '../src/server/secrets/secret-box.server'

const env = getServerEnv()
if (!env.AI_BASE_URL || !env.AI_TOKEN) {
  throw new Error('AI_BASE_URL and AI_TOKEN are required for the import')
}
if (env.AUTH_MODE !== 'development' || !env.DEV_AUTH_USERNAME) {
  throw new Error('import-env-provider requires development authentication')
}

const db = createDatabase(env.APP_DATABASE_PATH)
await ensureDevelopmentSeed(db, env)
const principal = await resolvePrincipal(
  db,
  {
    username: env.DEV_AUTH_USERNAME,
    name: null,
    email: null,
    expiresAt: Date.now() + 60_000,
    authMode: 'development',
  },
  env,
)
if (!principal) throw new Error('development user could not be resolved')
const workspace = principal.workspaces.find(
  (candidate) => candidate.slug === INITIAL_WORKSPACE_SLUG,
)
if (!workspace) throw new Error('development workspace could not be resolved')

const existing = db
  .select()
  .from(aiProviders)
  .where(
    and(
      eq(aiProviders.workspaceId, workspace.workspaceId),
      eq(aiProviders.name, '内部模型网关'),
    ),
  )
  .get()

const provider = await saveAiProvider(
  db,
  principal,
  workspace.workspaceId,
  {
    name: '内部模型网关',
    baseUrl: env.AI_BASE_URL,
    token: env.AI_TOKEN,
    enabled: true,
  },
  new SecretBox(env.CHANNEL_SECRET_KEK),
  existing ? { providerId: existing.id } : { explicitId: 'oneapi-comate' },
)

console.log(
  `provider ${provider.id} is ready in workspace ${workspace.slug} with token ${provider.tokenMasked}`,
)
db.$client.close()
