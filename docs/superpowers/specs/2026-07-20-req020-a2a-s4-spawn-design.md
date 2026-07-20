---
REQ-ID: REQ-020
切片: S4(A2A 对话派生 —— session A agent 经 a2a_call 自动创建新 session 执行子任务)
日期: 2026-07-20
状态: spec
关联: S1(a2a_call 出站)/ S2(/api/a2a 入站)/ S3(白名单)
---

# REQ-020 A2A · S4 Spawn Session 设计

## 目标

session A 的 agent 调 `a2a_call`(url=本机 /api/a2a, message, metadata.spawn=true)→ S2 检测 spawn → **创建新 session**(空 context)→ spawnFn 跑 → 回复回 A。新 session 出现在侧边栏(派生对话)。

**走完整 A2A 链路**(a2a_call → /api/a2a endpoint → 注入),验证 S1/S2 端到端。

## 方案(方案 2:A2A spawn signal)

`a2a_call` 的 `metadata` 加可选字段:
- `spawn: true` —— 触发派生(不传则委托已有 session,即 S3 行为)
- `provider: string`(可选,默认 `claude`)—— 新 session 的 provider
- `projectPath: string`(spawn 时必填)—— 新 session 的工作目录

S2 `handleTaskSend` 检测 `metadata.spawn === true`:
1. 不查已有 session(跳过 sessionId + a2a_exposed 检查)
2. `sessionsDb.createSession({ provider: metadata.provider || 'claude', projectPath: metadata.projectPath })` 创建新 session
3. spawnFn 跑新 session(空 context,全新 provider_session_id)
4. 回复回调用方(同 S2 artifacts)
5. 新 session 出现在侧边栏(下次 projects 刷新;WS 推送可选)

**向后兼容**:标准 A2A agent 不传 spawn → S3 行为(委托已有 session,要 sessionId + a2a_exposed)。只有 planrla 自己的 agent 传 spawn → 派生。协议纯净度可控(spawn 是 metadata 可选字段)。

## 3 关键决策(已定)

| 项 | 决策 |
|---|---|
| 新 session provider | `metadata.provider` 或默认 `claude` |
| 新 session project | `metadata.projectPath`(spawn 必填,agent 知道当前 cwd) |
| 新 session context | **空**(全新对话,不继承 A 历史;派生 = 干净环境跑子任务) |
| 新 session a2a_exposed | **false**(不自动暴露;用户后续手动标记若想再被委托) |

## 数据流

```
session A agent 调 a2a_call(url=http://127.0.0.1:<port>/api/a2a,
  message="帮我重构 X", metadata={ spawn:true, provider:'codex', projectPath:'D:/...' })
  → a2a_call(出站,S1)POST /api/a2a/ tasks/send
  → S2 handleTaskSend 检测 metadata.spawn=true
  → 跳过 sessionId/a2a_exposed 检查
  → sessionsDb.createSession({ provider:'codex', projectPath:'D:/...' }) → 新 sessionId
  → chatRunRegistry.startRun(新 session)
  → spawnFns['codex'](message, { sessionId: undefined(首次), cwd: projectPath, projectPath, permissionMode:'bypassPermissions' }, writer)
  → writer.waitComplete(120s)
  → 回复回 A(session A agent 拿到 codex 的回复)
  → 新 codex session 出现在侧边栏(projects 刷新)
```

## 组件改动

| 文件 | 改动 |
|---|---|
| `server/modules/a2a/inbound.service.ts` | `handleTaskSend` 加 spawn 分支:检测 metadata.spawn → sessionsDb.createSession + 跳过 sessionId/exposed 检查 + spawnFn |
| `server/modules/database/repositories/sessions.db.ts` | 确认 createSession 方法(或加)——创建新 session 行(provider/projectPath) |
| `server/modules/a2a/mcp.route.ts`(S1) | a2a_call 工具的 inputSchema 加可选 `spawn`/`provider`/`projectPath` 到 metadata 说明(让 agent 知道能传) |

**不改**:S2 route(同一 endpoint)、S3 白名单(spawn 跳过白名单,因为创建新)。

## 安全

| 层 | S4 |
|---|---|
| loopback | S2 已 loopback only |
| 限频 | S2 已 per-IP 20/min(spawn 也计入) |
| 创建 session 权限 | loopback 信任,任何 agent 能 spawn(本机无外部威胁) |
| projectPath | agent 传(loopback 信任;若担心,可校验 projectPath 在已知 projects 列表内,本切片不做) |
| 新 session 暴露 | a2a_exposed=false,不自动被再委托 |

## 验收标准

1. session A agent 调 `a2a_call(url=本机/api/a2a, message="...", metadata={spawn:true, provider:'codex', projectPath:'D:/...'})` → 新 codex session 创建 + 跑 + 回复回 A ✓
2. 新 session 出现在侧边栏(provider=codex, project=指定)✓
3. 不传 spawn → S3 行为(委托已有 session,要 sessionId + exposed)✓ 向后兼容
4. spawn 必填 projectPath(缺 → failed "projectPath required for spawn")✓
5. 新 session a2a_exposed=false(默认)✓
6. `npm run typecheck && npm run build` 干净

## 风险 / 未决

- **createSession 方法**:确认 sessionsDb 有创建新 session 的方法(看 sessions.db.ts;若无,加 `createSession({provider, projectPath})` INSERT + 返回 session_id)。
- **新 session provider_session_id**:首次 spawn(provider_session_id=null),spawnFn 新建。同 chat 首次发送。
- **新 session UI 出现时机**:server 创建后,前端侧边栏要刷新才看到(WS 推送 session_created 可选,本切片靠刷新/重连)。agent 拿到回复即可,不阻塞。
- **循环 spawn**:A spawn B,B spawn C... 靠 agent 自律 + 限频。本切片不做技术兜底。
- **provider 校验**:metadata.provider 若不在 spawnFns(如 'unknown')→ failed。spawnFn[provider] 检查已有。

## 下一步

spec Archie 确认 → writing-plans → worktree 实施 → 验收 → 合并 main。
