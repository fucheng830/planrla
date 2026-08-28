# REQ-052 会话压缩归档 — 压缩后主视图只显压缩后上下文,历史进「历史消息查询」

> **状态**:spec 评审中(kanban task #4 阶段一产出)
> **日期**:2026-08-28
> **范围**:planrla 桌面端 server + web UI(Claude provider 先行;其他 provider 预留接口)
> **关联**:REQ-032/039/041(渲染性能脉络)、REQ-049(fork 快照)、REQ-030(静默轮过滤,同读取层)

## 背景

planrla 的对话历史**没有自己的消息存储**,直接读 provider 的转录文件(事实源 = Claude Code 的 `~/.claude/projects/<dir>/<session>.jsonl`)。读取链路:

- **REST**:`GET /api/providers/sessions/:id/messages?limit&offset` → `sessionsService.fetchHistory` → `claude-sessions.provider.ts` 的 `getSessionMessages` **全量流式读取 + 归一化整个 JSONL**,再 `sliceTailPage` 从尾部切页(前端首屏 20 条)。
- **实时**:`claude-sdk.js` 循环 SDK 消息 → `normalizeMessage` 归一化 → WS 下发。

Claude Code 压缩(compact,手动 `/compact` 或 auto-compact)的行为:把前文压成摘要,**往 JSONL 追加一行 `isCompactSummary: true` 的合成 user 行;压缩前的原始消息行仍然保留在文件里**。当前 UI 只把这行摘要渲染成普通 assistant 气泡,压缩前的全部历史照样被整读、整归一化、可整页翻出——长会话「对话太多」的加载/渲染问题由此而来。

SDK 侧其实已有官方事件挂点(目前被归一化层**静默丢弃**):

- `SDKCompactBoundaryMessage`:`{type:'system', subtype:'compact_boundary', compact_metadata:{trigger:'auto'|'manual', pre_tokens, …}}`
- `PostCompact` hook(含 `compact_summary`)
- 历史侧:`isCompactSummary` 行(REQ 已有归一化识别,`claude-sessions.provider.ts:474`)

## 目标

1. **压缩触发事件**:live(WS `compact_boundary` 事件)+ 历史(JSONL 扫描识别边界)双通道,压缩发生即被应用感知。
2. **主视图收窄**:会话主视图默认只渲染「最后一个压缩边界之后」的消息(边界 = 摘要行,渲染为「上下文已压缩」卡);边界前消息不再进入主渲染链路。
3. **历史可查**:新增「历史消息查询」视图,按压缩纪元(compaction epoch)分段、分页浏览边界前的全部旧消息,复用现有消息渲染组件;入口在压缩摘要卡与侧栏会话菜单。
4. **性能受益**:主视图的网络响应体、归一化开销、前端渲染量从 O(全会话) 收敛到 O(当前纪元)。

### 非目标(MVP 不做)

- 物理搬运/复制消息数据(虚拟边界,单一事实源仍是 provider JSONL)。
- 其他 provider(codex/opencode/zcode/kimi/gemini/cursor)的边界适配——接口预留,后续 REQ 跟进。
- 归档段内搜索(全局搜索 `session_search` FTS5 已覆盖全量内容检索,不受本需求影响)。
- 压缩策略本身(触发阈值等)仍由 Claude Code 控制。

## 架构选型

| 方案 | 思路 | 结论 |
|------|------|------|
| **A. 虚拟边界 + 单一事实源(选定)** | 边界 = JSONL 中(按文件顺序)最后一个 `isCompactSummary` 行;`fetchHistory` 增加 `view` 口径(active/archived/all);live 靠 `compact_boundary` 事件;辅助表只做纪元缓存 | **零迁移、对既有长会话立即生效**(压缩发生在旧版本也一样)、fork/全局搜索/同步天然兼容(同一读取层)。选中。 |
| B. DB 归档表(消息复制进 SQLite) | live 压缩时把边界前消息复制进新表,主读取改查 DB | 否决:需全量回填、双写一致性(fork/重命名/截断都要跟)、存储翻倍;真正的持久化诉求(见风险 1)由 P1 sidecar 更精准满足。 |
| C. 物理分段 sidecar(边界时复制前段为 app-owned 文件) | 归档即落盘副本,主视图只读尾段 | 留作 **P1**:解决 Claude `cleanupPeriodDays`(默认 30 天)清理 JSONL 后历史不可查的问题。P0 不做,避免部分保留(messagesToKeep)等复制语义复杂化。 |

**关键决策**:

- **边界识别以 JSONL 现算为准**,`session_compactions` 表只是缓存/索引(live 事件 upsert + fetch 惰性发现 upsert),不作为过滤事实源——表与文件永远打不了架。
- **REST `view` 默认 `all`(现状)**,向后兼容;聊天 UI 显式传 `view=active`。kanban digest、session-query MCP、REQ-049 fork 快照等既有消费方零改动、零回归;由各消费方按语义自行显式收窄。
- **边界索引基于 raw 文件顺序计算**,不依赖 timestamp 排序(现读路径按 timestamp 排序展示,同毫秒行乱序会把边界算错,见风险 2)。

## 改动点

### Server(~200 行)

1. **`server/shared/types.ts`**
   - `MessageKind` 增 `'compact_boundary'`。
   - `FetchHistoryOptions` 增 `view?: 'active' | 'archived' | 'all'`(缺省 `'all'`)、`epoch?: number`。
   - `FetchHistoryResult` 增 `view`、`hasArchived`、`compaction?: { epoch: number; archivedMessages: number; lastBoundaryAt: string; trigger?: string }`。
2. **`claude-sessions.provider.ts`**(核心)
   - `normalizeMessage` 增分支:`type==='system' && subtype==='compact_boundary'` → 产出 `{kind:'compact_boundary', trigger, preTokens}`(今天被静默丢)。
   - `getSessionMessages` 保持返回 raw 行;**边界识别移到 `normalizeClaudeRawMessages`**:按文件顺序找最后一个 `isCompactSummary` 行索引 = 当前纪元起点;`view=active` 只归一化/序列化该行起的内容;`view=archived` 归一化边界前行,按纪元切段 + 沿用 `sliceTailPage` 尾分页;`total` 按 view 口径计数。
3. **`sessions.service.ts`**:`fetchHistory` 透传 `view/epoch`;未适配 provider 忽略 `view` 并在 result 标注(前端降级,见改动点 8)。
4. **`provider.routes.ts`**:messages 端点接受 `view`、`epoch` query;新增 `GET /api/providers/sessions/:id/compactions`(纪元列表:时间/trigger/条数,JSONL 惰性扫描 + 表缓存)供归档视图导航。
5. **`server/modules/database/schema.ts` + `repositories/sessions.db.ts`**:新表
   ```sql
   CREATE TABLE IF NOT EXISTS session_compactions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     session_id TEXT NOT NULL,
     epoch INTEGER NOT NULL,              -- 第几次压缩,1 起
     boundary_uuid TEXT,
     boundary_timestamp TEXT NOT NULL,
     trigger TEXT,                        -- auto | manual
     pre_tokens INTEGER,
     archived_messages INTEGER,           -- 该纪元边界前消息数(缓存)
     created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
     UNIQUE(session_id, epoch)
   );
   ```
6. **`claude-sdk.js`**:预计零改(normalizeMessage 覆盖后 `compact_boundary` 帧自然带 seq 进 WS);验证 chat.subscribe 重放语义即可。
7. **既有消费方确认(不改代码,补测试锁定)**:kanban digest(`kanban.routes.ts:268`,取最后一条 assistant 文本——active 口径反而更准,保持 `all` 不动);session-query MCP(保持 `all`);REQ-049 fork 快照(保持 `all`,完整复制语义)。

### Frontend(~250 行,UI 组件按项目约定 A2A 委托 Kimi 实施)

8. **`useChatSessionState.ts`**:首屏与搜索跳转全量加载改传 `view:'active'`;`result.hasArchived` 驱动历史入口显隐;provider 未适配时降级为现状(隐藏入口)。
9. **`useChatRealtimeHandlers`**:收到 `compact_boundary` → ① 展示压缩横幅;② **清空边界前 realtime 缓冲**(否则 merged 按 id 去重会残留旧气泡);③ `refetchFromServer(view:'active')` 换血主视图。
10. **`MessageComponent.tsx`**:`isCompactSummary` 从普通气泡改为可折叠「上下文已压缩」卡(摘要预览 + 「查看更早 N 条历史」入口)。
11. **新组件 `ArchiveMessagesPanel`**(独立文件):调 `compactions` + `messages(view=archived, epoch)` 分页,复用 `normalizedToChatMessages` + `MessageComponent` + virtua VList;store 扩独立 archive slot,**不污染主会话 slot**。
12. **i18n**:zh-CN / en 先行,其余 locale 跟进。

## 验收标准草稿

1. 会话中触发手动 `/compact` 或 auto-compact:主视图即时出现压缩事件;重进会话亦只显示边界后消息(含摘要卡),旧消息不再出现在主视图与「加载更多」链路(`hasMore` 在纪元起点截断)。
2. 摘要卡显示归档条数;打开历史消息查询可按纪元翻页看到全部旧消息;主会话视图状态不受归档浏览影响。
3. **既有长会话(压缩发生在旧版本)打开即生效**,无需迁移/回填。
4. REST 不带 `view` 行为与今天完全一致;session-query MCP、kanban digest、fork 语义不回归(测试锁定)。
5. 1000+ 消息会话首屏响应体收敛到边界后内容量级;`npm run typecheck` 过 + 既有测试不回归 + 新增 provider 边界 fixture 测试过。

## 风险

1. **Claude Code 版本演进(最高风险)**:旧版本只有 `isCompactSummary` 行、无 system 事件 → 双通道识别兜底;**新版本若压缩时物理重写/清除前段行**,虚拟边界的「历史」将无从读起;`cleanupPeriodDays`(默认 30 天)也会删老 JSONL。缓解:P1 sidecar 快照兜底;P0 加检测——表里有纪元记录但文件中边界前行数为 0 时,前端提示「历史已被 CLI 清理/过期」而非空白。
2. **文件顺序 vs timestamp 排序**:现读路径按 timestamp 排序;边界索引必须在排序前的 raw 文件顺序上计算,同毫秒行乱序会算错边界 → 实现顺序固定「先识别后排序」+ 含同 timestamp 行的 fixture 测试。
3. **摘要行双身份**:`isCompactSummary` 行既是边界又是内容(active 视图里渲染为压缩卡,archived 视图里它是上一纪元的末条)→ 归档视图按原样渲染摘要文本,避免重复叠加边界卡。
4. **消费方行为面**:默认 `all` 保证零回归;显式收窄的调用方(digest)语义需确认;A2A/MCP 查询不默认收窄(代理场景需要全量上下文)。
5. **多 provider 不对称**:`view` 对未适配 provider 无效 → result 显式标注 + 前端隐藏历史入口,避免「有历史但看不到」的错觉。
6. **前端 realtime 合并污染**:边界后不清 realtime 缓冲会残留旧气泡(merged 按 id 去重不清序)→ 处理器必须清槽(改动点 9);WS 重连重放只覆盖当次 run 的 seq,跨边界重放由服务端 active 口径兜底。
7. **性能收益的边界**:I/O 仍整文件流式(O(N)),收益在归一化/序列化/网络/渲染;超大会话后续可把纪元起点偏移量缓存进 `session_compactions` 做 seek 定位(列为后续优化,不在本 REQ)。
8. **行数预算**:server ~200 行 + 前端 ~250 行(新组件独立文件),符合文件卫生;实施按 plan 拆分(UI 组件拆给 Kimi 并行)。

## 分期

- **P0(本 REQ)**:虚拟边界 + live 事件 + active 主视图 + 历史消息查询视图(读 JSONL)+ `session_compactions` 缓存表。
- **P1(独立 REQ,另行入池)**:sidecar 归档快照(抗 CLI 清理/重写的持久归档)、归档段内搜索、codex/opencode 等 provider 边界适配、纪元偏移 seek 优化。

## 实施备注(2026-08-28,开工阶段回填)

1. **归档条数改为惰性获取**:`view=active` 的 `compaction.archivedMessages` 返回 `null`(算精确条数需归一化全部边界前行,正是本 REQ 要省掉的开销);压缩卡只显示「查看历史消息」入口,条数在打开归档面板时经 `GET …/compactions` 获取(该端点顺带把精确 `archivedMessages` 写回缓存表)。
2. **边界识别纯文件序**:`getSessionMessages` 不再内部排序,`normalizeClaudeRawMessages` 先按文件序找边界、再对所选段做稳定 timestamp 排序——同毫秒行不扰动边界(fixture 已覆盖)。
3. **out-of-range epoch 返回空页**而非报错(并发截断下的温和降级)。
4. 回归基线:全量 server 测试中 4 个失败(projects.db.integration / createProject conflict / providerMcp global adder / model cache persist)在 stash 本次改动后同样失败,为存量环境性失败,与 REQ-052 无关。
