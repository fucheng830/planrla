---
REQ-ID: REQ-043
title: kanban goal-stop-hook(stage 级 /goal 式自主,claude 软自判 + task_complete MCP + Stop hook block + maxTurns 兜底)
date: 2026-07-22
status: spec
关联: spike `debug/spike-stop-hook-block.mjs`(验证 claude-agent-sdk Stop hook block 机制)
---

# REQ-043 kanban goal-stop-hook 设计

## 背景

Archie 的"AI 自主工作"范式核心切片:把迭代计划给 agent,让它**持续工作到目标完成**而非干一步停一步等指令 —— 正是 Claude Code 内置 `/goal`(v2.1.139+)的体验。`/goal` 的底层机制是 **session 级 Stop hook condition**:claude 想结束 turn 时,Stop hook 检查"目标完成没",没完成就阻止它停下。

planrla kanban 的 agent 是 **claude-agent-sdk spawn 的(headless)**,不解析 `/goal` 字符串(CLI REPL 特性)。但 Stop hook 机制 SDK 完全可编程,且 `claude-hooks.ts` **已经在用 Stop hook**(发 liveness 信号)。所以 kanban 要获得 `/goal` 能力,不是实现命令,是**在 spawn 时注入"goal condition Stop hook"**——让单个 agent stage 内 claude 自驱到目标完成。

这是 kanban 从"能自驱(单步推进)"跨到"能放心自驱(单 stage 内一直干到完成)"的关键切片,与 Archie 范式①(睡觉自主)+ 前提(可测可量)直接交汇。

## spike 验证(已完成)

`debug/spike-stop-hook-block.mjs` 三组 run,验证 Stop hook 能否 block claude 停下:

| Run | Stop hook 返回 | Stop fired | result.subtype | 结论 |
|---|---|---|---|---|
| A | 顶层 `{decision:'block', reason}` | **3x**(跑满 maxTurns) | `error_max_turns` | ✅ **block 生效**,claude 被迫续跑到 maxTurns 截断 |
| B | `hookSpecificOutput` 包装 | 1x | `success` | ❌ block 不生效,claude 正常停 |
| C | `{}` baseline | 1x | `success` | 基线,正常停 |

**两个关键发现**:
1. **Stop hook 正确形态 = 顶层 `{ decision:'block', reason }`**(不是 hookSpecificOutput,后者只对 PreToolUse 的 permissionDecision 有效)
2. **maxTurns 截断的 `result.subtype = 'error_max_turns'`** —— 这是 runner 区分"goal 主动完成"vs"maxTurns 耗尽兜底"的判据

方案 A(Stop hook block)可行性**已证实**。

## 目标

1. agent stage 可配 `goalCondition`,stage 内 claude 持续工作直到**自判完成**并调用 `task_complete` MCP 工具声明
2. 完成 → stage 自然推进(`service.next`);maxTurns 耗尽 → 任务 fail + `aux.sessionError` 可见
3. 与现有 kanban hooks(AskUserQuestion 拦截 / liveness)同数组叠加,零回归
4. 纯后端机制,无 UI 改动

## 非目标

- **跨任务接力**(任务 A 完成 → 自动 admit 任务 B):onTerminal→getNextTask 闭环,属另一切片(可后续 REQ)
- **硬 gate 命令**(goal = `npm test` exit 0):本切片走软自判(claude 自判 + task_complete 信号);硬 gate 可作为后续增强叠加
- **task 级 goal**:只做 stage 级,与现有 stage 流水线契合
- **UI 改动**:完成 summary 进 `task_events` 审计表(时间线可见),不膨胀 `auxFlags`

## 架构

### 核心数据流(spike 实证)

```
agent stage 有 goalCondition → runner spawn 时注入:
  - opts.maxTurns = stage.goalMaxTurns (默认 300)
  - hooks.PostToolUse[matcher:'task_complete'] → 设 flag completedThisTurn = true
  - hooks.Stop → 读 flag:
      true  → 返回 {} 放行 → claude 停 → result.subtype = success
      false → 返回 {decision:'block', reason:'<goalCondition> 未完成,继续'} → claude 续跑
  - prompt 注入 goal + "完成后调 task_complete(taskId, summary)"

两种出口:
  · task_complete 已调 → Stop 放行 → subtype=success → runner onComplete → service.next 推进
  · maxTurns 耗尽 → subtype=error_max_turns → runner 检测 → service.fail(sessionError='goal maxTurns 耗尽')
```

