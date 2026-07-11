# planrla 原生多阶段任务看板 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 planrla(v0.8.2)实现原生多阶段任务看板,直击 MindFS 的差异化优势,作为后续团队协作/商业化的基础。

**Architecture:** 后端 `server/modules/kanban/`(types/store/scheduler/service/runner/git-worktree/mcp-tools)+ 前端 `src/components/kanban/`。移植 MindFS 的多阶段状态机(Go → TS),适配 planrla 的 5 provider 对称架构 + Electron + better-sqlite3。Runner 桥接 planrla 现有 session 管理。

**Tech Stack:** Node.js + TypeScript + Express + better-sqlite3(WAL)+ `node:test`(测试)+ Electron utility process(worktree)+ simple-git + node-cron + MCP(Claude Code 自驱)

**Spec:** `docs/superpowers/specs/2026-07-11-planrla-kanban-iteration-design.md`

**MindFS 参考源码:** `/tmp/mindfs`(本机克隆,移植时参照 `server/internal/kanban/` 和 `server/internal/api/appcontext.go`)

---

## 重要约定(遵循 planrla 现有模式)

- **import 别名**:`@/` = `server/`,import 路径写 `.js` 后缀(因 tsc-alias 编译,源是 .ts 但 import 写 .js)
- **测试**:`node:test` + `node:assert/strict`,测试文件放 `<module>/tests/*.test.ts`
- **依赖注入**:store/service 接受可选 `deps` 参数(传 mock 给测试)
- **错误**:用 `AppError`(from `@/shared/utils.js`),带 `code` + `statusCode`
- **commit**:conventional commits,husky/commitlint 会校验——**body 每行 ≤ 100 字符**
- **验证命令**:`npm run typecheck`(必须通过)

---

## File Structure

### 后端(`server/modules/kanban/`)
| 文件 | 职责 | 阶段 |
|---|---|---|
| `types.ts` | 数据模型 + 状态机常量 | W1 |
| `store.ts` | SQLite 任务表(tasks/stage_runs/task_events)CRUD | W1 |
| `template-store.ts` | JSON 模板文件(stage_template/task_template)CRUD | W1 |
| `service.ts` | 状态机核心循环(CreateTask/Next/Prev/Complete/Cancel...) | W1 |
| `tests/state-machine.test.ts` | 状态机单测 | W1 |
| `tests/store.test.ts` | 存储 CRUD 单测 | W1 |
| `scheduler.ts` | per-root 去抖 + hasSlot 并发规则 | W2 |
| `runner.ts` | Runner 接口,桥接 planrla 5 provider session | W3 |
| `aux-bridge.ts` | agent 事件 → kanban aux flag 桥接 | W3 |
| `git-worktree.ts` | worktree 操作(simple-git) | W4 |
| `mcp-tools.ts` | task_next/task_prev/task_status MCP 工具(Claude Code) | W4 |

### 后端入口
| 文件 | 职责 | 阶段 |
|---|---|---|
| `server/routes/tasks.ts` | Express 路由 `/api/tasks/*` + WS 广播 | W2 |
| `server/index.js` | 挂载 tasks 路由 | W2 |

### 前端(`src/components/kanban/`)
| 文件 | 职责 | 阶段 |
|---|---|---|
| `Board.tsx` | 看板主视图(阶段列) | W4 |
| `StageColumn.tsx` | 单个阶段列 | W4 |
| `TaskCard.tsx` | 任务卡(含 aux 徽章) | W4 |
| `TaskDetailModal.tsx` | 任务详情 | W4 |
| `TaskTemplateEditor.tsx` | 模板编辑 | W4 |
| `KanbanContext.tsx` | 状态管理(WS 订阅) | W4 |

### 配套(W4)
| 文件 | 职责 |
|---|---|
| `server/modules/scheduled/` | 定时任务(node-cron) |
| `server/modules/notification/`(扩展) | webhook channel |

---

## Phase 1(W1):数据模型 + 存储 + 状态机

**目标**:可独立验证的状态机 + 存储(单测全绿)。不含 agent 执行、不含 UI。

### Task 1: 数据模型 types.ts

**Files:**
- Create: `server/modules/kanban/types.ts`

- [ ] **Step 1: 创建 types.ts(完整类型 + 状态常量)**

参照 MindFS `server/internal/kanban/types.go`(/tmp/mindfs)翻译成 TS:

