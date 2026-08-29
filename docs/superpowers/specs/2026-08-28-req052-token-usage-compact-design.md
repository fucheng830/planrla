# REQ-052 技术方案:令牌用量按钮 hover 详情卡片 + 点击自动压缩上下文

> REQ-ID: REQ-052
> 状态: spec(待评审)
> 日期: 2026-08-28
> 目标组件: `src/components/chat/view/subcomponents/TokenUsageSummary.tsx`
> 关联: kanban task #1 阶段「技术方案」

## 1. 需求概述

聊天输入框的令牌用量按钮(当前点击弹 `/cost` 模态)改为:

1. **hover popover**:悬停约 150ms 在按钮上方浮出详情卡片——已用总 token、输入/输出拆分、上下文窗口占用比例、可见消息数;移开即消失。蓝白设计语言(白底、`primary/40` 边框、圆角阴影),视觉对齐命令面板。
2. **点击 = 触发当前会话自动压缩**(语义对齐 claude CLI `/compact`):压缩期间按钮 loading;完成后用量数字刷新。`/cost` 斜杠命令与模态本身保留,仅移除按钮 → 模态的绑定。
3. **Provider 范围**:claude 优先实现;zcode/codex 等其余 provider 返回「暂不支持」提示。

## 2. 现状与数据链路(探索结论)

| 链路 | 现状 |
| --- | --- |
| tokenBudget 数据 | `claude-sdk.js` `extractTokenBudget()` 从 SDK usage 提取 `{ used, total(=CONTEXT_WINDOW||160000), inputTokens, outputTokens, cacheRead/CreationTokens, breakdown{input,output} }`,经 WS `status{ text:'token_budget', tokenBudget }` 推送;初始加载走 REST `GET /api/projects/:projectId/sessions/:sessionId/token-usage` |
| 按钮 | `TokenUsageSummary.tsx`(纯展示,`onClick` prop)→ `ChatComposer.tsx` 传 `onShowTokenUsage` → `ChatInterface.tsx` 传 `showCostModal` |
| `/cost` 模态 | `useChatComposerState.showCostModal()` 合成 `/cost` 命令 → `POST /api/commands/execute` → `CommandResultModal` 的 `CostContent`;斜杠命令输入路径独立于按钮 |
| WS 协议 | `server/modules/websocket/services/chat-websocket.service.ts` 分派 `chat.send / chat.abort / chat.subscribe / chat.permission-response`;每次 `chat.send` 新起一次 SDK `query({ prompt, options:{ resume } })`(per-turn 模型),`chatRunRegistry` 提供 per-session 互斥与 `complete` 终态帧 |
| 压缩生态 | SDK `@anthropic-ai/claude-agent-sdk@0.3.165` **无原生 compact() API**,但 CLI 处理斜杠命令(sdk.d.ts `initialPrompt`:"Slash commands are processed");compact 后 transcript 追加 `compact_boundary`(system 行,normalizeMessage 不产出 UI 消息)+ `isCompactSummary` 合成行——`claude-sessions.provider.ts:474` **已**将其转为 assistant 摘要消息,前端 `useChatMessages.ts:48` 已透传 |
| 能力矩阵 | `provider-capabilities.service.ts` 已有 `supportsAbort / supportsTokenUsage` 等字段,前端据此渲染 UI,是既定扩展点 |
| 视觉参照 | 命令面板 `CommandMenu.tsx`:`bg-white/95 dark:bg-slate-950/95`、8px 圆角、大阴影、blur;`Tooltip.tsx` 提供了 portal + fixed 定位 + delay 计时的现成模式 |

## 3. 架构选型(压缩触发机制)

### 方案 A(推荐):`chat.compact` 消息 → 复用 per-turn query,prompt = `/compact`

服务端新增 WS 消息类型 `chat.compact`,处理函数复用 `chat.send` 的全部基础设施(会话行解析 → `chatRunRegistry.startRun` → `spawnFns[claude]`,即 `queryClaudeSDK`),仅把 prompt 固定为 `'/compact'`。压缩在 CLI/SDK 内部完成:总结历史 → 以摘要替换上下文 → transcript 写入 summary + boundary。

