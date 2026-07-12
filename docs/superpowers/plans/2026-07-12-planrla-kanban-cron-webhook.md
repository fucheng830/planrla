# planrla 看板 W4-extras 实施计划:cron 定时任务 + webhook 通知

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps use checkbox (`- [ ]`)。

**Goal:** 给已交付的 kanban 自驱看板补两块自动化能力——① **cron 定时任务**:按 cron 表达式自动从模板建任务(如每天 9 点建"日报"任务);② **webhook 通知**:任务关键事件(建/完成/失败)推送到一个 webhook URL(复用 planrla 通知 orchestrator 的 channel 机制)。

**Architecture:** cron = `kanban_schedules` 表(SQLite,镜像 tasks DAO 模式)+ `node-cron` 驱动 + REST CRUD;启动时 `createKanbanCron` 载入所有 enabled schedule 注册到 node-cron,触发时调 `service.createTask`。webhook = 在 `notification-orchestrator` 加一路 `webhook` channel(`POST` 到 preferences 里的 URL),kanban 路由在 create/complete/fail 时调 `notifyUserIfEnabled`。

**Tech Stack:** Node + Express + better-sqlite3 + `node-cron`(新增 dep)+ 既有 notification-orchestrator + ws(W4 既有)。

**基于:** `docs/superpowers/specs/2026-07-11-planrla-kanban-iteration-design.md` 第 7 节(cron + webhook 是 W4 spec 剩余两项)+ W4 已交付的 store/service/routes/runner/MCP。

---

## 关键决策(基于摸底)

1. **cron 库 = `node-cron`**(无现成 cron 库,新增 dep。轻量、标准、支持 `*/5 * * * *` 等表达式)。`node-cron` 是纯 JS,无 native 依赖,`npm install` 不踩 better-sqlite3 那种 ABI 坑。
2. **schedules 表 + DAO 镜像 tasks 模式**:`kanban_schedules(id, root_id, task_template_id, cron_expression, enabled, input, last_run_at, created_at, updated_at)`,在 store 的 schema-apply 段加 `CREATE TABLE IF NOT EXISTS`。DAO:`createScheduleStore({db})` 提供 list/get/save/delete/updateLastRun。
3. **cron 驱动 = 启动时全量载入 + CRUD 时增量重载**。`createKanbanCron({scheduleStore, service, log})` 启动时 `listSchedules()` → 每个 enabled 用 `cron.schedule(expr, callback)` 注册;callback 调 `service.createTask({rootId, taskTemplateId, input})`。CRUD(save/delete)时 `reload()`(destroy all + re-register)。简单可靠,避免维护单条 diff。
4. **触发即 createTask** → 复用现有 service.createTask(已含 scheduler 触发 + WS 广播 + onTerminal worktree 清理)。所以定时建出的任务跟手动建的一样进自驱闭环。
5. **webhook 是 notification-orchestrator 的一路 channel**(镜像 webPush)。preferences 加 `channels.webhook.{enabled, url}`。`notifyUserIfEnabled` 遍历 enabled channels 时,webhook → `sendWebhook(url, event)`(`POST` JSON)。**不改 kanban 的事件广播**(WS 照旧),webhook 是并行的外部推送。
6. **kanban 触发通知的点 = REST 路由**(create / complete / cancel / fail)。这些路由有 `req.user.userId`。**MCP 路由(agent task_next)暂不通知**(pre-auth 无 userId;若需,后续从 task→project→owner 反查)。计划里标注为 follow-up。
7. **前端 UI 本 plan 不含**(schedules 管理对话框 / webhook 设置 UI)——后端 REST + 通知 channel 先行,前端 UI 留独立 plan(同 W4-前端 切分)。手动用 curl 或后续 UI 测。

## 关键接口(W4 已有,本 plan 依赖)

- `service.createTask({rootId, taskTemplateId, input})` → 触发 scheduler + 建任务。
- `notifyUserIfEnabled({userId, event})`(`notification-orchestrator.js:212`)→ 按用户 preferences 的 channels 推送。
- `createNotificationEvent({provider, sessionId, kind, code, meta, severity, requiresUserAction, dedupeKey})`(`:49`)→ 构造事件。
- store DAO 模式(`createTaskStore({db})` 返回 `{getTask, listTasks, createTask, ...}`)。
- kanban routes 挂在 `/api/tasks`(authenticateToken 后,`req.user.userId` 可用)。