```typescript
// server/modules/kanban/types.ts

// ===== 状态常量 =====
export type TaskStatus =
  | 'pending' | 'queued' | 'running' | 'waiting_user'
  | 'paused' | 'success' | 'fail' | 'cancelled';

export type StageStatus =
  | 'pending' | 'running' | 'waiting_user'
  | 'success' | 'fail' | 'cancelled' | 'approved' | 'rejected';

export type SessionReusePolicy = 'task_main' | 'same_stage' | 'always_new';

export const SESSION_REUSE_TASK_MAIN: SessionReusePolicy = 'task_main';
export const SESSION_REUSE_SAME_STAGE: SessionReusePolicy = 'same_stage';
export const SESSION_REUSE_ALWAYS_NEW: SessionReusePolicy = 'always_new';

export function isTerminalTaskStatus(s: TaskStatus): boolean {
  return s === 'success' || s === 'fail' || s === 'cancelled';
}

// ===== 实体 =====
export interface StageTemplate {
  id: string;
  name: string;
  role: 'user' | 'agent';
  autoAdvance: boolean;
  agent?: string;
  model?: string;
  mode?: string;
  effort?: string;
  fastService?: string;
  planMode?: boolean;
  sessionReusePolicy?: SessionReusePolicy;
  promptTemplate?: string;
  agentCanControlStage?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskTemplateStage {
  id: string;
  stageTemplateId?: string;
  position: number;
  snapshot: StageTemplate;
}

export interface TaskTemplate {
  id: string;
  name: string;
  description?: string;
  maxConcurrency: number;
  stages: TaskTemplateStage[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskAuxFlags {
  askUserWaiting: boolean;
  hasPlan: boolean;
  hasTodos: boolean;
  hasTask: boolean;
  sessionError?: string;
}

export interface Task {
  id: string;
  taskNumber: number;
  rootId: string;
  taskTemplateId: string;
  taskTemplateName?: string;
  createWorktree: boolean;
  worktreeBranchMode?: string;
  worktreeBranch?: string;
  worktreePath?: string;
  currentStageIndex: number;
  status: TaskStatus;
  schedulerAdmitted: boolean;
  mainSessionKey?: string;
  worktreeRootId?: string;
  labels: string[];
  auxFlags: TaskAuxFlags;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  // 由 store 装饰(非 DB 列)
  currentStageName?: string;
  currentStageStatus?: StageStatus;
}

export interface StageRun {
  id: string;
  taskId: string;
  stageIndex: number;
  stageName: string;
  role: 'user' | 'agent';
  status: StageStatus;
  sessionKey?: string;
  input?: string;
  renderedPrompt?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  stageRunId?: string;
  type: string;
  payloadJson?: string;
  createdAt: string;
}
```

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: PASS(0 errors)

- [ ] **Step 3: Commit**

```bash
git add server/modules/kanban/types.ts
git commit -m "feat(kanban): add data model and status constants"
```

---

### Task 2: SQLite store — 表 schema + 基础 CRUD

**Files:**
- Create: `server/modules/kanban/store.ts`
- Create: `server/modules/kanban/tests/store.test.ts`
- Modify: `package.json`(加 test script)

参照 MindFS `server/internal/kanban/task_store.go:64-148`(DDL)+ `:204-345`(CRUD)。

- [ ] **Step 1: 加 npm test script**

`package.json` 的 `scripts` 加(在 `"lint"` 附近):

```json
"test": "node --import tsx --test \"server/**/*.test.ts\"",
"test:kanban": "node --import tsx --test \"server/modules/kanban/**/*.test.ts\""
```

- [ ] **Step 2: 写第一个失败测试(CreateTask + GetTask)**

```typescript
// server/modules/kanban/tests/store.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTaskStore } from '@/modules/kanban/store.js';

function newTestStore() {
  const dbPath = join(tmpdir(), `kanban-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  return createTaskStore({ dbPath });
}

test('createTask inserts task + initial stage run + event, getTask returns it', () => {
  const store = newTestStore();
  const now = new Date().toISOString();

  const task = store.createTask({
    task: {
      id: 'task-1', taskNumber: 1, rootId: 'root-1',
      taskTemplateId: 'tpl-1', taskTemplateName: 'T',
      createWorktree: true, currentStageIndex: 0,
      status: 'queued', schedulerAdmitted: false,
      labels: [], auxFlags: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false },
      createdAt: now, updatedAt: now,
    },
    initialStageRun: {
      id: 'run-1', taskId: 'task-1', stageIndex: 0, stageName: 'S',
      role: 'user', status: 'approved', createdAt: now, updatedAt: now,
    },
    event: { id: 'ev-1', taskId: 'task-1', type: 'task_created', createdAt: now },
  });

  assert.equal(task.id, 'task-1');
  const got = store.getTask('task-1');
  assert.ok(got);
  assert.equal(got!.status, 'queued');
  assert.equal(got!.taskNumber, 1);
});
```

- [ ] **Step 3: 跑测试,确认失败(模块不存在)**

Run: `npm run test:kanban`
Expected: FAIL,`Cannot find module '@/modules/kanban/store.js'`

- [ ] **Step 4: 实现 store.ts(DDL + createTask + getTask)**

```typescript
// server/modules/kanban/store.ts
import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import type { Task, StageRun, TaskEvent, TaskAuxFlags, TaskStatus } from '@/modules/kanban/types.js';

export interface TaskStoreDeps {
  dbPath: string;
}

export interface CreateTaskInput {
  task: Task;
  initialStageRun: StageRun;
  event: TaskEvent;
}

