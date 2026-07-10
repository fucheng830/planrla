---
REQ-ID: REQ-030
标题: AI 自动重命名(10 轮触发)
日期: 2026-07-11
状态: spec
类型: feat
---

# REQ-030 AI 自动重命名(10 轮触发)

## 1. 背景

REQ-013(v0.8.0)实现了「会话重命名」,但只做了**手动**模式:用户敲 `/rename`(无标题版让 agent 生成,或带标题版直接用)。spec §9 明确排除了「增量自动命名」,理由是 YAGNI。

Archie 在使用中撞到这个缺口:手动 `/rename` 和 GUI 改名没本质区别(都要人介入),他要的是**当前对话的 provider(agent)自己根据对话内容生成标题,用户完全无感**。存量痛点(REQ-013 背景数据):4462 条会话标题里约 4400 条是首条消息全文(长/重复/无区分),codex 侧 62 条 `Untitled`——手动模式解决不了这些。

本需求补回 REQ-013 排除的「自动」:新会话进行到固定轮数后,由当前 provider 的 agent 自动生成标题写库。

## 2. 目标 / 非目标

**目标**:
- 新会话累计 **10 轮**对话后,当前 provider 的 agent 自动生成简短标题,写入 `sessions.custom_name`,侧边栏实时刷新。
- 用户完全无感:不手敲 `/rename`、不想标题、不看 agent 输出。
- 跨 provider:Claude / Codex / Grok 会话都能自动命名(`set_session_title` 已通过 MCP 注册给所有 provider)。

**非目标**:
- ❌ 存量回填(4462 条历史会话)—— YAGNI,只管新会话。
- ❌ 可配置/动态时机 —— 固定 10 轮,不做设置项(简化;若后续要再加)。
- ❌ server 端直接调 LLM API —— 继承 REQ-013 的架构转向,由 provider agent 生成。
- ❌ 改 systemPrompt / claude-agent-sdk 预设。
- ❌ 标题去重后缀、存量批量 retile。

## 3. 架构决策

**选路径 A:前端自动触发「无标题 rename hint」**,非路径 B(systemPrompt 引导 agent 自主)。

| 路径 | 做法 | 结论 |
|---|---|---|
| **A. 前端自动触发**(选) | 第 10 轮响应后,前端发起一次 silent agent 调用,内容 = `formatRenameCommandHint(sessionId)`(无标题版,REQ-013 已实现)→ agent 生成标题调 `set_session_title` | 复用 REQ-013 全套机制,**不改 server / 不改 MCP handler / 不改 DB / 不改 systemPrompt**;跨 provider 天然支持 |
| B. systemPrompt 引导 agent 自主 | systemPrompt 加"10 轮后生成标题调 set_session_title" | REQ-013 §9 已论证排除:要让 agent 自主须把 sessionId 注入 systemPrompt,有 claude-agent-sdk 追加 systemPrompt 的不确定性 + 影响所有会话 |

路径 A 的核心技术点:**「silent agent 调用」**——前端发起一次 agent 调用,但不渲染到 chat UI(用户看不见这次 turn),仅让 agent 调 MCP 工具产生写库副作用。两个实现子方案(plan 阶段定):

- **A1(推荐)**:复用现有 sendMessage 通道,加 `silent: true` 标志 → server 正常跑 agent,前端不渲染这条 turn 的用户消息和响应。
- **A2**:server 在响应完成后主动发起 agent 调用(前端零改,但新机制,工作量大)。

推荐 A1(最小改动,复用 chat 通道)。

## 4. 设计

### 4.1 触发条件(三条件全满足)

1. **轮数达标**:当前 session 累计 **assistant 响应数 ≥ 10**(1 轮 = 1 条 user 消息 + 1 条 assistant 响应;计数以 assistant 响应完成计)。
2. **会话未命名**:`sessions.custom_name` 为空 / `null` / 等于默认占位名(`Untitled` 等)—— 复用 REQ-013 现有守卫(同步器仅在 custom_name 为空或 Untitled 时覆盖)。
3. **未在生成中**:前端 in-flight ref 防重入(避免 10 轮边界多次触发)。

### 4.2 轮数定义

