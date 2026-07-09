---
REQ-ID: REQ-013
标题: 会话重命名(chat 触发 · MCP 工具模式)
日期: 2026-07-09
状态: spec
类型: feat
---

# REQ-013 会话重命名(chat 触发 · MCP 工具模式)

## 1. 背景

BACKLOG 中 REQ-013「会话自动重命名(LLM 生成标题)」长期 `blocked`,卡点:server 端调 Claude Haiku 生成标题需要 `ANTHROPIC_API_KEY`,但 planrla 主路径走 Claude Code OAuth,server 拿不到 API key。存量痛点(摘自 BACKLOG):4462 条会话标题里约 4400 条是首条消息全文(长/重复/无区分),codex 侧 62 条 `Untitled`。

手动重命名**已全链路实现**(侧边栏 hover ✏️ → input → Enter/✓,落库 `sessions.custom_name`,后端 `PUT /api/providers/sessions/:sessionId`)。本需求不重复手动重命名,而是补「让 LLM 自动生成标题」的能力 —— 但用一条**绕过 blocked 的全新架构**。

## 2. 架构转向(核心决策)

**原 BACKLOG 方案**:server 端调 LLM(Haiku)生成标题 → blocked(OAuth 拿不到 API key)。

**新方案**:**不在 server 端调任何 LLM**。让 chat 里的 Claude Code agent(本身就是 LLM)根据对话内容生成标题文本,然后调用一个 planrla 暴露的 MCP 工具把标题写库。

这条路径直接消解 blocked:
- 不需要 `@anthropic-ai/sdk`、不需要 OAuth→API key 转换、不需要 Ollama;
- agent 已登录(OAuth 或 API key 都行,它本来就在跑),标题生成是它的原生能力;
- 落库仍走现有 `updateSessionCustomName`,与手动重命名同一条写入路径。

## 3. 设计

### 3.1 MCP 工具 `set_session_title`(载体)

在 `server/modules/mcp/session-query-mcp.route.ts` 现有 router 里加第 3 个工具(前两个:`query_session` / `search_conversations`):

| 字段 | 值 |
|------|-----|
| `name` | `set_session_title` |
| `description` | "Set a custom title for a conversation session on this host. Call this after generating a short descriptive title from the conversation content, or when the user asks to rename/retitle the current or a specific session." |
| `inputSchema` | `{ sessionId: string (required), title: string (required, 1-50 chars after trim) }` |
| handler | 同进程调 `sessionsDb.updateSessionCustomName(sessionId, title.trim())` → 广播 WS `session_renamed`(见 3.2)→ 返回 `{ sessionId, title }` |

`tools/list` 数组加入该工具;`callTool` 增加 `set_session_title` 分支。落库走现有 `updateSessionCustomName`(`sessions.db.ts:214`),**不改 DB schema**。

**⚠️ 写操作前提变更**:现有 route 顶部注释声明 "read-only",挂在 `validateApiKey`/`authenticateToken` 中间件之前。新增写工具后需更新注释:仍是 local-only single-user,写的是本机用户自己的会话标题(无越权面 —— 与已有 `PUT /sessions/:sessionId` 手动重命名等同的信任边界),但不再只读。

### 3.2 WS 推送 `session_renamed`(落库后刷新侧边栏)

agent 调 MCP 工具落库后,前端侧边栏需实时刷新。采用 **WS 推送**(Archie 指定):

- handler 落库成功后,广播 WS 事件 `session_renamed`,payload `{ sessionId, title, provider? }`。
- 复用现有广播范式:`server/utils/taskmaster-websocket.js` 的 `wss.clients.forEach(client => client.send(...))`,或经 `websocket-state.service.ts`(其设计目的即"让 broadcast 方不必直接持有 wss")。MCP handler 走后者,避免在 express router 里注入 wss。
- 前端:侧边栏监听 `session_renamed`,更新本地会话 state 并重渲染标题(复用现有 WS→sidebar 刷新通路,参照 `session_upserted` 监听模式;具体事件总线接入点 plan 阶段确认)。

