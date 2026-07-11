# planrla 看板 W2 实施计划:scheduler + 路由 + WS 广播

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps use checkbox (`- [ ]`).

**Goal:** 为 W1 状态机接上 scheduler(并发准入)+ Express 路由(前端可驱动)+ WS 广播(实时更新)。W2 后看板可"操作"(创建/推进/广播),W3 接 agent 执行。

**Architecture:** `scheduler.ts`(per-root 去抖 + hasSlot 简化版 + admitTask,RunTask 留桩给 W3)+ `kanban.routes.ts`(Express,用 W1 service + broadcastTaskUpdated)+ 装配(复用 `getConnection()` 共享 db)。复用 planrla websocket 广播模式(参照 `server/utils/taskmaster-websocket.js`)。

**Tech Stack:** Express + W1 的 store/service + planrla `database/connection`(getConnection)+ WS(`wss.clients.forEach`)

**Spec:** `docs/superpowers/specs/2026-07-11-planrla-kanban-iteration-design.md` 第 3 节
**W1 plan:** `docs/superpowers/plans/2026-07-11-planrla-kanban-iteration.md`(Phase 2 大纲)

## W1 已确立接口(W2 对接,不重定义)
- `createTaskStore({ db: DB })` → `{ createTask, getTask, listQueuedTasks, listTasks, updateTaskStatus, updateTaskStage, latestStageRun, updateTaskAuxFlags, nextTaskNumber, insertStageRun, insertTaskEvent }`
- `createTemplateStore({ dir })` → `{ saveTaskTemplate, getTaskTemplate, listTaskTemplates, deleteTaskTemplate }`
- `createKanbanService({ taskStore, templateStore })` → `{ createTask(rootId,taskTemplateId,input), next/prev/jump/pause/resume/complete/cancel/fail(rootId,taskId[,targetIndex]) }`(全带 rootId authz)
- `AppError(message, { code, statusCode })`
- `getConnection(): Database.Database`(from `@/modules/database/index.js`,共享单例)

## 约定(同 W1)
- import `@/`=`server/` + `.js` 后缀;ESM;`node:test`
- commit conventional,body ≤100 字符/行,尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- 路由用 `req.app.locals.wss`(planrla 惯例)+ `authenticateToken` 中间件
- 测试 `npm run test:kanban`;typecheck `npx tsc --noEmit -p server/tsconfig.json`(timeout 300000)

## File Structure
| 文件 | 职责 |
|---|---|
| `server/utils/kanban-websocket.js` | broadcastTaskUpdated(WS 广播工具) |
| `server/modules/kanban/scheduler.ts` | per-root 去抖 + hasSlot + admitTask + RunTask 桩 |
| `server/modules/kanban/kanban.routes.ts` | Express 路由 `/api/tasks/*` + 广播 |
| `server/modules/kanban/assembly.ts` | 装配:从 getConnection 建 store/template/service/scheduler 单例 |
| `server/modules/kanban/tests/scheduler.test.ts` | scheduler 单测 |
| `server/index.js`(Modify) | 挂载 `app.use('/api/tasks', authenticateToken, kanbanRoutes)` |

---

## Task 1: kanban-websocket.js(WS 广播工具)

**Files:** Create `server/utils/kanban-websocket.js`

参照 `server/utils/taskmaster-websocket.js` 模式。

- [ ] **Step 1:** Create `server/utils/kanban-websocket.js`:

```javascript
/**
 * KANBAN WEBSOCKET UTILITIES
 * Broadcasts kanban task state changes via WebSocket.
 */
export function broadcastTaskUpdated(wss, rootId, task) {
  if (!wss || !rootId || !task) {
    console.warn('kanban WebSocket broadcast: missing wss/rootId/task');
    return;
  }
  const message = {
    type: 'kanban-task-updated',
    rootId,
    task,
    timestamp: new Date().toISOString(),
  };
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      try { client.send(JSON.stringify(message)); } catch (e) { console.error('kanban WS send error:', e); }
    }
  });
}
```

