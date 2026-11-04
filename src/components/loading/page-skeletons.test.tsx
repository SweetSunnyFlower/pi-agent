// @vitest-environment jsdom

import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { renderUi } from '#/test/ui'

import {
  AgentCardGridSkeleton,
  AgentFormSkeleton,
  AgentWorkspaceShellSkeleton,
  ChatLoadingSkeleton,
  ConversationHistorySkeleton,
  CreateAgentPageSkeleton,
  HomePageSkeleton,
  ProviderListSkeleton,
  ProviderPageSkeleton,
} from './page-skeletons'

afterEach(cleanup)

describe('page skeletons', () => {
  it.each([
    [<HomePageSkeleton />, '正在加载工作区'],
    [<CreateAgentPageSkeleton />, '正在加载创建表单'],
    [<ProviderPageSkeleton />, '正在加载供应商页面'],
    [<ProviderListSkeleton />, '正在加载供应商'],
    [<AgentWorkspaceShellSkeleton />, '正在加载 Agent 工作区'],
    [<ChatLoadingSkeleton />, '正在加载对话'],
    [<ConversationHistorySkeleton />, '正在加载历史对话'],
  ])('exposes an accessible loading status', (ui, label) => {
    renderUi(ui)
    expect(screen.getByRole('status', { name: label })).toBeTruthy()
    cleanup()
  })

  it('supports every Agent form variant', () => {
    renderUi(
      <>
        {(['prompt', 'tools', 'skills', 'channels', 'publish'] as const).map(
          (variant) => (
            <AgentFormSkeleton key={variant} variant={variant} />
          ),
        )}
      </>,
    )

    expect(screen.getAllByRole('status')).toHaveLength(5)
  })

  it('renders the requested number of Agent card placeholders', () => {
    renderUi(<AgentCardGridSkeleton count={4} />)

    expect(screen.getByRole('status', { name: '正在加载 Agent' })).toBeTruthy()
    expect(document.querySelectorAll('[data-skeleton-card]')).toHaveLength(4)
  })

  it('preserves the Agent three-column layout while loading', () => {
    renderUi(<AgentWorkspaceShellSkeleton />)

    expect(document.querySelector('.agent-workspace-grid')).toBeTruthy()
    expect(document.querySelector('.agent-rail')).toBeTruthy()
    expect(document.querySelector('.agent-status-rail')).toBeTruthy()
  })
})
