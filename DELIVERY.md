# REQ-052 交付说明:令牌用量按钮 hover 详情 + 点击自动压缩上下文

> kanban task #1(`f81b6189-673c-4c7a-a03a-9fd677163a3b`)「开工 → 验收」产出
> 分支:`kanban/1-f81b6189`(基于 main @ 5284c5a,即 REQ-052 技术方案提交)
> 日期:2026-08-28
> 方案:`docs/superpowers/specs/2026-08-28-req052-token-usage-compact-design.md`

## 一、完成内容

### 1. Spike R1:headless `/compact` 有效性验证(方案前置闸门)

`debug/verify-compact-sdk.mjs` 以与 `claude-sdk.js` 完全一致的 per-turn query 方式直连 SDK 真实 CLI(CLI 2.1.231),三段式验证:

| Run | 动作 | 结果 |
| --- | --- | --- |
| A | 建会话 + 长文生成 | session `795abf25-…`,产生 ~51k 上下文 |
| B | resume + prompt=`/compact` | `status: compacting` → **`compact_boundary {trigger: manual, pre_tokens: 51188, post_tokens: 2372}`** |
| C | 压缩后继续对话 | 正常应答,会话存活 |

**结论:PASS**——CLI 在 headless SDK 下真实处理 `/compact`(51k→2.4k),方案 A(chat.compact 复用 per-turn query)可行,无需 streaming-input fallback。另确认压缩 run 的 result usage 为 0(不会推送误导性 token_budget)。

### 2. 服务端:WS 协议新增 `chat.compact`

- 能力位 `supportsCompact`(claude=true,其余 6 provider=false)入 `provider-capabilities.service.ts`,经 `GET /api/providers/capabilities` 自动下发前端。
- `handleChatCompact`(独立文件):校验链 `SESSION_ID_REQUIRED → SESSION_NOT_FOUND → UNSUPPORTED_PROVIDER → COMPACT_UNSUPPORTED → COMPACT_EMPTY_SESSION → RUN_IN_PROGRESS`,全过后以 prompt=`'/compact'` 复用 `chat.send` 全套基础设施(run 互斥、`complete` 终态、abort、`token_budget` 推送、transcript 持久化),`finally completeRun` 安全网与 chat.send 同契约。
- 为守住 500 行红线(spec R5 预案),将原 service 拆分:`chat-protocol.utils.ts`(协议原语)+ `chat-websocket.types.ts`(共享类型),`chat-websocket.service.ts` 388→300 行。
- providers barrel 补导出 `providerCapabilitiesService`(boundaries/dependencies 规则)。

### 3. 前端:按钮重构 + 压缩状态机

- `TokenUsageSummary.tsx` 重写(59→223 行):hover ≥150ms 经 portal 浮出详情卡片(已用/输入/输出、上下文窗口占用进度条、可见消息/总消息、状态文案),蓝白设计语言对齐命令面板(`bg-white/95 dark:bg-slate-950/95`、`border-primary/40`、圆角大阴影 + blur,150ms 过渡);移开立即消失;`<150ms` 不出现。点击触发压缩:压缩中图标换 `Loader2` 旋转 + disabled;不支持/空会话点击无效并显示对应文案。按钮 hover/active 类沿用原有。
- `useChatSessionState.ts`:`compactingSessionId` state + ref 镜像,`isCompacting` 按「当前查看会话」派生(切换会话不串态);`handleCompactSession(model)` 前置守卫(无会话/处理中/压缩中/不支持/空会话);`finishCompactSession` 复位 + **主动 `GET token-usage` 兜底刷新**(R2 缓解);`cancelCompactSession` 处理 pre-run 拒绝。
- `useChatRealtimeHandlers.ts`:`complete` 终态帧匹配压缩会话 → 复位 + `onCompactRunFinished`;`protocol_error` 分支(压缩被拒时无 complete)→ 复位 + `onCompactCancelled`;错误消息落列复用既有逻辑。
- `ChatInterface.tsx`:`providerCapabilities` 透出并派生 `supportsCompact === true` 严格判定;接线三 hook 与 composer props。
- `useChatComposerState.ts`:删除 `showCostModal`(按钮→/cost 模态绑定移除);`/cost` 斜杠命令注册(`server/routes/commands.js`)与 `CommandResultModal` cost 分支**原样保留**。
- i18n:`tokenUsage` 键新增 11 键 × zh-CN/en 双语。

## 二、改动文件清单

**修改(12 个,+403/−137)**

| 文件 | 变更 |
| --- | --- |
| `src/components/chat/view/subcomponents/TokenUsageSummary.tsx` | 重写:hover popover + 压缩交互(59→223 行) |
| `src/components/chat/hooks/useChatSessionState.ts` | +92:压缩状态机与三个入口函数 |
| `src/components/chat/hooks/useChatRealtimeHandlers.ts` | +36:complete/protocol_error 压缩复位分支 |
| `src/components/chat/view/ChatInterface.tsx` | +21/−8:supportsCompact 派生与接线 |
| `src/components/chat/view/subcomponents/ChatComposer.tsx` | +23/−8:props 替换(onShowTokenUsage→压缩组) |
| `src/components/chat/hooks/useChatComposerState.ts` | −14:删 showCostModal |
| `src/components/chat/hooks/useChatProviderState.ts` | +3:类型 supportsCompact? + 透出 providerCapabilities |
| `src/i18n/locales/zh-CN/chat.json`、`en/chat.json` | 各 +11 键 |
| `server/modules/providers/services/provider-capabilities.service.ts` | +14:supportsCompact ×7 |
| `server/modules/providers/index.ts` | +1:barrel 导出 |
| `server/modules/websocket/services/chat-websocket.service.ts` | 388→300 行:chat.compact 分发 + 协议原语抽离 |

