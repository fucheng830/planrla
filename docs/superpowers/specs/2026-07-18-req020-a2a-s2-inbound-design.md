---
REQ-ID: REQ-020
切片: S2(planrla 暴露为 A2A endpoint —— 入站)
日期: 2026-07-18
状态: spec(Archie 已认可 design,直接执行)
关联:
  - S1 spec: 2026-07-11-req020-a2a-s1-client-tools-design.md
  - hermes-a2a: `D:\workspace\projects\ai\agents\ai-agents\hermes-a2a\plugin\server.py`(endpoint 模板)
  - kanban runner: `server/modules/kanban/runner.ts` + `runner-writer.ts`(程序化注入 + writer 黄金参照)
---

# REQ-020 A2A · S2 Inbound Endpoint 设计

## 架构上下文

S1(client 出站)已实现 + 合并 main。S2 暴露 planrla 为 A2A endpoint,接收外部/自家 session 的 A2A 消息(入站)。S3 后续做 per-session 寻址路由 + 内部协作编排。

**Archie 决策**:
- **认证:loopback only**(127.0.0.1/::1,无 token)—— 本机 A2A 协作够用,不支持跨机外部(后续开外部再加 token + 白名单)
- **endpoint:主 app `/api/a2a/`**(复用 Express 3001,loopback guard)

## S2 目标与非目标

**目标**:
- planrla 暴露 A2A JSON-RPC endpoint(loopback):`GET /.well-known/agent.json`(Agent Card)+ `POST /`(tasks/send | tasks/get | tasks/cancel)
- `tasks/send` 接收消息 → 经 sessionId 寻址 → 注入到该 session → 该 session 的 provider agent 处理 → 同步(120s)/轮询取回 artifacts 回复
- 复用 kanban runner 的"程序化注入"模式(`spawnFns[provider]` + writer 缓存回复),不走 WebSocket
- 入站安全:sanitize_inbound(prompt injection,9 正则)+ filter_outbound(复用 S1)+ per-IP 限频 20/min + 一 session 一 run

**非目标(留给 S3)**:
- per-session 寻址的 UI/发现(session A 怎么发现 session B)—— S3
- session 间委托编排 —— S3
- SSE 流式(`streaming:false`,同步 + 轮询)
- 跨机外部(loopback only;外部 token + 白名单后续)

## endpoint

挂在主 Express `app.use('/api/a2a/', a2aInboundRouter)`,**auth 之前**(loopback guard 自管,同 S1 a2a mcp / kanban mcp)。

- `GET /api/a2a/.well-known/agent.json` → Agent Card
- `POST /api/a2a/` → JSON-RPC 分发
- loopback guard(127.0.0.1/::1/::ffff:127.0.0.1,非 loopback → 403)

### Agent Card
```json
{
  "name": "planrla",
  "description": "Planrla project AI workbench (A2A inbound, loopback only)",
  "url": "http://127.0.0.1:3001/api/a2a",
  "version": "<package.json version>",
  "protocol": "a2a",
  "protocolVersion": "0.2.0",
  "capabilities": { "streaming": false, "pushNotifications": false, "multiTurn": true, "structuredMetadata": true },
  "skills": [{ "id": "general", "name": "General Assistant", "description": "Delegate a task to a planrla session's agent" }],
  "authentication": {}
}
```
`authentication: {}`(loopback 无 token)。skills 硬编码 `general`(同 hermes,S3 再动态化)。

## tasks/send 注入数据流(核心)

```
POST /api/a2a/  body: JSON-RPC { method:'tasks/send', params:{ message:{parts:[{type:text, text}]}, metadata:{ sessionId } } }
  ① loopback guard
  ② 限频(per-IP 20/min,超限 429)
  ③ JSON-RPC 解析,method=tasks/send
  ④ 抽 message.parts[].text(空 → failed)
  ⑤ sanitize_inbound(text)(9 条 prompt-injection 正则,移植 hermes security.py:17-37)
  ⑥ sessionsDb.getSessionById(sessionId)(无 → error;取 provider/project_path/provider_session_id)
  ⑦ chatRunRegistry.startRun({appSessionId: sessionId, provider, ...})(已有 run → "Agent busy" 429,复用 chat 的并发语义)
  ⑧ A2AInboundWriter(仿 RunnerWriter,缓存 provider 事件为 text)
  ⑨ await spawnFns[provider](sanitizedText, { sessionId: provider_session_id, cwd: project_path, projectPath, permissionMode: 'bypassPermissions' }, writer)
       (照搬 kanban runner.ts:155-186 的并发/timeout/兜底)
  ⑩ 阻塞等 writer complete(120s):完成 → artifacts 回填;超时 → state:working(对方 tasks/get 轮询)
  ⑪ filter_outbound(responseText)(复用 S1 a2a-client.service.ts)
  ⑫ 审计 console/jsonl
  ⑬ 返 {jsonrpc, id, result:{ id:taskId, status:{state}, artifacts:[{parts:[{type:text, text}]}] }}
```

