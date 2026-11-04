// @vitest-environment jsdom

import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderUi } from '#/test/ui'

import { AgentSkillsForm } from './agent-skills-form'

const securitySkill = {
  id: 'skill-1',
  versionId: 'skill-version-1',
  name: 'Security review',
  description: 'Check security boundaries.',
  source: 'workspace' as const,
  version: '1.0.0',
  runtimeName: 'platform.skill.workspace.security-review@1.0.0',
  content: 'Review authorization boundaries.',
  selected: true,
  sortOrder: 0,
}

const riskSkill = {
  id: 'skill-2',
  versionId: 'skill-version-2',
  name: 'Risk review',
  description: 'Check delivery risks.',
  source: 'workspace' as const,
  version: '1.0.0',
  runtimeName: 'platform.skill.workspace.risk-review@1.0.0',
  content: 'List blocking risks and owners.',
  selected: false,
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AgentSkillsForm', () => {
  it('shows the published Skill order without editing controls', () => {
    renderUi(
      <AgentSkillsForm
        workspaceId="w1"
        agentId="a1"
        initialSkills={[securitySkill, riskSkill]}
        readOnly
      />,
    )

    expect(screen.getAllByText('Security review').length).toBeGreaterThan(0)
    expect(screen.queryByText('Risk review')).toBeNull()
    expect(screen.queryByRole('button', { name: '添加技能' })).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('button', { name: '保存技能配置' })).toBeNull()
    expect(
      screen.queryByRole('button', { name: '上移 Security review' }),
    ).toBeNull()
  })

  it('saves the selected Skill order', async () => {
    const ordered = [
      { ...riskSkill, selected: true, sortOrder: 0 },
      { ...securitySkill, selected: true, sortOrder: 1 },
    ]
    const fetchMock = vi.fn().mockResolvedValue(Response.json(ordered))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentSkillsForm
        workspaceId="w1"
        agentId="a1"
        initialSkills={[securitySkill, riskSkill]}
      />,
    )

    await user.click(screen.getByRole('switch', { name: '启用 Risk review' }))
    await user.click(screen.getByRole('button', { name: '上移 Risk review' }))
    await user.click(screen.getByRole('button', { name: '保存技能配置' }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/draft/skills?workspaceId=w1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          capabilityVersionIds: ['skill-version-2', 'skill-version-1'],
        }),
      }),
    )
    expect(screen.getByText('技能配置已保存')).toBeTruthy()
  })

  it('uploads a Skill ZIP package', async () => {
    const created = {
      ...riskSkill,
      id: 'skill-3',
      versionId: 'skill-version-3',
      name: 'Release review',
      runtimeName: 'platform.skill.workspace.release-review@1.0.0',
    }
    const fetchMock = vi.fn().mockResolvedValue(Response.json(created))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentSkillsForm workspaceId="w1" agentId="a1" initialSkills={[]} />,
    )

    await user.click(screen.getByRole('button', { name: '添加技能' }))
    await user.upload(
      screen.getByLabelText('选择 Skill ZIP 包'),
      new File(['zip-data'], 'release-review.zip', {
        type: 'application/zip',
      }),
    )
    await user.click(screen.getByRole('button', { name: '上传并校验' }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/w1/capabilities/skills/package',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
      }),
    )
    expect(await screen.findByText('Release review')).toBeTruthy()
  })

  it('deletes a workspace Skill after confirmation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([]))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderUi(
      <AgentSkillsForm
        workspaceId="w1"
        agentId="a1"
        initialSkills={[securitySkill]}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: '删除 Security review' }),
    )
    expect(
      await screen.findByRole('heading', { name: '删除技能？' }),
    ).toBeTruthy()
    expect(document.querySelector('.agent-alert-dialog-content')).toBeTruthy()
    expect(document.querySelector('.agent-dialog-content')).toBeNull()
    await user.click(screen.getByRole('button', { name: '确认删除' }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/draft/skills/skill-version-1?workspaceId=w1',
      expect.objectContaining({ method: 'DELETE' }),
    )
    await waitFor(() =>
      expect(screen.queryByText('Security review')).toBeNull(),
    )
    expect(screen.getByText('技能配置已保存')).toBeTruthy()
  })
})
