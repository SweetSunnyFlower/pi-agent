import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { unzipSync } from 'fflate'
import { parse as parseYaml } from 'yaml'

export const MAX_SKILL_PACKAGE_BYTES = 10 * 1024 * 1024
export const MAX_SKILL_PACKAGE_FILES = 500
export const MAX_SKILL_PACKAGE_UNCOMPRESSED_BYTES = 50 * 1024 * 1024

export type SkillPackageFile = {
  path: string
  size: number
  sha256: string
  data: Uint8Array
}

export type ParsedSkillPackage = {
  name: string
  slug: string
  description: string
  content: string
  entrypoint: 'SKILL.md'
  files: SkillPackageFile[]
}

export type InstalledSkillPackage = {
  packagePath: string
  files: Array<Omit<SkillPackageFile, 'data'>>
}

function invalid(message: string): never {
  throw new Error(`invalid skill package: ${message}`)
}

function skillSlug(name: string): string {
  return name
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeArchivePath(value: string): string {
  const path = value.replaceAll('\\', '/')
  if (
    !path ||
    path.startsWith('/') ||
    /^[a-zA-Z]:/.test(path) ||
    path.includes('\0')
  ) {
    invalid(`unsafe path: ${value}`)
  }
  const segments = path
    .split('/')
    .filter((segment) => segment && segment !== '.')
  if (segments.some((segment) => segment === '..')) {
    invalid(`unsafe path: ${value}`)
  }
  if (segments.length === 0) invalid('empty file path')
  return segments.join('/')
}

function ignoredArchivePath(path: string): boolean {
  return (
    path === '.DS_Store' ||
    path.endsWith('/.DS_Store') ||
    path === '__MACOSX' ||
    path.startsWith('__MACOSX/')
  )
}

function parseSkillDocument(source: string): {
  name: string
  description: string
  content: string
} {
  const normalized = source.replace(/^\uFEFF/, '')
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) {
    invalid('SKILL.md must start with YAML frontmatter')
  }
  let frontmatter: unknown
  try {
    frontmatter = parseYaml(match[1])
  } catch {
    invalid('SKILL.md frontmatter is not valid YAML')
  }
  if (!frontmatter || typeof frontmatter !== 'object') {
    invalid('SKILL.md frontmatter must be an object')
  }
  const record = frontmatter as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  const description =
    typeof record.description === 'string' ? record.description.trim() : ''
  const content = match[2].trim()
  if (!description || description.length > 1_024) {
    invalid('description is required and must not exceed 1024 characters')
  }
  if (!name || name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    invalid(
      'name is required and must use lowercase letters, numbers, and hyphens',
    )
  }
  if (!content) {
    invalid('SKILL.md instructions must not be empty')
  }
  return { name, description, content }
}

export function readSkillPackage(archive: Uint8Array): ParsedSkillPackage {
  let fileCount = 0
  let totalSize = 0
  const extracted = unzipSync(archive, {
    filter(file) {
      if (ignoredArchivePath(file.name) || file.name.endsWith('/')) {
        return false
      }
      fileCount += 1
      totalSize += file.originalSize
      if (fileCount > MAX_SKILL_PACKAGE_FILES) {
        invalid(`archive contains more than ${MAX_SKILL_PACKAGE_FILES} files`)
      }
      if (totalSize > MAX_SKILL_PACKAGE_UNCOMPRESSED_BYTES) {
        invalid('archive expands beyond the 50 MB limit')
      }
      return true
    },
  })

  const files = new Map<string, Uint8Array>()
  for (const [rawPath, data] of Object.entries(extracted)) {
    const path = normalizeArchivePath(rawPath)
    if (files.has(path)) invalid(`duplicate path: ${path}`)
    files.set(path, data)
  }
  const skillEntries = [...files.keys()].filter(
    (path) => path.split('/').at(-1) === 'SKILL.md',
  )
  if (skillEntries.length === 0) invalid('SKILL.md is required')
  if (skillEntries.length > 1) invalid('archive must contain one SKILL.md')

  const entryPath = skillEntries[0]
  const root = dirname(entryPath) === '.' ? '' : dirname(entryPath)
  const normalizedFiles: Array<{ path: string; data: Uint8Array }> = []
  for (const [path, data] of files) {
    const relative = root
      ? path.startsWith(`${root}/`)
        ? path.slice(root.length + 1)
        : invalid(`file is outside the skill root: ${path}`)
      : path
    normalizedFiles.push({ path: relative, data })
  }
  const skillFile = normalizedFiles.find((file) => file.path === 'SKILL.md')
  if (!skillFile) invalid('SKILL.md is required')
  let skillDocument: string
  try {
    skillDocument = new TextDecoder('utf-8', { fatal: true }).decode(
      skillFile.data,
    )
  } catch {
    invalid('SKILL.md must be UTF-8 text')
  }
  const document = parseSkillDocument(skillDocument)
  const slug = skillSlug(document.name)
  if (!slug) invalid('name cannot produce a valid storage slug')

  return {
    ...document,
    slug,
    entrypoint: 'SKILL.md',
    files: normalizedFiles
      .sort((left, right) =>
        left.path === 'SKILL.md'
          ? -1
          : right.path === 'SKILL.md'
            ? 1
            : left.path.localeCompare(right.path),
      )
      .map((file) => ({
        path: file.path,
        size: file.data.byteLength,
        sha256: createHash('sha256').update(file.data).digest('hex'),
        data: file.data,
      })),
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function installSkillPackage(
  parsed: ParsedSkillPackage,
  skillsRoot: string,
): Promise<InstalledSkillPackage> {
  const root = resolve(skillsRoot)
  const stagingRoot = join(root, '.staging')
  const destination = join(root, parsed.slug)
  await mkdir(stagingRoot, { recursive: true })
  if (await pathExists(destination)) {
    throw new Error('skill package already exists')
  }
  const staging = await mkdtemp(join(stagingRoot, `${parsed.slug}-`))
  try {
    for (const file of parsed.files) {
      const target = join(staging, ...file.path.split('/'))
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, file.data)
    }
    await rename(staging, destination)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
  return {
    packagePath: parsed.slug,
    files: parsed.files.map(({ data: _data, ...file }) => file),
  }
}

export async function removeInstalledSkillPackage(
  packagePath: string,
  skillsRoot: string,
): Promise<void> {
  await rm(join(resolve(skillsRoot), packagePath), {
    recursive: true,
    force: true,
  })
}
