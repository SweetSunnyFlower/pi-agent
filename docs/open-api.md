# Agent Open API 对接文档

外部系统可以通过 HTTP 调用平台上已发布的 Agent。每次请求提交一条消息，接口同步等待 Agent 回答完毕后返回完整结果。

## 1. 获取 Token

Token 由平台的 Agent 管理员在「Agent → 渠道 → Open API」中生成。生成时需要填写：

| 字段   | 说明                                        |
| ------ | ------------------------------------------- |
| 名称   | 用于区分调用方，例如“客服系统”              |
| 用户名 | 邮箱前缀，例如 `zhangsan`。会话归属于该用户 |
| 有效期 | 30 天、90 天、1 年，或永不过期              |

注意事项：

- Token 只会显示一次，请妥善保存。不要放在前端代码或公开仓库里。
- 一个 Token 只能调用生成它的那个 Agent。
- Token 被吊销或过期后立即失效。如需更换，请联系管理员重新生成。

## 2. 接口

```
POST {BASE_URL}/api/open/chat/{agentId}
```

`{BASE_URL}` 和 `{agentId}` 由平台管理员提供。

### 请求头

| Header          | 必填 | 值                 |
| --------------- | ---- | ------------------ |
| `Authorization` | 是   | `Bearer <token>`   |
| `Content-Type`  | 是   | `application/json` |

### 请求体

| 字段             | 类型          | 必填 | 说明                                                                     |
| ---------------- | ------------- | ---- | ------------------------------------------------------------------------ |
| `message`        | string        | 否*  | 用户消息，最长 100,000 字符                                              |
| `attachments`    | array         | 否*  | 图片列表，见下文“图片输入”                                               |
| `conversationId` | string (UUID) | 否   | 不传则新建会话；传入上次返回的 `conversationId` 则在原会话中继续多轮对话 |
| `modelProvider`  | string        | 否   | 切换模型，必须与 `modelId` 同时传入                                      |
| `modelId`        | string        | 否   | 切换模型，必须与 `modelProvider` 同时传入                                |
| `idempotencyKey` | string (UUID) | 否   | 幂等键，见下文“重试与幂等”                                               |

\* `message` 和 `attachments` 至少要提供一个。

### 图片输入

`attachments` 中每个元素的格式：

```json
{ "mimeType": "image/png", "data": "<base64>" }
```

- `mimeType` 支持 `image/png`、`image/jpeg`、`image/webp`、`image/gif`。
- `data` 是纯 base64 字符串，不能带 `data:image/png;base64,` 前缀。
- 单张图片解码后不超过 4 MB。
- 每条消息的图片数量上限由平台配置决定，默认值请向管理员确认。
- Agent 当前使用的模型必须支持图片输入，否则返回 409 `model_does_not_support_images`。
- 只发图片、不带文字时，平台会默认使用“请分析这张图片。”作为提示语。

### 成功响应 `200 OK`

```json
{
  "conversationId": "8f6c2b1e-4d5a-4c3b-9e2f-1a2b3c4d5e6f",
  "submissionId": "42",
  "entryId": "87",
  "text": "这是 Agent 的回答……",
  "thinking": "（可选）模型的思考过程",
  "usage": {
    "input": 1200,
    "output": 350,
    "cacheRead": 0,
    "cacheWrite": 0,
    "totalTokens": 1550,
    "costTotal": 0
  },
  "modelProvider": "oneapi-comate",
  "modelId": "some-model"
}
```

| 字段                        | 说明                                       |
| --------------------------- | ------------------------------------------ |
| `conversationId`            | 会话 ID。继续对话时传回该值                |
| `submissionId`              | 本次提交的 ID，用于排查问题                |
| `entryId`                   | 回答消息的 ID，用于排查问题                |
| `text`                      | Agent 的完整回答，Markdown 文本            |
| `thinking`                  | 可选，模型思考内容。仅开启思考的模型会返回 |
| `usage`                     | 可选，Token 用量统计                       |
| `modelProvider` / `modelId` | 可选，实际回答所用的模型                   |

对接方只需依赖 `conversationId` 和 `text`，其余字段可能为空。

### 错误响应

错误时返回 JSON：`{ "error": "<code>", "message": "<可选说明>" }`。

