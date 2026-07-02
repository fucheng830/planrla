# Sidebar Open Performance — Design Spec

> **起因**：roadmap P1「会话列表分页/缓存」。Phase 0 profile 推翻了「会话列表未分页」的前提 —— 会话列表**已分页**（20/页，load-more 13–19ms）；真瓶颈是 `GET /api/projects` 端点 **~1s/请求**。本 spec 把 P1 项重定向到真问题。

## Phase 0 实测发现（2026-07-02，:3002，QuantDinger 项目 4202 sessions 作极端样本）

| 流程 | 耗时 | 结论 |
|---|---|---|
| `GET /api/projects?sessionsLimit=20`（3 连击）| **0.84 / 0.93 / 1.62s** | 每请求都慢，非首次缓存 |
| `GET /api/projects?skipSynchronization=1` | **0.24–0.28s** | sync 占 **~0.6s** |
| `GET /api/projects/archived` | 0.56–0.60s | 同类（也 inline sync）|
| `GET /api/projects/:id/sessions?limit=20&offset=N`（N=0/100/500）| **13–19ms** | 分页/load-more **非瓶颈** |
| 客户端 `/api/projects` TTFB | **995ms**（46KB）| sidebar 冷开等的就这个 |
| JS heap（侧栏打开后）| 20MB | 无内存膨胀 |
| `/api/providers/sessions/running` 轮询 | 50+ 次/会话，每次 2–6ms | 唠叨但便宜（非瓶颈，可后续优化）|

### 根因（代码已核实）
`getProjectsWithSessions`（`projects-with-sessions-fetch.service.ts:180`）每请求：
1. **inline sync**（L183–185）：`await sessionSynchronizerService.synchronizeSessions()` —— 扫全部 session 行 + jsonl stat，**每次读都跑**。但 server 启动时已起 session watchers（启动日志 "Setting up session watchers"）+ WS 推送，read 时 inline sync **是冗余**。（`getArchivedProjectsWithSessions` L251 同样。）
2. **N+1 per-project 查询**（L197–218）：`for (const row of projectRows)` 循环 30 个项目，**循环内**调 `readProjectSessionsPageByPath(projectPath)`（每项目一条 DB 查询）+ `await generateDisplayName(...)`（async/IO）。= ~0.25s。

会话列表分页（`getProjectSessionsPage`）本身已高效（19ms），**不动**。

## Phase 1 定向修复

### Fix 1 — read path 不 inline sync（最大收益：~0.6s → ~0ms）
`GET /api/projects` 与 `GET /api/projects/archived` 默认走 `skipSynchronization=true`（即不在 read handler 里调 `synchronizeSessions`）。数据新鲜度由 session watchers + WS 推送负责（已存在）。保留 `?skipSynchronization=0` 给显式强制同步（如侧栏「刷新」按钮）。
- **风险**：watcher 未覆盖的边角（外部进程新建 session 未被 watch）→ 读到略旧数据。
- **缓解**：手动刷新按钮强制 sync；启动时全量同步（已有）；watcher 覆盖 `.claude/projects` 文件变化（主流路径）。

### Fix 2 — base 装配批量化（~0.25s → 目标 <0.1s）
把 N+1 循环改成**一条批量 SQL**：一次 JOIN 出所有项目的首页 session（`LIMIT` per group）+ `total`（窗口函数或子查询 + `COUNT(*) OVER`）。
- `generateDisplayName` 的 async IO：默认名按 `path.basename` 同步可算；只有需读盘查 git/包名的分支保留 async，且可缓存。
- 路由层 `fs.existsSync` × 30（过滤已删除路径）：项目存在性变化罕见 —— 启动时扫一次 + 文件 watcher 失效缓存；或先返回、存在性异步标记。

### Fix 3 — （可选，独立）减少 running-sessions 轮询
客户端对 `/api/providers/sessions/running` 高频轮询（50+/会话）。WS 已连接 —— 改为 WS 推送驱动、去轮询。非本 spec 核心，单列后续。

## 验收
- `GET /api/projects`（默认 read path）**p50 < 200ms、p95 < 400ms**（before ~900ms）。
- `GET /api/projects/archived` 同量级改善。
- load-more `GET /api/projects/:id/sessions` 仍 **< 50ms**（不回归）。
- sidebar 冷开 → 项目可见 **< 1s**（before ~1s+，目标 ~0.3s）。
- 手动「刷新」仍能强制同步（`skipSynchronization=0` 路径保留）。
- 现有功能测试不回归；新增批量 SQL 的纯函数测试（按项目取首页 session + total）。

## 不做（YAGNI）
- **会话列表虚拟滚动 / 再分页** —— 已 19ms，无收益。
- **客户端 session 缓存淘汰** —— heap 20MB，无膨胀。
- **message 渲染优化** —— 本 spec 不涉及（长会话窗口化已在 P0 完成）。

## 备注
- 本 P1 项在 roadmap 标注为「会话列表分页/缓存」；实测后真瓶颈是 projects 端点 inline sync + N+1。roadmap 文案待 PR 时一并修正为「sidebar 打开性能（projects 端点）」。
- 改动集中在 `server/modules/projects/`（routes + fetch service + 一条批量 SQL）；前端零改动。