### 3.3 `/rename` 斜杠命令(主入口)

照搬 `useSearchCommand.ts` 范式,但更简单(无需先调搜索 API):

- `parseRenameCommand(rawInput)`:解析 `/rename [可选用户给定标题]`,返回 `{ explicitTitle?: string }`。
- `formatRenameCommandHint({ sessionId, explicitTitle })`:拼装上下文块 prepend 进用户消息。两种形态:
  - 无显式标题:`[重命名当前会话 (id=<sessionId>)] 请根据本次对话内容,生成一个简短(5-15 字)的标题,并调用 set_session_title 工具写入。`
  - 有显式标题(`/rename 调试 WS 推送`):`[重命名当前会话 (id=<sessionId>)] 请用标题"调试 WS 推送"调用 set_session_title 工具写入。`
- 前端 composer 拦截 `/rename`(同 `/search`,不进 server `/api/commands/execute`),prepend hint 后 `sendMessage`。
- 注册到 `useSlashCommands.ts`,命令列表露出 `/rename`。

### 3.4 当前会话 sessionId 上下文

`/rename` 触发时,前端从当前活动会话 state 取 `sessionId`,拼进 hint(与 `@reference` hint 模式一致)。**不改 systemPrompt**(`claude-sdk.js:216` 固定 `preset: 'claude_code'`,避免影响所有会话 + SDK 追加 API 不确定性)。

MCP 工具注册后,agent 在对话中也能**自主调用**(如用户 @reference 某会话后说"给这个改个名")—— 这是工具 description 引导的免费副产品,无需额外工作。

### 3.5 标题约束

- 长度 1-50 字符(trim 后);空标题拒绝(保留现有默认名,不写空串)。
- 后端校验:在 MCP handler 内复用 `parseSessionRenameSummary`(`provider.routes.ts:299`)的 trim/长度校验模式,收紧上限到 50。
- 不做去重后缀(`#2`):YAGNI,允许同名。

## 4. 数据流

```
用户输入 /rename (或 /rename <标题>)
  → 前端 composer 拦截,parseRenameCommand
  → formatRenameCommandHint(当前 sessionId + 指令)
  → hint 块 prepend 进 messageContent → sendMessage
  → claude-sdk query() 跑 agent
  → agent 生成标题(或采用用户给的)→ 调 MCP 工具 set_session_title(sessionId, title)
  → MCP handler:
      1) updateSessionCustomName(sessionId, title)  // 同进程写库
      2) broadcast session_renamed { sessionId, title }  // WS 推送
      → 返回 { sessionId, title }
  → agent 回复"已重命名为 <title>"
  → 前端侧边栏收到 session_renamed WS 事件 → 更新本地 state → 显示新标题
```

## 5. 影响面 / 文件

| 文件 | 改动 |
|------|------|
| `server/modules/mcp/session-query-mcp.route.ts` | 加 `set_session_title` 工具定义 + `callTool` 分支;handler 调 `updateSessionCustomName` + 广播 `session_renamed`;更新顶部 read-only 注释 |
| `server/utils/` 或 `server/modules/websocket/` | 新增/复用 `broadcastSessionRenamed` helper(参照 `taskmaster-websocket.js`) |
| `src/components/chat/hooks/useRenameCommand.ts`(新) | `parseRenameCommand` + `formatRenameCommandHint`(参照 `useSearchCommand.ts`) |
| `src/components/chat/hooks/useChatComposerState.ts` | composer 拦截 `/rename`(参照 `/search` 拦截点 ~L584) |
| `src/components/chat/hooks/useSlashCommands.ts` | 注册 `/rename` 命令露出 |
| 侧边栏 hook(`useSidebarController.ts` 或 WS 监听层) | 监听 `session_renamed`,更新会话 state |
| `src/i18n/locales/*/chat.json` + `sidebar.json` | `/rename` 命令文案 + 工具结果/提示文案(各语言同步) |

