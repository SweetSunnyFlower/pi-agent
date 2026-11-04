# Chat Thinking Process Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Web 对话中展示紧凑、可展开的思考过程，聚合 Token 用量，并在模型切换时显示持久化分隔线。

**Architecture:** 服务端从 Pi assistant message 中提取 thinking、usage、provider 和 model，并将 live `thinking_delta`、usage、`agent_changed` 转换成平台 SSE 事件。前端统一以扩展后的 `ChatMessage` 渲染正文、思考活动栏和模型切换分隔线，历史记录从已落库 assistant message 重建。

**Tech Stack:** TypeScript, React 19, TanStack Router, Pi Durable 1.3, Vitest, Testing Library, Tailwind CSS 4, Lucide icons.

## Global Constraints

- 桌面思考活动栏宽度上限必须为 `40rem`。
- 移动端活动栏必须占满可用宽度。
- 默认仅展示一行，新增逻辑行时旧行向上滑出。
- 展开按钮固定在活动栏右侧，使用 Chevron 图标。
- 只有 `model.provider` 或 `model.modelId` 真正变化时才显示分隔线。
- 所有展示内容必须能从数据库历史恢复。
- 不提交或覆盖用户已有的 `agent-page-header.tsx` 和聊天路由改动。
- 每个任务先写失败测试，再写最小实现。

---

### Task 1: 扩展服务端消息数据与历史恢复

**Files:**
- Modify: `src/server/runtime/chat.server.ts`
- Test: `src/server/runtime/chat.server.test.ts`

**Interfaces:**
- Consumes: Pi `AssistantMessage.content`, `AssistantMessage.usage`, `AssistantMessage.provider`, `AssistantMessage.model`.
- Produces: `ChatUsage`; assistant `ChatMessage` 的 `thinking`, `usage`, `modelProvider`, `modelId`; `role: "model-change"` 历史项。

- [ ] **Step 1: Write the failing runtime test**

```ts
import { fauxThinking } from '@earendil-works/pi-ai'

it('restores thinking, usage, and model changes from durable history', async () => {
  faux.setResponses([
    fauxAssistantMessage([
      fauxThinking('先确认输入。\n再检查风险。'),
      fauxText('第一轮回答。'),
    ]),
    fauxAssistantMessage([fauxText('切换模型后的回答。')]),
  ])

  const first = await sendWebMessage(
    db,
    principal!,
    workspaceId,
    agentId,
    {
      message: '第一轮',
      idempotencyKey: '65e428f8-6cc6-4b1b-88e4-cf8d1387d317',
    },
    harness,
  )
  await waitForWebAnswer(
    db,
    principal!,
    workspaceId,
    first.conversationId,
    first.submissionId,
    harness,
  )

  await sendWebMessage(
    db,
    principal!,
    workspaceId,
    agentId,
    {
      conversationId: first.conversationId,
      message: '第二轮',
      modelProvider: 'oneapi-comate',
      modelId: 'faux-chat-2',
      idempotencyKey: '532ee965-c49f-4a62-9422-b8cbdf771c30',
    },
    harness,
    undefined,
    models,
  )

  const messages = await getWebConversationMessages(
    db,
    principal!,
    workspaceId,
    first.conversationId,
    harness,
  )
  expect(messages[1]).toMatchObject({
    role: 'assistant',
    thinking: '先确认输入。\n再检查风险。',
    modelProvider: 'oneapi-comate',
    modelId: 'faux-chat',
    usage: expect.objectContaining({ totalTokens: expect.any(Number) }),
  })
  expect(messages.some((message) => message.role === 'model-change')).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/server/runtime/chat.server.test.ts`
Expected: FAIL because assistant messages do not expose `thinking`, `usage`, or model changes.

- [ ] **Step 3: Add shared server types and extraction helpers**