## File Structure

| 文件 | 职责 |
|---|---|
| `server/modules/kanban/schedule-store.ts` | `kanban_schedules` 表 schema + DAO(list/get/save/delete/updateLastRun) |
| `server/modules/kanban/schedule-types.ts` | `KanbanSchedule` / `ScheduleRow` / rowToSchedule 类型 |
| `server/modules/kanban/cron-driver.ts` | `createKanbanCron`:`node-cron` 注册 + 触发 createTask + reload |
| `server/modules/kanban/tests/schedule-store.test.ts` | schedule DAO 单测 |
| `server/modules/kanban/tests/cron-driver.test.ts` | cron 驱动单测(注入 mock service + mock node-cron) |
| `server/modules/kanban/tests/schedule-routes.test.ts` | schedules REST CRUD(supertest) |
| `server/services/notification-orchestrator.js`(Modify) | 加 `sendWebhook` channel + `channels.webhook` 偏好读取 |
| `server/modules/kanban/kanban.routes.ts`(Modify) | 加 `/schedules*` CRUD 路由 + create/complete/cancel/fail 调 notifyUserIfEnabled |
| `server/modules/kanban/assembly.ts`(Modify) | 建 scheduleStore + createKanbanCron + 启动 + 注入 router |
| `package.json`(Modify) | 加 `node-cron` dep |

## 约定

- import `@/`=`server/` + `.js` 后缀;ESM;`node:test` + `node:assert/strict`;supertest。
- AppError:`new AppError(message, { code, statusCode })`。
- 测试 `npm run test:kanban`;typecheck `npx tsc --noEmit -p server/tsconfig.json`(≤300s)。
- commit conventional,尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 文件 ≤500 行。

---

## Task 1: 加 node-cron dep + schedule 类型 + schedule-store DAO

**Files:**
- Modify: `package.json`(加 `node-cron` dep + `@types/node-cron` devDep)
- Create: `server/modules/kanban/schedule-types.ts`
- Create: `server/modules/kanban/schedule-store.ts`
- Create: `server/modules/kanban/tests/schedule-store.test.ts`

### 步骤 0:Read `server/modules/kanban/store.ts` 的 schema-apply 段(约 line 249+,`CREATE TABLE IF NOT EXISTS tasks`)与 `createTaskStore` 的 DAO 返回模式,照搬。

### 步骤 1:加 dep
```bash
cd D:/workspace/projects/ai/apps/planrla
npm install node-cron @types/node-cron
```
(`node-cron` 是纯 JS 无 native;`@types/node-cron` 放 devDependencies。)

### 步骤 2:`schedule-types.ts`
```typescript
export interface KanbanSchedule {
  id: string;
  rootId: string;
  taskTemplateId: string;
  cronExpression: string;       // e.g. "0 9 * * *" (每天 9 点)
  enabled: boolean;
  input: string;                // 建任务时的 input(可为空)
  lastRunAt: string | null;     // ISO,上次触发时间
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleRow {
  id: string;
  root_id: string;
  task_template_id: string;
  cron_expression: string;
  enabled: number;              // 0/1
  input: string;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export function rowToSchedule(r: ScheduleRow): KanbanSchedule {
  return {
    id: r.id, rootId: r.root_id, taskTemplateId: r.task_template_id,
    cronExpression: r.cron_expression, enabled: !!r.enabled, input: r.input,
    lastRunAt: r.last_run_at, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
```

### 步骤 3:`schedule-store.ts`(schema + DAO)
```typescript
import type { Database } from 'better-sqlite3';
import type { KanbanSchedule, ScheduleRow } from './schedule-types.js';
import { rowToSchedule } from './schedule-types.js';

export interface ScheduleStoreDeps { db: Database; }

export interface ScheduleStore {
  listSchedules(rootId: string): KanbanSchedule[];
  listAllEnabledSchedules(): KanbanSchedule[];
  getSchedule(id: string): KanbanSchedule | null;
  saveSchedule(s: KanbanSchedule): KanbanSchedule;   // insert or update by id
  deleteSchedule(id: string): void;
  updateLastRun(id: string, at: string): void;
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS kanban_schedules (
  id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL,
  task_template_id TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  input TEXT NOT NULL DEFAULT '',
  last_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedules_root ON kanban_schedules(root_id);
CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON kanban_schedules(enabled);`;

