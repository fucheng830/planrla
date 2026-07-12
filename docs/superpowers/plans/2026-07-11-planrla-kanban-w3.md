# planrla 看板 W3 实施计划:runner + aux bridge(scheduler 接 agent)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps use checkbox (`- [ ]`).

**Goal:** 把 W2 scheduler 的 `onAdmit` 桩替换为真实 agent 执行——调 planrla 5 provider spawnFn 跑 stage prompt,流式收事件,提取 aux flag(AskUser/Plan/Todo/Task)写回看板。

**Architecture:** `RunnerWriter`(极简,兼容 ChatSessionWriter 接口)收 spawnFn 事件 → `aux-bridge.ts`(基于 `kind + toolName` 提取 flag)→ `store.updateTaskAuxFlags`。`runner.ts`(provider-neutral,调 spawnFns map)的 `ensureSession`(复用 `mainSessionKey`)+ `runAgentStage`。scheduler `onAdmit` → `runner.runAgentStage`(fire-and-forget async)。

**Tech Stack:** planrla 5 provider spawnFns(`queryClaudeSDK`/`queryCodex`/...)+ W1/W2 的 store/service/scheduler

**基于:** `docs/superpowers/specs/2026-07-11-planrla-kanban-iteration-design.md` 第 3、6 节 + provider session API 摸底报告(explore,会话内)

## 关键决策(基于 explore 报告)
1. **轻量直调 spawnFn**(绕过 chat gateway——它强绑 ws,`ChatSessionWriter` 只 forward 单 ws,且 `chatRunRegistry` 为前端 replay 设计吃内存)。runner 直调 `queryClaudeSDK(prompt, {cwd, sessionId, model, permissionMode}, runnerWriter)`,参照 `server/routes/agent.js:952-958`。
2. **RunnerWriter**:极简 writer(`send`/`setSessionId`/`updateWebSocket`/`isWebSocketWriter`/`userId`),满足 spawnFn 对 writer 的全部用法。`send` 收事件 → 回调 `onEvent(msg)`。
3. **aux 提取基于 `kind + toolName`**(explore 报告第 5 节,planrla 用 `MessageKind` 联合,不细分 type):
   - **askUserWaiting**:Claude `kind:'permission_request'` + `toolName==='AskUserQuestion'`(`claude-sdk.js:42,605`)
   - **hasPlan**:Claude `permission_request` + `ExitPlanMode`,或 `tool_use` + `exit_plan_mode`/`TodoWrite`(plan 模式)
   - **hasTodos**:Claude `tool_use` + `TodoWrite` / Codex `tool_use` + `TodoList`(`codex-sessions.provider.ts:454`)
   - **hasTask**:Claude `tool_use` + `Task`(子 agent)
4. **permissionMode**:`stage.planMode ? 'plan' : 'default'`(**必须 default 才能 captured AskUser**;`auto`/`bypassPermissions` SDK 自动放行,收不到 permission_request,见 `claude-sdk.js:576-580`)
5. **provider 支持**:provider-neutral(按 `stage.agent` 取 spawnFn)。aux 按能力:Claude 完整,Codex 只 hasTodos,其他 provider 跑但不提 aux(`supportsPermissionRequests: false`,`provider-capabilities.service.ts:57,69,79`)
6. **run 结束**:spawnFn 的 Promise resolve(`kind:'complete'` 后)→ runner 推进阶段(若 `stage.autoAdvance` → `service.next`;否则停在 running,等用户)
7. **W3 用主仓库 cwd**(`task.worktreePath` 为空时用 `rootId` 解析的 path);W4 补 worktree 创建后 runner 自动用 worktree

## 关键不确定性(W3-T1 先确认)
- **rootId 语义**:`kanban/types.ts:69` `Task.rootId` 是 planrla `projects` 表 `project_id`(DB 主键)还是 `project_path`?影响 cwd 解析。**W3-T1 Read kanban routes 的 rootId 来源 + planrla projectsDb 确认**。
- **spawnFns 导出**:`index.js:123-129` 的 `spawnFns` map 是局部变量,没 export。W3 要么 export 它,要么 runner 按 provider 直接 import(`@/claude-sdk.js` 等)。**W3-T1 决定**(推荐:新建 `server/modules/providers/spawn-fns.ts` 集中导出,`index.js` 和 runner 都用)。
- **EnsureSession 的 session 复用**:W1 的 `mainSessionKey` 是 kanban sessionKey(非 provider native id)。runner 要把 `mainSessionKey` 映射到 provider native sessionId(从 sessions 表或内存)。**W3-T2 实现**(参照 MindFS `appcontext.go:211-257` 的三策略)。

