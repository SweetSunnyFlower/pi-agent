import {
  Code2,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Minus,
  Quote,
  Type,
} from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import type { Editor, Range } from '@tiptap/core'
import type { SuggestionKeyDownProps } from '@tiptap/suggestion'

import { cn } from '#/lib/utils'

export type SlashMenuItem = {
  id: string
  title: string
  description: string
  group: string
  icon: typeof Type
  keywords: string[]
  command: (editor: Editor, range: Range) => void
}

const runCommand =
  (
    transform: (chain: ReturnType<Editor['chain']>) => {
      run: () => boolean
    },
  ) =>
  (editor: Editor, range: Range) => {
    transform(editor.chain().focus().deleteRange(range)).run()
  }

export const slashMenuItems: SlashMenuItem[] = [
  {
    id: 'text',
    title: '文本',
    description: '普通段落文本',
    group: '基础块',
    icon: Type,
    keywords: ['text', 'paragraph', '正文', '段落'],
    command: runCommand((chain) => chain.setParagraph()),
  },
  {
    id: 'heading-1',
    title: '一级标题',
    description: '页面或章节的大标题',
    group: '基础块',
    icon: Heading1,
    keywords: ['h1', 'heading', 'title', '标题'],
    command: runCommand((chain) => chain.setHeading({ level: 1 })),
  },
  {
    id: 'heading-2',
    title: '二级标题',
    description: '章节中的主要分区',
    group: '基础块',
    icon: Heading2,
    keywords: ['h2', 'heading', 'subtitle', '标题'],
    command: runCommand((chain) => chain.setHeading({ level: 2 })),
  },
  {
    id: 'heading-3',
    title: '三级标题',
    description: '更细的内容层级',
    group: '基础块',
    icon: Heading3,
    keywords: ['h3', 'heading', '标题'],
    command: runCommand((chain) => chain.setHeading({ level: 3 })),
  },
  {
    id: 'bullet-list',
    title: '无序列表',
    description: '创建带项目符号的列表',
    group: '列表',
    icon: List,
    keywords: ['bullet', 'list', 'unordered', '列表'],
    command: runCommand((chain) => chain.toggleBulletList()),
  },
  {
    id: 'ordered-list',
    title: '有序列表',
    description: '创建带编号的步骤列表',
    group: '列表',
    icon: ListOrdered,
    keywords: ['ordered', 'numbered', 'list', '列表'],
    command: runCommand((chain) => chain.toggleOrderedList()),
  },
  {
    id: 'blockquote',
    title: '引用',
    description: '突出方法、注意事项或原文',
    group: '高级块',
    icon: Quote,
    keywords: ['quote', 'blockquote', '引用'],
    command: runCommand((chain) => chain.toggleBlockquote()),
  },
  {
    id: 'code-block',
    title: '代码块',
    description: '插入多行代码或结构化示例',
    group: '高级块',
    icon: Code2,
    keywords: ['code', 'snippet', '代码'],
    command: runCommand((chain) => chain.toggleCodeBlock()),
  },
  {
    id: 'divider',
    title: '分割线',
    description: '分隔不同配置段落',
    group: '高级块',
    icon: Minus,
    keywords: ['divider', 'horizontal rule', '分割线'],
    command: runCommand((chain) => chain.setHorizontalRule()),
  },
]

export function filterSlashMenuItems(query: string): SlashMenuItem[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return slashMenuItems

  return slashMenuItems.filter((item) =>
    [item.title, item.description, ...item.keywords]
      .join(' ')
      .toLocaleLowerCase()
      .includes(normalized),
  )
}

export type PromptSlashMenuHandle = {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

export type PromptSlashMenuProps = {
  items: SlashMenuItem[]
  command: (item: SlashMenuItem) => void
}

export const PromptSlashMenu = forwardRef<
  PromptSlashMenuHandle,
  PromptSlashMenuProps
>(function PromptSlashMenu({ items, command }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    setSelectedIndex(0)
  }, [items])

  function selectItem(index: number) {
    command(items[index])
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!items.length) return false
      if (event.key === 'ArrowDown') {
        setSelectedIndex((current) => (current + 1) % items.length)
        return true
      }
      if (event.key === 'ArrowUp') {
        setSelectedIndex(
          (current) => (current + items.length - 1) % items.length,
        )
        return true
      }
      if (event.key === 'Enter') {
        selectItem(selectedIndex)
        return true
      }
      return false
    },
  }))

  if (!items.length) {
    return (
      <div className="prompt-slash-menu px-4 py-3 text-xs text-[var(--sea-ink-soft)]">
        没有匹配的内容块
      </div>
    )
  }

  let previousGroup: string | null = null

  return (
    <div className="prompt-slash-menu" role="listbox" aria-label="插入内容块">
      {items.map((item, index) => {
        const Icon = item.icon
        const showGroup = item.group !== previousGroup
        previousGroup = item.group
        const selected = index === selectedIndex

        return (
          <div key={item.id}>
            {showGroup ? (
              <p className="px-2 pt-2 pb-1 font-mono text-[9px] font-bold tracking-[0.14em] text-[var(--kicker)] uppercase">
                {item.group}
              </p>
            ) : null}
            <button
              type="button"
              role="option"
              aria-selected={selected}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectItem(index)}
              className={cn(
                'flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors',
                selected
                  ? 'bg-[var(--lagoon)]/15 text-[var(--sea-ink)]'
                  : 'text-[var(--sea-ink-soft)] hover:bg-[var(--link-bg-hover)]',
              )}
            >
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border border-[var(--chip-line)] bg-[var(--chip-bg)]">
                <Icon aria-hidden="true" className="size-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold">
                  {item.title}
                </span>
                <span className="mt-0.5 block text-[10px] leading-4 opacity-75">
                  {item.description}
                </span>
              </span>
            </button>
          </div>
        )
      })}
    </div>
  )
})