```ts
export type ChatUsage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning?: number
  totalTokens: number
  costTotal: number
}

export type ChatMessage =
  | {
      id: string
      role: 'user'
      text: string
      timestamp: number
      attachments?: ChatImageAttachment[]
    }
  | {
      id: string
      role: 'assistant'
      text: string
      thinking?: string
      usage?: ChatUsage
      modelProvider?: string
      modelId?: string
      timestamp: number
    }
  | {
      id: string
      role: 'model-change'
      modelProvider: string
      modelId: string
      timestamp: number
    }

function messageThinking(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((part) =>
      part &&
      typeof part === 'object' &&
      'type' in part &&
      part.type === 'thinking' &&
      'thinking' in part &&
      typeof part.thinking === 'string' &&
      !('redacted' in part && part.redacted === true)
        ? [part.thinking]
        : [],
    )
    .join('\n')
}

function messageUsage(message: {
  usage?: {
    input?: unknown
    output?: unknown
    cacheRead?: unknown
    cacheWrite?: unknown
    reasoning?: unknown
    totalTokens?: unknown
    cost?: { total?: unknown }
  }
}): ChatUsage | undefined {
  const usage = message.usage
  if (!usage) return undefined
  const numeric = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0
  const result: ChatUsage = {
    input: numeric(usage.input),
    output: numeric(usage.output),
    cacheRead: numeric(usage.cacheRead),
    cacheWrite: numeric(usage.cacheWrite),
    totalTokens: numeric(usage.totalTokens),
    costTotal: numeric(usage.cost?.total),
    ...(typeof usage.reasoning === 'number'
      ? { reasoning: usage.reasoning }
      : {}),
  }
  return Object.values(result).some((value) => value !== 0)
    ? result
    : undefined
}

function addChatUsage(
  current: ChatUsage | undefined,
  next: ChatUsage | undefined,
): ChatUsage | undefined {
  if (!current) return next
  if (!next) return current
  return {
    input: current.input + next.input,
    output: current.output + next.output,
    cacheRead: current.cacheRead + next.cacheRead,
    cacheWrite: current.cacheWrite + next.cacheWrite,
    totalTokens: current.totalTokens + next.totalTokens,
    costTotal: current.costTotal + next.costTotal,
    ...((current.reasoning !== undefined || next.reasoning !== undefined) && {
      reasoning: (current.reasoning ?? 0) + (next.reasoning ?? 0),
    }),
  }
}
```

- [ ] **Step 4: Group assistant turns by user input and emit model-change entries**

In `chatMessagesFromEntries`, build one run group per user entry, accumulate thinking and usage across assistant turns, and insert a model-change item before the user when the group's model differs from the previous assistant model. Add thinking and usage only to the last visible assistant message in that run.

- [ ] **Step 5: Run the focused test**

Run: `npm test -- src/server/runtime/chat.server.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/runtime/chat.server.ts src/server/runtime/chat.server.test.ts
git commit -m "feat: persist chat reasoning and usage"
```

---

### Task 2: Forward live thinking, usage, and model changes

**Files:**
- Modify: `src/server/runtime/chat.server.ts`
- Modify: `src/server/http/chat-http.server.test.ts`

**Interfaces:**
- Consumes: Pi `message_update`, `message_end`, `agent_changed`, current submission entry.
- Produces: SSE `thinking`, `usage`, `agent_changed`; richer `snapshot` and `done`.

- [ ] **Step 1: Write failing SSE assertions**

```ts
const response = fauxAssistantMessage([
  fauxThinking('检查输入。\n确认风险。'),
  fauxText('流式最终回答。'),
])
response.usage = {
  input: 120,
  output: 40,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 160,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.02 },
}
faux.setResponses([response])

// Existing SSE test continues through conversationEventsHandler.
expect(body).toContain('event: snapshot')
expect(body).toContain(
  '"thinking":"检查输入。\\n确认风险。"',
)
expect(body).toContain('"totalTokens":160')
expect(body).toContain('event: done')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/server/http/chat-http.server.test.ts`
Expected: FAIL because snapshot and done do not contain thinking or usage.

- [ ] **Step 3: Extend the platform event union**