export function createScheduleStore(deps: ScheduleStoreDeps): ScheduleStore {
  const { db } = deps;
  db.exec(SCHEMA);

  function listSchedules(rootId: string): KanbanSchedule[] {
    return (db.prepare('SELECT * FROM kanban_schedules WHERE root_id = ? ORDER BY created_at ASC').all(rootId) as ScheduleRow[]).map(rowToSchedule);
  }
  function listAllEnabledSchedules(): KanbanSchedule[] {
    return (db.prepare('SELECT * FROM kanban_schedules WHERE enabled = 1').all() as ScheduleRow[]).map(rowToSchedule);
  }
  function getSchedule(id: string): KanbanSchedule | null {
    const r = db.prepare('SELECT * FROM kanban_schedules WHERE id = ?').get(id) as ScheduleRow | undefined;
    return r ? rowToSchedule(r) : null;
  }
  function saveSchedule(s: KanbanSchedule): KanbanSchedule {
    const exists = !!db.prepare('SELECT 1 FROM kanban_schedules WHERE id = ?').get(s.id);
    if (exists) {
      db.prepare(`UPDATE kanban_schedules SET root_id=@rootId, task_template_id=@taskTemplateId, cron_expression=@cronExpression, enabled=@enabled, input=@input, updated_at=@updatedAt WHERE id=@id`)
        .run({ id: s.id, rootId: s.rootId, taskTemplateId: s.taskTemplateId, cronExpression: s.cronExpression, enabled: s.enabled ? 1 : 0, input: s.input, updatedAt: new Date().toISOString() });
    } else {
      db.prepare(`INSERT INTO kanban_schedules (id, root_id, task_template_id, cron_expression, enabled, input, last_run_at, created_at, updated_at) VALUES (@id,@rootId,@taskTemplateId,@cronExpression,@enabled,@input,@lastRunAt,@createdAt,@updatedAt)`)
        .run({ id: s.id, rootId: s.rootId, taskTemplateId: s.taskTemplateId, cronExpression: s.cronExpression, enabled: s.enabled ? 1 : 0, input: s.input, lastRunAt: s.lastRunAt, createdAt: s.createdAt, updatedAt: s.updatedAt });
    }
    return getSchedule(s.id)!;
  }
  function deleteSchedule(id: string): void { db.prepare('DELETE FROM kanban_schedules WHERE id = ?').run(id); }
  function updateLastRun(id: string, at: string): void { db.prepare('UPDATE kanban_schedules SET last_run_at = ?, updated_at = ? WHERE id = ?').run(at, at, id); }

  return { listSchedules, listAllEnabledSchedules, getSchedule, saveSchedule, deleteSchedule, updateLastRun };
}
```

### 步骤 4:测试 `tests/schedule-store.test.ts`(参照 `store.test.ts` 的 temp-db 模式)
```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { Database } from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScheduleStore } from '@/modules/kanban/schedule-store.js';