## File Structure
| 文件 | 职责 |
|---|---|
| `server/modules/kanban/runner-writer.ts` | RunnerWriter(极简 writer,收 spawnFn 事件)|
| `server/modules/kanban/aux-bridge.ts` | 事件 → aux flag(`kind+toolName` → `updateTaskAuxFlags`)|
| `server/modules/kanban/runner.ts` | `ensureSession` + `runAgentStage`(调 spawnFn)|
| `server/modules/kanban/assembly.ts`(Modify)| `scheduler.onAdmit` → `runner.runAgentStage`;装配 runner |
| `server/index.js`(Modify,可能)| spawnFns 导出(若 W3-T1 选 export 方案)|

## 约定
- import `@/`=`server/` + `.js` 后缀;ESM;`node:test`
- AppError:`new AppError(message, { code, statusCode })`
- 测试 `npm run test:kanban`;typecheck `npx tsc --noEmit -p server/tsconfig.json`(timeout 300000)
- commit conventional,body ≤100 字符/行,尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Task 1: aux-bridge.ts + RunnerWriter + 确认 rootId/spawnFns

**Files:** Create `aux-bridge.ts` + `runner-writer.ts` + `tests/aux-bridge.test.ts`

### 步骤 0(探索确认)
- Read `server/modules/kanban/kanban.routes.ts`(W2 写的,看 rootId 怎么从 req 来)+ planrla `server/modules/database/repositories/projects.db.ts`(看 getProjectPathById 或类似,确认 rootId 是 projectId 还是 path)
- Read `server/index.js:120-140`(spawnFns map 装配)+ 决定:export spawnFns 还是 runner 按 provider import。**推荐**:新建 `server/modules/providers/spawn-fns.ts` 重导出 `{ claude: queryClaudeSDK, codex: queryCodex, cursor: spawnCursor, gemini: spawnGemini, opencode: spawnOpenCode }`,index.js 和 runner 都 import 它(消除 index.js 局部 map)。

### 步骤 1:写 aux-bridge 失败测试 `tests/aux-bridge.test.ts`

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuxBridge } from '@/modules/kanban/aux-bridge.js';

function setup() {
  const updates: Array<{ taskId: string; flags: any }> = [];
  const auxBridge = createAuxBridge({
    updateAuxFlags: (taskId, flags) => { updates.push({ taskId, flags }); },
  });
  return { auxBridge, updates };
}

test('Claude AskUserQuestion permission_request sets askUserWaiting=true', () => {
  const { auxBridge, updates } = setup();
  auxBridge.handle('t1', { kind: 'permission_request', toolName: 'AskUserQuestion', requestId: 'r1', input: {} });
  assert.deepEqual(updates[0], { taskId: 't1', flags: { askUserWaiting: true } });
});

test('Claude ExitPlanMode permission_request sets hasPlan=true', () => {
  const { auxBridge, updates } = setup();
  auxBridge.handle('t1', { kind: 'permission_request', toolName: 'ExitPlanMode', requestId: 'r2' });
  assert.deepEqual(updates[0], { taskId: 't1', flags: { hasPlan: true } });
});

test('Claude TodoWrite tool_use sets hasTodos=true', () => {
  const { auxBridge, updates } = setup();
  auxBridge.handle('t1', { kind: 'tool_use', toolName: 'TodoWrite', toolInput: { todos: [] } });
  assert.deepEqual(updates[0], { taskId: 't1', flags: { hasTodos: true } });
});

test('Codex TodoList tool_use sets hasTodos=true', () => {
  const { auxBridge, updates } = setup();
  auxBridge.handle('t1', { kind: 'tool_use', toolName: 'TodoList', toolInput: { items: [] } });
  assert.deepEqual(updates[0], { taskId: 't1', flags: { hasTodos: true } });
});

test('Claude Task tool_use sets hasTask=true', () => {
  const { auxBridge, updates } = setup();
  auxBridge.handle('t1', { kind: 'tool_use', toolName: 'Task', toolInput: {} });
  assert.deepEqual(updates[0], { taskId: 't1', flags: { hasTask: true } });
});

