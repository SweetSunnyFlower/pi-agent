// @vitest-environment jsdom

import { cleanup, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AgentRecord } from '#/lib/api/platform-client'
import { renderUi } from '#/test/ui'

import { AgentEditDraftGate } from './agent-edit-draft-gate'

const publishedVersion = {
  id: 'v1',
  versionNumber: 1,
  instructions: 'Published instructions',
  modelProvider: 'oneapi',
  modelId: 'DeepSeek-V4',
  thinkingLevel: 'medium' as const,
  status: 'published' as const,
}

const draftVersion = {
  ...publishedVersion,
  id: 'v2',
  versionNumber: 2,
  status: 'draft' as const,
}

const publishedAgent = {
  id: 'a1',
  workspaceId: 'w1',
  name: 'Reviewer',
  description: '',
  visibility: 'workspace',
  status: 'active',
  currentPublishedVersionId: 'v1',
  createdBy: 'u1',
  versions: [publishedVersion],
} satisfies AgentRecord

function GateHarness({
  initialAgent,
  canEdit = true,
}: {
  initialAgent: AgentRecord
  canEdit?: boolean
}) {
  const [agent, setAgent] = useState(initialAgent)

  async function refreshAgent() {
    setAgent((current) => ({
      ...current,
      status: 'draft',
      versions: [draftVersion, ...current.versions],
    }))
  }

  return (
    <AgentEditDraftGate
      enabled
      canEdit={canEdit}
      workspaceId={agent.workspaceId}
      agent={agent}
      refreshAgent={refreshAgent}
    >
      <div>直接编辑内容</div>
    </AgentEditDraftGate>
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AgentEditDraftGate', () => {
  it('creates an editable draft automatically before rendering the editor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(draftVersion))
    vi.stubGlobal('fetch', fetchMock)

    renderUi(<GateHarness initialAgent={publishedAgent} />)

    expect(
      screen.getByRole('status', { name: '正在加载 Agent 配置' }),
    ).toBeTruthy()
    expect(await screen.findByText('直接编辑内容')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/a1/versions?workspaceId=w1',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('renders the editor immediately when a draft already exists', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderUi(
      <GateHarness
        initialAgent={{
          ...publishedAgent,
          status: 'draft',
          versions: [draftVersion, publishedVersion],
        }}
      />,
    )

    expect(screen.getByText('直接编辑内容')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows a retry action when automatic draft preparation fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network failed'))
    vi.stubGlobal('fetch', fetchMock)

    renderUi(<GateHarness initialAgent={publishedAgent} />)

    expect((await screen.findByRole('alert')).textContent).toContain(
      '无法自动准备编辑草稿',
    )
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
  })
})
