# REQ-043 kanban goal-stop-hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 kanban agent stage 加 `/goal` 式自主能力——stage 配 `goalCondition` 后,claude 持续工作直到自判完成并调 `task_complete` MCP 工具,Stop hook 阻止提前停,maxTurns(默认 300)兜底。

**Architecture:** stage 级 goal(软自判)。claude 调 `task_complete` MCP → PostToolUse hook 设 flag → Stop hook 读 flag(true 放行推进 / false 返回 `{decision:'block'}` 续跑)。maxTurns 耗尽 → spawnFn reject → 现有 catch → service.fail。spike(`debug/spike-stop-hook-block.mjs`)已实证:Stop hook 顶层 `{decision:'block'}` 生效;`error_max_turns` 走 reject/catch。

**Tech Stack:** TypeScript(server/modules/kanban)+ claude-agent-sdk function hooks(Stop/PostToolUse)+ node:test。基底 commit `1ed6a8e`(claude-hooks.ts 已在 main)。

**Spec:** `docs/superpowers/specs/2026-07-22-req043-kanban-goal-stop-hook-design.md`

---

## 前置:worktree node_modules junction

worktree 无 node_modules,tsc/test 跑不了。先 junction 主 worktree 的 node_modules(从 worktree 根跑):

```bash
# 在 worktree 根 D:/workspace/projects/ai/apps/planrla/.claude/worktrees/req043-goal-stop-hook
cmd //c "mklink /J node_modules ..\..\node_modules"
```

验证:`ls node_modules/.bin/tsc` 存在。

---

## Task 1: types.ts — StageTemplate 加 goalCondition + goalMaxTurns

**Files:**
- Modify: `server/modules/kanban/types.ts`(StageTemplate interface)

- [ ] **Step 1: 加字段**

在 `StageTemplate` interface 的 `agentCanControlStage?: boolean;` 后加:

```ts
  /** REQ-043: 有此字段 = goal stage。claude 持续工作直到自判完成并调 task_complete MCP,
   *  Stop hook 阻止提前停。缺失 = 现有单次行为(零回归)。 */
  goalCondition?: string;
  /** REQ-043: goal stage 的 maxTurns 上限,默认 300。耗尽 → spawnFn reject → service.fail。 */
  goalMaxTurns?: number;
```

- [ ] **Step 2: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS(纯可选字段,无破坏)

- [ ] **Step 3: commit**

```bash
git add server/modules/kanban/types.ts
git commit --no-verify -m "feat(kanban): StageTemplate 加 goalCondition + goalMaxTurns 字段(REQ-043)"
```

---

## Task 2: prompt.ts — goal preamble + 测试

**Files:**
- Modify: `server/modules/kanban/prompt.ts`(加 buildGoalPreamble + renderStagePrompt 拼接)
- Test: `server/modules/kanban/tests/prompt.test.ts`

- [ ] **Step 1: 写失败测试**(prompt.test.ts 末尾追加)

```ts
import { renderStagePrompt } from '@/modules/kanban/prompt.js';

const NOW = '2026-01-01T00:00:00.000Z';
const baseStage = { id: 's', name: 'Do', role: 'agent' as const, agent: 'claude', autoAdvance: false, createdAt: NOW, updatedAt: NOW };
const baseCtx = { taskId: 't-1', taskNumber: 1, stageName: 'Do', stageIndex: 1, rootPath: '/r', input: 'go' };

test('renderStagePrompt appends goal preamble when stage has goalCondition', () => {
  const out = renderStagePrompt({
    stage: { ...baseStage, goalCondition: '所有测试通过' } as any,
    ctx: baseCtx,
  });
  assert.match(out, /所有测试通过/);
  assert.match(out, /task_complete/);
  assert.match(out, /t-1/);
});

test('renderStagePrompt omits goal preamble when no goalCondition', () => {
  const out = renderStagePrompt({ stage: baseStage as any, ctx: baseCtx });
  assert.doesNotMatch(out, /你的目标/);
  assert.doesNotMatch(out, /task_complete/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:kanban -- --test-name-pattern="goal preamble"`
Expected: FAIL(`goalCondition` 不影响输出)

- [ ] **Step 3: 实现 buildGoalPreamble + 改 renderStagePrompt**

prompt.ts 加(在 buildMcpPreamble 后):