```ts
export type WebConversationEvent =
  | {
      type: 'snapshot'
      messages: ChatMessage[]
      partial?: string
      thinkingPartial?: string
      usage?: ChatUsage
      model?: { provider: string; modelId: string }
    }
  | { type: 'thinking'; text: string }
  | { type: 'usage'; usage: ChatUsage }
  | {
      type: 'agent_changed'
      modelProvider: string
      modelId: string
    }
  | { type: 'delta'; text: string }
  | {
      type: 'done'
      text: string
      thinking?: string
      usage?: ChatUsage
      modelProvider?: string
      modelId?: string
    }
  | {
      type: 'failed'
      code: WebAnswerFailureCode | 'agent_failed'
      message: string
    }
```

- [ ] **Step 4: Translate live events**

In `streamWebConversationEvents`, initialize model state from `snapshot.agent.model`. On `message_update`, emit `thinking_delta` text and current usage. On `message_end` for an assistant message, add its usage to the run aggregate. On `agent_changed`, compare provider/model and emit only when changed.

Make `waitForWebAnswer` aggregate thinking and usage from all assistant entries in the current submission run and return them in the `done` event.

- [ ] **Step 5: Run focused server tests**

Run: `npm test -- src/server/runtime/chat.server.test.ts src/server/http/chat-http.server.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/runtime/chat.server.ts src/server/http/chat-http.server.test.ts
git commit -m "feat: stream chat reasoning and usage"
```

---

### Task 3: Build thinking activity and model divider components

**Files:**
- Create: `src/components/agents/thinking-activity.tsx`
- Create: `src/components/agents/model-change-divider.tsx`
- Modify: `src/styles.css`
- Test: `src/components/agents/agent-chat-panel.test.tsx`

**Interfaces:**
- Consumes: `thinking?: string`, `usage?: ChatUsage`, `modelProvider`, `modelId`.
- Produces: `ThinkingActivity({ thinking, usage })`; `ModelChangeDivider({ modelId })`.

- [ ] **Step 1: Add failing component assertions**

```ts
act(() => {
  source.emit('snapshot', {
    type: 'snapshot',
    messages: [],
    thinkingPartial: '第一行',
    usage: {
      input: 1200,
      output: 348,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 1548,
      costTotal: 0.02,
    },
  })
  source.emit('thinking', { type: 'thinking', text: '\n第二行' })
  source.emit('agent_changed', {
    type: 'agent_changed',
    modelProvider: 'oneapi-comate',
    modelId: 'DeepSeek-V4-Flash-Vision-Exp',
  })
})

expect(screen.getByTestId('thinking-track').style.transform).toContain('24px')
expect(screen.getByText('1.5k')).toBeTruthy()
expect(screen.getByRole('separator', { name: /模型切换/ })).toBeTruthy()

await user.click(screen.getByRole('button', { name: '展开思考过程' }))
expect(screen.getByText('第一行')).toBeTruthy()
expect(screen.getByText('第二行')).toBeTruthy()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/agents/agent-chat-panel.test.tsx`
Expected: FAIL because the SSE events and components do not exist.

- [ ] **Step 3: Implement `ThinkingActivity`**

```tsx
export function ThinkingActivity({
  thinking,
  usage,
}: {
  thinking?: string
  usage?: ChatUsage
}) {
  const [expanded, setExpanded] = useState(false)
  const lines = (thinking ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return null

  return (
    <section
      aria-label="思考过程"
      className="thinking-activity w-full max-w-[40rem]"
    >
      <div className="flex min-h-8 items-center gap-2">
        <span className="thinking-activity-label">过程</span>
        <div className="thinking-activity-viewport" data-testid="thinking-clip">
          <div
            data-testid="thinking-track"
            className="thinking-activity-track"
            style={{
              transform: expanded
                ? 'translateY(0)'
                : `translateY(-${Math.max(0, lines.length - 1) * 24}px)`,
            }}
          >
            {lines.map((line, index) => (
              <p key={`${index}:${line}`}>{line}</p>
            ))}
          </div>
        </div>
        {usage ? <UsageLabel usage={usage} /> : null}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={expanded ? '收起思考过程' : '展开思考过程'}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="size-7 shrink-0 rounded-full"
        >
          <ChevronDown
            className={cn(
              'size-3.5 transition-transform duration-180',
              expanded && 'rotate-180',
            )}
          />
        </Button>
      </div>
      {expanded ? (
        <div className="thinking-activity-expanded whitespace-pre-wrap">
          {thinking}
        </div>
      ) : null}
    </section>
  )
}
```

