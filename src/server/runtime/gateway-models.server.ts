import { createModels, createProvider } from '@earendil-works/pi-ai'
import type { Model, MutableModels } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import {
  fetchAiProviderModels,
  openAiProviderToken,
} from '#/server/platform/ai-provider.server'
import type {
  AiProviderRow,
  ProviderModelFetch,
} from '#/server/platform/ai-provider.server'
import { modelSupportsImageInput } from '#/lib/agents/model-capabilities'
import type { SecretBox } from '#/server/secrets/secret-box.server'

function modelFor(
  id: string,
  provider: string,
  baseUrl: string,
): Model<'openai-completions'> {
  return {
    id,
    name: id,
    api: 'openai-completions',
    provider,
    baseUrl,
    reasoning: true,
    input: modelSupportsImageInput(id) ? ['text', 'image'] : ['text'],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 128_000,
    maxTokens: 32_000,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStrictMode: false,
      supportsUsageInStreaming: true,
    },
  }
}

export async function createProviderModels(
  providers: readonly AiProviderRow[],
  box: SecretBox,
  fetchModels: ProviderModelFetch = fetch,
): Promise<MutableModels> {
  const models = createModels()
  await syncProviderModels(models, providers, box, fetchModels)
  return models
}

export async function syncProviderModels(
  target: MutableModels,
  providers: readonly AiProviderRow[],
  box: SecretBox,
  fetchModels: ProviderModelFetch = fetch,
): Promise<void> {
  const built = await Promise.all(
    providers.map(async (provider) => {
      try {
        const modelIds = await fetchAiProviderModels(provider, box, fetchModels)
        return createProvider({
          id: provider.id,
          name: provider.name,
          baseUrl: provider.baseUrl,
          auth: {
            apiKey: {
              name: provider.name,
              resolve: async () => ({
                auth: { apiKey: openAiProviderToken(provider, box) },
                source: 'database',
              }),
            },
          },
          models: modelIds.map((id) =>
            modelFor(id, provider.id, provider.baseUrl),
          ),
          api: openAICompletionsApi(),
        })
      } catch {
        return null
      }
    }),
  )

  target.clearProviders()
  for (const provider of built) {
    if (provider) target.setProvider(provider)
  }
}