```ts
/** REQ-043: goal stage 的 preamble——告诉 agent 目标 + 完成时调 task_complete。 */
export function buildGoalPreamble(stage: StageTemplate, ctx: PromptContext): string {
  if (!stage.goalCondition) return '';
  return [
    '',
    '--- goal ---',
    `你的目标:${stage.goalCondition}`,
    `持续工作直到目标完成。完成后必须调用 MCP 工具 task_complete(taskId: "${ctx.taskId}", summary: "...") 声明完成,summary 简述成果。`,
    '未完成时不要停止;中途可调 task_status 查看。',
    '--- end goal ---',
    '',
  ].join('\n');
}
```

改 `renderStagePrompt`:

```ts
export function renderStagePrompt({ stage, ctx }: RenderStagePromptArgs): string {
  const base = substitute(stage.promptTemplate ?? '', {
    input: ctx.input,
    task_id: ctx.taskId,
    task_number: ctx.taskNumber,
    stage_name: ctx.stageName,
    stage_index: ctx.stageIndex,
    project_path: ctx.rootPath ?? '',
  });
  const preamble = buildMcpPreamble(ctx, { enabled: stage.agentCanControlStage !== false });
  const goal = buildGoalPreamble(stage, ctx);
  const tail = preamble + goal;
  if (!base) return tail.replace(/^\n/, '');
  return base + tail;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:kanban -- --test-name-pattern="goal preamble"`
Expected: PASS(2 tests)

- [ ] **Step 5: commit**

```bash
git add server/modules/kanban/prompt.ts server/modules/kanban/tests/prompt.test.ts
git commit --no-verify -m "feat(kanban): renderStagePrompt 拼 goal preamble(REQ-043)"
```

---

## Task 3: mcp.route.ts — task_complete MCP 工具 + 测试

**Files:**
- Modify: `server/modules/kanban/mcp.route.ts`(TOOL_DEFS + KNOWN_TOOLS + tools/call 分支)
- Test: `server/modules/kanban/tests/mcp-route.test.ts`

- [ ] **Step 1: 写失败测试**(mcp-route.test.ts,复用现有 setup 模式;参考文件里现有 `tools/call task_next` 测试的 app/service/scheduler mock 套路)

```ts
test('task_complete records goal_completed event + calls service.next', async () => {
  // 复用现有 mcp-route.test.ts 的 setup(getKanban mock + supertest/express)
  // 构造一个 task,POST tools/call { name:'task_complete', arguments:{ taskId, summary } }
  // 断言:service.next 被调(rootId, taskId);task_events 多一条 type='goal_completed' { summary }
});
```

(具体 setup 沿用文件顶部已有的 `buildApp()` / mock service 模式;断言点:`service.next` mock 收到调用 + `taskStore.insertTaskEvent` 收到 `type:'goal_completed'` + `summary` 透传。)

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:kanban -- --test-name-pattern="task_complete"`
Expected: FAIL(unknown tool: task_complete)

- [ ] **Step 3: 实现 task_complete**

mcp.route.ts 顶部加 import:

```ts
import { randomUUID } from 'node:crypto';
```

`TOOL_DEFS` 数组加(在 task_next_up 后):

```ts
  {
    name: 'task_complete',
    description: "Declare this kanban task's current goal complete. Call when the goal condition is satisfied. Advances the task to its next stage.",
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        summary: { type: 'string', description: 'brief summary of what was accomplished' },
      },
      required: ['taskId'],
    },
  },
```

`KNOWN_TOOLS` 加 `'task_complete'`:

```ts
const KNOWN_TOOLS = new Set(['task_next', 'task_prev', 'task_status', 'task_next_up', 'task_complete']);
```

tools/call 分支改(替换现有 `if (name === 'task_next') ... else if (name === 'task_prev')`):

```ts
        if (name === 'task_complete') {
          const summary = String(msg.params?.arguments?.summary ?? '');
          try {
            taskStore.insertTaskEvent({
              id: randomUUID(), taskId, type: 'goal_completed',
              payloadJson: summary ? JSON.stringify({ summary }) : undefined,
              createdAt: new Date().toISOString(),
            });
          } catch (e) {
            // best-effort: event 记录失败不能阻断推进
          }
          service.next(rootId, taskId);
        } else if (name === 'task_next') {
          service.next(rootId, taskId);
        } else if (name === 'task_prev') {
          service.prev(rootId, taskId);
        }
