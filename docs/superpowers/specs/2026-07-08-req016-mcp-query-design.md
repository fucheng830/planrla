---
REQ-ID: REQ-016
title: 跨会话上下文共享 —— MCP 定点查询(L2)
date: 2026-07-08
status: spec
owner: Archie
supersedes: 2026-07-07-req016-context-share-design.md(v1 client preload,因"全量塞 prompt 慢+渲染卡"被否)
---

# REQ-016 L2:跨会话上下文共享 —— MCP 定点查询

## 背景 + 为何弃 v1

v1(client prepend 全文)实施完成(9 task,feat 分支)后,Archie 复测抓到**设计缺陷**:整段历史模式默认把被引 session 全部消息(实测 375 条 / 98k token)塞进 `content`,导致:
1. **会话慢**:LLM 收到 98k token prompt → 推理慢 + 贵。
2. **渲染卡**:巨大 `content` 进 MessageComponent(state 持有 + String() 操作 + 展开引用块渲染)→ DOM 拖死。

根因:**"把 A 的内容全塞给 B"这个机制本身错**。Archie 定方向 A(agent 自主查),并明确先做 **MCP 模式**(planrla 已有 MCP 基建,Provider 无关现成可保),A2A(agent 间实时对话,hermes-a2a 那套)留 L3。

**核心转变**:从"把 A 的内容塞给 B"→ **"告诉 B 有个工具能查 A,B 按需查"**。prompt 始终很小(工具定义 + 几行提示),慢/卡/成本从根上消失。

## 复用探查(已确认)

| 假设 | 探查结果 | 文件 |
|---|---|---|
| 各 provider 支持 MCP | 命中:claude/codex/cursor/gemini/opencode 全有 `*-mcp.provider.ts` + `mcp.service.ts` 注册 stdio/http MCP server | `server/modules/providers/` |
| session 消息查询 API 已有 | 命中:`api.unifiedSessionMessages(sessionId, provider)` + server 端 sessions 服务 | `src/utils/api.js`、`server/modules/providers/services/sessions.service.ts` |
| v1 的 UI 可复用 | 命中:picker(含跨-project search)+ chip + i18n + Ctrl+L + `useSessionReferences` hook —— 全保留,只换注入层 | feat 分支 T1-T4,T6,T8 |
| MCP SDK 可用(TS) | `@modelcontextprotocol/sdk`(Node,需装)—— planrla 目前**只配置外部 MCP server,未自托管**;自托管内部 MCP server 是新基建 | (新依赖) |

## 设计

### §1 机制(Always-on 内部 MCP server)

- planrla **自托管一个内部 MCP server**(HTTP/SSE,挂在 planrla server 上,路由如 `/api/mcp/internal`),暴露 `query_session` 工具。
- **一次性注册**:planrla 启动时(或首次有 session 时)通过 `providerMcpService.upsertServer` 把这个内部 MCP server(HTTP transport,URL=`http://localhost:<planrla-port>/api/mcp/internal`)注册给各 provider。
- 注册后**常驻**:agent 之后对话时始终有 `query_session` 工具可用,不随 @reference 动态挂摘。
- 实现:用 `@modelcontextprotocol/sdk` 的 `Server` + HTTP transport(或手写一个最小 JSON-RPC 端点,覆盖 `initialize`/`tools/list`/`tools/call`)。

### §2 工具接口

```
query_session
  params: {
    sessionId: string,        // 必填,被引 session 的 id
    query?: string,           // 可选,关键词搜消息内容(不区分大小写子串)
    range?: { start?: number, end?: number }  // 可选,消息索引区间(0-based)
  }
  returns: {
    messages: Array<{ role: 'user'|'assistant'|string, content: string, timestamp?: string }>,
    total: number,            // 该 session 消息总数
    truncated: boolean        // 是否截断(单次返回上限,见 §6)
  }
```

- `query` 非空 → 在 session 消息里子串搜(命中消息 + 各前后 1 条上下文),返回命中集(去重 + 按时间排)。
- `range` → 取 `[start, end)` 区间(支持"最近 N 条":`range={start: total-N, end: total}`)。
- 两者都缺 → 返回最近 20 条(兜底)。
- 走 `sessions.service` 查(复用现有 session 消息读取,不新开数据路径)。