function db() { return new Database(join(tmpdir(), `sch-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)); }
const NOW = new Date().toISOString();
const base = { rootId: 'r1', taskTemplateId: 'tpl', cronExpression: '0 9 * * *', enabled: true, input: '', lastRunAt: null, createdAt: NOW, updatedAt: NOW };

test('save + get + list', () => {
  const s = createScheduleStore({ db: db() });
  const saved = s.saveSchedule({ ...base, id: 's1' });
  assert.equal(saved.id, 's1');
  assert.equal(s.getSchedule('s1')?.cronExpression, '0 9 * * *');
  assert.equal(s.listSchedules('r1').length, 1);
});

test('listAllEnabledSchedules only enabled', () => {
  const s = createScheduleStore({ db: db() });
  s.saveSchedule({ ...base, id: 's1', enabled: true });
  s.saveSchedule({ ...base, id: 's2', enabled: false });
  assert.equal(s.listAllEnabledSchedules().length, 1);
});

test('save updates existing (idempotent by id)', () => {
  const s = createScheduleStore({ db: db() });
  s.saveSchedule({ ...base, id: 's1', cronExpression: '0 9 * * *' });
  s.saveSchedule({ ...base, id: 's1', cronExpression: '*/5 * * * *' });
  assert.equal(s.listSchedules('r1').length, 1);
  assert.equal(s.getSchedule('s1')?.cronExpression, '*/5 * * * *');
});

test('delete + updateLastRun', () => {
  const s = createScheduleStore({ db: db() });
  s.saveSchedule({ ...base, id: 's1' });
  s.updateLastRun('s1', NOW);
  assert.equal(s.getSchedule('s1')?.lastRunAt, NOW);
  s.deleteSchedule('s1');
  assert.equal(s.getSchedule('s1'), null);
});
```

### 步骤 5:typecheck + 跑测试 + commit
```bash
npx tsc --noEmit -p server/tsconfig.json
npm run test:kanban
git -C D:/workspace/projects/ai/apps/planrla add package.json package-lock.json server/modules/kanban/schedule-types.ts server/modules/kanban/schedule-store.ts server/modules/kanban/tests/schedule-store.test.ts
git -C D:/workspace/projects/ai/apps/planrla commit -m "feat(kanban): add kanban_schedules store + node-cron dep" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: cron-driver(createKanbanCron)+ 单测

**Files:**
- Create: `server/modules/kanban/cron-driver.ts`
- Create: `server/modules/kanban/tests/cron-driver.test.ts`

### 步骤 1:`cron-driver.ts`
```typescript
import cron, { type ScheduledTask } from 'node-cron';
import type { ScheduleStore } from '@/modules/kanban/schedule-store.js';
import type { KanbanService } from '@/modules/kanban/service.js';

export interface CronDriverDeps {
  scheduleStore: ScheduleStore;
  service: KanbanService;
  log?: (msg: string) => void;
}

export interface KanbanCronDriver {
  /** Load all enabled schedules + register with node-cron. Call once on startup. */
  start(): void;
  /** Destroy all registered tasks + re-register from the store. Call after schedule CRUD. */
  reload(): void;
  /** Stop all scheduled tasks (e.g. on shutdown). */
  stop(): void;
}

export function createKanbanCron(deps: CronDriverDeps): KanbanCronDriver {
  const { scheduleStore, service, log = () => {} } = deps;
  const tasks = new Map<string, ScheduledTask>();

  function trigger(scheduleId: string, rootId: string, taskTemplateId: string, input: string): void {
    try {
      service.createTask({ rootId, taskTemplateId, input });
      scheduleStore.updateLastRun(scheduleId, new Date().toISOString());
      log(`[kanban-cron] triggered schedule=${scheduleId}`);
    } catch (e: any) {
      log(`[kanban-cron] trigger failed schedule=${scheduleId}: ${e?.message ?? e}`);
    }
  }

  function register(rootId: string, schedules: { id: string; taskTemplateId: string; cronExpression: string; input: string }[]): void {
    for (const s of schedules) {
      if (!cron.validate(s.cronExpression)) {
        log(`[kanban-cron] skip invalid expr schedule=${s.id} expr=${s.cronExpression}`);
        continue;
      }
      const task = cron.schedule(s.cronExpression, () => trigger(s.id, rootId, s.taskTemplateId, s.input));
      tasks.set(s.id, task);
      log(`[kanban-cron] registered schedule=${s.id} expr=${s.cronExpression}`);
    }
  }

  function start(): void {
    for (const s of scheduleStore.listAllEnabledSchedules()) {
      register(s.rootId, [{ id: s.id, taskTemplateId: s.taskTemplateId, cronExpression: s.cronExpression, input: s.input }]);
    }
  }

  function reload(): void {
    for (const t of tasks.values()) t.stop();
    tasks.clear();
    start();
  }

  function stop(): void {
    for (const t of tasks.values()) t.stop();
    tasks.clear();
  }

  return { start, reload, stop };
}
```

### 步骤 2:测试 `tests/cron-driver.test.ts`(mock node-cron + mock service)
```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { createKanbanCron } from '@/modules/kanban/cron-driver.js';

// mock node-cron: capture registered schedules + validate calls
function mockCron() {
  const registered: { expr: string; cb: () => void; stopped: boolean }[] = [];
  const cronMod: any = {
    schedule: (expr: string, cb: () => void) => { const r = { expr, cb, stopped: false }; registered.push(r); return { stop: () => { r.stopped = true; } }; },
    validate: (expr: string) => /^[0-9*/ ]+$/.test(expr),  // permissive for test
  };
  return { cronMod, registered };
}

test('start registers all enabled schedules; trigger calls service.createTask + updateLastRun', () => {
  const { cronMod, registered } = mockCron();
  const created: { rootId: string; taskTemplateId: string; input: string }[] = [];
  const lastRuns: string[] = [];
  const scheduleStore = {
    listAllEnabledSchedules: () => [{ id: 's1', rootId: 'r1', taskTemplateId: 'tpl', cronExpression: '0 9 * * *', input: 'morning', enabled: true }],
    updateLastRun: (id: string, at: string) => { lastRuns.push(id); assert.equal(id, 's1'); },
  } as any;
  const service = { createTask: (args: any) => { created.push(args); return { id: 'task-1' }; } } as any;

  // inject the mocked cron module — use the factory's internal import override via rewire? 
  // Node ESM doesn't allow runtime import override; instead test trigger() directly.
  // Simpler: test that trigger path works by calling the registered callback.
  // ... (see note below)
});
```
⚠️ node-cron 是直接 import 的,ESM 无法运行时替换。**改测法**:把 `cron.schedule` 调用抽成可注入。重设 `cron-driver.ts` 让 `cron` 模块通过 deps 注入(`deps.cron?` 默认用真 node-cron):

修订 `cron-driver.ts` 的 `CronDriverDeps` 加 `cron?: typeof import('node-cron')`,默认用真的;测试传 mock cron。回调触发后断言 service.createTask 被调 + updateLastRun 被调。再测 `reload()`(stop all + re-register)。implementer 按"可注入 cron 模块"写,测试注入 mock。测试要点:
- start → 注册 N 个(enabled 数量)。
- 手动触发已注册的 callback → service.createTask({rootId, taskTemplateId, input}) 被调 + scheduleStore.updateLastRun 被调。
- reload → 之前的 task.stop() 被调 + 重新注册。
- 无效 cron 表达式 → 跳过(skip,不注册)。

### 步骤 3:typecheck + 测试 + commit
```bash
npx tsc --noEmit -p server/tsconfig.json
npm run test:kanban
git -C D:/workspace/projects/ai/apps/planrla add server/modules/kanban/cron-driver.ts server/modules/kanban/tests/cron-driver.test.ts
git -C D:/workspace/projects/ai/apps/planrla commit -m "feat(kanban): add createKanbanCron driver (node-cron)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: schedules REST 路由 + kanban 路由触发 webhook 通知

**Files:**
- Modify: `server/modules/kanban/kanban.routes.ts`(加 `/schedules*` CRUD + create/complete/cancel/fail 调 notifyUserIfEnabled)
- Modify: `server/modules/kanban/tests/schedule-routes.test.ts`(Create)

### 步骤 1:`kanban.routes.ts` 加 scheduleStore + cron 依赖 + schedules 路由
- deps 加 `scheduleStore: ScheduleStore` + `cronDriver: { reload: () => void }`。
- 加路由(放在 `/templates*` 之后、`/:taskId` 之前,避免路由冲突):
```typescript
router.get('/schedules', (req, res) => {
  const rootId = String(req.query.rootId ?? '');
  if (!rootId) return res.status(400).json({ message: 'rootId required' });
  res.json({ schedules: scheduleStore.listSchedules(rootId) });
});
router.post('/schedules', (req, res) => {
  try {
    const sch = scheduleStore.saveSchedule(req.body);
    cronDriver.reload();
    res.json({ schedule: sch });
  } catch (e: any) { res.status(400).json({ message: e?.message ?? 'invalid schedule' }); }
});
router.delete('/schedules/:id', (req, res) => {
  scheduleStore.deleteSchedule(req.params.id);
  cronDriver.reload();
  res.json({ ok: true });
});
```
- 在 createTask(POST `/`)、complete/cancel/fail(handleMove 的对应 action)成功后加通知:
```typescript
import { notifyUserIfEnabled, createNotificationEvent } from '@/services/notification-orchestrator.js';
// after createTask:
notifyUserIfEnabled({ userId: req.user.userId, event: createNotificationEvent({ provider: 'kanban', sessionId: task.id, kind: 'task_created', code: 'kanban.task.created', meta: { taskNumber: task.taskNumber, rootId }, severity: 'info' }) });
// after complete/cancel/fail in handleMove similarly (kind: task_completed/task_cancelled/task_failed)
```
(Read `notification-orchestrator.js` 确认 `createNotificationEvent` 的必填字段 + `normalizeNotificationSession` 是否需要。`req.user.userId` 来自 authenticateToken。)

### 步骤 2:测试 `tests/schedule-routes.test.ts`(supertest,参照 `template-routes.test.ts`)
- GET `/api/tasks/schedules?rootId=r1` → 200 + schedules 数组。
- POST `/api/tasks/schedules` body=`{id,rootId,taskTemplateId,cronExpression,enabled,input...}` → 200 + schedule;再 GET 看落盘。
- DELETE `/api/tasks/schedules/:id` → 200;再 GET 404/空。
- POST 无效 cron(如 `"not-a-cron"`)→ driver 跳过(不 throw),路由仍 200(因为 save 不校验 cron,校验在 driver;或路由加 `cron.validate` 提前 400——**推荐路由加校验**:`if (!cron.validate(sch.cronExpression)) return 400`,这样无效表达式进不了库。implementer 决定,加校验更稳)。

### 步骤 3:typecheck + 测试 + commit
```bash
npx tsc --noEmit -p server/tsconfig.json
npm run test:kanban
git -C D:/workspace/projects/ai/apps/planrla add server/modules/kanban/kanban.routes.ts server/modules/kanban/tests/schedule-routes.test.ts
git -C D:/workspace/projects/ai/apps/planrla commit -m "feat(kanban): add schedule CRUD routes + task event notifications" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: webhook channel(通知 orchestrator)

**Files:**
- Modify: `server/services/notification-orchestrator.js`(加 sendWebhook + channels.webhook)
- Modify: `server/modules/kanban/tests/cron-driver.test.ts` 或新建 `tests/notification-webhook.test.ts`

### 步骤 1:Read `notification-orchestrator.js`
- `notifyUserIfEnabled`(`:212`):看它怎么读 preferences + 遍历 channels(找 webPush 那段 `preferences?.channels?.webPush`)。
- `createNotificationEvent`(`:49`):确认事件结构。
- 找 webPush 发送的实现(`sendWebPush`? 或 web-push 库调用)——webhook 镜像它。

### 步骤 2:加 webhook channel
- 加 `sendWebhook(url, event)`:`node-fetch`(已是 dep)或全局 `fetch`(Node 18+ 内置,planrla Node 24,用内置 fetch)`POST` JSON 到 url,best-effort(catch 不抛)。
- 在 `notifyUserIfEnabled` 的 channel 遍历段,加:
```javascript
const webhookCfg = preferences?.channels?.webhook;
if (webhookCfg?.enabled && webhookCfg?.url) {
  sendWebhook(webhookCfg.url, event).catch(() => {});  // best-effort, 不阻塞
}
```
- preferences 结构:`channels.webhook = { enabled: boolean, url: string }`。preferences 表/存储——Read 看 planrla 怎么存 preferences(可能是 user_preferences 表或 settings)。在对应处加 webhook 默认 `{enabled:false, url:''}`。

### 步骤 3:测试 webhook
- 单测 `sendWebhook`:mock fetch(或用一个本地 http server 接收)→ 断言 POST 到 url + body 是 event。best-effort(URL 不通时不抛)。
- 集成:`notifyUserIfEnabled({userId, event})` with webhook enabled → sendWebhook 被调。

### 步骤 4:typecheck + 测试 + commit
```bash
npx tsc --noEmit -p server/tsconfig.json
npm run test:kanban
git -C D:/workspace/projects/ai/apps/planrla add server/services/notification-orchestrator.js server/modules/kanban/tests/notification-webhook.test.ts
git -C D:/workspace/projects/ai/apps/planrla commit -m "feat(notify): add webhook notification channel" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: assembly 接线 + 集成测试 + 前端 api client

**Files:**
- Modify: `server/modules/kanban/assembly.ts`(建 scheduleStore + createKanbanCron + start + 注入 router)
- Modify: `server/modules/kanban/tests/w4-extras-integration.test.ts`(Create)
- Modify: `src/components/kanban/api.ts`(加 `kanbanApi.listSchedules/saveSchedule/deleteSchedule`)+ `src/components/kanban/types.ts`(加 KanbanSchedule 类型)

### 步骤 1:`assembly.ts` 接线
- 建 `scheduleStore = createScheduleStore({ db })`。
- 建 `cronDriver = createKanbanCron({ scheduleStore, service, log })`。
- `cronDriver.start()`(启动时注册所有 schedule)。
- `createKanbanRouter({ service, templateStore, scheduler, scheduleStore, cronDriver })`。
- getKanban() 返回加 `scheduleStore, cronDriver`。
- 注意:getKanban 是懒初始化(首次 /api/tasks 请求时);cronDriver.start() 在那时跑——OK(schedule 不多,即时注册无碍)。或在 server.listen 后显式调——懒即可。

### 步骤 2:集成测试 `w4-extras-integration.test.ts`
- 建 store + service + scheduleStore + cronDriver(mock cron,或用 `cron.validate` + 不真等触发)。
- 保存一个 schedule(enabled, expr)→ cronDriver.start() → 断言 mock cron 注册了它。
- 模拟触发(调注册的 callback)→ service.createTask 被调 → 任务出现在 listTasks。
- reload():保存新 schedule → reload → mock cron 重新注册(新数量)。

### 步骤 3:前端 api client
- `api.ts` 加:`listSchedules(rootId)` / `saveSchedule(sch)` / `deleteSchedule(id)`(镜像 templates 的 api 方法)。
- `types.ts` 加 `KanbanSchedule` 接口(镜像后端)。
- (前端 schedules UI 留独立 plan,这里只加 api 客户端,方便后续 UI 或手动 curl。)

### 步骤 4:typecheck(server + 前端)+ build + commit
```bash
npx tsc --noEmit -p server/tsconfig.json
npx tsc --noEmit -p tsconfig.json
npm run test:kanban
git -C D:/workspace/projects/ai/apps/planrla add server/modules/kanban/assembly.ts server/modules/kanban/tests/w4-extras-integration.test.ts src/components/kanban/api.ts src/components/kanban/types.ts
git -C D:/workspace/projects/ai/apps/planrla commit -m "feat(kanban): wire cron driver + schedules in assembly + frontend api client" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## W4-extras 完成标准

- `kanban_schedules` 表 + DAO(增删改查 + listAllEnabled)。
- `createKanbanCron` 驱动:启动注册 + CRUD reload + 触发 createTask。
- schedules REST 路由(`/api/tasks/schedules*`)。
- webhook 通知 channel(notification-orchestrator一路 `channels.webhook`)。
- kanban create/complete/cancel/fail 触发 notifyUserIfEnabled。
- 前端 api client(listSchedules/saveSchedule/deleteSchedule)+ KanbanSchedule 类型。
- `npm run test:kanban` 全绿(W4 既有 + schedule ~4 + cron ~4 + schedule-routes ~4 + webhook ~2 + 集成 ~2 = ~+16)。
- typecheck(server + 前端)0。
- **不含(留独立 plan)**:前端 schedules 管理 UI 对话框、webhook 设置 UI、MCP 路由(agent task_next)触发通知(需 userId 反查)。

## Self-Review

- **Spec coverage**:spec 第 7 节 cron(schedules + node-cron 驱动 ✓ Task 1-3、5)+ webhook(notification channel ✓ Task 4)。✓
- **Placeholder scan**:Task 2 的 cron-driver 测试我标了 ESM 无法运行时替换 node-cron 的问题 + 给了"deps 注入 cron 模块"的解法(implementer 按 deps.cron 注入写 + 测试传 mock)。其余代码块完整。无 "TODO"。
- **Type 一致性**:`KanbanSchedule`(schedule-types.ts)在 schedule-store / cron-driver / routes / api client 全用同名;`createKanbanCron` 的 `CronDriverDeps`(scheduleStore + service)在 assembly 一致;`notifyUserIfEnabled({userId, event})` 签名对齐 orchestrator。
- **复用**:cron 触发调 `service.createTask` → 复用 W4 的 scheduler + runner + worktree + onTerminal 清理(定时建的任务跟手动的一样进自驱闭环)。webhook 复用 notification-orchestrator 的 channel 机制(镜像 webPush)。
- **不确定性**:notification-orchestrator 的 preferences 存储位置(Task 4 步骤 1 Read 确认)、createNotificationEvent 的必填字段(Read 确认)、node-cron 的 ESM default export 形式(Task 2 步骤 1 `import cron, { ScheduledTask } from 'node-cron'`——若该版本 export 形态不同,implementer 按 @types/node-cron 调整)。都给了 Read 指令。
- **风险**:node-cron 在 Electron/Node 进程的定时器在 dev 重启时清掉(getKanban 懒初始化,每次 server 重启重新 start)——符合预期。生产长期跑需确认 server 进程常驻(planrla 是)。