export function createTaskStore(deps: TaskStoreDeps) {
  const db: DB = new Database(deps.dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA_SQL);

  const createTaskStmt = db.transaction((input: CreateTaskInput) => {
    const t = input.task;
    db.prepare(`INSERT INTO tasks
      (id, task_number, root_id, task_template_id, task_template_name,
       create_worktree, worktree_branch_mode, worktree_branch, worktree_path,
       current_stage_index, status, scheduler_admitted, main_session_key,
       worktree_root_id, labels_json,
       aux_ask_user_waiting, aux_has_plan, aux_has_todos, aux_has_task, aux_session_error,
       created_at, updated_at, completed_at)
      VALUES (@id,@taskNumber,@rootId,@taskTemplateId,@taskTemplateName,
        @createWorktree,@worktreeBranchMode,@worktreeBranch,@worktreePath,
        @currentStageIndex,@status,@schedulerAdmitted,@mainSessionKey,
        @worktreeRootId,@labelsJson,
        @askUserWaiting,@hasPlan,@hasTodos,@hasTask,@sessionError,
        @createdAt,@updatedAt,@completedAt)`)
      .run({
        ...t,
        labelsJson: JSON.stringify(t.labels ?? []),
        askUserWaiting: t.auxFlags.askUserWaiting ? 1 : 0,
        hasPlan: t.auxFlags.hasPlan ? 1 : 0,
        hasTodos: t.auxFlags.hasTodos ? 1 : 0,
        hasTask: t.auxFlags.hasTask ? 1 : 0,
        sessionError: t.auxFlags.sessionError ?? null,
        completedAt: t.completedAt ?? null,
      });

    insertStageRun(input.initialStageRun);
    insertTaskEvent(input.event);
    return t;
  });

  function insertStageRun(r: StageRun) {
    db.prepare(`INSERT INTO stage_runs
      (id, task_id, stage_index, stage_name, role, status, session_key,
       input, rendered_prompt, started_at, finished_at, created_at, updated_at)
      VALUES (@id,@taskId,@stageIndex,@stageName,@role,@status,@sessionKey,
        @input,@renderedPrompt,@startedAt,@finishedAt,@createdAt,@updatedAt)`)
      .run({ ...r, sessionKey: r.sessionKey ?? null, input: r.input ?? null, renderedPrompt: r.renderedPrompt ?? null, startedAt: r.startedAt ?? null, finishedAt: r.finishedAt ?? null });
  }

  function insertTaskEvent(e: TaskEvent) {
    db.prepare(`INSERT INTO task_events (id, task_id, stage_run_id, type, payload_json, created_at)
      VALUES (@id,@taskId,@stageRunId,@type,@payloadJson,@createdAt)`)
      .run({ ...e, stageRunId: e.stageRunId ?? null, payloadJson: e.payloadJson ?? null });
  }

  function getTask(id: string): Task | null {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
    if (!row) return null;
    return rowToTask(row);
  }

  return { createTask: createTaskStmt, getTask, insertStageRun, insertTaskEvent, close: () => db.close() };
}

