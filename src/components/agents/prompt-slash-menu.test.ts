import { describe, expect, it } from 'vitest'

import { filterSlashMenuItems } from './prompt-slash-menu'

describe('filterSlashMenuItems', () => {
  it('finds blocks with Chinese and English aliases', () => {
    expect(filterSlashMenuItems('标题').map((item) => item.id)).toEqual([
      'heading-1',
      'heading-2',
      'heading-3',
    ])
    expect(filterSlashMenuItems('h2').map((item) => item.id)).toEqual([
      'heading-2',
    ])
    expect(filterSlashMenuItems('代码').map((item) => item.id)).toEqual([
      'code-block',
    ])
  })

  it('returns every available block for an empty query', () => {
    expect(filterSlashMenuItems('  ')).toHaveLength(9)
  })

  it('returns no blocks for an unknown query', () => {
    expect(filterSlashMenuItems('不存在的块')).toEqual([])
  })
})
