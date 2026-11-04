export type UiChoiceOption = {
  id: string
  label: string
  description?: string
}

export type UiFormField = {
  id: string
  label: string
  type: 'text' | 'textarea' | 'number'
  placeholder?: string
  required?: boolean
}

export type UiInteractionDefinition =
  | {
      kind: 'single_select'
      title: string
      description?: string
      options: UiChoiceOption[]
      submitLabel?: string
    }
  | {
      kind: 'multi_select'
      title: string
      description?: string
      options: UiChoiceOption[]
      minSelections?: number
      maxSelections?: number
      submitLabel?: string
    }
  | {
      kind: 'confirm'
      title: string
      description?: string
      confirmLabel?: string
      cancelLabel?: string
    }
  | {
      kind: 'form'
      title: string
      description?: string
      fields: UiFormField[]
      submitLabel?: string
    }

export type UiInteractionResponse =
  | {
      kind: 'single_select'
      selectedOptionId?: string
      otherText?: string
    }
  | {
      kind: 'multi_select'
      selectedOptionIds: string[]
      otherText?: string
    }
  | {
      kind: 'confirm'
      confirmed: boolean
      otherText?: string
    }
  | {
      kind: 'form'
      values: Record<string, string | number>
      otherText?: string
    }

export type UiInteractionRecord = {
  id: string
  kind: UiInteractionDefinition['kind']
  request: UiInteractionDefinition
  status: 'pending' | 'answered' | 'cancelled' | 'expired'
  response?: UiInteractionResponse
  createdAt: string
  answeredAt?: string
}