- 计数 = session 已持久化的 assistant 响应次数(从 `fetchHistory` 返回的 messages 里 role=assistant 计数,或 server 在 session 对象带 `assistantTurnCount`)。
- 只计已完成的 assistant 响应(stream_end / complete);进行中的不算。
- plan 阶段确认计数来源(前端 messages state vs server 返回字段)。

### 4.3 触发动作

第 10 次 assistant 响应完成、且条件满足时:
1. 前端 `useAutoRename` 调 `formatRenameCommandHint(sessionId)`(无标题版,复用 `useRenameCommand.ts` 现有函数)。
2. 前端发起 **silent agent 调用**:走当前会话 provider 的 sendMessage 通道,带 `silent: true` + 消息内容 = hint。
3. server 跑当前 provider 的 agent(与正常 chat 同路径),agent 看到 hint → 生成标题 → 调 `set_session_title(sessionId, title)` MCP 工具。
4. MCP handler(已有):`updateSessionCustomName` 写库 + WS 广播 `session_renamed`。
5. 前端侧边栏监听 `session_renamed`(REQ-013 已实现)→ 刷新标题。
6. 前端 in-flight ref 标记完成(后续轮数增加不再触发,且 custom_name 已非空,守卫也挡)。

### 4.4 不污染对话流(silent 调用)

silent 调用的 hint 消息和 agent 响应**不渲染到 chat UI**:
- 前端:`silent: true` 的消息不进 messages state、不显示气泡;agent 的流式响应也不渲染(副作用仅在侧边栏标题)。
- server:正常跑 agent(让它能调 MCP 工具),但知道这是 silent(不触发 UI stream,或 stream 了前端丢弃)。
- plan 阶段确认 server 接口形态(复用现有 chat WS 通道加 silent 标志,还是新开一个 `/api/auto-rename` 端点)。

### 4.5 跨 provider

- hint 发给**当前会话 provider** 的 agent(Claude / Codex / Grok / Cursor / OpenCode)。
- `set_session_title` 已通过 `addMcpServerToAllProviders` 注册给所有 provider(REQ-013 §5),每个 provider 的 agent 都能看到并调用该工具。
- 各 provider agent 调 MCP 工具的行为差异是风险点(§9),需测试验证(尤其 Codex / Grok)。

### 4.6 失败处理

- silent 调用失败(agent 没调工具 / 网络错 / 超时):**静默**,不阻塞对话、不弹错。
- 重试策略:本切片不做(失败就失败,用户可手动 `/rename`)。YAGNI。

## 5. 数据流

```
对话进行,每次 assistant 响应完成
  → 前端 useAutoRename 检查:
      assistantTurnCount >= 10
      && custom_name 为空/Untitled
      && !inFlight
  → 全满足:前端发起 silent agent 调用
      内容 = formatRenameCommandHint(sessionId)  // 无标题版,REQ-013 已实现
      silent: true
      provider = 当前会话 provider
  → server 跑 agent(不渲染 UI)
  → agent 生成标题 → 调 set_session_title(sessionId, title)
  → MCP handler(已有):
      updateSessionCustomName(sessionId, title)
      broadcast session_renamed { sessionId, title }
  → 前端侧边栏(已有监听)→ 标题刷新
  → inFlight = false(custom_name 已非空,后续不再触发)
```

## 6. 影响面 / 文件

| 文件 | 改动 |
|---|---|
| `src/components/chat/hooks/useAutoRename.ts`(新) | 触发逻辑:轮数检查、守卫条件、发起 silent 调用、in-flight 防重入 |
| `src/components/chat/hooks/useRenameCommand.ts`(已有) | **不改**,只复用 `formatRenameCommandHint` |
| sendMessage 通道(`useChatComposerState` / chat WS hook) | 加 `silent: true` 分支:前端不渲染、server 知道不 stream UI |
| server chat 路由 / WS handler | 识别 silent 调用,跑 agent 但不触发 UI stream(plan 确认接口形态) |
| session state(hooks) | 暴露 `assistantTurnCount` / `custom_name` 给 useAutoRename |
| **不改** | `session-query-mcp.route.ts`(set_session_title 已在)、`session-rename.service.ts`、DB schema、provider 矩阵、手动 `/rename`、侧边栏✏️ |

