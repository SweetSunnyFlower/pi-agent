export type AgentSectionId =
  'basic' | 'prompt' | 'tools' | 'skills' | 'channels' | 'publish' | 'chat'

export type AgentWorkspaceMode = 'view' | 'edit'

export const agentSections = [
  { id: 'basic', label: '基本信息' },
  { id: 'prompt', label: '提示词与模型' },
  { id: 'tools', label: '工具' },
  { id: 'skills', label: '技能' },
  { id: 'channels', label: '渠道' },
  { id: 'publish', label: '检查与发布' },
  { id: 'chat', label: '开始对话' },
] as const satisfies readonly {
  id: AgentSectionId
  label: string
}[]

const viewSections = agentSections.filter((section) => section.id !== 'publish')
const editSections = agentSections.filter((section) => section.id !== 'chat')

export function agentSectionsForMode(mode: AgentWorkspaceMode) {
  return mode === 'view' ? viewSections : editSections
}

export function parseAgentWorkspaceMode(
  search: unknown,
  fallback: AgentWorkspaceMode = 'edit',
): AgentWorkspaceMode {
  if (typeof search === 'string') {
    const value = new URLSearchParams(
      search.startsWith('?') ? search : `?${search}`,
    ).get('mode')
    return value === 'view' ? 'view' : value === 'edit' ? 'edit' : fallback
  }
  if (search && typeof search === 'object' && 'mode' in search) {
    const value = (search as { mode?: unknown }).mode
    return value === 'view' ? 'view' : value === 'edit' ? 'edit' : fallback
  }
  return fallback
}

export function agentSectionHref(
  workspaceSlug: string,
  agentId: string,
  section: AgentSectionId,
  mode: AgentWorkspaceMode = 'edit',
): string {
  return `/w/${encodeURIComponent(workspaceSlug)}/agents/${encodeURIComponent(agentId)}/${section}?mode=${mode}`
}