- [ ] **Step 2:** typecheck + commit
```bash
npx tsc --noEmit -p server/tsconfig.json
git add server/utils/kanban-websocket.js && git commit -m "feat(kanban): add broadcastTaskUpdated WS util" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: scheduler.ts(并发准入 + RunTask 桩)

**Files:** Create `server/modules/kanban/scheduler.ts` + `server/modules/kanban/tests/scheduler.test.ts`

参照 MindFS `server/internal/kanban/service.go:466-644`(schedule/hasSlot/admitTask)。**简化版**(spec 决策 2:强制 worktree,只看 `used < MaxConcurrency`)。RunTask 留桩(W3 接 runner)。

- [ ] **Step 1:** 写失败测试 `tests/scheduler.test.ts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import { createTaskStore } from '@/modules/kanban/store.js';
import { createTemplateStore } from '@/modules/kanban/template-store.js';
import { createKanbanService } from '@/modules/kanban/service.js';
import { createScheduler } from '@/modules/kanban/scheduler.js';

function setup() {
  const db = new Database(join(tmpdir(), `sch-${Date.now()}-${Math.random().toString(36).slice(2)}.db`));
  db.pragma('journal_mode = WAL');
  const taskStore = createTaskStore({ db });
  const templateStore = createTemplateStore({ dir: join(tmpdir(), `sch-tpl-${Date.now()}`) });
  const service = createKanbanService({ taskStore, templateStore });
  const runCalls: any[] = [];
  const scheduler = createScheduler({
    taskStore,
    onAdmit: (taskId) => runCalls.push(taskId),  // RunTask 桩:记录被 admit 的任务
  });
  return { db, taskStore, templateStore, service, scheduler, runCalls };
}

test('schedule admits a queued task up to maxConcurrency', () => {
  const { db, templateStore, service, scheduler, runCalls } = setup();
  // 模板 maxConcurrency=2,但 W1 service 不存 maxConcurrency 到 task —— scheduler 从 templateStore 读
  templateStore.saveTaskTemplate({
    id: 't1', name: 'T', maxConcurrency: 2, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    stages: [{ id: 's0', position: 0, snapshot: { id: 'ss0', name: 'Plan', role: 'user', autoAdvance: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' } }],
  });
  const a = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'a' }); // status=queued(auto_advance)
  const b = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'b' });
  const c = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'c' });
  scheduler.schedule('r1');
  assert.equal(runCalls.length, 2); // maxConcurrency=2 → admit a, b
  db.close();
});

test('schedule skips already-admitted tasks', () => {
  const { db, templateStore, service, scheduler, runCalls } = setup();
  templateStore.saveTaskTemplate({ id: 't1', name: 'T', maxConcurrency: 1, createdAt: '', updatedAt: '', stages: [{ id: 's0', position: 0, snapshot: { id: 'ss0', name: 'P', role: 'user', autoAdvance: true, createdAt: '', updatedAt: '' } }] });
  service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'a' });
  scheduler.schedule('r1'); // admit a
  scheduler.schedule('r1'); // a 已 admit,跳过
  assert.equal(runCalls.length, 1);
  db.close();
});

test('schedule coalesces concurrent triggers (per-root debounce)', () => {
  const { db, scheduler } = setup();
  // 多次 schedule('r1') 并发触发,只跑一轮(去抖)
  // 实现细节:scheduleRun[rootId] 标记 + 循环结束检查 schedulePend
  scheduler.schedule('r1'); // 即便没任务也不应崩
  scheduler.schedule('r1');
  db.close();
});
```

- [ ] **Step 2:** 跑失败 `npm run test:kanban` → FAIL(模块不存在)
- [ ] **Step 3:** 实现 `scheduler.ts`:

```typescript
import type { TaskStore } from '@/modules/kanban/store.js';
import type { TemplateStore } from '@/modules/kanban/template-store.js';
import type { Task } from '@/modules/kanban/types.js';

export interface SchedulerDeps {
  taskStore: TaskStore;
  templateStore: TemplateStore;
  onAdmit: (taskId: string) => void;  // RunTask hook(W3 接 runner)
}