| HTTP 状态码 | `error`                         | 原因                                                                                        | 处理建议                         |
| ----------- | ------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------- |
| 400         | `validation_error`              | 请求体不是合法 JSON，或字段不符合要求（如空消息、图片格式错误、`conversationId` 不是 UUID） | 检查请求体，不要重试             |
| 401         | `unauthorized`                  | Token 缺失、无效、已过期或已吊销                                                            | 联系管理员确认 Token 状态        |
| 403         | `forbidden`                     | Token 不属于路径中的 Agent                                                                  | 检查 `agentId` 与 Token 是否匹配 |
| 404         | `not_found`                     | `conversationId` 不存在，或不属于当前 Token 的用户和 Agent                                  | 不传 `conversationId`，新建会话  |
| 409         | `agent_not_published`           | Agent 尚未发布                                                                              | 联系管理员发布 Agent             |
| 409         | `model_not_available`           | 指定的 `modelProvider` / `modelId` 不可用                                                   | 换一个模型，或不传模型字段       |
| 409         | `model_does_not_support_images` | 当前模型不支持图片                                                                          | 切换视觉模型，或不传图片         |
| 409         | `model_unavailable`             | 会话使用的模型已下线                                                                        | 新建会话，或传入其它模型         |
| 409         | `submission_failed`             | Agent 运行失败                                                                              | 稍后重试                         |
| 409         | `empty_answer`                  | Agent 没有返回内容                                                                          | 稍后重试                         |
| 500         | `internal_error`                | 服务端内部错误                                                                              | 稍后重试，持续出现请联系管理员   |
| 503         | `open_api_disabled`             | 平台未开启 Open API                                                                         | 联系管理员                       |

## 3. 会话说明

- 会话归属于 Token 上绑定的用户名和 Agent。只有同一用户名、同一 Agent 的 Token 才能继续该会话。
- Open API 会话与该用户在 Web 页面上的会话相互独立，互不可见。
- Open API 会话不支持 Web 端的交互卡片（选择、确认、表单）。Agent 只会返回纯文本回答。
- 通过 `modelProvider` / `modelId` 切换模型后，该会话后续的轮次会继续使用新模型。
- 同一会话的消息会按顺序处理。如果上一条消息尚未回答完，新消息会排队，等待时间会相应变长。

## 4. 超时与重试

- 接口在 Agent 回答完毕后才返回。耗时取决于模型和 Agent 调用的工具，可能从几秒到数分钟不等。客户端请把 HTTP 读超时设置得足够长，建议不少于 5 分钟。
- 服务端目前没有设置最长等待时间。
- 平台目前没有对调用频率做限制，请合理控制并发。

### 重试与幂等

- `idempotencyKey` 是 UUID，作用于已有会话：同一个 `conversationId` 下用相同的 `idempotencyKey` 重复提交，不会重复写入用户消息。
- 新建会话时（不传 `conversationId`），每次请求都会创建一个新会话，`idempotencyKey` 无法去重。如果新建会话的请求超时，重试会产生另一个会话。
- 建议：对 400、401、403、404 错误不要重试；对 409 中的 `submission_failed`、`empty_answer` 以及 500 可以退避后重试。

## 5. 示例

### 单轮对话

```bash
curl -X POST "$BASE_URL/api/open/chat/$AGENT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --max-time 300 \
  -d '{"message": "你好，介绍一下你自己"}'
```

### 多轮对话

```bash
curl -X POST "$BASE_URL/api/open/chat/$AGENT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --max-time 300 \
  -d '{
    "conversationId": "8f6c2b1e-4d5a-4c3b-9e2f-1a2b3c4d5e6f",
    "message": "继续展开第二点"
  }'
```

### 发送图片

```bash
IMG=$(base64 -w 0 ./screenshot.png)
curl -X POST "$BASE_URL/api/open/chat/$AGENT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --max-time 300 \
  -d "{\"message\": \"这张图里有什么问题？\", \"attachments\": [{\"mimeType\": \"image/png\", \"data\": \"$IMG\"}]}"
```

### Python

```python
import requests

BASE_URL = "https://example.com"  # 替换为平台地址
AGENT_ID = "<agentId>"
TOKEN = "<token>"


def chat(message: str, conversation_id: str | None = None) -> dict:
    body = {"message": message}
    if conversation_id:
        body["conversationId"] = conversation_id
    resp = requests.post(
        f"{BASE_URL}/api/open/chat/{AGENT_ID}",
        headers={"Authorization": f"Bearer {TOKEN}"},
        json=body,
        timeout=300,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"{resp.status_code}: {resp.text}")
    return resp.json()


first = chat("你好")
print(first["text"])
second = chat("继续", first["conversationId"])
print(second["text"])
```

### Node.js

```js
const BASE_URL = 'https://example.com' // 替换为平台地址
const AGENT_ID = '<agentId>'
const TOKEN = '<token>'

async function chat(message, conversationId) {
  const resp = await fetch(`${BASE_URL}/api/open/chat/${AGENT_ID}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, conversationId }),
    signal: AbortSignal.timeout(300_000),
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(`${resp.status}: ${data.error}`)
  return data
}

const first = await chat('你好')
console.log(first.text)
const second = await chat('继续', first.conversationId)
console.log(second.text)
```