### §3 @reference = 加"提示行"(不再塞内容)

`useChatComposerState.handleSubmit`(替换 v1 的全文 prepend)改为**只 prepend 一行提示**到 `content`:

```
[可查询引用:「<title>」(id=<sessionId>, <provider>)] 用 query_session 工具按需查它的内容。
```

- 每个引用一行(~50 token)。多引用多行。
- **不再塞被引 session 的消息全文**。content 体积 = 用户问题 + N×50 token 提示(恒小)。
- 聊天记录里那条用户消息:显示用户问题 + 一个**"📎 可查: <title>"小标签**(不再有折叠引用块 —— 因为没有全文可折叠了)。

### §4 数据流

```
@reference(sessionA) via picker
  → useSessionReferences 加引用 state
  → chip 显示「🔗 可查:<title>」
用户打字 + 发送
  → handleSubmit:content = "<提示行(s)>\n\n<用户问题>"
  → sendMessage(chat.send, content)  // 不含被引 session 全文
agent(Claude/Codex/…)收到 content
  → 看到提示行 + 已注册的 query_session 工具
  → 自主决定:要不要查?查什么?(如"auth 怎么做的")
  → 调 query_session(A_id, "auth")
  → planrla MCP server(server 端)→ sessions.service 查 A 的消息 → 返回命中片段
agent 用返回片段推理 → 回复用户
```

### §5 复用 feat 分支 UI + 替换注入层(关键简化)

**关键简化**:L2 不 preload 消息 → `SessionReference` 类型**砍掉 `mode` / `messages` 字段**,只剩 `{id, sessionId, title, provider, date}`。连带 v1 的"模式选择(单条/整段)""消息选择器""chip 编辑/截断面板"**全删** —— UI 比以为的更轻。

| v1 task | L2 处置 |
|---|---|
| T1 sessionReferenceFormat(纯逻辑)| **大改**:删 `formatReferenceBlock`/`parseQuotedReference`/`SessionReferenceMode`/`ReferencedMessage`;`SessionReference` 瘦身为 `{id, sessionId, title, provider, date}`;新 `formatReferenceHint(ref)`(一行提示)。`estimateTokens` → 删(chip 不再显示 token,提示恒小)。测试随之改。 |
| T2 useSessionReferences hook | **简化**:只留 `references` + `addReference` + `removeReference` + `clearReferences` + `formattedHints`(拼好的提示行);删 `updateReferenceMessages`/`trimToFirstN`/`totalTokens`/`buildReference`/`mode`。 |
| T3 SessionReferencePicker | **简化**:选 session → 直接 `onConfirm(sessionId, title, provider)`(一步)。删模式选择(整段/单条)、消息选择器、api.unifiedSessionMessages 调用(picker 不再拉消息)。跨-project search **留**。 |
| T4 SessionReferenceChip | **简化**:只显示「🔗 可查:「<title>」(id=<short>)」+ 删除 ×。删展开/编辑/截断面板、token 显示。 |
| T5 composer 注入 | **改**:`handleSubmit` prepend 全文 → prepend `formattedHints`(每引用一行)。Ctrl+L 留。 |
| T6 ChatComposer 接线 | **留**(按钮 + chip 区 + Picker 挂载;props 随 T2-T4 简化调整)|
| T7 MessageComponent 折叠块 | **删**:content 不含全文 → 无折叠块;用户消息可选加一个"📎 可查 N 个引用"小标签(轻量,不展开) |
| T8 i18n | **改**:references 段 keys 调整(chipFrom → queryableFrom 等;删 trim/edit/save 相关)|
| 新 T_mcp:**内部 MCP server** | **新**:server 端 `query_session` 工具 + MCP 协议端点 + 一次性注册给各 provider |

### §6 token / 返回上限(MCP 工具结果)

- `query_session` 单次返回**最多 20 条消息**或 **~4k token**(取先到);超了 `truncated=true`,agent 可缩小 `query`/`range` 再查。
- 防止工具结果本身变巨大(把慢/卡从 prompt 端挪到工具结果端就白搞了)。