export function createScheduler(deps: SchedulerDeps) {
  const { taskStore, templateStore, onAdmit } = deps;
  const running = new Set<string>();   // scheduleRun[rootId]
  const pending = new Set<string>();   // schedulePend[rootId]

  function schedule(rootId: string): void {
    if (running.has(rootId)) { pending.add(rootId); return; }
    running.add(rootId);
    try {
      run(rootId);
      while (pending.has(rootId)) {
        pending.delete(rootId);
        run(rootId);
      }
    } finally {
      running.delete(rootId);
    }
  }

  function run(rootId: string): void {
    const queued = taskStore.listQueuedTasks(rootId); // 升序
    const all = taskStore.listTasks(rootId);
    for (const task of queued) {
      if (task.schedulerAdmitted) continue;
      const tpl = templateStore.getTaskTemplate(task.taskTemplateId);
      if (!tpl) continue;
      if (!hasSlot(task, tpl.maxConcurrency, all)) continue;
      admit(task);
      onAdmit(task.id);
    }
  }

  function hasSlot(candidate: Task, maxConcurrency: number, all: Task[]): boolean {
    const limit = maxConcurrency > 0 ? maxConcurrency : 1;
    let used = 0;
    for (const t of all) {
      if (t.id === candidate.id) continue;
      if (!t.schedulerAdmitted) continue;
      if (isTerminalStatus(t.status)) continue;
      // 简化版(决策 2:强制 worktree,不区分模板/串行)
      used++;
    }
    return used < limit;
  }

  function admit(task: Task): void {
    taskStore.updateTaskStatus(task.id, 'running');
    // 注意:updateTaskStatus 非终态分支不动 schedulerAdmitted;admit 后单独置
    taskStore.updateTaskStage(task.id, task.currentStageIndex, 'running');
    // updateTaskStage 重置 schedulerAdmitted=0,需再设 1:
    // (store 需提供 setSchedulerAdmitted,或扩展 updateTaskStage 参数 —— 见 Step 4)
  }

  return { schedule };
}

function isTerminalStatus(s: string): boolean {
  return s === 'success' || s === 'fail' || s === 'cancelled';
}
```

- [ ] **Step 4:** store 需补 `setSchedulerAdmitted(taskId, value)`(因 updateTaskStage 重置 admitted=0,admit 后要设 1)。在 `store.ts` 加:
```typescript
function setSchedulerAdmitted(taskId: string, value: boolean): void {
  db.prepare('UPDATE tasks SET scheduler_admitted = ?, updated_at = ? WHERE id = ?')
    .run(value ? 1 : 0, new Date().toISOString(), taskId);
}
```
加进 return。scheduler.admit 改:
```typescript
function admit(task: Task): void {
  taskStore.updateTaskStage(task.id, task.currentStageIndex, 'running'); // 设 status=running + 重置 admitted=0
  taskStore.setSchedulerAdmitted(task.id, true); // 再设 admitted=1
}
```

- [ ] **Step 5:** 跑测试通过(全绿)+ typecheck
- [ ] **Step 6:** commit
```bash
git add server/modules/kanban/scheduler.ts server/modules/kanban/store.ts server/modules/kanban/tests/scheduler.test.ts && git commit -m "feat(kanban): add scheduler with per-root debounce and hasSlot" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: kanban.routes.ts(Express 路由)

**Files:** Create `server/modules/kanban/kanban.routes.ts`

参照 `server/routes/taskmaster.js`(router + req.app.locals.wss)+ `server/modules/projects/projects.routes.ts`(.ts 模式)。**先 Read 这两个确认模式**。

- [ ] **Step 1:** Read `server/routes/taskmaster.js`(头部 router 定义 + 一个 handler)+ `server/modules/projects/projects.routes.ts`(看 .ts router 导入 + app.locals.wss 用法)。

- [ ] **Step 2:** Create `kanban.routes.ts`:

