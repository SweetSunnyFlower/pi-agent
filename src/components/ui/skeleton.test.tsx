// @vitest-environment jsdom

import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { renderUi } from '#/test/ui'

import { LoadingRegion } from '../loading/loading-region'
import { Skeleton } from './skeleton'

afterEach(cleanup)

describe('Skeleton', () => {
  it('renders an accessible loading region with decorative placeholders', () => {
    renderUi(
      <LoadingRegion label="正在加载测试内容">
        <Skeleton data-testid="skeleton-line" className="h-4 w-24" />
      </LoadingRegion>,
    )

    const region = screen.getByRole('status', {
      name: '正在加载测试内容',
    })
    expect(region.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByText('正在加载测试内容')).toBeTruthy()
    expect(
      screen.getByTestId('skeleton-line').getAttribute('aria-hidden'),
    ).toBe('true')
  })
})
