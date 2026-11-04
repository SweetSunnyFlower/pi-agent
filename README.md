# Pi Agent 平台

基于 TanStack Start、Pi Durable 和如流 SDK 的团队 Agent 平台。平台负责 Agent
配置、版本发布、工具与技能编排，以及 Web / 如流两个渠道的统一对话运行时。

## 当前能力

- 创建 Agent，并在独立页面配置基本信息、提示词、工具、技能、渠道和发布状态。
- 使用 Notion 风格 Tiptap 编辑器编写提示词，支持 `/` 命令插入块级内容。
- 从 OpenAI 兼容模型网关的 `/models` 接口动态加载模型列表。
- 配置内置 HTTP、OpenAPI 和 MCP 工具；技能按平台安全规则、技能正文、Agent
  提示词的顺序注入。
- 发布不可变 Agent 版本。后续草稿修改不会影响已有对话，直到再次发布。
- Web 渠道使用 HTTP 提交、SSE 状态事件和数据库会话恢复。
- Web 对话提供“历史对话”侧边面板，仅列出当前用户在该 Agent 下的会话摘要，
  可重新打开并继续之前的对话。
- Agent 回答使用 `react-markdown` 渲染，支持 GFM、任务列表、表格、换行、KaTeX
  数学公式、代码高亮、标题锚点和经过净化的 Markdown HTML。
- 如流渠道使用 WebSocket 接收私聊与群聊消息，一个 Agent 绑定一个如流机器人。
- 如流消息先落库再提交 Pi Durable；最终回答以一条完整 Markdown 消息发送。
- 如流入站事件幂等、出站投递可重试，超时等不确定结果不会自动重复发送。
- 本地开发身份与生产零信任网关身份统一通过同一套 Principal / Workspace 权限模型。

## 核心架构

```text
Web HTTP                 InfoFlow WebSocket
   |                           |
   +-------- channel adapters -+
                |
                v
       inbound / delivery DB
                |
                v
       Pi Durable Harness
   conversation + submission
                |
                v
   model gateway + tools + skills
                |
                v
      committed assistant answer
                |
       +--------+---------+
       |                  |
    Web SSE           InfoFlow sender
```

无论接入多少个渠道，入参先进入平台数据库和 Pi Durable，执行结果再按渠道能力返回。
Web 可以流式展示，如流只发送最终完整文本。

## 技术栈

- Node.js 22.19+
- TanStack Start / TanStack Router / React 19
- TypeScript / Tailwind CSS / shadcn-style Radix UI
- SQLite / Drizzle ORM
- Pi Durable 1.3 / Pi AI 1.3 / Chord
- `@baidu/infoflow-sdk-nodejs`

## 本地启动

安装依赖：

```bash
npm install
```

复制环境变量模板：

```bash
cp .env.example .env.development
```

至少需要配置：

```dotenv
NODE_ENV=development
APP_ORIGIN=http://localhost:3000
AUTH_MODE=development
DEV_AUTH_USERNAME=your.username
APP_DATABASE_PATH=./data/platform.sqlite
CHANNEL_SECRET_KEK=<base64-encoded-32-byte-key>
```

生成渠道密钥加密所需的 32 字节 KEK：

```bash
openssl rand -base64 32
```

`.env.local`、`.env.development` 和 `.env.production` 已被 Git 忽略。真实模型
Token 和如流凭据不得提交到仓库。

执行迁移并初始化开发工作区：

```bash
npm run db:migrate
npm run workspace:init
npm run dev
```

初始化脚本会以幂等方式创建或更新：

- slug：`fde`
- 名称：`数字人FDE组`
- 管理员：当前 `DEV_AUTH_USERNAME`

创建其他 workspace：

```bash
npm run workspace:create -- \
  --slug team-a \
  --name "Team A" \
  --admin-username your.username
```

打开 <http://localhost:3000>。

## AI 供应商

模型服务不再通过 `AI_BASE_URL` / `AI_TOKEN` 运行时配置。工作区管理员从首页
进入“供应商”，或打开：