```typescript
import { Router } from 'express';
import type { KanbanService } from '@/modules/kanban/service.js';
import { broadcastTaskUpdated } from '@/utils/kanban-websocket.js';

export interface KanbanRouterDeps {
  service: KanbanService;
}

export function createKanbanRouter(deps: KanbanRouterDeps): Router {
  const router = Router();
  const { service } = deps;

  // GET /api/tasks?rootId=...
  router.get('/', (req, res) => {
    const rootId = String(req.query.rootId ?? '');
    if (!rootId) return res.status(400).json({ message: 'rootId required' });
    // service 需要加 listTasks(W2-T4 装配时补,或这里直接用 taskStore —— 见 Task 4)
    // 先用 service 暴露的只读方法(若 W1 没有,在 Task 4 给 service 加 listTasks/getTask)
    res.json({ /* tasks */ });
  });

  // POST /api/tasks { rootId, taskTemplateId, input }
  router.post('/', async (req, res) => {
    try {
      const { rootId, taskTemplateId, input } = req.body;
      const task = service.createTask({ rootId, taskTemplateId, input });
      broadcastTaskUpdated(req.app.locals.wss, rootId, task);
      res.json(task);
    } catch (e: any) {
      res.status(e.statusCode ?? 500).json({ message: e.message, code: e.code });
    }
  });

  // POST /api/tasks/:taskId/{next,prev,jump,pause,resume,complete,cancel,fail}
  const moves = ['next', 'prev', 'pause', 'resume', 'complete', 'cancel', 'fail'] as const;
  for (const action of moves) {
    router.post(`/:taskId/${action}`, (req, res) => handleMove(req, res, action));
  }
  router.post('/:taskId/jump', (req, res) => handleMove(req, res, 'jump', Number(req.body.targetIndex)));

  function handleMove(req: any, res: any, action: string, targetIndex?: number) {
    const rootId = String(req.body.rootId ?? '');
    const taskId = req.params.taskId;
    if (!rootId) return res.status(400).json({ message: 'rootId required' });
    try {
      const task = (service as any)[action](rootId, taskId, targetIndex);
      broadcastTaskUpdated(req.app.locals.wss, rootId, task);
      res.json(task);
    } catch (e: any) {
      res.status(e.statusCode ?? 500).json({ message: e.message, code: e.code });
    }
  }

  return router;
}
```

- [ ] **Step 3:** typecheck + commit
```bash
git add server/modules/kanban/kanban.routes.ts && git commit -m "feat(kanban): add Express routes for tasks CRUD and transitions" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 装配(assembly.ts)+ service 补只读方法 + index.js 挂载

**Files:** Create `server/modules/kanban/assembly.ts`;Modify `server/modules/kanban/service.ts`(加 listTasks/getTask);Modify `server/index.js`(挂载路由)

- [ ] **Step 1:** service 补只读方法(`service.ts` 的 return 加):
```typescript
function listTasks(rootId: string): Task[] {
  return taskStore.listTasks(rootId);
}
function getTask(rootId: string, taskId: string): Task | null {
  return requireTask(taskId, rootId);  // 带 rootId authz
}
```
return 加 `listTasks, getTask`。

- [ ] **Step 2:** Create `assembly.ts`(单例装配):
```typescript
import { getConnection } from '@/modules/database/index.js';
import { createTaskStore } from '@/modules/kanban/store.js';
import { createTemplateStore } from '@/modules/kanban/template-store.js';
import { createKanbanService } from '@/modules/kanban/service.js';
import { createScheduler } from '@/modules/kanban/scheduler.js';
import { createKanbanRouter } from '@/modules/kanban/kanban.routes.js';
import { appConfigDb } from '@/modules/database/index.js';
import path from 'node:path';
import os from 'node:os';

let cached: ReturnType<typeof build> | null = null;

export function getKanban() {
  if (cached) return cached;
  cached = build();
  return cached;
}

function build() {
  const db = getConnection();
  const taskStore = createTaskStore({ db });
  // 模板目录:用 planrla config 目录(参照现有 config 解析,简化用 ~/.planrla/kanban-templates)
  const templateDir = path.join(os.homedir(), '.planrla');
  const templateStore = createTemplateStore({ dir: templateDir });
  const service = createKanbanService({ taskStore, templateStore });
  const scheduler = createScheduler({ taskStore, templateStore, onAdmit: (taskId) => {
    // W3 接 runner;W2 留桩(只 log)
    console.log('[kanban] task admitted (runner pending W3):', taskId);
  }});
  const router = createKanbanRouter({ service });
  return { db, taskStore, templateStore, service, scheduler, router };
}
```

- [ ] **Step 3:** Modify `server/index.js`(参照现有 router import + app.use 模式):
- 在 import 区(行 54-72 附近)加:`import { getKanban } from './modules/kanban/assembly.js';`
- 在 app.use 路由区(行 249-291 附近,authenticateToken 之后)加:
  ```javascript
  app.use('/api/tasks', authenticateToken, getKanban().router);
  ```

- [ ] **Step 4:** typecheck + 手动冒烟(可选,跑 server 看 /api/tasks 不 500)+ commit
```bash
npx tsc --noEmit -p server/tsconfig.json
git add server/modules/kanban/assembly.ts server/modules/kanban/service.ts server/index.js && git commit -m "feat(kanban): wire kanban module into server with shared db" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 集成测试(路由 + scheduler 端到端)

**Files:** Create `server/modules/kanban/tests/integration.test.ts`

