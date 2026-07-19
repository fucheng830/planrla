---
REQ-ID: REQ-020
切片: S3(planrla 内部 session 间协作 —— 发现 + 白名单 + agent 自主委托)
日期: 2026-07-18
状态: spec(Archie 已选 C1: agent 自主编排)
关联:
  - S1: 2026-07-11-req020-a2a-s1-client-tools-design.md(已合 main,a2a_call 出站)
  - S2: 2026-07-18-req020-a2a-s2-inbound-design.md(已合 main,/api/a2a 入站 endpoint)
---

# REQ-020 A2A · S3 Internal Collaboration 设计

## 架构上下文

S1(client 出站)+ S2(inbound endpoint)已合并 main。S3 把两者连通做"planrla 内部 session 间协作":session A 的 agent 发现可委托的 session B,经 a2a_call(出站,S1)→ /api/a2a(入站,S2)→ 注入 session B → 回复回 A。

**Archie 决策**:**C1 —— agent 自主编排**(不建编排引擎,委托判断靠 agent 智能)。S3 实际 = A 发现 + B 白名单/UI。

## S3 目标与非目标

**目标**:
1. **发现(A)**:加 MCP 工具 `a2a_list_sessions`,列本机 planrla 中 `a2a_exposed=true` 的 session(id/provider/摘要),让 agent 知道能委托谁
2. **白名单(B)**:`sessions` 表加 `a2a_exposed` 字段(默认 false),用户在设置/侧边栏标记哪些 session 允许被委托
3. **agent 自主委托(C1)**:agent 看 `a2a_list_sessions` 后,**自己判断**该委托哪个 session,调 `a2a_call`(url=`http://127.0.0.1:<port>/api/a2a`, sessionId=目标 session)→ S2 注入 → 回复

**非目标**:
- 委托编排引擎/DSL(C3,不做)
- 用户引导委托(C2,不做,纯 agent 自主)
- 跨机外部委托(loopback only,后续)
- 委托关系持久化/审计增强(S2 已有 console 审计)

## 工具定义(a2a_list_sessions)

加到 S1 的 a2a MCP 工具集(`server/modules/a2a/mcp.route.ts`,同 a2a_list/discover/call 一组,所有 provider 可见)。

```jsonc
{
  "name": "a2a_list_sessions",
  "description": "List local planrla sessions that are exposed for A2A delegation (a2a_exposed=true). Use these with a2a_call (url=http://127.0.0.1:<port>/api/a2a, sessionId=<id>) to delegate a task to another session's agent.",
  "inputSchema": { "type": "object", "properties": {} }
}
```

**返回**:
```jsonc
{
  "sessions": [
    { "id": "<session_id>", "provider": "claude", "summary": "<会话摘要>", "projectPath": "<项目路径>" }
  ],
  "count": N,
  "endpoint": "http://127.0.0.1:<port>/api/a2a"
}
```
- 只列 `a2a_exposed=true`(白名单)
- `endpoint` 提示 agent 用这个 url 调 a2a_call(本机回环)

## 配置(a2a_exposed 白名单)

- **DB**:`sessions` 表加 `a2a_exposed BOOLEAN DEFAULT 0`(`schema.ts` + `migrations.ts` runMigrations ALTER ADD COLUMN,幂等)
- **repository**:`sessionsDb` 加 `listA2aExposed()`(SELECT a2a_exposed=1)+ `setA2aExposed(sessionId, bool)`
- **API**:settings 路由加 `PATCH /api/sessions/:sessionId/a2a-exposed` body `{exposed: bool}`(或扩现有 session PATCH)
- **UI**:会话侧边栏每条 session 加"允许 A2A 委托"开关(或设置页 A2A 分区列 session 勾选)

## 数据流(session A 委托 session B)