- **优点**:改动面最小(服务端约 +60 行,`claude-sdk.js` 零改动);run 互斥、`complete` 终态、abort、`token_budget` 推送、摘要消息展示全部自动复用;与「per-turn resume」运行时模型完全一致。
- **缺点**:依赖 CLI 在 headless/SDK 下对 `/compact` 的处理(见 §6 风险 R1,spike 前置验证)。

### 方案 B(否决):streaming-input 常驻连接改造

把会话改为常驻 SDK streaming-input 连接,中途发 `/compact`。需要重写「per-turn resume」运行时核心(会话生命周期、writer 重连、事件序列),工程量与风险远超需求边界,收益(时延)与本需求无关。

### 方案 C(否决):自研压缩

服务端手读 transcript → 调模型总结 → 写回/新开会话。破坏 CLI transcript 生态(boundary/summary/replay 语义),且与 CLI 升级强耦合。YAGNI。

### 前端 popover 取舍

- **自研轻量 popover**(采用):portal + fixed 定位 + 150ms 计时,模式照抄 `Tooltip.tsx`;富内容卡片不适合黑底 `Tooltip`,也不为单组件引入 radix `Popover` 新依赖(项目 radix 依赖仅 tabs)。
- **数据源**:全部来自前端已有 state(`tokenBudget`、`visibleMessages.length`、`totalMessages`),**零新增请求**;`/cost` 模态改为仅供斜杠命令使用。

## 4. 详细设计

### 4.1 服务端

```
chat.compact { sessionId }
  → 校验 sessionId / 会话行(同 chat.send)
  → 能力检查:providerCapabilitiesService.getProviderCapabilities(provider).supportsCompact
      false → protocol_error { code:'COMPACT_UNSUPPORTED' }
  → 校验 session.provider_session_id 非空(空会话无可压缩 → 'COMPACT_EMPTY_SESSION')
  → chatRunRegistry.startRun(互斥:已有 run → 'RUN_IN_PROGRESS')
  → spawnFns[claude]('/compact', { sessionId: provider_session_id, resume:true, cwd: project_path, model }, run.writer)
  → 运行时照常流出:isCompactSummary 摘要消息、status{token_budget}、terminal complete;异常走 error + complete(exitCode 1)
  → finally chatRunRegistry.completeRun(安全网,同 chat.send)
```

**复用而非新增事件**:压缩 run 的终态信号就是既有 `complete` 帧;压缩后的用量刷新由压缩 run 内 SDK usage 消息触发的 `status{token_budget}` 帧自动完成。不新增专用 kind,协议面最小。

**能力矩阵**:`provider-capabilities.service.ts` 新增字段 `supportsCompact: boolean`(claude: true;其余 provider: false,注释说明「压缩依赖 CLI 内置 /compact,仅 Claude SDK 运行时具备」)。非 claude provider 即便收到伪造 `chat.compact` 也被能力检查拦截,双保险。

### 4.2 前端

**`TokenUsageSummary.tsx`(重构,核心改动)**

```
<button wrapper>                        // onMouseEnter → 150ms timer → setOpen(true);onMouseLeave → 立即关闭
  …现有按钮内容(hover/active 类不变)…
  {open && createPortal(<TokenUsageCard/>, document.body)}   // fixed 定位于按钮上方,右对齐
</button>
```

- 卡片内容(全部来自现有 props/state):
  - 已用总 token(`used`,复用 `formatTokenCount`)
  - 输入/输出拆分(`breakdown.input` / `breakdown.output`)
  - 上下文占用:进度条 + `used/total` 百分比(`total` 即 contextWindow)
  - 可见消息数:新增 `visibleMessageCount` / `totalMessages` props
  - 说明文案:「点击按钮即可压缩上下文」(i18n)
  - loading 态:图标换 `Loader2` 旋转,文案「正在压缩…」,点击禁用
  - 不支持 provider:文案「当前提供程序暂不支持压缩」,点击无效(能力由 props 传入)