### §7 Provider 矩阵

- Claude / Codex / Cursor / Gemini / OpenCode 全有 MCP 支持 → **Provider 无关保住**。
- 注册走 `providerMcpService.upsertServer`(每个 provider 一条),失败不阻塞(某 provider 不支持 MCP 时跳过 + warn)。

### §8 注册时机 + 安全

- **注册**:planrla server 启动时一次性注册给所有 provider(scope: user 或 global,不随 project 变)。
- **查询鉴权**:MCP server 收到 `tools/call` 时,校验调用方是本地 planrla(本地 HTTP,不对外;若对外需加 bearer,复用 planrla 现有 auth)。session 数据查询复用现有 sessions.service 的权限模型(本地单用户,全可查)。

## 验收标准

1. **内部 MCP server 跑**:planrla server 暴露 `/api/mcp/internal`(或等价),实现 MCP 协议(`initialize`/`tools/list`/`tools/call`),`tools/list` 含 `query_session`。
2. **一次性注册**:planrla 启动时把内部 MCP server 注册给所有支持 MCP 的 provider(各 `*-mcp.provider.ts` upsert);agent 对话时能看到 `query_session` 工具。
3. **@reference 加提示行(非全文)**:chip 出现 → 发送时 content 只 prepend 一行提示(`[可查询引用:「...」(id=..., ...)]`),**不含被引 session 消息全文**。content 体积恒小(用户问题 + N×~50 token)。
4. **agent 自主查**:agent 收到提示 + 工具 → 能调 `query_session(sessionId, query/range)` → 拿回命中消息片段。
5. **查询上限**:单次 `query_session` 返回 ≤20 条 / ≤4k token,`truncated` 正确。
6. **Provider 无关**:Claude / Codex / Cursor / Gemini / OpenCode 都能注册 + 用(Codex/Gemini 若 MCP 支持有差异,记录在 release notes,不阻塞)。
7. **性能**:content 不随引用大小膨胀(对比 v1 的 98k token → 现在 <1k token);无渲染卡(无折叠大块)。
8. **回归**:v1 的 picker / chip / 跨-project search / Ctrl+L / i18n 不受影响;现有 `@` 文件 / `/` slash / 图片附件 / `Tab` 权限 不受影响。
9. **预检三件套过**:typecheck + build + git diff --check。

## 非目标(L3+ / 后续)

- ❌ **A2A**(agent 间实时对话,hermes-a2a 模式:注入对方跑着的 session、webhook 即时唤醒、对等)→ L3,需要 live agent 通信 + 安全栈。
- ❌ **内容 preload**(v1 全文塞,已否)。
- ❌ **折叠引用块渲染**(随 preload 一起去掉)。
- ❌ **chip 编辑/截断面板**(无全文可编辑;chip 只表达"可查")。
- ❌ **跨设备**(L3,需 relay)。

## 影响文件(预估)

| 文件 | 动作 |
|---|---|
| `server/modules/mcp/internal-mcp.server.ts`(新)| 内部 MCP server:`query_session` 工具实现 + MCP 协议端点 |
| `server/modules/mcp/internal-mcp.route.ts`(新)| HTTP/SSE 路由挂到 planrla server(`/api/mcp/internal`)|
| `server/modules/providers/services/mcp.service.ts` 或 startup(改)| 启动时一次性注册内部 MCP server 给各 provider |
| `src/components/chat/utils/sessionReferenceFormat.ts`(改)| `formatReferenceBlock`→`formatReferenceHint`;删 `parseQuotedReference` |
| `src/components/chat/hooks/useChatComposerState.ts`(改)| handleSubmit:prepend 提示行(非全文)|
| `src/components/chat/view/subcomponents/SessionReferenceChip.tsx`(改)| 视觉:🔗 可查 + 删编辑/截断面板 |
| `src/components/chat/view/subcomponents/MessageComponent.tsx`(改)| 删 UserMessageBody 折叠块;可选加"📎 可查"标签 |
| `src/i18n/locales/{en,zh-CN}/chat.json`(改)| references 段 keys 调整 |

(精确文件路径 + MCP SDK 选型在 writing-plans 阶段核对。)
