export type AgentManifestCapability = {
  runtimeName: string
  kind: 'tool' | 'skill'
  version: string
}

export type AgentManifest = {
  capabilities?: AgentManifestCapability[]
}

export function capabilityCounts(manifest?: AgentManifest) {
  const capabilities = manifest?.capabilities ?? []
  return {
    tools: capabilities.filter((capability) => capability.kind === 'tool')
      .length,
    skills: capabilities.filter((capability) => capability.kind === 'skill')
      .length,
  }
}

export function channelLabel(channels: Array<'web' | 'infoflow'>) {
  return channels.includes('infoflow') ? 'Web + 如流' : 'Web 默认'
}