### flag 生命周期

`completedThisTurn` 是 per-query 的 Map(每次 spawn 新建 hooks,自然隔离)。PostToolUse[task_complete] 设 true 后,同 query 内 Stop 读到 true 即放行;stage 推进后 query 结束,flag 随之消亡。不需要 per-turn 重置——`task_complete` 一旦调用即声明完成,stage 立即推进。

### 与现有 hooks 叠加

`claude-hooks.ts` 当前 Stop hook 仅在 `emitHookEvents` 时挂 liveness(恒返回 {})。加 goal block 后,Stop 数组按需推入:
- `emitHookEvents` → 推 liveness(发信号,返回 {})
- `goalCondition` 存在 → 推 goalBlock(决定放行/block)

Claude Code 多 Stop hooks 依次执行,任一返回 block 则 block。liveness 永远不 block,goal block 独立决策,互不干扰。

## 组件改动

| 文件 | 改动 |
|---|---|
| `server/modules/kanban/types.ts` | `StageTemplate` 加 `goalCondition?: string` + `goalMaxTurns?: number` |
| `server/modules/kanban/prompt.ts` | `renderStagePrompt`:有 goalCondition 时 preamble 追加 goal + task_complete 指令 |
| `server/modules/kanban/claude-hooks.ts` | `createKanbanClaudeHooks` 加可选 `goalCondition`;有则挂 PostToolUse[task_complete] + Stop goalBlock |
| `server/modules/kanban/runner.ts` | spawn opts 透传 `maxTurns: stage.goalMaxTurns ?? 300`(error_max_turns 兜底走现有 reject/catch → service.fail,不新增逻辑) |
| `server/modules/kanban/mcp.route.ts` | 加第 5 个工具 `task_complete(taskId, summary)`:记 `goal_completed` event + service.next |
| `server/claude-sdk.js` | `createKanbanClaudeHooks` 调用处透传 goalCondition(从 stage 读) |
| `server/modules/kanban/tests/claude-hooks.test.ts` | goal Stop hook 放行/block 两路 + PostToolUse flag |
| `server/modules/kanban/tests/runner.test.ts` | goal stage 传 maxTurns + hooks;mock subtype=error_max_turns → fail |
| `server/modules/kanban/tests/mcp-route.test.ts` | task_complete → service.next + event 落库 |

## 数据模型

`StageTemplate`(`types.ts`)加两个可选字段:

```ts
interface StageTemplate {
  // ... 现有字段
  goalCondition?: string;   // 有此字段 = goal stage,挂 stop-hook;无 = 现有单次行为(零回归)
  goalMaxTurns?: number;    // maxTurns 上限,默认 300
}
```

- **`goalCondition` 缺失 = 现有行为**:stage 单次跑完即推进,完全不动现有模板/任务
- **默认 `goalMaxTurns = 300`**:覆盖 Archie 的"睡觉自主"长任务场景(每"轮"≈claude 一次想停,300 轮够大型自主任务)。模板可按任务复杂度调高/调低

## MCP 工具 task_complete

`mcp.route.ts` `TOOL_DEFS` 加:

```ts
{
  name: 'task_complete',
  description: 'Declare this kanban task\'s current goal complete. Call when the goal condition is satisfied. Advances the task to its next stage.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string' },
      summary: { type: 'string', description: 'brief summary of what was accomplished' },
    },
    required: ['taskId'],
  },
}
```

`tools/call` 分支:`task_complete` → `service.next(rootId, taskId)` + `taskStore.insertTaskEvent({ type:'goal_completed', payloadJson:{ summary } })` + scheduler.schedule(推进后 admit 下个 agent stage)。loopback guard 复用现有。

## Stop hook + PostToolUse 实现

`createKanbanClaudeHooks` 加 `goalCondition?: string` 入参:

```ts
// PostToolUse:task_complete 调用 → 设 flag
if (goalCondition) {
  hooks.PostToolUse = [{
    matcher: 'task_complete',
    hooks: [async (input) => { completedThisTurn.set(taskId, true); return {}; }],
  }];
  // Stop:读 flag 决定放行/block
  hooks.Stop.push({
    matcher: '',
    hooks: [async () => {
      if (completedThisTurn.get(taskId)) return {};  // 放行
      return { decision: 'block', reason: `Goal not done: ${goalCondition}. 继续工作,完成后调用 task_complete(taskId, summary)。` };
    }],
  });
}
```