### tasks/get(轮询)
`POST /api/a2a/` method=tasks/get, params:{id:taskId} → 查 in-memory task store,返当前 state(working/completed/failed/canceled)。

### tasks/cancel
method=tasks/cancel → 标记 canceled + 中断 writer(若在跑)。

## 组件(新建,≤500 行/文件)

| 文件 | 职责 |
|---|---|
| `server/modules/a2a/inbound.route.ts` | Express router:loopback guard + JSON-RPC 分发(initialize 不需要,只 agent.json + tasks/*) |
| `server/modules/a2a/inbound.service.ts` | 注入逻辑:session 注入 + Agent Card 构建 + 限频 + sanitize_inbound + task store(in-memory Map) + 超时 |
| `server/modules/a2a/a2a-inbound-writer.ts` | 仿 `runner-writer.ts`:实现 spawnFn writer 契约(send/setSessionId/updateWebSocket/isWebSocketWriter/userId),缓存 provider 事件为 text,complete 时 resolve Promise |
| `server/modules/a2a/inbound.security.ts` | sanitize_inbound(9 正则)+ RateLimiter(per-IP 20/min),移植 hermes security.py。filter_outbound 复用 S1 a2a-client.service.ts |
| `server/modules/a2a/inbound.service.test.ts` | 单测:注入(mock spawnFn)+ sanitize_inbound + 限频 |

**复用**:
- S1 `a2a-client.service.ts` 的 `filterOutbound`(出站脱敏)
- `server/modules/kanban/runner-writer.ts` 的 writer 契约(仿写)
- `chatRunRegistry`(一 session 一 run)
- `sessionsDb.getSessionById`(session 寻址)
- `spawnFns`(provider 分发)

## 修改

- `server/index.js`:挂 `/api/a2a/` 路由(auth 之前,同 /api/mcp/a2a)
- 无 DB 改动(loopback only,task store in-memory;session 白名单 S3 再加表)

## 安全(loopback only)

| 层 | S2 |
|---|---|
| 认证 | loopback(127.0.0.1/::1),无 token |
| 限频 | per-IP 20/min(loopback 单 IP,保留防失控) |
| 入站过滤 | sanitize_inbound(9 正则 prompt injection) |
| 出站脱敏 | filter_outbound(复用 S1) |
| 并发 | chatRunRegistry 一 session 一 run(防并发冲突) |
| session 越权 | loopback 信任,全部 session 可调(本机无外部威胁;外部开再加白名单) |
| 审计 | console(S2 简化;jsonl 后续) |

## 验收标准

1. `GET /api/a2a/.well-known/agent.json` 返 Agent Card(loopback 外 403)
2. S1 的 a2a_call(本机 hermes-a2a 或自测)调 planrla `/api/a2a/` tasks/send,指定 sessionId,planrla 该 session 的 agent 处理 + 回复
3. working 态轮询(tasks/get)正确终止(不卡)
4. session 已有 run(WS 在跑)时 tasks/send 返 "Agent busy"(不并发冲突)
5. sanitize_inbound:发含 prompt-injection 的消息 → 过滤([FILTERED])
6. filter_outbound:回复含 API key → [REDACTED]
7. per-IP 限频:超 20/min → 429
8. loopback 外(IP 非 127.0.0.1)→ 403
9. `npm run typecheck && npm run build` 干净
10. packaged asar 可用(进程内 Express,无外部 spawn)

## 风险 / 未决

- **session 寻址**:统一 endpoint + body `metadata.sessionId`。loopback 信任全部 session;S3 再加白名单/发现 UI。
- **task store**:in-memory(Map),server 重启丢 working 任务(acceptable,S2 短时;S3 持久化再考虑)
- **permissionMode**:入站用 `bypassPermissions`(外部 agent 委托,不打断用户权限确认)。若 Archie 要更严,可改 default(但会卡在权限请求,入站无人 ack)。**plan 阶段定**,倾向 bypassPermissions(入站委托语义)。
- **多 provider**:session 的 provider 由 sessionsDb 查表得出,S2 不需要 provider 分支。
- **测试对方**:本机起 hermes-a2a(它有 client)或用 curl 直接 POST /api/a2a/ 模拟 A2A client。

## 下一步

本 spec Archie 已认可 → `writing-plans` 出 S2 实施 plan → worktree `.claude/worktrees/req020-a2a-s2` 实施 → 三道门验收 → 合并 main → S3。