function rowToTask(row: any): Task {
  return {
    id: row.id, taskNumber: row.task_number, rootId: row.root_id,
    taskTemplateId: row.task_template_id, taskTemplateName: row.task_template_name ?? undefined,
    createWorktree: Boolean(row.create_worktree),
    worktreeBranchMode: row.worktree_branch_mode ?? undefined,
    worktreeBranch: row.worktree_branch ?? undefined,
    worktreePath: row.worktree_path ?? undefined,
    currentStageIndex: row.current_stage_index, status: row.status as TaskStatus,
    schedulerAdmitted: Boolean(row.scheduler_admitted),
    mainSessionKey: row.main_session_key ?? undefined,
    worktreeRootId: row.worktree_root_id ?? undefined,
    labels: JSON.parse(row.labels_json ?? '[]'),
    auxFlags: {
      askUserWaiting: Boolean(row.aux_ask_user_waiting),
      hasPlan: Boolean(row.aux_has_plan),
      hasTodos: Boolean(row.aux_has_todos),
      hasTask: Boolean(row.aux_has_task),
      sessionError: row.aux_session_error ?? undefined,
    },
    createdAt: row.created_at, updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
  };
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  task_number INTEGER NOT NULL,
  root_id TEXT NOT NULL,
  task_template_id TEXT NOT NULL,
  task_template_name TEXT,
  create_worktree INTEGER NOT NULL DEFAULT 1,
  worktree_branch_mode TEXT,
  worktree_branch TEXT,
  worktree_path TEXT,
  current_stage_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  scheduler_admitted INTEGER NOT NULL DEFAULT 0,
  main_session_key TEXT,
  worktree_root_id TEXT,
  labels_json TEXT NOT NULL DEFAULT '[]',
  aux_ask_user_waiting INTEGER NOT NULL DEFAULT 0,
  aux_has_plan INTEGER NOT NULL DEFAULT 0,
  aux_has_todos INTEGER NOT NULL DEFAULT 0,
  aux_has_task INTEGER NOT NULL DEFAULT 0,
  aux_session_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_root ON tasks(root_id);

CREATE TABLE IF NOT EXISTS stage_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  stage_index INTEGER NOT NULL,
  stage_name TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  session_key TEXT,
  input TEXT,
  rendered_prompt TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stage_runs_task_stage ON stage_runs(task_id, stage_index, created_at);

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  stage_run_id TEXT,
  type TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_events_task_created ON task_events(task_id, created_at);
`;
```

- [ ] **Step 5: 跑测试,确认通过**

Run: `npm run test:kanban`
Expected: PASS(1 test)

- [ ] **Step 6: typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/modules/kanban/store.ts server/modules/kanban/tests/store.test.ts package.json
git commit -m "feat(kanban): add SQLite task store with schema and createTask"
```

---

### Task 3: store 补全 CRUD(ListTasks/ListQueued/UpdateTaskStatus/LatestStageRun/UpdateAuxFlags)

**Files:**
- Modify: `server/modules/kanban/store.ts`
- Modify: `server/modules/kanban/tests/store.test.ts`

参照 MindFS `task_store.go:232-411`(ListTasks/ListQueuedTasks/LatestStageRun/UpdateTaskStatus)+ `:413-434`(admitted 清零)。

- [ ] **Step 1: 写失败测试(ListQueued + UpdateTaskStatus + LatestStageRun)**

追加到 `store.test.ts`:

```typescript
test('listQueuedTasks returns queued tasks ordered by created_at', () => {
  const store = newTestStore();
  const now = new Date().toISOString();
  // 创建 2 个 queued 任务(略,参照上面 createTask 调用)
  // ... create task-a (createdAt: T1), task-b (createdAt: T2 > T1)
  const queued = store.listQueuedTasks('root-1');
  assert.equal(queued.length, 2);
  assert.equal(queued[0].id, 'task-a'); // 升序
});

test('updateTaskStatus sets status + clears schedulerAdmitted on terminal', () => {
  const store = newTestStore();
  // create task with status=running, schedulerAdmitted=true
  store.updateTaskStatus('task-1', 'fail');
  const got = store.getTask('task-1');
  assert.equal(got!.status, 'fail');
  assert.equal(got!.schedulerAdmitted, false); // terminal 清零
  assert.ok(got!.completedAt); // 终态写 completedAt
});

test('latestStageRun returns the most recent run for a stage', () => {
  const store = newTestStore();
  // create task + 2 stage_runs for stage 0(不同 created_at)
  const latest = store.latestStageRun('task-1', 0);
  assert.equal(latest!.id, 'run-later');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:kanban`
Expected: FAIL(方法不存在)

- [ ] **Step 3: 实现方法**

在 `createTaskStore` 的 return 对象补全(参照 MindFS `task_store.go:232-345` 的 SQL):

```typescript
function listQueuedTasks(rootId: string): Task[] {
  const rows = db.prepare('SELECT * FROM tasks WHERE root_id = ? AND status = ? ORDER BY created_at ASC')
    .all(rootId, 'queued') as any[];
  return rows.map(rowToTask);
}

function listTasks(rootId: string): Task[] {
  const rows = db.prepare('SELECT * FROM tasks WHERE root_id = ? ORDER BY updated_at DESC, created_at DESC')
    .all(rootId) as any[];
  return rows.map(rowToTask);
}

function updateTaskStatus(id: string, status: TaskStatus): void {
  const now = new Date().toISOString();
  const terminal = isTerminalTaskStatus(status);
  db.prepare(`UPDATE tasks SET status = ?, scheduler_admitted = ?, completed_at = ?, updated_at = ? WHERE id = ?`)
    .run(status, terminal ? 0 : 1, terminal ? now : null, now, id);
  // 注意:terminal 时 scheduler_admitted 清 0;非终态保持(不清)——见 MindFS task_store.go:413-434
}

function latestStageRun(taskId: string, stageIndex: number): StageRun | null {
  const row = db.prepare('SELECT * FROM stage_runs WHERE task_id = ? AND stage_index = ? ORDER BY created_at DESC LIMIT 1')
    .get(taskId, stageIndex) as any;
  return row ? rowToStageRun(row) : null;
}

function updateTaskAuxFlags(taskId: string, flags: Partial<TaskAuxFlags>): void {
  const sets: string[] = [];
  const params: any = { taskId, updatedAt: new Date().toISOString() };
  if (flags.askUserWaiting !== undefined) { sets.push('aux_ask_user_waiting = @askUserWaiting'); params.askUserWaiting = flags.askUserWaiting ? 1 : 0; }
  if (flags.hasPlan !== undefined) { sets.push('aux_has_plan = @hasPlan'); params.hasPlan = flags.hasPlan ? 1 : 0; }
  if (flags.hasTodos !== undefined) { sets.push('aux_has_todos = @hasTodos'); params.hasTodos = flags.hasTodos ? 1 : 0; }
  if (flags.hasTask !== undefined) { sets.push('aux_has_task = @hasTask'); params.hasTask = flags.hasTask ? 1 : 0; }
  if (flags.sessionError !== undefined) { sets.push('aux_session_error = @sessionError'); params.sessionError = flags.sessionError; }
  if (sets.length === 0) return;
  sets.push('updated_at = @updatedAt');
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = @taskId`).run(params);
}
```

加 `rowToStageRun` 辅助函数(参照 `rowToTask` 模式)。把方法加进 return 对象。

- [ ] **Step 4: 跑测试通过**

Run: `npm run test:kanban`
Expected: PASS(4 tests)

- [ ] **Step 5: typecheck + commit**

```bash
npm run typecheck
git add server/modules/kanban/store.ts server/modules/kanban/tests/store.test.ts
git commit -m "feat(kanban): add list/update/aux-flags CRUD to task store"
```

---

### Task 4: 模板 store(JSON 文件)

**Files:**
- Create: `server/modules/kanban/template-store.ts`
- Create: `server/modules/kanban/tests/template-store.test.ts`

参照 MindFS `server/internal/kanban/template-store.go:155-304`(校验 + 归一)。

- [ ] **Step 1: 写失败测试(saveTaskTemplate + getTaskTemplate + 校验)**

```typescript
// server/modules/kanban/tests/template-store.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTemplateStore } from '@/modules/kanban/template-store.js';

function newStore() {
  const dir = join(tmpdir(), `kanban-tpl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return createTemplateStore({ dir });
}

test('saveTaskTemplate rejects empty name', () => {
  const store = newStore();
  assert.throws(() => store.saveTaskTemplate({ id: 't1', name: '', stages: [], maxConcurrency: 1, createdAt: '', updatedAt: '' }),
    /name/i);
});

test('saveTaskTemplate rejects template with no stages', () => {
  const store = newStore();
  assert.throws(() => store.saveTaskTemplate({ id: 't1', name: 'T', stages: [], maxConcurrency: 1, createdAt: '', updatedAt: '' }),
    /stage/i);
});

test('saveTaskTemplate snapshots stage templates into TaskTemplate', () => {
  const store = newStore();
  const now = new Date().toISOString();
  const tpl = {
    id: 't1', name: 'T', maxConcurrency: 2, createdAt: now, updatedAt: now,
    stages: [{ id: 's1', position: 0, snapshot: { id: 'ss1', name: 'Plan', role: 'user' as const, autoAdvance: true, createdAt: now, updatedAt: now } }],
  };
  store.saveTaskTemplate(tpl);
  const got = store.getTaskTemplate('t1');
  assert.equal(got!.stages[0].snapshot.name, 'Plan');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:kanban`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现 template-store.ts**

```typescript
// server/modules/kanban/template-store.ts
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskTemplate, StageTemplate, SessionReusePolicy } from '@/modules/kanban/types.js';

export interface TemplateStoreDeps { dir: string; }

export function createTemplateStore(deps: TemplateStoreDeps) {
  mkdirSync(join(deps.dir, 'kanban-templates'), { recursive: true });

  function saveTaskTemplate(tpl: TaskTemplate): TaskTemplate {
    if (!tpl.name?.trim()) throw new Error('template name required');
    if (!tpl.stages?.length) throw new Error('template must have at least one stage');
    const normalized: TaskTemplate = {
      ...tpl,
      maxConcurrency: tpl.maxConcurrency > 0 ? tpl.maxConcurrency : 1,
      stages: tpl.stages.map((s, i) => ({ ...s, position: i, snapshot: normalizeStageTemplate(s.snapshot) })),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(pathFor('task_template', tpl.id), JSON.stringify(normalized, null, 2), 'utf8');
    return normalized;
  }

  function getTaskTemplate(id: string): TaskTemplate | null {
    const p = pathFor('task_template', id);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8'));
  }

  function listTaskTemplates(): TaskTemplate[] {
    // 扫描 dir/kanban-templates/task_template-*.json
    // ...(参照实现,略)
  }

  return { saveTaskTemplate, getTaskTemplate, listTaskTemplates };
}

function normalizeStageTemplate(s: StageTemplate): StageTemplate {
  const policy: SessionReusePolicy = s.sessionReusePolicy ?? 'task_main';
  return { ...s, sessionReusePolicy: policy };
}

function pathFor(kind: string, id: string): string {
  return join(/* deps.dir 不在此函数作用域,实际实现把它作为闭包或传参 */);
}
```

> **注意**:`pathFor` 需要访问 `deps.dir`——实际实现里把 `pathFor` 放进 `createTemplateStore` 闭包内,或传 `dir` 参数。`listTaskTemplates` 用 `readdirSync` 扫描。参照 MindFS `template-store.go:277-287`(`saveJSONLocked`)。

- [ ] **Step 4: 跑测试通过 + typecheck + commit**

```bash
npm run test:kanban   # PASS
npm run typecheck
git add server/modules/kanban/template-store.ts server/modules/kanban/tests/template-store.test.ts
git commit -m "feat(kanban): add JSON template store with validation"
```

---

### Task 5: 状态机 service.ts(核心转换)

**Files:**
- Create: `server/modules/kanban/service.ts`
- Create: `server/modules/kanban/tests/state-machine.test.ts`

参照 MindFS `server/internal/kanban/service.go:194-460`(CreateTask/Next/Prev/Jump/Complete/Fail/Cancel)+ `:646-669`(admitTask)。**不含 agent 执行**(runAgentStage 在 W3)。

- [ ] **Step 1: 写失败测试(CreateTask → queued,Next → approved+queued,Complete → success)**

```typescript
// server/modules/kanban/tests/state-machine.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { createKanbanService } from '@/modules/kanban/service.js';
import { createTaskStore } from '@/modules/kanban/store.js';
import { createTemplateStore } from '@/modules/kanban/template-store.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function newService() {
  const dbPath = join(tmpdir(), `kanban-svc-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const tplDir = join(tmpdir(), `kanban-svc-tpl-${Date.now()}`);
  return createKanbanService({
    taskStore: createTaskStore({ dbPath }),
    templateStore: createTemplateStore({ dir: tplDir }),
  });
}

test('CreateTask with auto_advance first stage puts task in queued', async () => {
  const svc = newService();
  // 先存一个模板:1 个 user stage(auto_advance=true)
  const tplId = 'tpl-1';
  svc.saveTaskTemplate(/* ... 1 stage, autoAdvance true ... */);
  const task = await svc.createTask({ rootId: 'root-1', taskTemplateId: tplId, input: 'do thing' });
  assert.equal(task.status, 'queued');
});

test('Complete on last stage transitions task to success', async () => {
  const svc = newService();
  // 模板:1 user stage + 1 agent stage
  // createTask → queued → (mock 推进到末阶段)→ complete → success
  const task = await svc.createTask({ rootId: 'root-1', taskTemplateId: tplId, input: 'x' });
  const completed = await svc.complete('root-1', task.id);
  assert.equal(completed.status, 'success');
});

test('Cancel transitions to cancelled and clears schedulerAdmitted', async () => {
  const svc = newService();
  const task = await svc.createTask({ rootId: 'root-1', taskTemplateId: tplId, input: 'x' });
  const cancelled = await svc.cancel('root-1', task.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.schedulerAdmitted, false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:kanban`
Expected: FAIL(`createKanbanService` 不存在)

- [ ] **Step 3: 实现 service.ts(核心转换,参照 MindFS service.go:194-460)**

```typescript
// server/modules/kanban/service.ts
import { randomUUID } from 'node:crypto';
import type { TaskStore } from '@/modules/kanban/store.js';
import type { TemplateStore } from '@/modules/kanban/template-store.js';
import type { Task, TaskStatus, StageStatus } from '@/modules/kanban/types.js';
import { isTerminalTaskStatus } from '@/modules/kanban/types.js';
import { AppError } from '@/shared/utils.js';

export interface KanbanServiceDeps {
  taskStore: TaskStore;
  templateStore: TemplateStore;
}

export function createKanbanService(deps: KanbanServiceDeps) {
  const { taskStore, templateStore } = deps;

  async function createTask(input: { rootId: string; taskTemplateId: string; input: string }): Promise<Task> {
    const tpl = templateStore.getTaskTemplate(input.taskTemplateId);
    if (!tpl) throw new AppError('TASK_TEMPLATE_NOT_FOUND', 404, `template ${input.taskTemplateId} not found`);
    const firstStage = tpl.stages[0]?.snapshot;
    if (!firstStage || firstStage.role !== 'user') {
      throw new AppError('INVALID_TEMPLATE', 400, 'first stage must be user role');
    }
    const now = new Date().toISOString();
    const taskId = randomUUID();
    const taskNumber = nextTaskNumber(input.rootId);
    const firstStatus: TaskStatus = firstStage.autoAdvance ? 'queued' : 'waiting_user';
    const firstRunStatus: StageStatus = firstStage.autoAdvance ? 'approved' : 'pending';

    const task: Task = {
      id: taskId, taskNumber, rootId: input.rootId,
      taskTemplateId: tpl.id, taskTemplateName: tpl.name,
      createWorktree: true, currentStageIndex: 0,
      status: firstStatus, schedulerAdmitted: false,
      labels: [], auxFlags: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false },
      createdAt: now, updatedAt: now,
    };
    const run = { id: randomUUID(), taskId, stageIndex: 0, stageName: firstStage.name, role: 'user', status: firstRunStatus, input: input.input, createdAt: now, updatedAt: now };
    const event = { id: randomUUID(), taskId, type: 'task_created', createdAt: now };
    taskStore.createTask({ task, initialStageRun: run, event });
    return task;
  }

  async function complete(rootId: string, taskId: string): Promise<Task> {
    const task = taskStore.getTask(taskId);
    if (!task) throw new AppError('TASK_NOT_FOUND', 404, `task ${taskId} not found`);
    // 校验:当前 stage 是末阶段(参照 service.go:430-460)
    taskStore.updateTaskStatus(taskId, 'success');
    return taskStore.getTask(taskId)!;
  }

  async function cancel(rootId: string, taskId: string): Promise<Task> {
    taskStore.updateTaskStatus(taskId, 'cancelled');
    return taskStore.getTask(taskId)!;
  }

  // next/prev/jump/pause/resume/fail 参照 MindFS service.go:365-460 实现
  // ...(签名 + 转换逻辑,略——移植时照 service.go 逐方法翻)

  function nextTaskNumber(rootId: string): number {
    const tasks = taskStore.listTasks(rootId);
    return tasks.length + 1; // 简化版,生产用 max(taskNumber)+1
  }

  return { createTask, complete, cancel, /* next, prev, jump, pause, resume, fail */ };
}

export type KanbanService = ReturnType<typeof createKanbanService>;
```

- [ ] **Step 4: 跑测试通过**

Run: `npm run test:kanban`
Expected: PASS

- [ ] **Step 5: 补全 next/prev/jump/pause/resume/fail(参照 MindFS service.go:365-460)**

每个方法:校验当前状态 → 更新 current_stage_index / status → 写 stage_run + event。参照 `/tmp/mindfs/server/internal/kanban/service.go` 逐方法翻译,补对应单测(翻译 MindFS `service_test.go` 的 case)。

- [ ] **Step 6: typecheck + 全量测试 + commit**

```bash
npm run typecheck
npm run test:kanban   # 全绿
git add server/modules/kanban/service.ts server/modules/kanban/tests/state-machine.test.ts
git commit -m "feat(kanban): add state machine service with core transitions"
```

---

### Task 6: 翻译 MindFS 状态机单测(覆盖所有转换)

**Files:**
- Modify: `server/modules/kanban/tests/state-machine.test.ts`

参照 MindFS `server/internal/kanban/service_test.go`(1072 行)的 case 覆盖,翻译成 `node:test`。重点 case:
- CreateTask:auto_advance vs 非 auto_advance(queued vs waiting_user)
- 首阶段非 user role → 报错
- Next/Prev/Jump 状态转换
- Pause/Resume
- Complete 非末阶段 → 报错
- Fail/Cancel 清 schedulerAdmitted
- 终态后再操作 → 报错或 no-op

- [ ] **Step 1: 逐 case 翻译(TDD: 每个 case 先跑确认行为,不一致就修)**

(参照 `/tmp/mindfs/server/internal/kanban/service_test.go` 的测试函数名 + 断言,翻译成 TS。每翻译一组 case,跑一次 `npm run test:kanban`。)

- [ ] **Step 2: 全量测试通过 + commit**

```bash
npm run test:kanban   # 全绿(目标 ≥ 20 cases)
git add server/modules/kanban/tests/state-machine.test.ts
git commit -m "test(kanban): port MindFS state machine test cases to node:test"
```

---

## Phase 1 完成标准(W1 交付)

- `server/modules/kanban/{types,store,template-store,service}.ts` 全部实现
- `npm run test:kanban` 全绿(≥ 20 cases,覆盖状态机所有转换)
- `npm run typecheck` 通过
- 每个 Task 一个 commit(conventional commits,body 行 ≤ 100 字符)

**W1 不含**:agent 执行(runAgentStage)、scheduler 并发、Express 路由、前端 UI、worktree、MCP——这些在 W2-W4。

---

## Phase 2-4(后续阶段大纲)

> 各阶段完成后,基于前一阶段的实际类型/接口,展开为独立 plan 文档(`docs/superpowers/plans/YYYY-MM-DD-planrla-kanban-W2.md` 等)。这里只列任务分解,不展开 step(细节会随 W1 实现调整)。

### Phase 2(W2):调度 + 路由

| Task | 内容 | MindFS 参考 |
|---|---|---|
| 2.1 | scheduler.ts:per-root 去抖(scheduleRun/schedulePend)+ hasSlot(简化版:强制 worktree,只看 `used < MaxConcurrency`) | `service.go:466-644` |
| 2.2 | admitTask + RunTask 桩(暂不接 agent,W3 接) | `service.go:646-669` |
| 2.3 | Express 路由 `server/routes/tasks.ts`:`/api/tasks` GET/POST + `/api/tasks/:id/{next,prev,jump,pause,resume,complete,cancel}` | `http_tasks.go` |
| 2.4 | WS 广播:`broadcastTaskUpdated`(复用 planrla `websocket-server`) | `http_tasks.go:303-314` |
| 2.5 | `server/index.js` 挂载 tasks 路由 | — |
| 2.6 | 路由 + scheduler 集成测试 | — |

### Phase 3(W3):Runner + aux flag

| Task | 内容 | MindFS 参考 |
|---|---|---|
| 3.1 | runner.ts:Runner 接口(CreateTaskWorktree 桩 / EnsureAgentSession / RunAgentStage / TaskUpdated) | `types.go:155-160` + `appcontext.go:143-327` |
| 3.2 | EnsureAgentSession:3 种 session 复用策略(task_main/same_stage/always_new),桥接 planrla `claude-sdk.js` 的 session 启动 | `appcontext.go:211-257` |
| 3.3 | RunAgentStage:把 prompt 发给 planrla Claude session,流式回调挂到 WS 广播 | `appcontext.go:259-316` |
| 3.4 | aux-bridge.ts:agent 事件(AskUser/Plan/Todo/Task 工具)→ kanban aux flag,通过 session.taskId 反查 | `appcontext.go:805-869` |
| 3.5 | scheduler 接 runner(RunTask 真跑) | `service.go:728-790` |
| 3.6 | Runner + aux 集成测试(用 mock provider) | — |

### Phase 4(W4):worktree + MCP + 前端 + 配套

| Task | 内容 | MindFS 参考 |
|---|---|---|
| 4.1 | git-worktree.ts:simple-git 封装 `git worktree add`,放 Electron utility process | `gitview.go:475-494` + `usecase/git_worktree.go:200-267` |
| 4.2 | `.git/info/exclude` 写入(.worktree/ 排除)+ 存在性检查 | `appcontext.go:174-210` |
| 4.3 | mcp-tools.ts:task_next/task_prev/task_status MCP 工具(Claude Code),调 kanban service | — |
| 4.4 | 前端 KanbanContext + Board + StageColumn + TaskCard(全新 UI,复用 planrla UI 组件库) | — |
| 4.5 | TaskTemplateEditor + TaskDetailModal | — |
| 4.6 | 主内容区加 kanban tab(`MainContent.tsx`,类似 TaskMaster tab 但默认显示) | `MainContent.tsx:203` |
| 4.7 | 定时任务:node-cron + scheduled_tasks 表,触发 createTask | — |
| 4.8 | webhook 通知:notification-orchestrator 加 webhook channel | — |
| 4.9 | E2E:创建任务 → 跑 → 看板显示 → worktree 隔离 → 阶段推进 → MCP 自驱 | — |

---

## Self-Review

### 1. Spec coverage
- 原生任务看板(多阶段)→ Task 1-5(W1)+ Task 4.4-4.6(W4)✓
- worktree 隔离 + 并发(强制开启)→ Task 4.1-4.2(W4)+ Task 2.1 scheduler 简化 ✓
- 任务模板(每阶段 agent/model/mode/prompt)→ Task 1(types)+ Task 4(template-store)+ Task 4.5(编辑器)✓
- 任务-会话-worktree 三向关联 → Task 3.2-3.4(session.taskId + aux bridge)+ Task 4.1(worktreePath)✓
- 定时任务 → Task 4.7 ✓
- webhook 通知 → Task 4.8 ✓
- 全新 UI(不复用 TaskBoard)→ Task 4.4-4.6 ✓

### 2. Placeholder scan
- Task 4(template-store)的 `pathFor` 和 `listTaskTemplates` 标注了"参照实现"——这是已知待补,执行 Task 4 时需补全(不能留到代码里)。**已标注,执行时注意**。
- Task 5(service)的 next/prev/jump 等方法标注"参照 MindFS service.go:365-460 翻译"——移植任务,源可查(`/tmp/mindfs`)。**可接受**(不是占位,是有据移植)。
- Phase 2-4 是大纲,明确标注"完成后展开独立 plan"——符合分阶段规划。

### 3. Type consistency
- `Task`、`StageRun`、`TaskEvent`、`TaskTemplate`、`StageTemplate` 在 Task 1 定义,W1 内一致 ✓
- `createTaskStore` / `createTemplateStore` / `createKanbanService` 工厂签名一致(deps 注入)✓
- `TaskStore` / `TemplateStore` / `KanbanService` 类型在 W2-W4 引用时需对齐(W1 完成后导出 `export type TaskStore = ReturnType<typeof createTaskStore>`)——**Task 3 末尾补导出类型**

### 4. 需补强的小项
- **Task 3 补**:store.ts 末尾加 `export type TaskStore = ReturnType<typeof createTaskStore>;`(供 service/runner 注入)
- **Task 4 补**:template-store.ts 的 `pathFor` / `listTaskTemplates` 必须在实现时补全(不能留 TODO)

---

## Execution Handoff

Plan 完成并保存到 `docs/superpowers/plans/2026-07-11-planrla-kanban-iteration.md`。两个执行选项:

**1. Subagent-Driven(推荐)** — 每个 Task 派新 subagent,任务间审查,迭代快
**2. Inline Execution** — 本会话用 executing-plans 批量执行 + 检查点

哪个?