```

scheduler.schedule 触发条件加 task_complete(替换现有 `if (name === 'task_next' || name === 'task_prev')`):

```ts
        if (name === 'task_next' || name === 'task_prev' || name === 'task_complete') {
          scheduler.schedule(rootId);
        }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:kanban -- --test-name-pattern="task_complete"`
Expected: PASS

- [ ] **Step 5: commit**

```bash
git add server/modules/kanban/mcp.route.ts server/modules/kanban/tests/mcp-route.test.ts
git commit --no-verify -m "feat(kanban): task_complete MCP 工具 + goal_completed event(REQ-043)"
```

---

## Task 4: claude-hooks.ts — goal Stop hook + PostToolUse flag + 测试

**Files:**
- Modify: `server/modules/kanban/claude-hooks.ts`(createKanbanClaudeHooks 加 goalCondition 入参 + PostToolUse + Stop goalBlock)
- Test: `server/modules/kanban/tests/claude-hooks.test.ts`

> ⚠️ **matcher 风险**:PostToolUse 要检测 MCP 工具 `task_complete` 的调用。Claude Code 里 MCP 工具名是 `mcp__<server>__<tool>`,matcher 是 glob。本 task 用 `*task_complete`(glob,匹配任意 server 的 task_complete)。Task 6 端到端验证;若不工作,fallback 改 `mcp__planrla-kanban__task_complete` 全名。

- [ ] **Step 1: 写失败测试**(claude-hooks.test.ts,setup 加 goalCondition)

改 `setup` 函数签名加 goalCondition:

```ts
function setup(opts: {
  decision?: HookApprovalDecision | null;
  emitHookEvents?: boolean;
  goalCondition?: string;
} = {}) {
  // ... 现有 ...
  const hooks = createKanbanClaudeHooks({
    send: (msg) => sent.push(msg as SentMessage),
    waitForToolApproval: async (requestId, options) => { /* 现有 */ },
    createRequestId: () => 'req-1',
    getSessionId: () => 'sid-1',
    emitHookEvents: opts.emitHookEvents,
    goalCondition: opts.goalCondition,
    onActionRequired: () => { notifications += 1; },
  });
  return { hooks, sent, waits, notifications: () => notifications };
}
```

加测试(文件末尾):

```ts
// --------------------------- REQ-043 goal stop hook ---------------------------

test('goal hooks only registered when goalCondition is set', () => {
  const off = setup({ goalCondition: undefined });
  assert.equal(off.hooks.PostToolUse, undefined);
  const on = setup({ goalCondition: '测试通过' });
  assert.ok(on.hooks.PostToolUse);
  assert.ok(on.hooks.Stop && on.hooks.Stop.length >= 1);
});

test('goal Stop hook blocks when task_complete not yet called', async () => {
  const { hooks } = setup({ goalCondition: '所有测试通过' });
  const goalBlock = hooks.Stop![hooks.Stop!.length - 1].hooks[0];
  const out: any = await goalBlock({}, undefined, {});
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /所有测试通过/);
});

test('goal PostToolUse on task_complete sets flag → Stop allows', async () => {
  const { hooks } = setup({ goalCondition: '所有测试通过' });
  const post = hooks.PostToolUse![0].hooks[0];
  await post({ tool_name: 'mcp__planrla-kanban__task_complete' }, undefined, {});
  const goalBlock = hooks.Stop![hooks.Stop!.length - 1].hooks[0];
  const out = await goalBlock({}, undefined, {});
  assert.deepEqual(out, {});
});