- [ ] **Step 4: Implement model divider**

```tsx
export function ModelChangeDivider({ modelId }: { modelId: string }) {
  return (
    <div
      role="separator"
      aria-label={`模型切换到 ${modelId}`}
      className="flex items-center gap-3 py-1 text-[10px]"
    >
      <span className="h-px flex-1 bg-[var(--line)]" />
      <span className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1 font-medium text-[var(--sea-ink-soft)]">
        模型切换 · {modelId}
      </span>
      <span className="h-px flex-1 bg-[var(--line)]" />
    </div>
  )
}
```

- [ ] **Step 5: Add CSS**

```css
.thinking-activity {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: color-mix(in oklab, var(--lagoon) 6%, var(--surface-strong));
  padding: 6px 8px;
}

.thinking-activity-label {
  flex: none;
  color: var(--lagoon-deep);
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.thinking-activity-viewport {
  block-size: 24px;
  flex: 1;
  min-inline-size: 0;
  overflow: hidden;
}

.thinking-activity-track {
  transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
}

.thinking-activity-track p {
  block-size: 24px;
  overflow: hidden;
  color: var(--sea-ink-soft);
  font-size: 11px;
  line-height: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thinking-activity-expanded {
  max-block-size: 40vh;
  overflow: auto;
  border-block-start: 1px solid var(--line);
  margin-block-start: 6px;
  padding-block-start: 8px;
  color: var(--sea-ink-soft);
  font-size: 11px;
  line-height: 1.7;
}

@media (prefers-reduced-motion: reduce) {
  .thinking-activity-track {
    transition: none;
  }
}
```

- [ ] **Step 6: Run focused test**

Run: `npm test -- src/components/agents/agent-chat-panel.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/agents/thinking-activity.tsx src/components/agents/model-change-divider.tsx src/styles.css src/components/agents/agent-chat-panel.test.tsx
git commit -m "feat: add thinking activity UI"
```

---

### Task 4: Integrate thinking, usage, and model changes into chat

**Files:**
- Modify: `src/lib/api/platform-client.ts`
- Modify: `src/components/agents/agent-chat-panel.tsx`
- Modify: `src/components/agents/agent-chat-panel.test.tsx`

**Interfaces:**
- Consumes: SSE `snapshot`, `thinking`, `usage`, `agent_changed`, `delta`, `done`.
- Produces: hybrid `ChatMessage` rendering and active-model deduplication.

- [ ] **Step 1: Add failing interaction tests**

```ts
it('inserts a model divider before the next user message after switching models', async () => {
  // Open the existing conversation at faux-chat.
  // Select faux-chat-2.
  // Submit a new message.
  expect(screen.getByRole('separator', { name: /faux-chat-2/ })).toBeTruthy()
})

it('renders historical thinking and usage in the collapsed activity row', async () => {
  // History API returns an assistant message with thinking, usage, provider, modelId.
  expect(screen.getByLabelText('思考过程')).toBeTruthy()
  expect(screen.getByText('历史思考第二行')).toBeTruthy()
  expect(screen.getByText('1.5k')).toBeTruthy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/agents/agent-chat-panel.test.tsx`
Expected: FAIL because chat panel does not render the new fields or events.

- [ ] **Step 3: Extend client types**