## 7. 验收标准

1. 新会话进行到**第 10 次 assistant 响应**完成后,侧边栏标题**自动**变成 AI 生成的简短标题(5-15 字),用户全程无操作。
2. 已有 `custom_name`(用户手改过 / AI 生成过 / 非 Untitled)的会话,**不触发**自动重命名。
3. silent 调用**不污染对话流**:chat UI 看不到 hint 消息和 agent 响应,只有侧边栏标题刷新。
4. **只触发一次**:后续(11、12…轮)不再重复触发。
5. **跨 provider**:Claude / Codex / Grok 会话都能自动命名(各验证一例)。
6. 失败静默:silent 调用出错 / agent 没调工具时,不阻塞对话、不报错。
7. 手动 `/rename`、侧边栏✏️、`query_session`、`search_conversations` 行为不受影响。
8. 落库后 DB `sessions.custom_name` 与新标题一致;不被后续 synchronizer 覆盖(现有守卫)。

## 8. 测试

- **useAutoRename 单元**:轮数计数(10 达标 / 9 不触发)、守卫(custom_name 非空不触发、inFlight 阻重入)、触发后发起 silent 调用参数正确。
- **silent 调用端到端**:触发 → agent 调 `set_session_title` → `custom_name` 更新 → 侧边栏收到 `session_renamed` 刷新。
- **不渲染 UI**:silent 调用的 hint 和响应不进 messages state / 不渲染气泡。
- **守卫**:已有标题不触发、只触发一次。
- **跨 provider**:mock 各 provider agent 调 `set_session_title`(重点 Codex / Grok,验证其 agent 调 MCP 工具的行为)。
- **失败静默**:agent 不调工具 / 调用超时,对话不中断、无错误冒泡。

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| silent 调用成本(每会话一次额外 agent turn) | 只触发一次 + 固定 10 轮(非每轮),成本可控;agent 用当前 provider(订阅额度,非额外 API 费) |
| agent 不调 `set_session_title` | hint 强指令("生成标题并调用 set_session_title");工具 description 已引导;失败静默不阻塞 |
| 轮数计数偏差 | 明确定义(assistant 响应完成计 1);plan 确认计数来源;9 vs 10 边界测试 |
| 跨 provider 行为差异(Codex/Grok agent 调 MCP 工具) | 各 provider 实测验证;若某 provider agent 不调工具,该 provider 静默失败(用户可手动) |
| silent 调用与正常 chat 的并发(用户在第 10 轮响应后立刻发新消息) | silent 调用排队 / 或与用户下一轮合并;in-flight 标记避免冲突;plan 阶段细化并发模型 |
| silent 调用失败让用户困惑(以为会自动命名却没有) | 静默失败可接受(用户可手动 /rename);后续可加"自动命名失败"小标记(P2,本切片不做) |

## 10. 状态机与发版

- BACKLOG 新增 **REQ-030**,状态 `backlog` → `spec`(本 spec)。
- 归属:下一个 feat 主题版 → minor(候选 `v0.9.0`,基线为已 released 的 `v0.8.1`;最终版本号由发版时点定)。
- 与 REQ-013 关系:REQ-013 = 手动重命名(已 released);REQ-030 = 自动重命名(本需求,独立 spec/plan)。两者共用 `set_session_title` MCP 工具 + `formatRenameCommandHint` + WS `session_renamed`,无冲突。

## 11. 与 REQ-013 的关系(复用清单)

| 复用项 | 说明 |
|---|---|
| `set_session_title` MCP 工具 | 完全复用,不改 handler |
| `formatRenameCommandHint(sessionId)`(无标题版) | 完全复用,不改 `useRenameCommand.ts` |
| `updateSessionCustomName` 写库 | 完全复用 |
| WS `session_renamed` 广播 + 侧边栏监听 | 完全复用 |
| 同步器"不覆盖非 Untitled 的 custom_name"守卫 | 完全复用,作为"只触发一次"的二道保险 |

REQ-030 只新增「触发时机判断 + silent 调用通道」,不动 REQ-013 的任何已发布代码。