```text
/w/:workspaceSlug/providers
```

每个供应商包含：

- 显示名称。
- OpenAI 兼容 Base URL。
- API Token；使用 `CHANNEL_SECRET_KEK` 加密后存入 `ai_providers`。
- 启用状态和最近测试时间。

供应商 API：

- `GET/POST /api/workspaces/:workspaceId/providers`
- `PUT /api/providers/:providerId`
- `POST /api/providers/:providerId/test`

连接测试会调用 `{Base URL}/models`。Agent 模型下拉会聚合所有启用供应商的模型，
分别显示“供应商名称 · 模型 ID”。新增、编辑或停用供应商后，Pi Runtime
会自动重新注册模型，无需重启服务。

### 从旧环境变量迁移

旧部署如果仍使用 `AI_BASE_URL` / `AI_TOKEN`，可执行一次：

```bash
npm run import-env-provider
```

脚本会将当前值加密后写入开发工作区的 `oneapi-comate` 供应商。导入完成后，
运行时可删除这两个环境变量。它们现在只用于一次性迁移，不再作为生产模型配置。

同一 `CHANNEL_SECRET_KEK` 同时保护如流渠道和 AI 供应商 Token。更换 KEK 前必须先
重新录入相关凭据；已加密数据无法在无迁移的情况下解密。

## 数据与 Pi Durable

平台业务表与 Pi Durable 表位于同一个 SQLite 数据库。Pi 表使用 `pi_` 前缀，
业务表包括：

- `agents` / `agent_versions`：Agent 与不可变发布版本。
- `ai_providers`：工作区 AI 供应商及加密 Token。
- `agent_channels` / `channel_connections`：渠道开关及加密凭据。
- `conversation_bindings`：渠道会话作用域到 Pi conversation 的映射。
- `inbound_events`：如流入站事件、Pi submission 与最终回答。
- `outbound_deliveries`：如流最终回复的持久化发送状态。
- `capabilities` / `capability_versions`：工具与技能定义。

SQLite 默认启用 WAL、外键与 5 秒 busy timeout。数据库文件目录已加入
`.gitignore`。

迁移命令：

```bash
npm run db:generate
npm run db:migrate
```

## Web 对话

主要接口：

- `POST /api/chat/:agentId`：提交消息并返回 `conversationId` /
  `submissionId`。
- `GET /api/agents/:agentId/conversations`：列出当前用户的 Web 历史对话摘要。
- `GET /api/conversations/:conversationId`：读取数据库中的已提交消息。
- `GET /api/conversations/:conversationId/events`：SSE 订阅
  `snapshot`、`delta`、`done`、`failed` 事件。业务失败使用自定义 `failed`
  事件，避免与 EventSource 保留的传输 `error` 事件混淆。
- `GET /api/conversations/:conversationId/wait`：服务端等待最终回答。

Web 提交带有客户端幂等键。首次提交会绑定当前发布版本，刷新页面后可从数据库恢复
同一会话；新对话不会复用旧会话。

## 如流渠道

如流机器人凭据在 Agent 的渠道页面填写，不使用全局 `INFOFLOW_APP_KEY` /
`INFOFLOW_APP_SECRET` 环境变量。凭据使用 `CHANNEL_SECRET_KEK` 通过 AES-256-GCM
加密后写入 `channel_connections`。

全局端点：

```dotenv
INFOFLOW_API_BASE_URL=https://apiin.im.baidu.com/api/v1
INFOFLOW_WS_GATEWAY=infoflow-open-gateway.weiyun.baidu.com
INFOFLOW_WS_CONNECT_DOMAIN=infoflow-open-gateway.weiyun.baidu.com:8869
```

运行方式：

1. 应用自定义服务器入口 `src/server.ts` 启动如流 supervisor。
2. supervisor 恢复所有已启用连接和未完成投递。
3. 每个 Agent 最多维护一个 `WSClient`，配置变更后自动断开旧连接并建立新连接。
4. 私聊会话作用域为 `infoflow:private:<sender>`。
5. 群聊只在机器人被 `@` 时触发，会话作用域为
   `infoflow:group:<groupId>:sender:<senderId>`。
