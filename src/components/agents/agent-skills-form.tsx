import {
  ArrowDown,
  ArrowUp,
  Check,
  FileArchive,
  FileText,
  LoaderCircle,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { Button } from '#/components/ui/button'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { Input } from '#/components/ui/input'
import { Switch } from '#/components/ui/switch'
import {
  ApiError,
  deleteAgentCapabilityRequest,
  replaceAgentSkillsRequest,
  uploadSkillPackageRequest,
} from '#/lib/api/platform-client'
import type { SkillCatalogItem } from '#/lib/api/platform-client'
import { cn } from '#/lib/utils'

type SkillFilter = 'all' | SkillCatalogItem['source']

const sourceLabels: Record<SkillCatalogItem['source'], string> = {
  builtin: '内置',
  workspace: '自定义',
}

export function AgentSkillsForm({
  workspaceId,
  agentId,
  initialSkills,
  onSaved,
  readOnly = false,
}: {
  workspaceId: string
  agentId: string
  initialSkills: SkillCatalogItem[]
  onSaved?: () => void | Promise<void>
  readOnly?: boolean
}) {
  const [skills, setSkills] = useState(initialSkills)
  const [selectedOrder, setSelectedOrder] = useState(() =>
    initialSkills
      .filter((skill) => skill.selected)
      .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
      .map((skill) => skill.versionId),
  )
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SkillFilter>('all')
  const [creatorOpen, setCreatorOpen] = useState(false)
  const [packageFile, setPackageFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [deletingSkill, setDeletingSkill] = useState<SkillCatalogItem | null>(
    null,
  )
  const [deleting, setDeleting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filteredSkills = useMemo(() => {
    if (readOnly) return skills.filter((skill) => skill.selected)
    const normalized = query.trim().toLocaleLowerCase()
    return skills.filter((skill) => {
      if (filter !== 'all' && skill.source !== filter) return false
      if (!normalized) return true
      return [
        skill.name,
        skill.description,
        skill.content,
        ...(skill.files?.map((file) => file.path) ?? []),
      ]
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalized)
    })
  }, [filter, query, readOnly, skills])

  const selectedSkills = selectedOrder
    .map((versionId) => skills.find((skill) => skill.versionId === versionId))
    .filter((skill): skill is SkillCatalogItem => Boolean(skill))

  function toggleSkill(versionId: string, enabled: boolean) {
    setSelectedOrder((current) => {
      if (enabled) {
        return current.includes(versionId) ? current : [...current, versionId]
      }
      return current.filter((id) => id !== versionId)
    })
    setSaved(false)
  }

  function moveSkill(index: number, direction: -1 | 1) {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= selectedOrder.length) return
    setSelectedOrder((current) => {
      const next = [...current]
      ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
      return next
    })
    setSaved(false)
  }

  async function uploadPackage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!packageFile) {
      setError('请先选择 Skill ZIP 包。')
      return
    }
    if (
      !packageFile.name.toLocaleLowerCase().endsWith('.zip') ||
      packageFile.size > 10 * 1024 * 1024
    ) {
      setError('仅支持不超过 10 MB 的 .zip 文件。')
      return
    }
    setUploading(true)
    setError(null)
    try {
      const created = await uploadSkillPackageRequest(workspaceId, packageFile)
      setSkills((current) => [created, ...current])
      setCreatorOpen(false)
      setPackageFile(null)
    } catch (uploadError) {
      setError(
        uploadError instanceof ApiError
          ? (uploadError.detail ?? 'Skill 包校验或安装失败。')
          : 'Skill 包上传失败，请稍后重试。',
      )
    } finally {
      setUploading(false)
    }
  }

  async function saveSkills(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const updated = await replaceAgentSkillsRequest(
        workspaceId,
        agentId,
        selectedOrder,
      )
      setSkills(updated)
      setSelectedOrder(
        updated
          .filter((skill) => skill.selected)
          .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
          .map((skill) => skill.versionId),
      )
      setSaved(true)
      void onSaved?.()
    } catch {
      setError('技能配置保存失败，请检查权限后重试。')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDeleteSkill() {
    if (!deletingSkill || deleting) return
    setDeleting(true)
    setError(null)
    try {
      const updated = await deleteAgentCapabilityRequest(
        workspaceId,
        agentId,
        'skill',
        deletingSkill.versionId,
      )
      setSkills(updated)
      setSelectedOrder(
        updated
          .filter((skill) => skill.selected)
          .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
          .map((skill) => skill.versionId),
      )
      setDeletingSkill(null)
      setSaved(true)
      void onSaved?.()
    } catch {
      setError('技能删除失败，请检查权限后重试。')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="grid gap-5">
      <section className="agent-panel p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">技能目录</h2>
              <span className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2 py-0.5 font-mono text-[9px] text-[var(--sea-ink-soft)]">
                已启用 {selectedOrder.length}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-[var(--sea-ink-soft)]">
              上传或选择版本化技能，并按下方顺序加入平台安全规则之后、Agent
              提示词之前。
            </p>
          </div>
          {!readOnly ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setCreatorOpen((current) => !current)
                setError(null)
              }}
            >
              {creatorOpen ? (
                <X aria-hidden="true" />
              ) : (
                <Plus aria-hidden="true" />
              )}
              {creatorOpen ? '取消添加' : '添加技能'}
            </Button>
          ) : null}
        </div>

        {!readOnly ? (
          <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[var(--sea-ink-soft)]"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="搜索技能"
                placeholder="搜索名称、描述或 Prompt 内容"
                className="h-9 pl-9"
              />
            </div>
            <div className="flex gap-1.5" aria-label="技能来源筛选">
              {[
                { value: 'all' as const, label: '全部' },
                { value: 'workspace' as const, label: '自定义' },
                { value: 'builtin' as const, label: '内置' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={filter === option.value}
                  onClick={() => setFilter(option.value)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                    filter === option.value
                      ? 'border-[var(--lagoon-deep)] bg-[var(--lagoon)]/12 text-[var(--sea-ink)]'
                      : 'border-[var(--line)] bg-white/30 text-[var(--sea-ink-soft)] hover:bg-white/60',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {!readOnly && creatorOpen ? (
        <form onSubmit={uploadPackage} className="agent-panel p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--lagoon-deep)]">
              <Sparkles aria-hidden="true" className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">上传 Skill ZIP 包</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--sea-ink-soft)]">
                上传后会先解压并校验格式，通过后才安装到平台 Skill 目录。
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-dashed border-[var(--chip-line)] bg-[var(--chip-bg)]/45 p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-[var(--chip-line)] bg-white/60 text-[var(--lagoon-deep)]">
                <FileArchive aria-hidden="true" className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <label
                  htmlFor="skill-package-file"
                  className="text-xs font-semibold"
                >
                  Skill ZIP 包
                </label>
                <p className="mt-1 text-[10px] leading-4 text-[var(--sea-ink-soft)]">
                  包内必须包含唯一的 SKILL.md，支持根目录或单一顶层目录。
                </p>
                <input
                  id="skill-package-file"
                  aria-label="选择 Skill ZIP 包"
                  type="file"
                  accept=".zip,application/zip,application/x-zip-compressed"
                  disabled={uploading}
                  onChange={(event) =>
                    setPackageFile(event.target.files?.[0] ?? null)
                  }
                  className="mt-3 block w-full cursor-pointer rounded-lg border border-[var(--line)] bg-white/70 text-xs file:mr-3 file:border-0 file:bg-[var(--sea-ink)] file:px-3 file:py-2 file:text-white"
                />
                {packageFile ? (
                  <p className="mt-2 font-mono text-[10px] text-[var(--sea-ink-soft)]">
                    {packageFile.name} · {(packageFile.size / 1024).toFixed(1)}{' '}
                    KB
                  </p>
                ) : null}
              </div>
            </div>
            <ul className="mt-4 grid gap-1 text-[10px] leading-4 text-[var(--sea-ink-soft)]">
              <li>• 必填 frontmatter：name、description</li>
              <li>• SKILL.md 正文不能为空</li>
              <li>• 最多 500 个文件，解压后不超过 50 MB</li>
              <li>• 禁止绝对路径和 .. 路径穿越</li>
            </ul>
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              type="submit"
              size="sm"
              disabled={!packageFile || uploading}
            >
              {uploading ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : (
                <Upload aria-hidden="true" />
              )}
              {uploading ? '上传并校验中…' : '上传并校验'}
            </Button>
          </div>
        </form>
      ) : null}

      {selectedSkills.length > 0 ? (
        <section className="agent-panel p-5 sm:p-6">
          <div>
            <h2 className="text-sm font-semibold">执行顺序</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--sea-ink-soft)]">
              越靠前的技能越早加入系统提示词。
            </p>
          </div>
          <ol className="mt-4 grid gap-2">
            {selectedSkills.map((skill, index) => (
              <li
                key={skill.versionId}
                className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-white/35 px-3 py-2"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] font-mono text-[10px]">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                  {skill.name}
                </span>
                {!readOnly ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`上移 ${skill.name}`}
                      disabled={index === 0}
                      onClick={() => moveSkill(index, -1)}
                    >
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`下移 ${skill.name}`}
                      disabled={index === selectedSkills.length - 1}
                      onClick={() => moveSkill(index, 1)}
                    >
                      <ArrowDown aria-hidden="true" />
                    </Button>
                  </>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {filteredSkills.length > 0 ? (
        <div className="grid gap-3">
          {filteredSkills.map((skill) => {
            const checked = selectedOrder.includes(skill.versionId)
            return (
              <article
                key={skill.versionId}
                className={cn(
                  'agent-panel p-5 transition-colors',
                  checked &&
                    'border-[var(--lagoon-deep)] bg-[color-mix(in_oklab,var(--lagoon)_8%,var(--surface-strong))]',
                )}
              >
                <div className="flex items-start gap-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--lagoon-deep)]">
                    <FileText aria-hidden="true" className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold">{skill.name}</h3>
                      <span className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2 py-0.5 font-mono text-[9px] text-[var(--kicker)]">
                        {sourceLabels[skill.source]} · v{skill.version}
                      </span>
                      {skill.files ? (
                        <span className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2 py-0.5 font-mono text-[9px] text-[var(--sea-ink-soft)]">
                          {skill.files.length} 个文件
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1.5 text-xs leading-5 text-[var(--sea-ink-soft)]">
                      {skill.description || '尚未填写技能描述。'}
                    </p>
                    <details className="mt-3 text-xs">
                      <summary className="cursor-pointer font-semibold text-[var(--lagoon-deep)]">
                        查看 SKILL.md
                      </summary>
                      <pre className="mt-2 max-h-56 overflow-auto rounded-lg border border-[var(--line)] bg-white/35 p-3 font-sans text-xs leading-5 whitespace-pre-wrap">
                        {skill.content}
                      </pre>
                    </details>
                  </div>
                  {readOnly ? (
                    <span className="shrink-0 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2.5 py-1 text-[9px] font-semibold text-[var(--palm)]">
                      已启用
                    </span>
                  ) : (
                    <div className="flex shrink-0 items-center gap-1">
                      {skill.source === 'workspace' ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`删除 ${skill.name}`}
                          onClick={() => setDeletingSkill(skill)}
                        >
                          <Trash2
                            aria-hidden="true"
                            className="text-destructive"
                          />
                        </Button>
                      ) : null}
                      <Switch
                        checked={checked}
                        onCheckedChange={(enabled) =>
                          toggleSkill(skill.versionId, enabled)
                        }
                        aria-label={`启用 ${skill.name}`}
                      />
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <section className="agent-panel flex min-h-52 flex-col items-center justify-center px-6 py-10 text-center">
          <span className="grid size-11 place-items-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--lagoon-deep)]">
            <Sparkles aria-hidden="true" className="size-5" />
          </span>
          <h2 className="mt-4 text-sm font-semibold">
            {readOnly
              ? '当前版本没有启用技能'
              : skills.length === 0
                ? '还没有技能定义'
                : '没有匹配的技能'}
          </h2>
          <p className="mt-1 max-w-md text-xs leading-5 text-[var(--sea-ink-soft)]">
            {readOnly
              ? '发布版本未绑定任何技能。'
              : skills.length === 0
                ? '上传一个标准 Skill ZIP 包，再选择是否加入当前 Agent。'
                : '尝试更换关键词或来源筛选。'}
          </p>
          {!readOnly && skills.length === 0 && !creatorOpen ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-4"
              onClick={() => setCreatorOpen(true)}
            >
              <Plus aria-hidden="true" />
              上传第一个技能
            </Button>
          ) : null}
        </section>
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {!readOnly ? (
        <form
          onSubmit={saveSkills}
          className="flex items-center justify-end gap-3"
        >
          {saved ? (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--palm)]"
            >
              <Check aria-hidden="true" className="size-3.5" />
              技能配置已保存
            </span>
          ) : null}
          <Button type="submit" disabled={saving}>
            {saving ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : null}
            {saving ? '保存中…' : '保存技能配置'}
          </Button>
        </form>
      ) : null}

      <AlertDialog
        open={Boolean(deletingSkill)}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeletingSkill(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除技能？</AlertDialogTitle>
            <AlertDialogDescription>
              “{deletingSkill?.name}”会从技能目录和所有 Agent
              草稿中移除。已发布版本和旧对话仍保留原技能版本。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={deleting}
              onClick={() => setDeletingSkill(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={() => void confirmDeleteSkill()}
            >
              {deleting ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : (
                <Trash2 aria-hidden="true" />
              )}
              确认删除
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