```ts
export type ChatUsage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning?: number
  totalTokens: number
  costTotal: number
}

export type ChatMessage =
  | {
      id: string
      role: 'user'
      text: string
      timestamp: number
      attachments?: ChatImageAttachment[]
    }
  | {
      id: string
      role: 'assistant'
      text: string
      thinking?: string
      usage?: ChatUsage
      modelProvider?: string
      modelId?: string
      timestamp: number
    }
  | {
      id: string
      role: 'model-change'
      modelProvider: string
      modelId: string
      timestamp: number
    }
```

- [ ] **Step 4: Update pending assistant state**

Add stable helpers:

```ts
function patchAssistant(
  id: string,
  patch: Partial<Extract<ChatMessage, { role: 'assistant' }>>,
) {
  setMessages((current) =>
    current.map((message) =>
      message.id === id && message.role === 'assistant'
        ? { ...message, ...patch }
        : message,
    ),
  )
}

function appendThinking(id: string, delta: string) {
  setMessages((current) =>
    current.map((message) =>
      message.id === id && message.role === 'assistant'
        ? { ...message, thinking: `${message.thinking ?? ''}${delta}` }
        : message,
    ),
  )
}
```

- [ ] **Step 5: Handle all new SSE events**

```ts
source.addEventListener('thinking', (messageEvent) => {
  const data = parseEvent<{ text: string }>(messageEvent)
  if (data?.text) appendThinking(assistantId, data.text)
})

source.addEventListener('usage', (messageEvent) => {
  const data = parseEvent<{ usage: ChatUsage }>(messageEvent)
  if (data?.usage) patchAssistant(assistantId, { usage: data.usage })
})

source.addEventListener('agent_changed', (messageEvent) => {
  const data = parseEvent<{
    modelProvider: string
    modelId: string
  }>(messageEvent)
  if (data) insertModelChange(data, userId)
})
```

On `done`, patch `text`, `thinking`, `usage`, `modelProvider`, and `modelId`, then update `activeModel`.

- [ ] **Step 6: Insert model divider before the user message**

Before adding the optimistic user/assistant pair, compare `selectedModel` with `activeModel` when `conversationId` exists. Insert a `model-change` message before the user message. Use a deduplication helper that checks whether the same model divider already immediately precedes the target user message.

- [ ] **Step 7: Render model-change messages and thinking**

In the message map, return `<ModelChangeDivider />` for `role === 'model-change'`. For assistant messages, render `<ThinkingActivity thinking={message.thinking} usage={message.usage} />` above the answer text. Only show the legacy `思考中…` placeholder when neither text nor thinking exists.

- [ ] **Step 8: Run focused tests**

Run: `npm test -- src/components/agents/agent-chat-panel.test.tsx src/server/runtime/chat.server.test.ts src/server/http/chat-http.server.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/api/platform-client.ts src/components/agents/agent-chat-panel.tsx src/components/agents/agent-chat-panel.test.tsx
git commit -m "feat: show chat reasoning and model switches"
```

---

### Task 5: Full verification and browser automation

**Files:**
- Verify only; modify code only if a gate exposes a defect.

**Interfaces:**
- Consumes: completed implementation.
- Produces: verified behavior and a clean remote main commit.

- [ ] **Step 1: Run complete automated gates**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit 0; 47+ test files pass with no failures.

- [ ] **Step 2: Verify in the live browser**

Use the current in-app browser tab to:

1. Create a new conversation with the Vision model.
2. Confirm the thinking activity shows one line.
3. Confirm a multiline response moves the first line out and leaves the latest line visible.
4. Expand and collapse the full thinking content.
5. Confirm input/output/total usage is visible.
6. Switch to another model and send a message.
7. Confirm the centered model-change divider appears before the user message.

- [ ] **Step 3: Inspect browser console**

Run browser console capture and verify there are no errors or warnings introduced by the feature.

- [ ] **Step 4: Commit any verification fix**

```bash
git add src/components/agents/agent-chat-panel.tsx src/components/agents/thinking-activity.tsx src/server/runtime/chat.server.ts
git commit -m "fix: polish chat reasoning activity"
```

- [ ] **Step 5: Push**

```bash
git push origin main
```

Expected: local `HEAD` equals `origin/main`.