6. 入站消息先去重落库，再提交 Pi Durable。
7. 回答提交后创建 outbound delivery，群聊使用 `MD`，私聊使用 `md`。

出站状态：

- `pending` / `retry`：后续 worker 会重试。
- `sending`：处理中；进程重启后会转为 `uncertain`，避免重复发送。
- `sent`：已取得 provider message ID。
- `uncertain`：可能已经送达，需要人工核对，不自动重发。
- `failed`：重试耗尽或配置缺失。

如流包来自内部 npm 源：

```bash
npm install @baidu/infoflow-sdk-nodejs --registry=http://registry.npm.baidu-int.com
```

真实如流联调需要在可访问内部网关的环境中配置有效机器人。自动化测试使用注入的
WebSocket 与发送器覆盖归一化、去重、重连、完整回复和投递状态机。

## 登录与零信任网关

生产环境使用 `AUTH_MODE=gateway`。网关需把经过验证的 JWT 注入
`x-zt-authorization` 请求头，JWT 至少包含 `username`、`exp`，并满足配置的
issuer / audience。

```dotenv
AUTH_MODE=gateway
AUTH_JWT_SECRET=<gateway-signing-secret>
```

JWT 算法默认使用 `HS256`。只有网关明确要求时才配置
`AUTH_JWT_ALGORITHM`、`AUTH_JWT_ISSUER` 或 `AUTH_JWT_AUDIENCE`。

本地无法接入网关时使用 `AUTH_MODE=development`，平台会以
`DEV_AUTH_USERNAME` 作为当前登录用户。服务端会拒绝在 production 模式下启用
development 身份。

Agent 的可见范围支持工作区公开与受限授权。普通用户只能看到自己有权限访问的
Agent，会话读取还会校验工作区、Agent、渠道和创建者。

## 质量门禁

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

测试覆盖 Agent 配置与发布、模型发现、工具与技能、Web 持久化对话、SSE、如流
事件归一化、WebSocket 生命周期、幂等、重试和不确定投递。

## 生产运行

```bash
npm run build
npm start
```

`npm start` 会先执行数据库迁移，再通过 `node --env-file=.env` 启动 Nitro
服务，默认监听 `http://localhost:8766`。生产 `.env` 至少要将
`NODE_ENV` 设置为 `production`，并使用 `AUTH_MODE=gateway`。
`npm run build` 会显式使用生产模式，避免本地 `.env.local` 中的开发配置污染
部署产物。

使用 PM2：

```bash
npm install -g pm2
pm2 delete pi-agent pi-agent-framework || true
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

PM2 通过 `npm start` 启动，因此数据库迁移失败时不会继续启动应用。部署目录必须
同时包含 `.output/`、`drizzle/`、`scripts/migrate-database.cjs` 和
`package.json`。从旧的直接启动 Nitro 配置升级时，必须先删除旧进程再启动，
避免两个进程同时监听 `PORT`。启动后可确认迁移已经执行：

```bash
pm2 logs pi-agent --lines 100
```

日志中应包含 `Database migrations applied successfully.`。

生产部署需要：

- 使用与构建环境相同 OS / CPU 架构，因为 `better-sqlite3` 包含原生模块。
- 持久化 SQLite 数据目录和 `CHANNEL_SECRET_KEK`。
- 将零信任网关的 `x-zt-authorization` 原样转发到应用。
- 允许服务器访问模型网关；启用如流时还需访问如流 HTTP 与 WebSocket 网关。

## 安全约定

- 模型 Token、如流 App Secret 和 JWT 密钥不得进入客户端 bundle 或日志。
- 渠道凭据以密文存储，API 只返回掩码。
- 日志仅记录错误类型或 agent ID，不记录提示词、消息正文或凭据。
- 如流发送存在不确定性时优先保证不重复打扰用户。
- 如果开发 KEK 曾在其他环境使用，部署前应重新生成并重新录入渠道凭据。