**不改**:DB schema(`custom_name` 列已有)、provider 矩阵(MCP 已 `addMcpServerToAllProviders` 注册给所有 provider)、手动重命名链路(侧边栏 ✏️ 保留)。

## 6. 验收标准

1. 在 chat 输入 `/rename`,agent 调 `set_session_title`,侧边栏对应会话标题实时更新为新标题。
2. `/rename <显式标题>` 直接采用用户给的标题落库。
3. MCP `tools/list` 返回含 `set_session_title`;其 description 足以让 agent 在自然语言("重命名当前会话为 X")+ 已知 sessionId 场景下自主调用。
4. 空 title 或 trim 后 > 50 字符被拒绝(handler 返回错误,不写库)。
5. WS `session_renamed` 事件被正确广播,前端侧边栏监听后刷新(无需手动刷新页面)。
6. 现有手动重命名(侧边栏 ✏️)、`query_session`、`search_conversations` 行为不受影响。
7. 落库后 DB `sessions.custom_name` 与新标题一致;重命名不会被后续 synchronizer 覆盖(现有守卫:`custom_name` 非 Untitled 时同步器不覆盖)。

## 7. 测试

- **MCP 工具单元**:`tools/list` 含 `set_session_title`;`callTool` 正确落库(`updateSessionCustomName` 被调用,DB 值更新);空/超长 title 校验拒绝;未知工具名仍报错。
- **WS 推送单元**:落库成功后 `broadcastSessionRenamed` 被调用,payload `{ sessionId, title }` 正确;落库失败不广播。
- **`/rename` 命令单元**:`parseRenameCommand` 正确解析有无显式标题;`formatRenameCommandHint` 输出含当前 sessionId;composer 正确拦截并 prepend。
- **前端刷新单元**:收到 `session_renamed` WS 事件后,侧边栏对应会话 state 更新。
- **e2e**:输入 `/rename`,agent 完成工具调用,侧边栏标题变更;输入 `/rename 调试 WS`,标题变为"调试 WS"。

## 8. 风险与对策

| 风险 | 对策 |
|------|------|
| MCP route 从只读变写,破坏原"read-only 所以免 auth"论证 | 更新顶部注释:local-only single-user + 写本机自己的会话标题,信任边界等同已有 `PUT /sessions/:sessionId`;无新增越权面 |
| MCP handler 广播 WS 需要 wss,但 express router 不持有 | 走 `websocket-state.service.ts`(设计即为此),不在 router 注入 wss |
| agent 不主动调 `set_session_title` | `/rename` hint 明确指令"调用 set_session_title 工具";工具 description 写清调用时机 |
| synchronizer 后续覆盖用户/AI 标题 | 复用现有守卫:同步器仅在 `custom_name` 为空或等于 Untitled 占位名时覆盖;AI 生成的标题非 Untitled,不会被冲掉 |
| 跨 provider(Codex 会话) | 工具按 sessionId 写库,与 provider 无关;Codex 会话同样可被命名(agent 用同一 Claude LLM 生成标题) |

## 9. 不做(YAGNI / 明确排除)

- ❌ 增量自动命名(新会话同步时自动生成)—— 触发场景定为"只手动单个"
- ❌ 批量 retile-all(回填存量 4462 条)
- ❌ server 端调 LLM(整个 blocked 问题被架构转向绕过)
- ❌ 标题去重后缀(`#2`)
- ❌ 常驻 sessionId 注入 systemPrompt(P2 增强,需验证 claude-agent-sdk 追加 systemPrompt API,本切片不做)

## 10. 状态机与发版

- BACKLOG 中 REQ-013 状态:`blocked` → `spec`(架构转向消解 blocked 根因)。
- 本切片归属:下一个 feat 主题版 → minor(候选 `v0.8.0`,基线为已 released 的 `v0.7.1`/REQ-026 patch;最终版本号由发版时点定)。
- BACKLOG 备注 应同步更新:记录架构转向(chat 触发 MCP 工具,非 server 调 LLM)。
