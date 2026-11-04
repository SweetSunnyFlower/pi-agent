import { Extension } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion'

import { filterSlashMenuItems, PromptSlashMenu } from './prompt-slash-menu'
import type {
  PromptSlashMenuHandle,
  PromptSlashMenuProps,
  SlashMenuItem,
} from './prompt-slash-menu'

const slashSuggestion: Omit<SuggestionOptions<SlashMenuItem>, 'editor'> = {
  char: '/',
  allowSpaces: false,
  startOfLine: false,
  allowedPrefixes: null,
  items: ({ query }) => filterSlashMenuItems(query),
  command: ({ editor, range, props }) => props.command(editor, range),
  render: () => {
    let component:
      ReactRenderer<PromptSlashMenuHandle, PromptSlashMenuProps> | undefined
    let unmount: (() => void) | undefined

    return {
      onStart: (props: SuggestionProps<SlashMenuItem>) => {
        component = new ReactRenderer(PromptSlashMenu, {
          editor: props.editor,
          props: {
            items: props.items,
            command: props.command,
          },
        })
        unmount = props.mount(component.element)
      },
      onUpdate: (props: SuggestionProps<SlashMenuItem>) => {
        if (!component) return
        component.updateProps({
          items: props.items,
          command: props.command,
        })
      },
      onKeyDown: (props) => component?.ref?.onKeyDown(props) ?? false,
      onExit: () => {
        unmount?.()
        component?.destroy()
        unmount = undefined
        component = undefined
      },
    }
  },
}

export const PromptSlashCommand = Extension.create({
  name: 'promptSlashCommand',

  addOptions() {
    return {
      suggestion: slashSuggestion,
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        shouldShow: ({ editor }) => !editor.isActive('codeBlock'),
      }),
    ]
  },
})