- 样式:`bg-white/95 dark:bg-slate-950/95 border border-primary/40 rounded-xl shadow-[对齐CommandMenu]` + portal 内 `text-*` 配色,蓝白语言对齐命令面板。
- Props 变更:`onClick → onCompact`、新增 `supportsCompact`(布尔,由 provider 能力矩阵映射到前端)、`isCompacting`、`visibleMessageCount`、`totalMessages`。

**状态与接线**

- `useChatSessionState.ts`:新增 `isCompacting` state + ref,`handleCompactSession()`:
  - 前置校验(空会话/正在处理/不支持)→ `sendMessage({ type:'chat.compact', sessionId })` → `isCompacting=true`
- `useChatRealtimeHandlers.ts`:
  - `complete` 分支:若压缩中 → `isCompacting=false` + `sessionStore.refreshFromServer(sid)`(摘要消息落列)+ 主动 `GET token-usage` 兜底刷新(R2 缓解);
  - `protocol_error` 分支:若压缩中 → 复位 `isCompacting`(防 RUN_IN_PROGRESS 等卡死 loading);
  - `status{token_budget}` 分支照常(压缩 run 期间的 usage 推送自然生效)。
- `ChatComposer.tsx` / `ChatInterface.tsx`:删 `onShowTokenUsage={showCostModal}` 绑定,传压缩相关 props;压缩期间 `onAbortSession` 保持可用(chat.abort 对压缩 run 同样有效)。
- `useChatComposerState.ts`:删除按钮专用的 `showCostModal()`;`/cost` 命令注册(`routes/commands.js`)与 `CommandResultModal` 的 cost 分支**不动**(斜杠命令路径保留)。

**i18n**(`src/i18n/locales/{zh-CN,en}/chat.json` `tokenUsage` 键附近新增):`popoverTitle / usedTokens / inputTokens / outputTokens / contextShare / visibleMessages / compactHint / compacting / compactUnsupported / compactEmpty` 等键,zh-CN 与 en 同步。

### 4.3 文件级改动点清单

| 文件 | 改动 | 量级 |
| --- | --- | --- |
| `src/components/chat/view/subcomponents/TokenUsageSummary.tsx` | 重构:hover popover + 压缩按钮 + loading | ~220 行(重写) |
| `src/components/chat/hooks/useChatSessionState.ts` | `isCompacting` + `handleCompactSession` + token-usage 兜底刷新 | ~45 行 |
| `src/components/chat/hooks/useChatRealtimeHandlers.ts` | complete/protocol_error 压缩复位分支 | ~15 行 |
| `src/components/chat/view/subcomponents/ChatComposer.tsx` | props 替换与传递 | ~10 行 |
| `src/components/chat/view/ChatInterface.tsx` | 接线(删 showCostModal 绑定) | ~10 行 |
| `src/components/chat/hooks/useChatComposerState.ts` | 删 `showCostModal` | −14 行 |
| `src/i18n/locales/zh-CN/chat.json`、`en/chat.json` | tokenUsage 相关键 | ~30 键 |
| `server/modules/websocket/services/chat-websocket.service.ts` | `chat.compact` 分支 + handler | ~55 行 |
| `server/modules/providers/services/provider-capabilities.service.ts` | `supportsCompact` 字段 ×7 provider | ~12 行 |
| `server/shared/types.ts` | 如协议类型集中则补 `chat.compact` | 数行 |

注:`chat-websocket.service.ts` 当前 388 行,+55 后接近 443,仍在 500 行红线内;若逼近则将 compact handler 抽为同目录独立文件。`claude-sdk.js`(1049 行,超标现状)本设计**零改动**,不加剧。

## 5. 交互与边界行为

| 场景 | 行为 |
| --- | --- |
| hover <150ms 移开 | 不出现 |
| hover ≥150ms | 卡片淡入(150ms,对齐命令面板过渡);移开立即消失 |
| 悬停中点击 | 触发压缩,卡片保留显示 loading,移开关闭 |
| 压缩中再点击 / 再发消息 | 按钮/输入禁用(isLoading 已有逻辑);压缩 run 占用 per-session 互斥 |
| 压缩中 abort | chat.abort 正常中断,complete(aborted) 复位 loading |
| 空会话(无 provider_session_id) | 服务端 `COMPACT_EMPTY_SESSION`;前端按钮禁用态 + 文案 |
| 其余 provider | 卡片显示「暂不支持」,点击无效;服务端能力检查兜底 |
| 压缩完成 | 摘要以 assistant 消息(`isCompactSummary`)出现在会话流;按钮数字随 `token_budget` 推送/兜底拉取刷新 |

