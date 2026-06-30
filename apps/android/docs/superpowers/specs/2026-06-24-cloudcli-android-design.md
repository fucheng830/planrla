# Planrla Android 客户端 设计

## Context

Archie 要手机原生 app 控制家里的 Claude Code。Planrla(siteboon/claudecodeui)已部署在 0.13:3002(nssm 服务,常驻 + 开机自启),提供 React web UI + REST/WebSocket API。web 版手机浏览器能用,但 Archie 要原生 app(更好 UX + 后台 + 推送潜力)。

本设计:**原生 Android(Kotlin + Compose)客户端,调 Planrla 后端 API**。后端不动,只做安卓前端。手机经 Tailscale 连 0.13:3002。

## MVP 范围(B)

- 登录(连 Planrla server)
- 项目 / session 列表 + 新建 session
- chat:发消息 + 流式回复(逐 token)
- 工具调用卡片(tool_use / tool_result,折叠)
- 权限审批(Allow / Deny)

## 非目标(MVP 不含)

推送通知(FCM)、shell 终端、文件/git 浏览、离线缓存 —— 后续。

## 架构

单 Activity + Compose Navigation。分层:

- **ui**:Compose screens + PermissionDialog
- **viewmodel**:MVVM + StateFlow
- **data**:Retrofit(REST)+ OkHttp WebSocket(chat)+ DataStore(JWT / URL)

流式:`WebSocketListener` → `Channel<ChatEvent>` → ViewModel collect → Compose 增量 append(只更新最后一条消息,不重建列表)。

## 数据契约(Planrla API)

### REST(Header:`Authorization: Bearer <JWT>`)

- `POST /api/auth/login` `{username,password}` → `{token,...}`
- `GET /api/auth/user`
- `GET /api/projects` → 项目列表(project_id, project_path, custom_project_name, session 数)
- `GET /api/projects/:projectId/sessions?offset&limit` → 分页 sessions
- `POST /api/projects/create-project`
- `GET /api/providers/:provider/sessions/:sessionId` → session 详情
- `GET /api/providers/sessions/:sessionId/messages` → 历史 NormalizedMessage

### WebSocket

- URL:`ws://<host>:<port>/ws?token=<JWT>`(token 在 query,因 WS 不能设 header)
- Server → Client:`NormalizedMessage`(JSON),`kind` 字段区分类型
- Client → Server:
  - 发消息(claude):`{type:'claude-command', command:<prompt>, options:{sessionId?, cwd?}}`
  - 权限审批:`{type:'claude-permission-response', requestId, allow, [updatedInput], [message], [rememberEntry]}`
  - 其他 client type:`abort-session`、`check-session-status`、`get-pending-permissions`、`get-active-sessions`

### NormalizedMessage(`server/shared/types.ts`)

字段:`id, sessionId, timestamp, provider, kind, role?, content?, toolName?, toolInput?, toolId?, toolResult?{content?,isError?,toolUseResult?}, requestId?, input?, reason?, newSessionId?, status?, isError?, tokens?, text?, canInterrupt?, sequence?`

**MessageKind:** `text | tool_use | tool_result | thinking | stream_delta | stream_end | error | complete | status | permission_request | permission_cancelled | session_created | interactive_prompt | task_notification`

## ChatEvent 模型(sealed class)

| MessageKind | ChatEvent | 用到的字段 |
|---|---|---|
| stream_delta | TextDelta | content(增量文本) |
| text | TextMessage | content, role |
| thinking | Thinking | content |
| tool_use | ToolUse | toolName, toolInput, toolId |
| tool_result | ToolResult | toolId, toolResult{content,isError} |
| permission_request | PermissionRequest | requestId, toolName, input |
| permission_cancelled | PermissionCancelled | requestId |
| stream_end | StreamEnd | — |
| error | Error | content/reason, isError |
| session_created | SessionCreated | newSessionId |
| complete | Complete | — |
| status/interactive_prompt/task_notification | Status(或忽略) | status |

ToolResult 按 `toolId` merge 进对应 ToolUse 卡片。

## Screens + 数据流

1. **ConnectScreen**:输入 server URL + username/password → `POST /api/auth/login` → 存 JWT(DataStore)→ 进 Projects。
2. **ProjectsScreen**:`GET /api/projects` → 卡片(项目名 + session 数)→ 点进 Sessions。
3. **SessionsScreen**:`GET /api/projects/:id/sessions` → 列表 + "New Session" → 点进 Chat。
4. **ChatScreen**:WS 连(`/ws?token`)→ 发消息 → 收 ChatEvent:
   - TextDelta → append 到当前 assistant 气泡(增量,不重建列表)
   - ToolUse → 工具卡片(折叠,显示 toolName + input)
   - ToolResult → merge 进卡片(显示 result)
   - PermissionRequest → PermissionDialog(Allow/Deny)→ 发 claude-permission-response
   - StreamEnd → 标记完成
   - Error → 错误气泡

## 关键实现点

1. **流式增量渲染**:TextDelta 只更新最后一条 assistant 气泡的 text(Compose state 局部更新),不重建整个 LazyColumn —— 避免 m5 那种 innerHTML 全重建卡顿。
2. **WS 认证**:token 在 query string(`?token=`)。JWT 过期:401 → 提示重登(Planrla 有 #754 JWT refresh issue,MVP 不做自动 refresh)。
3. **WS 重连**:OkHttp 自动重连 + 指数退避。
4. **权限队列**:多个 PermissionRequest 排队,逐个 dialog。
5. **Markdown**:回复文本用 Compose-markdown 渲染。
6. **配置持久化**:server URL + JWT 存 DataStore。

## 技术决策

- 仓库:`apps/apps/android`(Kotlin,Gradle KTS)
- minSdk 26(Android 8+),targetSdk 最新
- Kotlin + Jetpack Compose + Navigation + Lifecycle ViewModel
- Retrofit + OkHttp(WebSocket)+ kotlinx.serialization
- DataStore(Preferences)+ Coroutines / Flow
- Compose-markdown 做 markdown 渲染

## 待确认(实现第一步,扒 Planrla 源码 / 抓真实报文)

1. client→server 发消息的 `type` 精确值(读 `chat-websocket.service.ts` 或抓真实 WS 报文)。
2. permission_request 的精确字段(requestId 确认 + toolName/input 字段名)。
3. projects/sessions REST 返回的精确 JSON 形状(读 `projects.routes.ts` / `provider.routes.ts` 或 curl 实测)。

## 验证

1. 登录 + 列项目/sessions(REST)。
2. chat 流式:发消息,验证 TextDelta 逐 token append(不卡顿)。
3. 工具调用:触发工具(如让 claude 读文件),验证 ToolUse 卡片 + ToolResult merge。
4. 权限:触发权限请求(危险工具),验证 PermissionDialog + Allow/Deny 生效。
5. 断线:网络断/切后台,验证 WS 重连 + 重连后 refresh session messages 不丢。