`taskId` + `completedThisTurn` Map 通过闭包/入参注入(per-query 生命周期)。

## prompt 注入

`renderStagePrompt`:有 `goalCondition` 时,preamble 追加:

```
你的目标:<goalCondition>
持续工作直到目标完成。完成后必须调用 task_complete(taskId="<taskId>", summary="...") 声明完成,summary 简述成果。
未完成时不要停止;中途可调 task_status 查看。
```

## 兜底(双保险)

| 维度 | 上限 | 触发后 |
|---|---|---|
| 轮次 | `goalMaxTurns`(默认 300)→ `error_max_turns` | `service.fail` + `sessionError='goal maxTurns 耗尽'` |
| 墙钟 | `stageTimeoutMs`(默认 30min,现有)→ Promise.race reject | `service.fail` + `sessionError` |

两维度独立:maxTurns 防逻辑死循环,stageTimeoutMs 防墙钟爆炸。任一触发即 fail,worktree 由 onTerminal 清理。

**error_max_turns 走现有 reject/catch 路径**(spike 实测:query 在 max_turns 截断时发 error result 后 reject)→ runner.ts:219 现有 catch → `service.fail` + `sessionError`(消息自然含 "maximum number of turns",可识别)。**兜底 fail 复用现有机制,不新增逻辑**。成功路径由 `task_complete` MCP handler 触发 `service.next`,onComplete 看到 `alreadyAdvanced`(或 task 已 terminal)自动跳过,不双推进/不双调 fail。

## 测试

- `claude-hooks.test.ts`:goal Stop hook——flag true 放行 / flag false 返回 `{decision:'block'}`;PostToolUse[task_complete] 设 flag
- `runner.test.ts`:goal stage spawn opts 含 `maxTurns: 300`;mock spawnFn reject(max-turns 错误)→ `service.fail` 被调 + `sessionError` 含 max turns;mock resolve + task_complete MCP 调用 → `service.next` 被调
- `mcp-route.test.ts`:`task_complete(taskId, summary)` → service.next 调用 + `goal_completed` event 落 task_events
- 既有测试零回归(goalCondition 缺失 = 现有行为)

## 验收标准

1. 建 goal stage 任务(goalCondition + goalMaxTurns)→ agent 持续工作直到调 `task_complete` → stage 推进 + `goal_completed` event(含 summary)入时间线 ✓
2. agent 不调 `task_complete` 想提前停 → Stop hook block + reason 回喂 → claude 续跑 ✓
3. maxTurns 耗尽 → spawnFn reject → 现有 catch → task fail + `aux.sessionError` 含 "maximum number of turns" + worktree 清理 ✓
4. 无 goalCondition 的 stage → 行为零回归(单次跑完即推进)✓
5. 现有 AskUserQuestion 拦截 + liveness Stop hook 仍正常(同数组叠加不干扰)✓
6. `npm run typecheck && npm run test:kanban` 干净 ✓

## 风险/未决

- **Stop hook 与 liveness 共存**:spike 验证了单个 Stop hook block;多 Stop hooks(liveness + goalBlock)叠加需在测试中确认 SDK 依次执行且 liveness 的 `{}` 不影响 goalBlock 的 block 决策(Claude Code 规范:任一 block 则 block,liveness 永不 block,应无冲突——但需测试证实)
- **goalMaxTurns=300 的 token 成本**:最坏情况 token 消耗大;stageTimeoutMs 30min 墙钟兜底。若实际 dogfood 发现 300 太烧,模板可调低或后续加"累计 token 上限"(需 SDK 支持,另议)
- **task_complete 误调**:agent 可能在 goal 未真满足时误调 task_complete(软自判固有风险)。本切片接受(claude 自判);硬 gate(npm test 验证)作为后续增强叠加到 Stop hook(task_complete 时真跑命令验证)
- **review comment 与 goal stage**:review 续跑(startReviewComment)当前用 `bypassPermissions` 单次跑,不挂 goal hook——review 不自驱 goal,符合"人评论 → agent 改一轮"语义,无需改动

## 下一步

spec Archie 确认 → writing-plans → worktree `req043-goal-stop-hook` 实施(8 文件 + 3 测试)→ 三道门验收(dogfood:建 goal stage 任务,失焦睡觉,醒来看 task_complete 推进 / maxTurns 兜底)。
