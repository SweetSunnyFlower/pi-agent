import { Check, ChevronDown, ImageIcon, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { updateAgentDraftRequest } from '#/lib/api/platform-client'
import type { ModelOption, AgentVersionRecord } from '#/lib/api/platform-client'
import { modelSupportsImageInput } from '#/lib/agents/model-capabilities'
import { cn } from '#/lib/utils'
import { PromptRichEditor } from './prompt-rich-editor'

type ThinkingLevel = AgentVersionRecord['thinkingLevel']

const thinkingLevels: Array<{
  value: ThinkingLevel
  label: string
  copy: string
}> = [
  { value: 'off', label: '关闭', copy: '直接回答' },
  { value: 'minimal', label: '极简', copy: '轻量思考' },
  { value: 'low', label: '低', copy: '快速推理' },
  { value: 'medium', label: '中等', copy: '平衡速度与质量' },
  { value: 'high', label: '高', copy: '深入推理' },
]

export function AgentPromptForm({
  workspaceId,
  agentId,
  initialInstructions,
  initialProvider,
  initialModelId,
  initialThinkingLevel,
  modelOptions,
  readOnly = false,
  onSaved,
}: {
  workspaceId: string
  agentId: string
  initialInstructions: string
  initialProvider?: string
  initialModelId?: string
  initialThinkingLevel: ThinkingLevel
  modelOptions: ModelOption[]
  readOnly?: boolean
  onSaved?: () => void | Promise<void>
}) {
  const savedModel =
    initialProvider && initialModelId
      ? {
          provider: initialProvider,
          providerLabel: '当前已保存',
          modelId: initialModelId,
          baseUrl: '',
        }
      : undefined
  const availableModels =
    savedModel &&
    !modelOptions.some(
      (model) =>
        model.provider === savedModel.provider &&
        model.modelId === savedModel.modelId,
    )
      ? [savedModel, ...modelOptions]
      : modelOptions
  const initialModel =
    availableModels.find(
      (model) =>
        model.provider === initialProvider && model.modelId === initialModelId,
    ) ?? availableModels.at(0)
  const [instructions, setInstructions] = useState(initialInstructions)
  const [selectedModel, setSelectedModel] = useState(initialModel)
  const [thinkingLevel, setThinkingLevel] =
    useState<ThinkingLevel>(initialThinkingLevel)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const providerGroups = Array.from(
    availableModels
      .reduce(
        (groups, model) => {
          const group = groups.get(model.provider) ?? {
            provider: model.provider,
            providerLabel: model.providerLabel,
            baseUrl: model.baseUrl,
            models: [],
          }
          group.models.push(model)
          groups.set(model.provider, group)
          return groups
        },
        new Map<
          string,
          {
            provider: string
            providerLabel: string
            baseUrl: string
            models: ModelOption[]
          }
        >(),
      )
      .values(),
  )

  function selectModel(model: ModelOption) {
    setSelectedModel(model)
    setSaved(false)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!instructions.trim()) {
      setError('请填写提示词。')
      return
    }
    if (!selectedModel) {
      setError('当前没有可用的模型配置。')
      return
    }

    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      await updateAgentDraftRequest(workspaceId, agentId, {
        instructions: instructions.trim(),
        modelProvider: selectedModel.provider,
        modelId: selectedModel.modelId,
        thinkingLevel,
      })
      setSaved(true)
      void onSaved?.()
    } catch {
      setError('保存失败，请检查权限后重试。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="grid gap-6">
      <section className="agent-panel p-6 sm:p-8">
        <div className="grid gap-3">
          <span className="text-sm font-semibold">提示词</span>
          <p className="text-xs leading-5 text-[var(--sea-ink-soft)]">
            提示词会追加在平台安全规则和已选技能之后，用于定义 Agent
            的角色、目标和行为边界。
          </p>
          <PromptRichEditor
            value={instructions}
            readOnly={readOnly}
            onChange={(markdown) => {
              setInstructions(markdown)
              setSaved(false)
            }}
          />
        </div>
      </section>

      <section className="agent-panel p-6 sm:p-8">
        <div className="grid gap-6">
          <div className="grid gap-2">
            <label htmlFor="agent-model" className="text-sm font-semibold">
              模型
            </label>
            {availableModels.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    id="agent-model"
                    type="button"
                    variant="outline"
                    disabled={readOnly}
                    className="h-10 w-full justify-between bg-transparent px-3 text-left font-normal"
                    aria-label={
                      selectedModel
                        ? `模型：${selectedModel.providerLabel} ${selectedModel.modelId}`
                        : '模型'
                    }
                  >
                    <span className="min-w-0 truncate">
                      {selectedModel
                        ? `${selectedModel.providerLabel} · ${selectedModel.modelId}`
                        : '选择模型'}
                    </span>
                    {selectedModel &&
                    modelSupportsImageInput(selectedModel.modelId) ? (
                      <ImageIcon
                        aria-label="支持图片"
                        className="size-4 shrink-0 text-[var(--lagoon-deep)]"
                      />
                    ) : null}
                    <ChevronDown
                      aria-hidden="true"
                      className="size-4 shrink-0 opacity-55"
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="max-h-[min(28rem,65vh)] w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
                >
                  <DropdownMenuLabel>按供应商选择模型</DropdownMenuLabel>
                  {providerGroups.map((group) => (
                    <DropdownMenuSub key={group.provider}>
                      <DropdownMenuSubTrigger>
                        <span className="min-w-0 flex-1 truncate">
                          {group.providerLabel}
                        </span>
                        {selectedModel?.provider === group.provider ? (
                          <Check
                            aria-label="当前供应商"
                            className="size-3.5 text-[var(--palm)]"
                          />
                        ) : (
                          <span className="font-mono text-[9px] text-[var(--sea-ink-soft)]">
                            {group.models.length}
                          </span>
                        )}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="max-h-[min(24rem,60vh)] min-w-52 overflow-y-auto">
                        <DropdownMenuLabel className="normal-case">
                          {group.providerLabel}
                        </DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                          value={
                            selectedModel
                              ? `${selectedModel.provider}:${selectedModel.modelId}`
                              : ''
                          }
                        >
                          {group.models.map((model) => {
                            const value = `${model.provider}:${model.modelId}`
                            return (
                              <DropdownMenuRadioItem
                                key={value}
                                value={value}
                                onSelect={() => selectModel(model)}
                                onClick={() => selectModel(model)}
                              >
                                <span className="min-w-0 truncate">
                                  {model.modelId}
                                </span>
                                {modelSupportsImageInput(model.modelId) ? (
                                  <ImageIcon
                                    aria-label="支持图片"
                                    className="size-4 shrink-0 text-[var(--lagoon-deep)]"
                                  />
                                ) : null}
                              </DropdownMenuRadioItem>
                            )
                          })}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                模型列表为空。请先在工作区“供应商”页面添加并启用模型服务。
              </div>
            )}
          </div>

          <fieldset className="grid gap-3">
            <legend className="text-sm font-semibold">思考等级</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {thinkingLevels.map((level) => {
                const active = thinkingLevel === level.value
                return (
                  <button
                    key={level.value}
                    type="button"
                    aria-pressed={active}
                    disabled={readOnly}
                    onClick={() => {
                      setThinkingLevel(level.value)
                      setSaved(false)
                    }}
                    className={cn(
                      'rounded-xl border px-3 py-3 text-left transition-colors',
                      active
                        ? 'border-[var(--lagoon-deep)] bg-[var(--lagoon)]/10'
                        : 'border-[var(--line)] bg-white/35 hover:bg-white/60',
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      {level.label}
                      {active ? (
                        <Check
                          aria-hidden="true"
                          className="size-3.5 text-[var(--palm)]"
                        />
                      ) : null}
                    </span>
                    <span className="mt-1 block text-[10px] leading-4 text-[var(--sea-ink-soft)]">
                      {level.copy}
                    </span>
                  </button>
                )
              })}
            </div>
          </fieldset>
        </div>
      </section>

      {error && !readOnly ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {!readOnly ? (
        <div className="flex items-center justify-end gap-3">
          {saved ? (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--palm)]"
            >
              <Check aria-hidden="true" className="size-3.5" />
              草稿已保存
            </span>
          ) : null}
          <Button type="submit" disabled={saving || !selectedModel}>
            {saving ? (
              <LoaderCircle
                aria-hidden="true"
                className="size-4 animate-spin"
              />
            ) : null}
            {saving ? '保存中…' : '保存草稿'}
          </Button>
        </div>
      ) : null}
    </form>
  )
}
