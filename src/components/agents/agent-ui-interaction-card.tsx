import { Check, CircleHelp, LoaderCircle, Sparkles } from 'lucide-react'
import { useId, useState } from 'react'
import type { FormEvent } from 'react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import type {
  UiChoiceOption,
  UiInteractionRecord,
  UiInteractionResponse,
} from '#/lib/chat/ui-interaction'
import { cn } from '#/lib/utils'

type AgentUiInteractionCardProps = {
  interaction: UiInteractionRecord
  submitting?: boolean
  error?: string | null
  onSubmit: (response: UiInteractionResponse) => void | Promise<void>
}

function Choice({
  option,
  type,
  checked,
  disabled,
  onChange,
}: {
  option: UiChoiceOption
  type: 'radio' | 'checkbox'
  checked: boolean
  disabled: boolean
  onChange: () => void
}) {
  return (
    <label
      className={cn(
        'group flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
        checked
          ? 'border-[var(--lagoon-deep)] bg-[var(--link-bg-hover)]'
          : 'border-[var(--line)] bg-white/55 hover:border-[var(--lagoon)] hover:bg-[var(--link-bg-hover)]',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <input
        type={type}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 grid size-4 shrink-0 place-items-center border bg-white transition-colors',
          type === 'radio' ? 'rounded-full' : 'rounded-[4px]',
          checked
            ? 'border-[var(--sea-ink)] bg-[var(--sea-ink)] text-white'
            : 'border-[var(--chip-line)]',
        )}
      >
        {checked ? <Check className="size-3" strokeWidth={3} /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--sea-ink)]">
          {option.label}
        </span>
        {option.description ? (
          <span className="mt-0.5 block text-xs leading-5 text-[var(--sea-ink-soft)]">
            {option.description}
          </span>
        ) : null}
      </span>
    </label>
  )
}