```
session A 的 agent(Claude/Codex/...) 调 a2a_list_sessions
  → MCP /api/mcp/a2a tools/call a2a_list_sessions
  → sessionsDb.listA2aExposed() 返白名单 session[]
  → agent 看到列表(id/provider/summary/endpoint)
  → agent 判断该委托 session B(自主)
  → agent 调 a2a_call(url=http://127.0.0.1:<port>/api/a2a, sessionId=B, message="...委托内容...")
  → a2a_call(出站,S1)POST /api/a2a/(S2 入站)
  → S2 handleTaskSend(metadata.sessionId=B) → 注入 session B → spawnFns[B.provider] 跑
  → artifacts 回复 → a2a_call 拿到回复 → agent A 继续
```

## 组件改动

| 文件 | 改动 |
|---|---|
| `server/modules/a2a/mcp.route.ts` | 加 `a2a_list_sessions` 工具(tools/list + callTool 分支) |
| `server/modules/database/schema.ts` | sessions 表 `a2a_exposed` 列(初始 schema 加 + migration ALTER) |
| `server/modules/database/migrations.ts` | `runMigrations` 加 `addColumnToTableIfNotExists('sessions', 'a2a_exposed', 'BOOLEAN DEFAULT 0')` |
| `server/modules/database/repositories/sessions.db.ts` | 加 `listA2aExposed()` + `setA2aExposed(sessionId, exposed)` |
| `server/routes/settings.js`(或 sessions 路由) | PATCH session a2a_exposed |
| `src/components/...`(会话侧边栏或设置 A2A 分区) | UI 开关 |

**复用**:S1 a2a_call、S2 /api/a2a endpoint、sessionsDb。

## 安全(loopback + 白名单)

| 层 | S3 |
|---|---|
| session 白名单 | `a2a_exposed` 标志,只有标记的 session 出现在 `a2a_list_sessions` + 可被委托 |
| loopback | S2 已 loopback only,内部协作本机回环 |
| 委托边界 | agent 只能委托 a2a_exposed session(非白名单 session S2 仍可调,但 a2a_list_sessions 不列——agent 不知道 id) |

**注**:S2 的 /api/a2a 接收任意 sessionId(loopback 信任)。S3 白名单只控制"发现"(a2a_list_sessions 列哪些)。若要严格(非白名单 session 不接受委托),S2 handleTaskSend 加 `sessionsDb.getSessionById(sessionId).a2a_exposed` 检查。**建议加**(plan 阶段定,倾向加,防 agent 拿到非白名单 id 乱调)。

## 验收标准

1. 设置/侧边栏标记 session X 为 a2a_exposed ✓
2. session A 的 agent 调 `a2a_list_sessions` → 看到 session X(id/provider/summary)✓
3. session A agent 调 `a2a_call(url=本机/api/a2a, sessionId=X, message="...")` → session X agent 处理 + 回复回 A ✓
4. 非 a2a_exposed session 不出现在 a2a_list_sessions ✓
5. (若加严格检查)非白名单 session 被 a2a_call 委托 → S2 拒绝(403/failed)✓
6. `npm run typecheck && npm run build` 干净

## 风险 / 未决

- **a2a_exposed UI 位置**:会话侧边栏(每条 session 开关)vs 设置 A2A 分区(列表勾选)。侧边栏更直观(plan 阶段定,倾向侧边栏)。
- **严格白名单检查**:S2 handleTaskSend 加 a2a_exposed 检查(plan 阶段定,倾向加)。
- **agent 自主委托质量**:agent 可能委托错 session 或乱委托。靠 a2a_list_sessions 的 summary 质量 + agent 智能;后续可加委托确认 UI(C2,本切片不做)。
- **循环委托**:session A 委托 B,B 委托 A,死循环。靠 chatRunRegistry 一 session 一 run(同 session 不能并发)+ agent 不应委托回自己(靠 prompt/summary)。技术兜底:handleTaskSend 检查"正在被委托的 session 不再发 a2a_call"(复杂,本切片不做,靠 agent 自律)。

## 下一步

本 spec Archie 确认(C1 已选)→ `writing-plans` 出 S3 实施 plan → worktree 实施 → 验收 → 合并 main → A2A 三切片(S1+S2+S3)完整。