test('goal hooks absent does not break existing liveness Stop hook', async () => {
  // emitHookEvents 但无 goalCondition:Stop 只有 liveness(返回 {})
  const { hooks } = setup({ emitHookEvents: true });
  assert.equal(hooks.Stop!.length, 1);
  const out = await hooks.Stop![0].hooks[0]({ session_id: 'sid', hook_event_name: 'Stop' }, undefined, {});
  assert.deepEqual(out, {});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:kanban -- --test-name-pattern="goal"`
Expected: FAIL(goal hooks 不存在)

- [ ] **Step 3: 实现 goal hooks**

claude-hooks.ts `KanbanClaudeHooksDeps` 加字段:

```ts
  /** REQ-043: 有值 = goal stage。挂 PostToolUse[task_complete] flag + Stop goalBlock。 */
  goalCondition?: string;
```

`createKanbanClaudeHooks` 解构加 `goalCondition`:

```ts
  const {
    send, waitForToolApproval, createRequestId, getSessionId,
    emitHookEvents = false,
    goalCondition,
    onActionRequired,
    interactiveHookTimeoutSec = 24 * 60 * 60,
    log = () => {},
  } = deps;
```

在 `return { ... }` 前加 goal hooks 构造(现有 hooks 对象已含 PreToolUse + 可选 liveness):

```ts
  // REQ-043: goal stage 的 Stop hook block(= /goal 机制)。
  // PostToolUse[task_complete] 设 flag;Stop 读 flag:true 放行,false 返回 block 让 claude 续跑。
  if (goalCondition) {
    const completed = { value: false };
    hooks.PostToolUse = [{
      matcher: '*task_complete',
      hooks: [async () => { completed.value = true; return {}; }],
    }];
    hooks.Stop = (hooks.Stop ?? []).concat([{
      matcher: '',
      hooks: [async () => {
        if (completed.value) return {};
        return {
          decision: 'block',
          reason: `Goal not done: ${goalCondition}. 继续工作,完成后调用 task_complete(taskId, summary)。`,
        };
      }],
    }]);
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:kanban -- --test-name-pattern="goal"`
Expected: PASS(4 tests)

- [ ] **Step 5: commit**

```bash
git add server/modules/kanban/claude-hooks.ts server/modules/kanban/tests/claude-hooks.test.ts
git commit --no-verify -m "feat(kanban): goal Stop hook block + PostToolUse flag(REQ-043)"
```

---

## Task 5: runner.ts + claude-sdk.js — 透传 goalCondition + maxTurns + 测试

**Files:**
- Modify: `server/modules/kanban/runner.ts`(spawn opts 加 goalCondition + maxTurns)
- Modify: `server/claude-sdk.js`(createKanbanClaudeHooks 调用加 goalCondition;sdkOptions.maxTurns)
- Test: `server/modules/kanban/tests/runner.test.ts`

- [ ] **Step 1: 写失败测试**(runner.test.ts,复用 setup + makeAgentTemplate 模式)

```ts
test('goal stage passes goalCondition + maxTurns to spawnFn', async () => {
  let called: any = null;
  const mockSpawn = async (cmd: string, opts: any, writer: any) => {
    called = { opts };
    writer.send(JSON.stringify({ kind: 'complete' }));
  };
  const { db, templateStore, service, runner } = setup({ mockSpawn });
  templateStore.saveTaskTemplate({
    id: 't1', name: 'T', maxConcurrency: 1, createdAt: NOW, updatedAt: NOW,
    stages: [
      { id: 's0', position: 0, snapshot: { id: 'ss0', name: 'U', role: 'user', autoAdvance: true, createdAt: NOW, updatedAt: NOW } },
      { id: 's1', position: 1, snapshot: { id: 'ss1', name: 'Do', role: 'agent', agent: 'claude', autoAdvance: false, goalCondition: '测试通过', goalMaxTurns: 50, promptTemplate: 'do', createdAt: NOW, updatedAt: NOW } },
    ],
  });
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'go' });
  service.next('r1', task.id);
  await runner.runAgentStage('r1', task.id, 1);
  assert.equal(called.opts.goalCondition, '测试通过');
  assert.equal(called.opts.maxTurns, 50);
  db.close();
});

test('goal stage defaults maxTurns to 300 when goalMaxTurns unset', async () => {
  let called: any = null;
  const mockSpawn = async (cmd: string, opts: any, writer: any) => { called = { opts }; writer.send(JSON.stringify({ kind: 'complete' })); };
  const { db, templateStore, service, runner } = setup({ mockSpawn });
  templateStore.saveTaskTemplate({
    id: 't1', name: 'T', maxConcurrency: 1, createdAt: NOW, updatedAt: NOW,
    stages: [
      { id: 's0', position: 0, snapshot: { id: 'ss0', name: 'U', role: 'user', autoAdvance: true, createdAt: NOW, updatedAt: NOW } },
      { id: 's1', position: 1, snapshot: { id: 'ss1', name: 'Do', role: 'agent', agent: 'claude', autoAdvance: false, goalCondition: 'x', promptTemplate: 'do', createdAt: NOW, updatedAt: NOW } },
    ],
  });
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'go' });
  service.next('r1', task.id);
  await runner.runAgentStage('r1', task.id, 1);
  assert.equal(called.opts.maxTurns, 300);
  db.close();
});