test('unrelated event (text/stream_delta) does nothing', () => {
  const { auxBridge, updates } = setup();
  auxBridge.handle('t1', { kind: 'text', role: 'assistant', content: 'hi' });
  auxBridge.handle('t1', { kind: 'stream_delta', content: 'x' });
  assert.equal(updates.length, 0);
});
```

### 步骤 2:跑失败 → 实现 `aux-bridge.ts`

```typescript
import type { TaskAuxFlags } from '@/modules/kanban/types.js';

export interface AuxBridgeDeps {
  updateAuxFlags: (taskId: string, flags: Partial<TaskAuxFlags>) => void;
}

export function createAuxBridge(deps: AuxBridgeDeps) {
  const { updateAuxFlags } = deps;

  function handle(taskId: string, msg: any): void {
    if (!msg || typeof msg.kind !== 'string') return;
    const { kind, toolName } = msg;

    if (kind === 'permission_request' && toolName === 'AskUserQuestion') {
      updateAuxFlags(taskId, { askUserWaiting: true });
      return;
    }
    if (kind === 'permission_request' && toolName === 'ExitPlanMode') {
      updateAuxFlags(taskId, { hasPlan: true });
      return;
    }
    if (kind === 'tool_use') {
      if (toolName === 'TodoWrite' || toolName === 'TodoList') {
        updateAuxFlags(taskId, { hasTodos: true });
        return;
      }
      if (toolName === 'Task') {
        updateAuxFlags(taskId, { hasTask: true });
        return;
      }
      if (toolName === 'exit_plan_mode') {
        updateAuxFlags(taskId, { hasPlan: true });
        return;
      }
    }
  }

  return { handle };
}
```

### 步骤 3:实现 `runner-writer.ts`

```typescript
import type { AuxBridge } from '@/modules/kanban/aux-bridge.js';

interface RunnerWriterOptions {
  taskId: string;
  auxBridge: AuxBridge;
  onProviderSessionId?: (sid: string) => void;  // 捕获 provider native id
  onComplete?: () => void;
  onError?: (msg: any) => void;
}

export class RunnerWriter {
  isWebSocketWriter = true;
  userId: string | null = null;
  private providerSessionId: string | null = null;

  constructor(private opts: RunnerWriterOptions) {}

