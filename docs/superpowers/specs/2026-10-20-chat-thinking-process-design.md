# 对话思考过程、用量与模型切换提示设计

## 目标

在现有 Web 对话中展示 Pi Durable 返回的思考过程、Token 用量和模型切换信息，同时保持对话区域紧凑、稳定，并与当前平台的视觉语言一致。

## 交互设计

### 思考过程

- 每条助手回答上方显示一条思考活动栏；没有思考内容时不渲染。
- 桌面端固定最大宽度为 `40rem`，移动端占满助手消息可用宽度。
- 默认仅显示一行，固定高度，不随内容自动增高。
- 单个逻辑行超出宽度时不换行，使用省略显示。
- 出现下一逻辑行时，旧行向上滑出，新行从底部进入；动效约 `180ms`。
- 展开按钮固定在活动栏右侧。展开后显示完整思考内容，最大高度约 `40vh`，内容区内部滚动。
- 展开按钮使用 Chevron 图标，展开时旋转；再次点击恢复单行状态。
- 回答完成后仍保留最新一行和展开能力。
- 遵循 `prefers-reduced-motion`，减少动效时直接切换行内容。

### Token 用量

- 活动栏右侧显示当前回答的聚合用量，包含输入、输出和总计 Token。
- 桌面显示为紧凑文本，例如 `输入 1.2k · 输出 348 · 总计 1.5k`。
- 移动端折叠状态只显示总计，展开后显示输入、输出、缓存和费用等可用字段。
- 聚合范围是从当前用户输入开始的所有模型请求，包括工具调用前后的多个模型 turn；不包含不可用的估算值，只展示 Pi 实际返回的 usage。
- 当模型提供商未返回 reasoning 拆分时，不展示 reasoning Token。

### 模型切换

- 仅在模型实际变化时显示分隔线，相同模型重复配置不显示。
- 分隔线横跨对话内容区，中间显示 `模型切换 → <modelId>`。
- 分隔线位于切换模型后所发送用户消息之前。
- 直播时消费 Pi 的 `agent_changed` 事件并进行去重。
- 由于当前发送流程可能先配置模型、后建立 SSE 连接，客户端发送前还需比较当前会话模型和本次选择模型，避免遗漏切换提示。
- 历史会话根据 assistant message 中的 provider/model 重建分隔线，刷新后仍可看到模型切换。

## 数据与事件

### Pi 事件来源

- `thinking_delta`：思考文本增量。
- `message_update.usage`：当前模型请求的用量。
- `message_end`：提交后的完整 assistant message，包含 thinking、usage、provider 和 model。
- `agent_changed`：Agent 状态变化；只有 `model.provider` 或 `model.modelId` 改变时才生成平台模型切换事件。

### 平台 SSE 扩展

保留现有 `snapshot`、`delta`、`done`、`failed`，新增：

- `thinking`：思考文本增量。
- `usage`：当前回答的聚合用量。
- `agent_changed`：模型切换，包含 provider 和 modelId。

`done` 同时携带最终 thinking、usage 和模型信息，用于校正流式聚合结果。

### 历史消息

- `ChatMessage` 的 assistant 类型增加 `thinking`、`usage`、`provider` 和 `modelId`。
- `ChatMessage` 增加 `model-change` 类型，用于在历史记录中重建模型切换分隔线。
- 思考内容从 assistant message 的 `thinking` content block 提取。
- 用量聚合 assistant message 的 `usage`，范围与直播回答一致。

## 组件边界

- `AgentChatPanel`：管理会话消息、SSE 连接、模型切换去重和展开状态入口。
- `ThinkingActivity`：只负责单行上推动效、完整内容展开和用量展示。
- `ModelChangeDivider`：只负责模型切换分隔线。
- 服务端 chat runtime：负责 Pi 事件转换、历史消息提取、usage 聚合和模型变化去重。

## 错误与边界

- 思考过程为空、仅空白或已被安全过滤器 redacted 时，不生成活动栏。
- usage 字段缺失或为零时不展示伪造数据；有任一有效字段时展示可用字段。
- SSE 断线后沿用现有错误提示；已经完成的消息保持可读。
- `agent_changed` 可能由工具、提示词或思考级别变化触发，不能仅凭事件类型显示模型切换。
- 同一回答中的多个 assistant turn 使用同一模型，不重复画切换线。
- 新会话首次选择模型不显示“切换”，因为它没有前一个模型。

## 测试

- 服务端提取 thinking 和 usage，并在历史接口返回。
- 服务端转发 `thinking_delta`、usage 和真实模型变化。
- 历史重建模型切换分隔线，且相同模型不产生分隔线。
- 思考活动栏默认一条可见行，新增行后旧行被推出可视区域。
- 展开后显示完整内容，按钮状态和可访问名称正确。
- 桌面宽度为 `40rem` 上限，移动端占满可用宽度。
- 无用量的消息不显示虚构数值。
- 现有文本流式、失败、Markdown、图片和会话历史行为不回归。

## 非目标

- 不展示工具调用执行时间线。
- 不修改 Pi Durable 的底层存储格式。
- 不为思考过程增加 Markdown 渲染。
- 不增加每条消息的手动重试或编辑能力。