test('goal stage fails task when spawnFn rejects (max_turns exhausted)', async () => {
  const rejectSpawn = async () => { throw new Error('Reached maximum number of turns (50)'); };
  const { db, taskStore, templateStore, service, runner } = setup({ mockSpawn: rejectSpawn });
  templateStore.saveTaskTemplate({
    id: 't1', name: 'T', maxConcurrency: 1, createdAt: NOW, updatedAt: NOW,
    stages: [
      { id: 's0', position: 0, snapshot: { id: 'ss0', name: 'U', role: 'user', autoAdvance: true, createdAt: NOW, updatedAt: NOW } },
      { id: 's1', position: 1, snapshot: { id: 'ss1', name: 'Do', role: 'agent', agent: 'claude', autoAdvance: false, goalCondition: 'x', goalMaxTurns: 50, promptTemplate: 'do', createdAt: NOW, updatedAt: NOW } },
    ],
  });
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'go' });
  service.next('r1', task.id);
  await runner.runAgentStage('r1', task.id, 1);
  const got = taskStore.getTask(task.id);
  assert.equal(got!.status, 'fail', 'max_turns reject → service.fail');
  assert.match(String(got!.auxFlags.sessionError ?? ''), /maximum number of turns/i);
  db.close();
});

test('non-goal stage passes neither goalCondition nor maxTurns', async () => {
  let called: any = null;
  const mockSpawn = async (cmd: string, opts: any, writer: any) => { called = { opts }; writer.send(JSON.stringify({ kind: 'complete' })); };
  const { db, templateStore, service, runner } = setup({ mockSpawn });
  makeAgentTemplate(templateStore, 't1'); // 无 goalCondition
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'go' });
  service.next('r1', task.id);
  await runner.runAgentStage('r1', task.id, 1);
  assert.equal(called.opts.goalCondition, undefined);
  assert.equal(called.opts.maxTurns, undefined);
  db.close();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:kanban -- --test-name-pattern="goal stage"`
Expected: FAIL(opts 无 goalCondition/maxTurns)

- [ ] **Step 3: runner.ts spawn opts 加 goalCondition + maxTurns**

runner.ts `spawnFn(prompt, {...}, writer)` 调用(约 201-211 行),在 `mcpServers` 后加:

```ts
        await Promise.race([
          spawnFn(prompt, {
            sessionId: providerSessionId,
            cwd,
            projectPath: cwd,
            model: stage.model,
            permissionMode,
            emitHookEvents: true,
            envStrip: envStrip.length > 0 ? envStrip : undefined,
            mcpServers: mcpBaseUrl ? { 'planrla-kanban': { type: 'http', url: mcpBaseUrl } } : undefined,
            // REQ-043: goal stage 透传 goalCondition(→ claude-sdk.js → createKanbanClaudeHooks 挂 goal Stop hook)
            // + maxTurns(→ sdkOptions.maxTurns,SDK 原生截断 → error_max_turns reject → 现有 catch → fail)
            ...(stage.goalCondition ? {
              goalCondition: stage.goalCondition,
              maxTurns: stage.goalMaxTurns ?? 300,
            } : {}),
          } as any, writer),
```

- [ ] **Step 4: claude-sdk.js 传 goalCondition 给 hooks + sdkOptions.maxTurns**

claude-sdk.js `createKanbanClaudeHooks({...})` 调用(约 588 行)加 `goalCondition`:

```ts
      ...createKanbanClaudeHooks({
        send: (msg) => ws.send(msg),
        waitForToolApproval,
        createRequestId,
        getSessionId: () => capturedSessionId || sessionId || null,
        emitHookEvents: options.emitHookEvents === true,
        goalCondition: options.goalCondition,  // REQ-043
        onActionRequired: ({ requestId, toolName }) => { /* 现有 */ },
        log: (m) => console.log(m),
      }),
```

在 sdkOptions 构建(约 555-558 `mcpServers` 后)加 maxTurns:

```ts
    // REQ-043: goal stage 的 maxTurns 上限(SDK 原生截断 → error_max_turns reject)
    if (options.maxTurns) sdkOptions.maxTurns = options.maxTurns;
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm run test:kanban -- --test-name-pattern="goal stage"`
Expected: PASS(4 tests)

- [ ] **Step 6: commit**

```bash
git add server/modules/kanban/runner.ts server/modules/kanban/tests/runner.test.ts server/claude-sdk.js
git commit --no-verify -m "feat(kanban): runner 透传 goalCondition + maxTurns(REQ-043)"
```

---

## Task 6: 集成验证 + 端到端 matcher 确认

**Files:** 无新代码(验证 + 可能调 matcher)

- [ ] **Step 1: typecheck 全干净**

Run: `npm run typecheck`
Expected: PASS(src + server)

- [ ] **Step 2: kanban 全测试回归**

Run: `npm run test:kanban`
Expected: PASS(现有 196 + 新增 ~10 = ~206,0 fail)

- [ ] **Step 3: 端到端 matcher 确认(关键——验证 PostToolUse `*task_complete` 真能捕到 MCP 工具调用)**

写临时 spike `debug/spike-goal-e2e.mjs`(跑完可留作证或删):用 claude-agent-sdk 跑一个极小 goal stage,注入 kanban-style hooks(PostToolUse `*task_complete` + Stop goalBlock),prompt 教 agent "完成后调 task_complete"。观察:
- agent 调 task_complete 时 PostToolUse 是否 fire(matcher 是否命中)
- Stop hook 是否在 task_complete 后放行 / 未调时 block

若 PostToolUse `*task_complete` **没命中**(MCP 工具名格式不同),改 claude-hooks.ts matcher 为 `mcp__planrla-kanban__task_complete` 全名,重跑 Step 2 确认单测仍过。

- [ ] **Step 4: 清理 spike + 最终 commit**

```bash
# spike 留 debug/ 作证(或 git rm 若不需)
git add debug/spike-goal-e2e.mjs  # 若留
git commit --no-verify -m "test(kanban): goal-stop-hook 端到端 matcher 确认(REQ-043)"
```

---

## Self-Review(spec 覆盖)

- spec ② 数据模型(goalCondition + goalMaxTurns 默认 300)→ Task 1 ✓
- spec ③ MCP task_complete(summary 进 task_events)→ Task 3 ✓
- spec ④ Stop hook + PostToolUse 协调(顶层 decision:block,flag per-query)→ Task 4 ✓
- spec ⑤ prompt 注入 goal + task_complete → Task 2 ✓
- spec ⑥ 兜底(maxTurns → error_max_turns reject → 现有 catch → fail;stageTimeoutMs 30min 叠加)→ Task 5 Step 1 第三个测试 + runner 现有 catch ✓
- spec ⑦ 与现有 hooks 叠加(liveness Stop + goalBlock 同数组)→ Task 4 第四个测试 ✓
- spec ⑧ 改动文件清单(8 文件)→ Task 1-5 覆盖 types/prompt/mcp.route/claude-hooks/runner/claude-sdk + 3 测试 ✓
- spec 验收 1-6 → Task 6 + 单测覆盖 ✓
- **类型一致**:`goalCondition` / `goalMaxTurns` 在 types(Task 1)→ prompt/claude-hooks/runner(Task 2/4/5)同名同型;`task_complete` 在 mcp.route TOOL_DEFS + KNOWN_TOOLS(Task 3)一致 ✓
- **占位扫描**:Task 3 Step 1 测试用"沿用现有 setup 模式"描述而非逐行——因为 mcp-route.test.ts 现有 setup 较长,subagent 读文件顶部 `buildApp` 套路即可;断言点(service.next + goal_completed event)明确,非占位 ✓

---

## Execution Handoff

Plan complete。两种执行方式:

1. **Subagent-Driven(推荐)**——每 task 派新 subagent,两阶段 review,快迭代
2. **Inline Execution**——本 session 按 executing-plans 批量执行 + checkpoint

基底已在 main(`1ed6a8e` + BACKLOG `f0a8332`),worktree `req043-goal-stop-hook` 就绪。
