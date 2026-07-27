---
REQ-ID: REQ-046
标题: 后台任务管理面板(统一列表:kanban / a2a / chat / agent Bash)
日期: 2026-07-27
状态: spec
类型: feat
---

# REQ-046 后台任务管理面板

## 1. 背景

planrla 的后台任务现在散在四处,互不相通,用户**看不到也控不住**:

- **kanban agent task** —— agent 在独立 worktree 跑 stage,进度(aux flags)不实时(REQ-034:SDK events 没经 writer 桥接),挂死无超时(REQ-037)
- **A2A spawn task** —— 委派给 kimi/claude 的后台 session,task state 只在 `/api/a2a` 内部,无 UI
- **chat run** —— chat-run-registry 管 run lock,前端只看当前 session stream,看不到"还有哪些 session 在跑"
- **agent 内 Bash background** —— Claude Code agent 调 Bash(`run_in_background:true`),SDK 黑盒,planrla 完全不追

对应 `quant/CLAUDE.md` 经验 #3「后台任务管理混乱:反复启停产生孤儿进程,端口被旧进程占用,kill 乱杀」。本需求给一个**统一面板**,所有后台任务一屏看尽 + 干净控制(停/查/日志/重试)。

## 2. 目标 / 非目标

**目标**:
- 一个 `BackgroundTaskPanel` UI(方案 A 统一列表),聚合四类后台任务(kanban / a2a / chat / agent Bash),实时刷新(WS)
- 每张卡片:类型标签 + 标题 + 进度条 + 耗时 + 控制按钮(停止 / 查看 / 日志 / 重试)
- 干净停止(kill 进程 + 释放 worktree/端口)—— 直击 quant #3 孤儿/乱杀
- 顺带修 REQ-034(kanban aux flags 实时)+ 给 REQ-037(挂死超时)留检测点

**非目标**:
- ❌ agent 内 Bash background 的**真完成态**精确追踪 —— SDK 不主动透(SDK 只在 agent 调 BashOutput 时透 output),用启发式估(stale)。要 SDK 改是后续
- ❌ 改 Claude Code SDK 本身(纯解析 SDK 透出的 tool_use events)
- ❌ 跨用户/跨机器任务(单机单用户)
- ❌ 任务调度/队列(只看/控,不调度)

## 3. 架构

**核心:server 新 `background-task-registry`(聚合四类 → 统一 `BackgroundTask` 模型),WS push 前端面板。**

### 统一模型

```ts
type BackgroundTaskType = 'kanban' | 'a2a' | 'chat' | 'bash';
type BackgroundTaskStatus = 'running' | 'idle' | 'completed' | 'failed' | 'killed' | 'stale';

interface BackgroundTask {
  id: string;          // 各类型原 id 加前缀:kanban:REQ-045 / a2a:<taskId> / chat:<appSessionId> / bash:<appSessionId>:<bashTaskId>
  type: BackgroundTaskType;
  title: string;       // REQ-045 sidebar a11y / kimi UI 分析 / 91bb1e17 / npm build
  status: BackgroundTaskStatus;
  progress?: number;   // 0-100(kanban stage 比 / bash 估)
  startedAt: number;
  detail: {
    // kanban: { taskId, stage, stageTotal, aux: {hasPlan,hasTodos,hasTask,sessionError} }
    // a2a:    { taskId, state, provider }
    // chat:   { appSessionId, provider }
    // bash:   { appSessionId, bashTaskId, cmd, outputTail: string[], exitCode?: number }
  };
}
```

### 数据流(四类 task 怎么进 registry)

| 类型 | 现有 event 源 | 接入点 |
|---|---|---|
| kanban | `runner.ts` stage 事件 + aux flags | runner emit → `registry.update()`;aux 桥接修 REQ-034 |
| a2a | `inbound.service` task state + `tasks/get` poll | inbound → `registry.update()` |
| chat | `chat-run-registry`(已有 run lock + status) | `registry` 引用它(proxy,不重造) |
| bash | `claude-sdk.js` 收 SDK `tool_use`(Bash `run_in_background` / `BashOutput` / `KillBash`) | claude-sdk.js 解析 → `registry.start/update/complete` |

### 前端

- `BackgroundTaskPanel` 组件(方案 A 统一列表):卡片 = type 标签 + title + 进度条 + 耗时 + 按钮
- WS 收 `background_task_update`(全量 list 或 diff)→ 实时刷新
- 控制:`POST /api/background-tasks/:id/{stop|retry}` + view(跳详情:kanban task / a2a session / chat 窗口)+ log(抽屉看 outputTail / agent 输出)

## 4. 状态机

```
start → running → completed (stage done / a2a completed / bash exit 0)
                → failed    (aux.sessionError / a2a failed / bash exit≠0 / 挂死超时)
                → killed    (用户 stop API / KillBash)
                → stale     (agent Bash N min 无新 output,启发式估完成)

chat: running ↔ idle(chat-run-registry status)
```

每类映射:
- **kanban**:stage 跑=running;全 stage done=completed;`aux.sessionError`=failed;用户停=killed;10min 无 event=failed(挂死,REQ-037 检测点)
- **a2a**:state working=running;completed/failed/canceled;用户停=killed
- **chat**:run-registry running=running;否则 idle
- **bash**:start=running;BashOutput exit 0=completed;exit≠0=failed;5min 无新 output=stale;KillBash=killed