**新增(6 个代码/脚本 + 产物)**

| 文件 | 说明 |
| --- | --- |
| `server/modules/websocket/services/chat-compact.handler.ts` | 121 行,chat.compact handler |
| `server/modules/websocket/services/chat-protocol.utils.ts` | 79 行,协议原语(sendProtocolError 等) |
| `server/modules/websocket/services/chat-websocket.types.ts` | 41 行,共享类型 |
| `debug/verify-compact-sdk.mjs` | 111 行,R1 spike(复跑:`node debug/verify-compact-sdk.mjs`) |
| `debug/ui-acceptance/req052-harness.tsx` + `.html` | 真实组件验收 harness(真实 i18n 资源 + 受控场景) |
| `debug/ui-acceptance/req052-token-usage.mjs` | 116 行,playwright 无头验收脚本 |
| `debug/ui-acceptance/req052-{popover,compacting,unsupported}.png` | 截图留存 |
| `DELIVERY.md` | 本文件 |

## 三、验收结果(对照 spec §7)

| 门 | 结果 |
| --- | --- |
| `npm run typecheck`(前端+服务端 tsc) | ✅ exit 0 |
| eslint(改动文件清单) | ✅ 0 errors(13 warnings 均为存量,如 ChatInterface `formattedHints` 未使用在基线已存在) |
| `npm run build`(vite + server tsc) | ✅ exit 0 |
| `git diff --check` | ✅ 干净 |
| playwright UI 验收 | ✅ **25/25 PASS**:popover 12 项内容断言、进度条 74%、<150ms 不出现、移开消失、点击触发 onCompact、压缩中 disabled+spinner+文案且不重复触发、unsupported/empty 文案且点击无效 |
| 压缩链路 | SDK spike PASS(51k→2.4k)+ 协议分支静态验证;真实会话端到端压缩未跑(不碰用户真实会话数据,见遗留) |
| 回归抽查 | `showCostModal`/`onShowTokenUsage` 零残留;`/cost` 斜杠命令链完整(`commands.js:177,256` → `CommandResultModal:718`);其他 provider 按钮由 harness unsupported 场景覆盖 |

复跑方式:

```bash
node debug/verify-compact-sdk.mjs                                   # SDK spike(真实 CLI,3 次 haiku 调用)
npx esbuild debug/ui-acceptance/req052-harness.tsx --bundle \
  --outfile=debug/ui-acceptance/req052-harness.bundle.js \
  --format=iife --jsx=automatic --loader:.json=json \
  --define:process.env.NODE_ENV='"production"'                      # 改组件后需重打包
npx tailwindcss -i src/index.css -o debug/ui-acceptance/tw.css \
  --content "debug/ui-acceptance/req052-harness.tsx,src/components/chat/view/subcomponents/TokenUsageSummary.tsx"
node debug/ui-acceptance/req052-token-usage.mjs                     # UI 验收 + 截图
```

## 四、使用 / 合并方式

按 worktree 开发约定(项目 CLAUDE.md):

```bash
# 验收人(Archie)三道门通过后,回主 worktree:
cd D:/workspace/projects/ai/apps/planrla
git merge --no-ff kanban/1-f81b6189
git worktree remove .claude/worktrees/kanban/1-f81b6189   # 路径以实际为准
git branch -d kanban/1-f81b6189
```

- 用户侧行为:composer 工具条令牌按钮 hover 出详情卡;点击即压缩当前会话(claude),压缩中按钮转圈、可 Esc/停止按钮中断,完成后数字随兜底拉取刷新、摘要以消息形式出现在会话流。`/cost` 斜杠命令照旧弹模态。
- 其余 provider(zcode/codex 等):卡片显示「暂不支持」,点击无效;伪造 `chat.compact` 被服务端 `COMPACT_UNSUPPORTED` 拦截。

## 五、遗留事项

1. **真实会话端到端压缩未在本 worktree 实跑**:验收以「SDK spike(真实 CLI 真压缩)+ 协议分支可达性(typecheck/UI harness)+ 不碰用户数据」组合取证;建议验收人在测试项目里点一次真实 claude 会话的压缩做功能门复核。
2. **Android Compose 端同款交互**:按 spec §8 与项目约定属 UI 层,另行通过 A2A 委托 Kimi,不在本期。
3. **范围外未做**(spec §8):自动压缩阈值(auto-compact)、压缩前确认弹窗、压缩历史查看、其余 provider 压缩实现。
4. **R2 口径说明**:压缩 run 自身 result usage=0,压缩完成后按钮数字来自 complete 后的 `GET token-usage`(transcript 尾部最新 usage),以压缩后首个普通对话的真实 usage 为准;长 system prompt 场景下压缩前后总占用可能变化不明显(CLI 语义,pre/post_tokens 见 spike)。
5. **存量问题(非本次引入,未处理)**:全仓 eslint 有 16 个基线 errors(a2a/、cron-prompts/、spawn-fns.ts、sync/、services/tests 等)+ 若干 warnings;`claude-sdk.js` 1049 行超标现状未动(spec 明确零改动)。
6. **压缩完成提示音**:复用普通 complete 副作用(R4,spec 判定可接受);若嫌吵后续迭代走 silent 通道。
