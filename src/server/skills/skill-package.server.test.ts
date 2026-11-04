import { zipSync, strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'

import { readSkillPackage } from './skill-package.server'

function zip(files: Record<string, string>): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([path, content]) => [path, strToU8(content)]),
    ),
  )
}

describe('Skill ZIP package', () => {
  it('reads a package with SKILL.md at the archive root', () => {
    const parsed = readSkillPackage(
      zip({
        'SKILL.md': [
          '---',
          'name: security-review',
          'description: Review changes for security risks.',
          '---',
          '',
          '# Security review',
          '',
          'Check authorization boundaries.',
        ].join('\n'),
        'references/checklist.md': '- Verify ownership',
      }),
    )

    expect(parsed).toMatchObject({
      name: 'security-review',
      slug: 'security-review',
      description: 'Review changes for security risks.',
      content: expect.stringContaining('Check authorization boundaries.'),
      entrypoint: 'SKILL.md',
    })
    expect(parsed.files.map((file) => file.path)).toEqual([
      'SKILL.md',
      'references/checklist.md',
    ])
  })

  it('normalizes a package wrapped in one top-level directory', () => {
    const parsed = readSkillPackage(
      zip({
        'security-review/SKILL.md': [
          '---',
          'name: security-review',
          'description: Review security.',
          '---',
          '',
          'Review security.',
        ].join('\n'),
        'security-review/scripts/check.sh': '#!/bin/sh\n',
      }),
    )

    expect(parsed.files.map((file) => file.path)).toEqual([
      'SKILL.md',
      'scripts/check.sh',
    ])
  })

  it('rejects an archive without SKILL.md', () => {
    expect(() =>
      readSkillPackage(zip({ 'README.md': 'Missing entrypoint' })),
    ).toThrow(/SKILL\.md/)
  })

  it('rejects invalid frontmatter and missing descriptions', () => {
    expect(() =>
      readSkillPackage(
        zip({
          'SKILL.md': ['---', 'name: Security Review', '---', '', 'Body'].join(
            '\n',
          ),
        }),
      ),
    ).toThrow(/description/)
  })

  it('rejects path traversal entries', () => {
    expect(() =>
      readSkillPackage(
        zip({
          'SKILL.md': [
            '---',
            'name: security-review',
            'description: Review security.',
            '---',
            '',
            'Review security.',
          ].join('\n'),
          '../secret.txt': 'do not write outside the package',
        }),
      ),
    ).toThrow(/unsafe path/i)
  })
})
