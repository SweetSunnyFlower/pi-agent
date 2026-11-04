import { EditorContent, useEditor } from '@tiptap/react'
import { CharacterCount, Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { useEffect } from 'react'

import { PromptSlashCommand } from './prompt-slash-command'

const editorExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
  }),
  Markdown.configure({
    indentation: { style: 'space', size: 2 },
  }),
  Placeholder.configure({
    placeholder: '输入提示词，或键入 / 插入标题、列表、引用和代码块。',
  }),
  CharacterCount.configure({ limit: 100_000 }),
  PromptSlashCommand,
]

export function PromptRichEditor({
  value,
  onChange,
  readOnly = false,
}: {
  value: string
  onChange: (markdown: string) => void
  readOnly?: boolean
}) {
  const editor = useEditor({
    extensions: editorExtensions,
    content: value,
    contentType: 'markdown',
    editable: !readOnly,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        'aria-label': '提示词',
        class: 'tiptap-prompt-content',
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      onChange(currentEditor.getMarkdown())
    },
  })

  useEffect(() => {
    editor?.setEditable(!readOnly)
  }, [editor, readOnly])

  const characters = editor?.storage.characterCount.characters() ?? 0

  return (
    <div>
      <EditorContent editor={editor} />

      <div className="flex items-center justify-between pt-2">
        <span className="text-[10px] text-[var(--sea-ink-soft)]">
          {readOnly ? (
            '只读模式'
          ) : (
            <>
              键入{' '}
              <kbd className="rounded border border-[var(--line)] bg-[var(--chip-bg)] px-1 py-0.5 font-mono text-[9px] shadow-xs">
                /
              </kbd>{' '}
              插入内容块
            </>
          )}
        </span>
        <span className="font-mono text-[10px] text-[var(--sea-ink-soft)]">
          {characters}/100000
        </span>
      </div>
    </div>
  )
}