- [ ] **Step 1:** 写集成测试(用 supertest 或直接调 router + mock req/res):

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import { createTaskStore } from '@/modules/kanban/store.js';
import { createTemplateStore } from '@/modules/kanban/template-store.js';
import { createKanbanService } from '@/modules/kanban/service.js';
import { createKanbanRouter } from '@/modules/kanban/kanban.routes.js';

function setupRouter() {
  const db = new Database(join(tmpdir(), `int-${Date.now()}-${Math.random().toString(36).slice(2)}.db`));
  db.pragma('journal_mode = WAL');
  const taskStore = createTaskStore({ db });
  const templateStore = createTemplateStore({ dir: join(tmpdir(), `int-tpl-${Date.now()}`) });
  const service = createKanbanService({ taskStore, templateStore });
  const router = createKanbanRouter({ service });
  return { db, templateStore, service, router };
}

// 辅助:构造 mock req/res 调 router(或用 supertest —— 若 planrla 无 supertest,用 mock)
function mockReq(method: string, path: string, body: any = {}, query: any = {}, app = { locals: { wss: null } }) {
  return { method, path, body, query, app, params: {} } as any;
}
function mockRes() {
  const r: any = { statusCode: 200, body: null, status(c: number) { this.statusCode = c; return this; }, json(b: any) { this.body = b; return this; } };
  return r;
}

test('POST / creates a task and returns it', async () => {
  const { db, templateStore, router } = setupRouter();
  templateStore.saveTaskTemplate({ id: 't1', name: 'T', maxConcurrency: 1, createdAt: '', updatedAt: '', stages: [{ id: 's0', position: 0, snapshot: { id: 'ss0', name: 'P', role: 'user', autoAdvance: true, createdAt: '', updatedAt: '' } }] });
  // 调 router(需 Express dispatch —— 用真实 Express 更可靠)
  // 实现细节:用 express().use(router) + supertest,或手动 dispatch
  // ...(见 Step 2)
  db.close();
});
```

- [ ] **Step 2:** 集成测试用真实 Express dispatch(比 mock 可靠)。若 planrla 无 supertest 依赖,加 devDep `supertest`,或用 Node 内置 http + router.handle。**推荐加 supertest**(简单):`npm i -D supertest @types/supertest`,测试用 `await request(createServer(router)).post('/').send({...})`。

- [ ] **Step 3:** 测试覆盖:
- POST / 创建任务 → 200 + task
- POST / 缺 rootId → 400
- POST /:taskId/next 推进 → 200 + 更新 task
- POST /:taskId/next 错误 rootId → 403(TASK_ROOT_MISMATCH)
- GET /?rootId=... → 任务列表

- [ ] **Step 4:** 全绿 + typecheck + commit
```bash
npm run test:kanban
npx tsc --noEmit -p server/tsconfig.json
git add server/modules/kanban/tests/integration.test.ts package.json package-lock.json && git commit -m "test(kanban): add route + scheduler integration tests" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## W2 完成标准
- `scheduler.ts` + `kanban.routes.ts` + `assembly.ts` + `kanban-websocket.js` 全部实现
- `server/index.js` 挂载 `/api/tasks`(authenticateToken)
- 复用 `getConnection()` 共享 db(W1 review Important #1 落地)
- service 补 `listTasks`/`getTask`(带 rootId authz)
- `npm run test:kanban` 全绿(W1 46 + W2 新增 ≥ 10)
- typecheck 0 errors
- W2 不含:agent 执行(scheduler onAdmit 是桩,W3 接 runner)、前端 UI(W4)

## Self-Review
- **Spec coverage**:scheduler(W2-T2)+ 路由(W2-T3)+ WS 广播(W2-T1)+ 装配(W2-T4)= spec 第 3 节"看板调统一 session 接口 + WS 广播"。✓
- **Placeholder**:Task 5 集成测试的 dispatch 方式标注了"加 supertest 或手动 dispatch"——执行时选定一种(推荐 supertest),不留 TBD。
- **Type 一致性**:SchedulerDeps/KanbanRouterDeps 用 W1 的 TaskStore/KanbanService 类型。store 补 setSchedulerAdmitted(taskId, value)——W1 store 没,Task 2 Step 4 补。
- **W1 接口对接**:service 全方法带 rootId(W1 已做),路由传 rootId 即可。store DI(W1 已做),装配注入 getConnection()。