function OtherInput({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-1.5 rounded-xl border border-dashed border-[var(--chip-line)] bg-[var(--chip-bg)]/55 p-3">
      <Label htmlFor={id}>其他内容</Label>
      <p className="text-[10px] leading-4 text-[var(--sea-ink-soft)]">
        没有合适选项时，可直接填写你的答案或补充说明。
      </p>
      <Textarea
        id={id}
        aria-label="其他内容"
        value={value}
        placeholder="请输入其他答案或补充说明"
        disabled={disabled}
        maxLength={2_000}
        rows={2}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

export function AgentUiInteractionCard({
  interaction,
  submitting = false,
  error,
  onSubmit,
}: AgentUiInteractionCardProps) {
  const id = useId()
  const [singleSelection, setSingleSelection] = useState<string>()
  const [multipleSelections, setMultipleSelections] = useState<string[]>([])
  const [formValues, setFormValues] = useState<Partial<Record<string, string>>>(
    {},
  )
  const [otherText, setOtherText] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const request = interaction.request
  const disabled = submitting || interaction.status !== 'pending'
  const trimmedOtherText = otherText.trim()

  if (interaction.status !== 'pending') return null

  function submit(response: UiInteractionResponse) {
    if (disabled) return
    setValidationError(null)
    void onSubmit(response)
  }

  function toggleMultiple(optionId: string) {
    const selected = multipleSelections.includes(optionId)
    if (!selected && request.kind === 'multi_select') {
      const max = request.maxSelections ?? request.options.length
      if (multipleSelections.length >= max) {
        setValidationError(`最多选择 ${max} 项。`)
        return
      }
    }
    setValidationError(null)
    setMultipleSelections((current) =>
      selected
        ? current.filter((selectedId) => selectedId !== optionId)
        : [...current, optionId],
    )
  }

  function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (request.kind !== 'form') return
    const missing = request.fields.find(
      (field) => field.required && !formValues[field.id]?.trim(),
    )
    if (missing) {
      setValidationError(`请填写“${missing.label}”。`)
      return
    }
    const values: Record<string, string | number> = {}
    for (const field of request.fields) {
      const value = formValues[field.id]?.trim() ?? ''
      if (!value) continue
      values[field.id] = field.type === 'number' ? Number(value) : value
    }
    submit({
      kind: 'form',
      values,
      ...(trimmedOtherText ? { otherText: trimmedOtherText } : {}),
    })
  }

  const displayedError = validationError ?? error
  const selectCount =
    request.kind === 'multi_select' ? multipleSelections.length : 0
  const cannotSubmitMulti =
    request.kind === 'multi_select' &&
    selectCount < (request.minSelections ?? 0) &&
    !trimmedOtherText
  const cannotSubmitForm =
    request.kind === 'form' &&
    request.fields.some(
      (field) => field.required && !formValues[field.id]?.trim(),
    )

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="overflow-hidden rounded-2xl border border-[var(--chip-line)] bg-[var(--surface)] shadow-[0_16px_48px_rgba(30,90,72,0.08)]"
    >
      <div className="border-b border-[var(--line)] bg-[var(--chip-bg)] px-4 py-3.5 sm:px-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-[var(--sea-ink)] text-white">
            <CircleHelp aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[10px] font-medium tracking-[0.14em] text-[var(--kicker)] uppercase">
              <Sparkles aria-hidden="true" className="size-3" />
              需要你的选择
            </p>
            <h3
              id={`${id}-title`}
              className="mt-1 text-sm font-semibold text-[var(--sea-ink)]"
            >
              {request.title}
            </h3>
            {request.description ? (
              <p className="mt-1 text-xs leading-5 text-[var(--sea-ink-soft)]">
                {request.description}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="space-y-3 p-4 sm:p-5">
        {request.kind === 'single_select' ? (
          <>
            <fieldset className="space-y-2">
              <legend className="sr-only">{request.title}</legend>
              {request.options.map((option) => (
                <Choice
                  key={option.id}
                  option={option}
                  type="radio"
                  checked={singleSelection === option.id}
                  disabled={disabled}
                  onChange={() => {
                    setValidationError(null)
                    setSingleSelection(option.id)
                  }}
                />
              ))}
            </fieldset>
            <OtherInput
              id={`${id}-freeform`}
              value={otherText}
              disabled={disabled}
              onChange={(value) => {
                setValidationError(null)
                setOtherText(value)
              }}
            />
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                disabled={disabled || (!singleSelection && !trimmedOtherText)}
                onClick={() => {
                  submit({
                    kind: 'single_select',
                    ...(singleSelection
                      ? { selectedOptionId: singleSelection }
                      : {}),
                    ...(trimmedOtherText
                      ? { otherText: trimmedOtherText }
                      : {}),
                  })
                }}
              >
                {submitting ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : null}
                {request.submitLabel ?? '提交'}
              </Button>
            </div>
          </>
        ) : null}

        {request.kind === 'multi_select' ? (
          <>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-xs text-[var(--sea-ink-soft)]">
                可多选
                {request.maxSelections
                  ? `，最多 ${request.maxSelections} 项`
                  : ''}
              </legend>
              {request.options.map((option) => (
                <Choice
                  key={option.id}
                  option={option}
                  type="checkbox"
                  checked={multipleSelections.includes(option.id)}
                  disabled={disabled}
                  onChange={() => toggleMultiple(option.id)}
                />
              ))}
            </fieldset>
            <OtherInput
              id={`${id}-freeform`}
              value={otherText}
              disabled={disabled}
              onChange={(value) => {
                setValidationError(null)
                setOtherText(value)
              }}
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] text-[var(--sea-ink-soft)]">
                已选择 {selectCount} 项
              </span>
              <Button
                type="button"
                size="sm"
                disabled={disabled || cannotSubmitMulti}
                onClick={() =>
                  submit({
                    kind: 'multi_select',
                    selectedOptionIds: multipleSelections,
                    ...(trimmedOtherText
                      ? { otherText: trimmedOtherText }
                      : {}),
                  })
                }
              >
                {submitting ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : null}
                {request.submitLabel ?? '提交'}
              </Button>
            </div>
          </>
        ) : null}

        {request.kind === 'confirm' ? (
          <>
            <OtherInput
              id={`${id}-freeform`}
              value={otherText}
              disabled={disabled}
              onChange={(value) => {
                setValidationError(null)
                setOtherText(value)
              }}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() =>
                  submit({
                    kind: 'confirm',
                    confirmed: false,
                    ...(trimmedOtherText
                      ? { otherText: trimmedOtherText }
                      : {}),
                  })
                }
              >
                {request.cancelLabel ?? '取消'}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={disabled}
                onClick={() =>
                  submit({
                    kind: 'confirm',
                    confirmed: true,
                    ...(trimmedOtherText
                      ? { otherText: trimmedOtherText }
                      : {}),
                  })
                }
              >
                {submitting ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : null}
                {request.confirmLabel ?? '确认'}
              </Button>
            </div>
          </>
        ) : null}

        {request.kind === 'form' ? (
          <form className="space-y-4" onSubmit={submitForm}>
            {request.fields.map((field) => {
              const fieldId = `${id}-${field.id}`
              const value = formValues[field.id] ?? ''
              const onChange = (nextValue: string) => {
                setValidationError(null)
                setFormValues((current) => ({
                  ...current,
                  [field.id]: nextValue,
                }))
              }
              return (
                <div key={field.id} className="space-y-1.5">
                  <Label htmlFor={fieldId}>
                    {field.label}
                    {field.required ? (
                      <span aria-hidden="true" className="text-destructive">
                        *
                      </span>
                    ) : null}
                  </Label>
                  {field.type === 'textarea' ? (
                    <Textarea
                      id={fieldId}
                      aria-label={field.label}
                      value={value}
                      placeholder={field.placeholder}
                      disabled={disabled}
                      required={field.required}
                      rows={3}
                      onChange={(event) => onChange(event.target.value)}
                    />
                  ) : (
                    <Input
                      id={fieldId}
                      aria-label={field.label}
                      type={field.type}
                      value={value}
                      placeholder={field.placeholder}
                      disabled={disabled}
                      required={field.required}
                      onChange={(event) => onChange(event.target.value)}
                    />
                  )}
                </div>
              )
            })}
            <OtherInput
              id={`${id}-freeform`}
              value={otherText}
              disabled={disabled}
              onChange={(value) => {
                setValidationError(null)
                setOtherText(value)
              }}
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                disabled={disabled || cannotSubmitForm}
              >
                {submitting ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : null}
                {request.submitLabel ?? '提交'}
              </Button>
            </div>
          </form>
        ) : null}

        {displayedError ? (
          <p role="alert" className="text-xs text-destructive">
            {displayedError}
          </p>
        ) : null}
      </div>
    </section>
  )
}