## 6. 风险与缓解

| # | 风险 | 等级 | 缓解 |
| --- | --- | --- | --- |
| R1 | **headless `/compact` 生效性不确定**:SDK 无 compact API,斜杠命令处理依赖 CLI 行为;若 CLI 把 `/compact` 当普通文本发给模型,则产生一次无意义对话 | 高 | **实现第一步做 spike**(`debug/verify-compact-sdk.mjs`,仿 `spike-goal-e2e.mjs`):真实 CLI 上 resume 会话发 `/compact`,断言 transcript 出现 `compact_boundary`+`isCompactSummary` 且后续 input token 下降。若失败,fallback 到 **streaming-input 单发式**(一次 query 以 async-iterable prompt 发 `SDKUserMessage('/compact')`,SDK 文档佐证该路径解析斜杠命令;改动局部化在 claude 分支)。两者皆不可行时升级为需求评审决策,不擅自降级为「伪压缩」 |
| R2 | **用量口径漂移**:`result.modelUsage` 为累计值,压缩后按钮数字可能不降反平,观感「没生效」 | 中 | 压缩完成 `complete` 后主动 `GET token-usage`(REST 端点取 transcript 尾部最新 usage);实现时核对 claude 分支口径取「最新一条 usage」而非累计;以压缩后首个普通对话的真实 usage 为准 |
| R3 | **压缩耗时不可控**(长会话总结 30s+) | 中 | loading 态 + abort 可用 + per-session 互斥防并发;卡片内文案告知进行中 |
| R4 | 压缩完成触发完成提示音/通知(复用普通 complete 副作用) | 低 | 判定为「用户显式操作的完成反馈」,可接受;若验收嫌吵,压缩 run 改走 `silent` 通道(后续迭代,不进本期) |
| R5 | 文件行数卫生(chat-websocket.service.ts 逼近 500) | 低 | 预设抽离方案(§4.3 注) |
| R6 | 压缩后旧消息仍在 transcript/历史分页中,用户预期「消息消失」 | 低 | 语义对齐 CLI:压缩缩减的是**上下文窗口**,历史记录保留;popover 文案明确「压缩上下文」而非「清空消息」;验收以 token 占用下降为准 |

## 7. 验证与验收(对照需求验收标准)

1. **静态**:`npx tsc --noEmit -p tsconfig.json` 与 `npx eslint src/...` 0 error。
2. **压缩链路 spike**:`debug/verify-compact-sdk.mjs` —— SDK 直连验证 R1(通过后才进入 UI 接线)。
3. **UI 验收**:`debug/ui-acceptance/req052-token-usage.mjs`(playwright 无头,仿 `mockup-shot.cjs`):
   - hover 按钮 ≥150ms → popover 可见,断言四项数据行 + 提示文案存在,截图 `debug/ui-acceptance/req052-popover.png`;
   - 移开 → popover 消失断言;
   - 点击 → 按钮 loading 态断言 + 压缩完成(或 unsupported 提示)后 loading 复位,截图留存;
   - 压缩链路无法起真实会话的环境下,以 `chat.compact → protocol_error` 路径 + SDK spike 报告作为链路证据。
4. **回归抽查**:斜杠命令 `/cost` 仍弹模态;`/help`、模型切换等 composer 交互不受影响;其他 provider 会话按钮不报错。
5. **交付物**:本 spec → plan(`REQ-ID: REQ-052`)→ 实施 → `DELIVERY.md` 交付说明。

## 8. 明确不做(本期范围外)

- Android Compose 端同款交互(UI 层问题按项目约定另行委托 Kimi);
- 自动压缩阈值(auto-compact)、压缩前确认弹窗、压缩历史查看;
- 其余 provider 的压缩实现(仅保留「暂不支持」提示)。