## 5. agent Bash 解析(方案 1+:纯解析 SDK events,不碰 SDK)

`claude-sdk.js` 收 SDK 透出的 `tool_use` / `tool_result`(已归一化)。加 background 解析:

| SDK event | registry 动作 |
|---|---|
| `tool_use(Bash, input.run_in_background:true)` + `tool_result(task_id, 初始 output)` | `start({type:'bash', bashTaskId, cmd, outputTail})` |
| `tool_use(BashOutput, task_id)` + `tool_result(output)` | `update(outputTail)`;若 output 含 exit code → completed/failed |
| `tool_use(KillBash, task_id)` | `complete(killed)` |
| (无新 BashOutput,5min) | `stale`(启发式) |

**前置(实现时验证)**:SDK 透 Bash tool_use 的 `input.run_in_background` 字段 + BashOutput tool_result 的 output/exit。若 SDK 只透启动不透 output,降级为只 count(方案 3),spec §10 回退。

## 6. 错误处理

- **挂死**(REQ-037 GLM 场景):kanban/bash task 10min 无任何 event → failed + sessionError
- **解析失败**:SDK event 格式异常 → 容错 warn + 跳过(单个坏 event 不崩 registry)
- **内存**:task 完成/终止后 TTL 30min 清 + registry 上限 100(LRU)

## 7. 暂定值(可配)

| 项 | 值 | 说明 |
|---|---|---|
| bash stale 阈值 | 5 min | 无新 BashOutput → stale |
| 挂死超时 | 10 min | kanban/bash 无 event → failed |
| task TTL | 30 min | 完成后保留时长(前端可见) |
| registry 上限 | 100 | LRU |

## 8. 影响面 / 文件

| 文件 | 改动 |
|---|---|
| `server/modules/background-tasks/registry.service.ts`(新) | 聚合 service + 统一模型 + 状态机 + TTL/LRU |
| `server/modules/background-tasks/registry.routes.ts`(新) | `GET /api/background-tasks` + `POST /:id/{stop|retry}` |
| `server/modules/background-tasks/types.ts`(新) | BackgroundTask 模型 |
| `server/modules/kanban/runner.ts` | emit stage event → registry.update(接 REQ-034 aux 桥接) |
| `server/modules/a2a/inbound.service.ts` | task state → registry.update |
| `server/modules/websocket/services/chat-run-registry.service.ts` | registry 引用(proxy chat 类型) |
| `server/claude-sdk.js` | 解析 Bash background tool_use → registry.start/update/complete |
| `server/index.js` | mount background-tasks router + WS `background_task_update` 广播 |
| `src/components/background-tasks/BackgroundTaskPanel.tsx`(新) | 面板 UI(方案 A)+ 卡片 + 按钮 |
| `src/components/background-tasks/BackgroundTaskCard.tsx`(新) | 单卡片 |
| `src/components/background-tasks/useBackgroundTasks.ts`(新) | WS 订阅 + 控制动作 fetch |
| sidebar / 顶栏 | 入口按钮(打开面板) |

## 9. 验收标准

1. 面板聚合四类后台任务(kanban/a2a/chat/bash),实时刷新(WS,新 task/状态变 ≤1s 到前端)
2. 每张卡片显示 type 标签 + 标题 + 进度(kanban/a2a/bash)+ 耗时 + 状态
3. 控制按钮:**停止**(干净 kill + 释放 worktree/端口,无孤儿)、**查看**(跳对应详情)、**日志**(抽屉看 outputTail / agent 输出)、**重试**(失败/挂死重跑)
4. 状态机:running/idle/completed/failed/killed/stale 全覆盖,转换正确
5. agent Bash:启动/start、BashOutput/update、KillBash/killed、5min 无 output/stale —— 都能在面板看到
6. 挂死:kanban/bash 10min 无 event → failed + sessionError
7. REQ-034 顺带修:kanban aux flags 实时(aux 桥接到 registry)
8. typecheck + test 过(四类聚合 + 状态机 + agent Bash 解析 + 控制动作)

## 10. 回退

- agent Bash 若 SDK 不透 output(§5 前置失败)→ 降级方案 3(只 count「running N 个」,不追 output/完成),其他三类不受影响
- 单类接入出问题 → 该类从 registry 摘除(降级显示),不影响其他类

## 11. 测试

- `registry.service.test.ts`:四类聚合 + 状态机所有转换 + stale/挂死 + TTL/LRU
- `claude-sdk.js` Bash 解析单测(tool_use fixture → start/update/complete/stale)
- 控制动作(stop/retry API)+ 前端面板(WS + 卡片 + 按钮回调)
- dogfood:跑一次 build/dev 后台 + 一个 kanban task + 一个 a2a spawn,面板全看到 + 能停

## 12. 与现有 REQ 关系

- **REQ-034**(kanban aux flags 不实时)→ 本需求 §4/§8 顺带修(aux 桥接 registry)
- **REQ-037**(kanban agent GLM 挂死)→ 本需求 §4/§6 留检测点(10min 超时 failed);REQ-037 本身(GLM env 剖离)独立修
- **REQ-036**(worktree HEAD 漂移)→ 无关
