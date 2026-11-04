import { getDatabase } from '../src/db/index'
import { getServerEnv } from '../src/server/env.server'
import { listEnabledAiProviders } from '../src/server/platform/ai-provider.server'
import { createProviderModels } from '../src/server/runtime/gateway-models.server'
import { SecretBox } from '../src/server/secrets/secret-box.server'

const env = getServerEnv()
const db = getDatabase()
const models = await createProviderModels(
  await listEnabledAiProviders(db),
  new SecretBox(env.CHANNEL_SECRET_KEK),
)
const availableModels = models.getModels()
if (availableModels.length === 0) {
  throw new Error('Pi provider models are not available')
}
const model =
  availableModels.find((candidate) => candidate.id === 'DeepSeek-V4-Pro') ??
  availableModels[0]

const answer = await models.complete(model, {
  messages: [
    {
      role: 'user',
      content: '请只回复：PI_OK',
      timestamp: Date.now(),
    },
  ],
})

console.log(
  JSON.stringify({
    model: model.id,
    stopReason: answer.stopReason,
    text: answer.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(''),
  }),
)
db.$client.close()
