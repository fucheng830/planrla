# nomad 多端 API Contract 草案

## 目标

这份文档用于约束 Web、Desktop、Android 与后端之间的基础协议。P0 阶段先覆盖多端必须共享的对象、状态和事件，后续再演进为版本化 schema。

## 客户端

- Web：`src/`
- Desktop：`electron/` + Web UI
- Android：`apps/android/`
- API：`server/`

## 基础约定

- REST API 默认以 `/api` 开头。
- 认证使用 `auth-token`，前端通过 `Authorization: Bearer <token>` 发送。
- WebSocket 与 API 使用同一后端端口。
- 所有客户端都必须将 `sessionId` 视为稳定的应用层会话 ID，不直接依赖 Provider 原生会话 ID。
- 后端错误必须返回可展示的 `message` 或 `error` 字段。

## 核心状态模型

### SessionTaskStatus

所有端统一使用以下任务状态：

| 状态 | 含义 | 是否终态 | 用户动作 |
|---|---|---:|---|
| `idle` | 无活动任务 | 否 | 无 |
| `running` | Provider 正在执行 | 否 | 可查看、可中断 |
| `waiting_for_input` | 等待用户权限或输入 | 否 | 需要处理 |
| `completed` | 任务成功完成 | 是 | 可查看结果 |
| `failed` | 任务失败结束 | 是 | 查看错误或重试 |
| `needs_attention` | 任务结束但需要用户关注 | 是 | 查看详情 |

前端共享实现位于：

```text
src/shared/taskStatus.ts
```

Android 应同步这组枚举，不新增只在移动端存在的状态。

## REST API P0 范围

### 认证

```text
GET  /api/auth/status
POST /api/auth/login
POST /api/auth/register
GET  /api/auth/user
POST /api/auth/logout
```

### 项目与会话

```text
GET  /api/projects
GET  /api/projects/:projectId/sessions
POST /api/providers/sessions
GET  /api/providers/sessions/:sessionId/messages
GET  /api/providers/sessions/running
```

### 授权

```text
GET    /api/license/status
POST   /api/license/activate
DELETE /api/license/activate
```

### Provider

```text
GET /api/providers/capabilities
GET /api/providers/:provider/auth/status
GET /api/providers/:provider/models
```

## WebSocket P0 范围

### 客户端发送

```json
{
  "type": "chat.send",
  "sessionId": "app-session-id",
  "provider": "claude",
  "command": "user input"
}
```

```json
{
  "type": "chat.subscribe",
  "sessions": [
    {
      "sessionId": "app-session-id",
      "lastSeq": 12
    }
  ]
}
```

### 服务端事件

| `kind` | 说明 |
|---|---|
| `chat_subscribed` | 返回会话运行态和待处理权限 |
| `stream_delta` | 流式文本增量 |
| `stream_end` | 流式文本结束 |
| `text` | 普通文本消息 |
| `tool_use` | 工具调用 |
| `tool_result` | 工具结果 |
| `permission_request` | 等待用户授权，客户端映射为 `waiting_for_input` |
| `permission_cancelled` | 权限请求取消 |
| `complete` | 任务终态，客户端映射为 `completed` 或 `failed` |
| `protocol_error` | 协议错误，客户端应停止对应会话 loading |
| `session_upserted` | 会话元数据更新 |
| `loading_progress` | 后台扫描进度 |

## Android 接入约束

- Android 首期只覆盖项目、会话、任务状态、完成提醒、继续对话和轻量审批。
- Android 不直接解析 Provider 本地文件，不读取桌面端本地数据库。
- Android 与后端连接失败时必须显示当前后端地址、网络建议和重试入口。
- Android 的完成提醒应以 `SessionTaskStatus` 为唯一状态来源。

## 后续演进

- 为 REST 和 WebSocket 增加 schema 文件。
- 给 API contract 增加版本号。
- 将共享类型抽到 `packages/shared`。
- 增加 contract test，保障 Android/Web/Desktop 不被后端改动破坏。