  send(data: unknown): void {
    let msg: any;
    try {
      msg = typeof data === 'string' ? JSON.parse(data) : data;
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    this.opts.auxBridge.handle(this.opts.taskId, msg);

    if (msg.kind === 'session_created' && msg.sessionId) {
      this.providerSessionId = msg.sessionId;
      this.opts.onProviderSessionId?.(msg.sessionId);
    }
    if (msg.kind === 'complete') this.opts.onComplete?.();
    if (msg.kind === 'error') this.opts.onError?.(msg);
  }

  setSessionId(sid: string): void {
    this.providerSessionId = sid;
    this.opts.onProviderSessionId?.(sid);
  }

  getSessionId(): string | null { return this.providerSessionId; }
  updateWebSocket(): void { /* no-op */ }
}
```

### 步骤 4:跑测试通过(typecheck)+ commit
```bash
npm run test:kanban  # W1+W2 56 + aux 6 = 62
npx tsc --noEmit -p server/tsconfig.json
git add server/modules/kanban/aux-bridge.ts server/modules/kanban/runner-writer.ts server/modules/kanban/tests/aux-bridge.test.ts && git commit -m "feat(kanban): add aux bridge and runner writer" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: runner.ts(ensureSession + runAgentStage)

**Files:** Create `runner.ts` + `tests/runner.test.ts`(mock spawnFn)

参照 MindFS `appcontext.go:211-316`(EnsureAgentSession + RunAgentStage)+ explore 报告第 6 节 A/B。

### 步骤 1:新建 `server/modules/providers/spawn-fns.ts`(若 W3-T1 选此方案)
```typescript
import { queryClaudeSDK } from '@/claude-sdk.js';
import { queryCodex } from '@/openai-codex.js';
import { spawnCursor } from '@/cursor-cli.js';
import { spawnGemini } from '@/gemini-cli.js';
import { spawnOpenCode } from '@/opencode-cli.js';

export const spawnFns: Record<string, (cmd: string, opts: any, writer: any) => Promise<unknown>> = {
  claude: queryClaudeSDK,
  codex: queryCodex,
  cursor: spawnCursor,
  gemini: spawnGemini,
  opencode: spawnOpenCode,
};
```
(若 T1 发现 index.js 已导出或决定不抽,直接在 runner import 这 5 个)

### 步骤 2:`runner.ts`

```typescript
import type { TaskStore } from '@/modules/kanban/store.js';
import type { TemplateStore } from '@/modules/kanban/template-store.js';
import type { KanbanService } from '@/modules/kanban/service.js';
import type { AuxBridge } from '@/modules/kanban/aux-bridge.js';
import { RunnerWriter } from '@/modules/kanban/runner-writer.js';
import { spawnFns } from '@/modules/providers/spawn-fns.js';

export interface RunnerDeps {
  taskStore: TaskStore;
  templateStore: TemplateStore;
  service: KanbanService;
  auxBridge: AuxBridge;
  resolveRootPath: (rootId: string) => string | null;  // T1 确认 rootId→path
  log?: (msg: string) => void;
}

export function createRunner(deps: RunnerDeps) {
  const { taskStore, templateStore, service, auxBridge, resolveRootPath, log = console.log } = deps;
  // task mainSessionKey → provider native sessionId 的内存映射(W3 简化;生产可落库)
  const sessionMap = new Map<string, string>();

  async function runAgentStage(rootId: string, taskId: string, stageIndex: number): Promise<void> {
    const task = taskStore.getTask(taskId);
    if (!task) throw new Error(`task ${taskId} not found`);
    const tpl = templateStore.getTaskTemplate(task.taskTemplateId);
    if (!tpl) throw new Error(`template ${task.taskTemplateId} not found`);
    const stage = tpl.stages[stageIndex]?.snapshot;
    if (!stage || stage.role !== 'agent' || !stage.agent) throw new Error('invalid agent stage');

    const sessionKey = task.mainSessionKey ?? taskId;  // 简化:task_main 策略
    const providerSessionId = sessionMap.get(sessionKey);
    const cwd = task.worktreePath ?? resolveRootPath(rootId) ?? undefined;
    const permissionMode = stage.planMode ? 'plan' : 'default';
    const prompt = stage.promptTemplate ?? '';  // 简化:W3 不做模板渲染,W4 补 BuildAgentPrompt
    const spawnFn = spawnFns[stage.agent];
    if (!spawnFn) throw new Error(`unknown provider: ${stage.agent}`);

    log(`[kanban-runner] start task=${taskId} stage=${stageIndex} agent=${stage.agent} cwd=${cwd ?? '<none>'}`);
    const writer = new RunnerWriter({
      taskId,
      auxBridge,
      onProviderSessionId: (sid) => sessionMap.set(sessionKey, sid),
      onComplete: () => {
        log(`[kanban-runner] complete task=${taskId}`);
        if (stage.autoAdvance) {
          try { service.next(rootId, taskId); } catch (e) { log(`[kanban-runner] next failed: ${e}`); }
        }
      },
      onError: (m) => {
        taskStore.updateTaskAuxFlags(taskId, { sessionError: String(m?.message ?? m) });
      },
    });

    try {
      await spawnFn(prompt, {
        sessionId: providerSessionId,
        cwd,
        model: stage.model,
        permissionMode,
      } as any, writer);
    } catch (e: any) {
      taskStore.updateTaskAuxFlags(taskId, { sessionError: String(e?.message ?? e) });
      log(`[kanban-runner] spawn failed task=${taskId}: ${e}`);
    }
  }

  return { runAgentStage };
}
```

### 步骤 3:测试 `tests/runner.test.ts`(mock spawnFn)
```typescript
// 用 mock spawnFn(不调真实 Claude/Codex),测 runner:
// - runAgentStage 调 spawnFn(prompt, {cwd, sessionId, model, permissionMode}, writer)
// - writer.send({kind:'tool_use', toolName:'TodoWrite'}) → store.auxFlags.hasTodos=true
// - writer.send({kind:'complete'}) + autoAdvance → service.next 推进
// - providerSessionId 捕获 + sessionMap 复用(同 sessionKey 第二次跑传 sessionId)
```
(具体测试代码由 implementer 按上面结构写,mock spawnFns map 注入 runner)

### 步骤 4:跑测试 + typecheck + commit
```bash
git add server/modules/kanban/runner.ts server/modules/kanban/tests/runner.test.ts server/modules/providers/spawn-fns.ts && git commit -m "feat(kanban): add runner with ensureSession and runAgentStage" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 装配 runner + scheduler 接 runner

**Files:** Modify `assembly.ts`

### 步骤 1:Read 现有 `assembly.ts`(W2 写的)。修改 buildKanban:
- 加 `auxBridge = createAuxBridge({ updateAuxFlags: taskStore.updateTaskAuxFlags })`
- 加 `runner = createRunner({ taskStore, templateStore, service, auxBridge, resolveRootPath })`
- `resolveRootPath`:基于 T1 确认的 rootId 语义实现(若 rootId=projectId → `projectsDb.getProjectPathById(rootId)`;若 rootId=path → 直接返回)。import `projectsDb` from `@/modules/database/index.js`。
- scheduler 的 `onAdmit` 从桩改成 `runner.runAgentStage`(fire-and-forget,不 await):
  ```typescript
  const scheduler = createScheduler({
    taskStore, templateStore,
    onAdmit: (taskId) => {
      const task = taskStore.getTask(taskId);
      if (!task) return;
      // 异步跑,不阻塞 scheduler
      void runner.runAgentStage(task.rootId, taskId, task.currentStageIndex).catch(e => console.error('[kanban-runner]', e));
    },
  });
  ```
  注意:onAdmit 触发时,task.currentStageIndex 是 agent stage(admit 只对 queued agent stage;但 W2 scheduler 当前对所有 queued admit——W3 要在 admit 前判断 stage 是 agent role 才跑,否则 user stage 不跑 agent)。**W3-T3 处理**:scheduler run() 里检查 stage role,只 admit agent stage(user stage 的 queued 不 admit,直接 waiting_user)。

### 步骤 2:typecheck + 测试(无回归)+ commit
```bash
npm run test:kanban
npx tsc --noEmit -p server/tsconfig.json
git add server/modules/kanban/assembly.ts server/modules/kanban/scheduler.ts && git commit -m "feat(kanban): wire runner into scheduler onAdmit" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 集成测试(mock provider 端到端)

**Files:** `tests/runner-integration.test.ts`

### 步骤 1:集成测试
- 注入 mock spawnFn(发几个事件:session_created / tool_use TodoWrite / complete)
- service.createTask(auto_advance agent stage)→ scheduler.schedule → admit → runner 跑 mock spawnFn → aux hasTodos=true + autoAdvance next 推进
- 断言:task 经过 running → aux hasTodos → next stage

### 步骤 2:跑 + typecheck + commit
```bash
git add server/modules/kanban/tests/runner-integration.test.ts && git commit -m "test(kanban): runner end-to-end with mock provider" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## W3 完成标准
- `aux-bridge.ts` + `runner-writer.ts` + `runner.ts` 实现
- scheduler `onAdmit` → runner.runAgentStage(只对 agent stage;user stage 不 admit)
- 装配(assembly.ts)注入 runner + resolveRootPath
- spawnFns 集中导出(spawn-fns.ts,index.js 复用)
- aux flag 从 provider 事件提取(Claude 完整,Codex hasTodos,其他跑不提)
- `npm run test:kanban` 全绿(W2 56 + aux 6 + runner ~4 + 集成 ~2 = ~68)
- typecheck 0
- W3 不含:worktree 创建(W4,runner 当前用主仓库 cwd)、MCP 自驱工具(W4)、前端 UI(W4)、prompt 模板渲染(W4 BuildAgentPrompt)

## Self-Review
- **Spec coverage**:runner(W3-T2)+ aux bridge(W3-T1)= spec 第 6 节"aux flag 桥接"。✓
- **Placeholder**:runner.ts 的 prompt 模板渲染(`stage.promptTemplate ?? ''`)简化了,W4 补 BuildAgentPrompt(参照 MindFS service.go:1194-1206)。**标注为 W4,不算占位**(W3 范围外)。
- **Type 一致性**:RunnerWriter/RunnerDeps 用 W1/W2 的 TaskStore/TemplateStore/KanbanService/AuxBridge 类型。spawnFns 签名 `(cmd, opts, writer) => Promise<unknown>` 对齐 explore 报告。
- **不确定性处理**:rootId 语义 + spawnFns 导出 → W3-T1 探索确认,落实到代码。
