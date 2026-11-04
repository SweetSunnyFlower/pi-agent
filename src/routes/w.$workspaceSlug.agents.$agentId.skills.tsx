import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { AgentPageHeader } from '#/components/agents/agent-page-header'
import { AgentSkillsForm } from '#/components/agents/agent-skills-form'
import { useAgentWorkspace } from '#/components/agents/agent-workspace-context'
import { AgentFormSkeleton } from '#/components/loading/page-skeletons'
import {
  getAgentSkills,
  getAgentVersionSkills,
} from '#/lib/api/platform-client'
import type { SkillCatalogItem } from '#/lib/api/platform-client'
import { agentVersionForMode } from '#/lib/agents/agent-workspace-version'

export const Route = createFileRoute(
  '/w/$workspaceSlug/agents/$agentId/skills',
)({ component: SkillsPage })

function SkillsPage() {
  const { workspace, agent, refreshAgent, mode } = useAgentWorkspace()
  const readOnly = mode === 'view'
  const version = agentVersionForMode(agent, mode)
  const [skills, setSkills] = useState<SkillCatalogItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!version) {
      setSkills(null)
      return
    }
    let active = true
    const request = readOnly
      ? getAgentVersionSkills(workspace.workspaceId, agent.id, version.id)
      : getAgentSkills(workspace.workspaceId, agent.id)
    request
      .then((result) => {
        if (active) setSkills(result)
      })
      .catch(() => {
        if (active) setError('技能目录加载失败，请稍后重试。')
      })
    return () => {
      active = false
    }
  }, [agent.id, readOnly, version, workspace.workspaceId])

  return (
    <section>
      <AgentPageHeader
        eyebrow="04 · 技能"
        title={readOnly ? '已发布的专业技能' : '添加可复用的专业方法'}
        description={
          readOnly
            ? '查看当前发布版本绑定的技能与执行顺序。'
            : '创建或选择版本化技能，并按执行顺序注入 Agent 的系统提示词。'
        }
      />
      {error ? (
        <div role="alert" className="agent-panel p-6 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {!error && version && !skills ? (
        <AgentFormSkeleton variant="skills" />
      ) : null}
      {skills && version ? (
        <AgentSkillsForm
          workspaceId={workspace.workspaceId}
          agentId={agent.id}
          initialSkills={skills}
          onSaved={refreshAgent}
          readOnly={readOnly}
        />
      ) : null}
      {!version ? (
        <div className="agent-panel p-6 text-sm text-[var(--sea-ink-soft)]">
          {readOnly
            ? '该 Agent 尚未发布，暂无可查看的技能配置。'
            : '当前 Agent 没有可编辑的草稿版本。'}
        </div>
      ) : null}
    </section>
  )
}
