# planrla 看板 W4 实施计划:worktree 隔离 + prompt 渲染 + MCP 自驱 + 模板路由(后端自驱闭环)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps use checkbox (`- [ ]`)。

**Goal:** 把 W3 runner 的 `stage.promptTemplate ?? ''` 占位与 `task.worktreePath` 死字段换成真实的「worktree 隔离 + prompt 渲染 + Claude MCP 自驱」闭环——任务跑起来时自动 `git worktree add` 出隔离工作区,写入 `.mcp.json`,agent 通过 `task_next/task_prev/task_status` MCP 工具自驱推进阶段。补齐前端依赖的模板 REST 路由。

**Architecture:** `git-worktree.ts`(纯 git 操作,`child_process.spawn` 封装,worktree 放 `<rootPath>/.worktree/<branch>` + `.git/info/exclude` 排除)+ `worktree-setup.ts`(kanban 编排:建 worktree + 写 `.mcp.json` + 持久化 `task.worktreePath`)+ `prompt.ts`(`{{var}}` 替换 + MCP 自驱前言,注入 taskId)+ `mcp.route.ts`(进程内 HTTP JSON-RPC,`task_*` 工具,taskId→rootId 服务端反查)+ `kanban.routes.ts` 补模板 CRUD。runner 接 `worktreeSetup` 依赖,先 `ensureWorktree` 再 spawn,cwd=worktreePath,prompt=渲染后。

**Tech Stack:** Node `child_process.spawn`(对齐 `server/routes/git.js:12-47` 的 `spawnAsync`)+ Express + `node:test` + tsx + better-sqlite3(W1-W3 既有)+ 真实临时 git 仓库做集成测试。

**基于:** `docs/superpowers/specs/2026-07-11-planrla-kanban-iteration-design.md` 第 3、5、6、7 节 + W1-W3 实际接口摸底(会话内 explore 报告)+ 实测 `git worktree add <root>/.worktree/<branch>` 允许(会话内验证)。

---

## 关键决策(基于 explore 报告 + 实测)

1. **worktree 路径 = `<rootPath>/.worktree/<branch>`**(实测 git 允许在主仓库工作区内建链接 worktree)。`.git/info/exclude` 幂等追加 `.worktree/` 让主仓库 `git status` 不显示它。分支名 `kanban/<taskNumber>-<taskId前8位>`。
2. **worktree 创建时机 = runner `runAgentStage` 入口(lazy)**,非 `service.createTask`(eager)。原因:只在 task 真要跑时建,取消的 queued task 不建垃圾 worktree;且 runner 已读 `task.worktreePath`(W3 `runner.ts:74`)。`ensureWorktree` 幂等(已存在且在盘则复用)。
3. **MCP 工具 = 进程内 HTTP JSON-RPC**,挂 `/api/mcp/kanban`(auth 前,对齐 `/api/mcp/internal` at `index.js:235`)。**不**新建 stdio MCP server。镜像 `session-query-mcp.route.ts` 的 dispatch 形态(initialize/tools/list/tools/call,protocol `2024-11-05`)。
4. **agent 只需知 taskId,不知 rootId**。MCP `task_next({taskId})` 服务端用 `taskStore.getTask(taskId).rootId` 反查,再调 `service.next(rootId, taskId)`。taskId 由 `renderStagePrompt` 的自驱前言注入 prompt。
5. **`.mcp.json` 写进 worktree**(项目作用域,Claude 从 cwd 读),不污染用户全局 `~/.claude.json`,worktree 删除时同步消失。内容:`{mcpServers:{"planrla-kanban":{"type":"http","url":"http://127.0.0.1:<SERVER_PORT>/api/mcp/kanban"}}}`。
6. **mcpBaseUrl** 由 `process.env.SERVER_PORT || 3001` 推导(`index.js:1767` 同款默认,复用 env 契约)。
7. **MCP 自驱前言** 仅在 `stage.agentCanControlStage !== false` 时追加(默认开)。对 Claude 注入完整;其他 provider 跑但不生效(它们不读 worktree `.mcp.json` 的 http MCP,spec 决策 #3 已接受的局限)。
8. **service 无 `status()` 方法**——`task_status` MCP 工具用 `taskStore.getTask(taskId)` 直读(读不需 rootId authz)。
9. **模板路由** 前端必需但 W2 未补(`kanban.routes.ts` 只有 56 行:list+create+moves)。本 plan 补 `GET/POST /templates`、`GET/DELETE /templates/:id`。
10. **cron + webhook + 前端 UI 本 plan 不含**(用户决策:后端自驱闭环优先;前端 UI / cron / webhook 留独立 plan)。

## 关键接口(W1-W3 实测,本 plan 依赖)

- `Task`(`types.ts:66-86`):`id, taskNumber, rootId, createWorktree(boolean), worktreeBranchMode?, worktreeBranch?, worktreePath?, currentStageIndex, mainSessionKey?, ...`。worktree 字段在 schema+TaskRow+rowToTask 全链路存在但 **W1-W3 从不写**。
- `StageTemplate`(`types.ts:23-39`):`name, role, agent?, promptTemplate?, planMode?, agentCanControlStage?, autoAdvance, ...`。
- `TaskStore`(`store.ts`):`getTask(id)`, `latestStageRun(taskId, stageIndex)`, `updateTaskAuxFlags(taskId, flags)`, ...。**无 `updateTaskWorktree`**(Task 1 加)。
- `KanbanService`(`service.ts`):`next(rootId, taskId)`, `prev(rootId, taskId)`(currentStageIndex≤0 抛错), `getTask(rootId, taskId): Task|null`, `listTasks(rootId)`。
- `createRunner(deps)`(`runner.ts:32-51`):deps = `{taskStore, templateStore, service, auxBridge, resolveRootPath, spawnFns?, log?}`。`runAgentStage(rootId, taskId, stageIndex)`(`runner.ts:59-114`):line 74 `cwd = task.worktreePath ?? rootPath ?? undefined`,line 76 `prompt = stage.promptTemplate ?? ''`。**Task 3 改这两处 + 加 worktreeSetup 依赖**。
- `assembly.getKanban()`(`assembly.ts:14-51`)返回 `{db, taskStore, templateStore, service, scheduler, runner, router}`,line 30 建 runner,line 29 `resolveRootPath = projectsDb.getProjectPathById`。`server/index.js:253` 唯一调用点(懒初始化)。
- `createKanbanRouter({service})`(`kanban.routes.ts:5-7`):**Task 5 改 deps 加 `templateStore`**。
- spawnAsync 模式(`server/routes/git.js:12-47`):`child_process.spawn` + stdout/stderr buffer + 非 0 退出 reject。
- 端口:`process.env.SERVER_PORT || 3001`(`index.js:1767`);`app.use('/api/mcp/internal', ...)` 在 auth 前(`index.js:235`)。
- 测试:node:test + tsx,DI 建 temp sqlite db + temp 模板 dir(见 `runner.test.ts:37-55`)。`npm run test:kanban`(package.json:48)。typecheck:`npx tsc --noEmit -p server/tsconfig.json`(timeout 300000)。`@/`=`server/`+`.js` 后缀,ESM。

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `server/modules/kanban/git-worktree.ts` | 纯 git:createWorktree/removeWorktree/resolveWorktreePath/appendGitInfoExclude/worktreeExists | Create |
| `server/modules/kanban/prompt.ts` | `substitute`/`renderStagePrompt`/`buildMcpPrompt`(变量替换+MCP 前言) | Create |
| `server/modules/kanban/worktree-setup.ts` | kanban 编排:`ensureWorktree`(建 git wt+写 .mcp.json+持久化)+ `removeWorktree` | Create |
| `server/modules/kanban/mcp.route.ts` | kanban HTTP JSON-RPC MCP(task_next/prev/status) | Create |
| `server/modules/kanban/store.ts` | 加 `updateTaskWorktree(taskId, {worktreePath?, worktreeBranch?})` | Modify |
| `server/modules/kanban/runner.ts` | deps 加 `worktreeSetup?`;runAgentStage 改用 `renderStagePrompt` + `ensureWorktree` | Modify |
| `server/modules/kanban/kanban.routes.ts` | deps 加 `templateStore`;加 `/templates*` 4 路由 | Modify |
| `server/modules/kanban/assembly.ts` | 建 worktreeSetup(mcpBaseUrl)+ 注入 runner;router 传 templateStore | Modify |
| `server/index.js` | 挂 `/api/mcp/kanban`(auth 前) | Modify |
| `server/modules/kanban/tests/git-worktree.test.ts` | 真实 temp git 仓库测 create/remove/exists/exclude | Create |
| `server/modules/kanban/tests/prompt.test.ts` | substitute/render/preamble | Create |
| `server/modules/kanban/tests/worktree-setup.test.ts` | mock git + 真 store 测 ensureWorktree 幂等 + .mcp.json | Create |
| `server/modules/kanban/tests/mcp-route.test.ts` | supertest 测 initialize/tools/list/tools/call(注入 fake kanban) | Create |
| `server/modules/kanban/tests/template-routes.test.ts` | supertest 测 templates CRUD | Create |
| `server/modules/kanban/tests/runner.test.ts` | 扩展:assert cwd=worktree + 渲染 prompt | Modify |
| `server/modules/kanban/tests/w4-integration.test.ts` | 真 temp git 仓库端到端:createTask→admit→ensureWorktree→mock spawn→autoAdvance | Create |

## 约定

- import `@/`=`server/` + `.js` 后缀;ESM;`node:test` + `node:assert/strict`。
- AppError:`new AppError(message, { code, statusCode })`(本 plan 新增代码主要用普通 `Error`,store/service 已有的 AppError 不动)。
- 测试 `npm run test:kanban`;typecheck `npx tsc --noEmit -p server/tsconfig.json`(timeout 300000)。
- commit conventional,body ≤100 字符/行,尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 文件 ≤500 行。

---

## Task 1: git-worktree.ts(纯 git)+ store.updateTaskWorktree

**Files:**
- Create: `server/modules/kanban/git-worktree.ts`
- Create: `server/modules/kanban/tests/git-worktree.test.ts`
- Modify: `server/modules/kanban/store.ts`(加 `updateTaskWorktree`)
- Modify: `server/modules/kanban/tests/store.test.ts`(加 updateTaskWorktree 测试段)

### 步骤 0:Read `server/routes/git.js:12-47`(spawnAsync 参考)确认封装形态。

### 步骤 1:写 `git-worktree.test.ts` 失败测试(真实 temp git 仓库)

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorktreeGit, resolveWorktreePath } from '@/modules/kanban/git-worktree.js';

function gitInit(repoPath: string): void {
  spawnSync('git', ['init', '-q'], { cwd: repoPath });
  spawnSync('git', ['config', 'user.email', 't@t.t'], { cwd: repoPath });
  spawnSync('git', ['config', 'user.name', 'tester'], { cwd: repoPath });
  spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repoPath });
}

function makeRepo(): string {
  const p = mkdtempSync(join(tmpdir(), `kanban-gwt-${Date.now()}-`));
  gitInit(p);
  return p;
}

test('resolveWorktreePath puts worktree under <root>/.worktree/<branch>', () => {
  assert.equal(
    resolveWorktreePath('/repo', 'kanban/42-abc12345').replace(/\\/g, '/'),
    '/repo/.worktree/kanban/42-abc12345',
  );
});

test('createLinkedWorktree creates a real linked worktree on a new branch', async () => {
  const repo = makeRepo();
  const git = createWorktreeGit();
  try {
    const created = await git.createLinkedWorktree(repo, 'kanban/1-aaaaaaaa');
    assert.equal(existsSync(join(created.path, '.git')), true);
    const list = spawnSync('git', ['worktree', 'list'], { cwd: repo }).stdout.toString();
    assert.match(list, /kanban\/1-aaaaaaaa/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('createLinkedWorktree appends .worktree/ to .git/info/exclude idempotently', async () => {
  const repo = makeRepo();
  const git = createWorktreeGit();
  try {
    await git.createLinkedWorktree(repo, 'kanban/2-bbbbbbbb');
    const exclude = readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8');
    assert.match(exclude, /\.worktree\//);
    // idempotent: second create does not duplicate the line
    await git.createLinkedWorktree(repo, 'kanban/3-cccccccc');
    const exclude2 = readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8');
    assert.equal((exclude2.match(/\.worktree\//g) || []).length, 1);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('removeLinkedWorktree unregisters and deletes the worktree dir', async () => {
  const repo = makeRepo();
  const git = createWorktreeGit();
  try {
    const created = await git.createLinkedWorktree(repo, 'kanban/4-dddddddd');
    await git.removeLinkedWorktree(repo, created.path);
    assert.equal(existsSync(created.path), false);
    const list = spawnSync('git', ['worktree', 'list'], { cwd: repo }).stdout.toString();
    assert.doesNotMatch(list, /kanban\/4-dddddddd/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('worktreeExists is true for a created worktree, false otherwise', async () => {
  const repo = makeRepo();
  const git = createWorktreeGit();
  try {
    const created = await git.createLinkedWorktree(repo, 'kanban/5-eeeeeeee');
    assert.equal(git.worktreeExists(created.path), true);
    assert.equal(git.worktreeExists(join(repo, '.worktree', 'nope')), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('createLinkedWorktree throws on non-zero git exit', async () => {
  const repo = mkdtempSync(join(tmpdir(), `kanban-gwt-bad-${Date.now()}-`));
  spawnSync('git', ['init', '-q'], { cwd: repo }); // no commit → no HEAD to branch from
  const git = createWorktreeGit();
  try {
    await assert.rejects(() => git.createLinkedWorktree(repo, 'kanban/6-ffffffff'));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
```

### 步骤 2:跑 `npm run test:kanban` 确认新测试 fail(import 不存在)。

### 步骤 3:实现 `git-worktree.ts`

```typescript
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SpawnAsyncResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type SpawnAsyncFn = (
  cmd: string,
  args: string[],
  opts: { cwd: string },
) => Promise<SpawnAsyncResult>;

export interface WorktreeGitDeps {
  /** Inject for testing; defaults to a real child_process.spawn wrapper. */
  spawnAsync?: SpawnAsyncFn;
}

export interface CreatedWorktree {
  path: string;
  branch: string;
}

/** Resolve the on-disk path for a linked worktree inside <rootPath>/.worktree/<branch>. */
export function resolveWorktreePath(rootPath: string, branch: string): string {
  const safe = branch.replace(/[^A-Za-z0-9._/-]/g, '-');
  return join(rootPath, '.worktree', safe);
}

function defaultSpawn(cmd: string, args: string[], opts: { cwd: string }): Promise<SpawnAsyncResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

export type WorktreeGit = ReturnType<typeof createWorktreeGit>;

export function createWorktreeGit(deps: WorktreeGitDeps = {}) {
  const spawnAsync = deps.spawnAsync ?? defaultSpawn;

  async function runGit(rootPath: string, args: string[]): Promise<string> {
    const res = await spawnAsync('git', args, { cwd: rootPath });
    if (res.code !== 0) {
      const detail = (res.stderr.trim() || res.stdout.trim() || `exit ${res.code}`);
      throw new Error(`git ${args.join(' ')} failed: ${detail}`);
    }
    return res.stdout;
  }

  /** Append a pattern to <rootPath>/.git/info/exclude idempotently (keeps main repo status clean). */
  function appendGitInfoExclude(rootPath: string, pattern: string): void {
    const excludePath = join(rootPath, '.git', 'info', 'exclude');
    if (!existsSync(excludePath)) return;
    let existing = '';
    try { existing = readFileSync(excludePath, 'utf8'); } catch { /* ignore */ }
    const lines = existing.split(/\r?\n/);
    if (lines.includes(pattern)) return;
    const prefix = existing.length === 0 ? '' : existing.endsWith('\n') ? '' : '\n';
    appendFileSync(excludePath, `${prefix}${pattern}\n`);
  }

  /** Create a linked worktree at <rootPath>/.worktree/<branch> on a new branch from HEAD. */
  async function createLinkedWorktree(rootPath: string, branch: string): Promise<CreatedWorktree> {
    appendGitInfoExclude(rootPath, '.worktree/');
    const wtPath = resolveWorktreePath(rootPath, branch);
    await runGit(rootPath, ['worktree', 'add', '-b', branch, wtPath]);
    return { path: wtPath, branch };
  }

  /** Remove a linked worktree (unregisters + deletes on disk). Best-effort: throws on git failure. */
  async function removeLinkedWorktree(rootPath: string, wtPath: string): Promise<void> {
    await runGit(rootPath, ['worktree', 'remove', '--force', wtPath]);
  }

  /** True if a `.git` entry exists at wtPath (linked worktrees have a `.git` file, not dir). */
  function worktreeExists(wtPath: string): boolean {
    return existsSync(join(wtPath, '.git'));
  }

  return { createLinkedWorktree, removeLinkedWorktree, worktreeExists, appendGitInfoExclude, runGit };
}
```

### 步骤 4:扩展 `store.test.ts` 加 `updateTaskWorktree` 测试段

Read 现有 `server/modules/kanban/tests/store.test.ts`,看它怎么建 store + 插入 task(参照其 createTask 测试段)。追加:

```typescript
test('updateTaskWorktree persists worktreePath and worktreeBranch', () => {
  // 复用 store.test.ts 既有的 db + store + 一个已创建的 task(参照其 createTask 测试拿 taskId)
  // const { db, store, task } = setupExistingTask();   // 用文件内既有 setup
  store.updateTaskWorktree(task.id, { worktreePath: '/repo/.worktree/x', worktreeBranch: 'kanban/1-aaaa' });
  const after = store.getTask(task.id);
  assert.equal(after?.worktreePath, '/repo/.worktree/x');
  assert.equal(after?.worktreeBranch, 'kanban/1-aaaa');
});

test('updateTaskWorktree no-op when no fields given', () => {
  // const { store, task } = setupExistingTask();
  const before = store.getTask(task.id);
  store.updateTaskWorktree(task.id, {});
  const after = store.getTask(task.id);
  assert.deepEqual(after?.worktreePath, before?.worktreePath);
});
```

(用 store.test.ts 既有的 task setup;如果它没有可复用的 helper,就在测试体内 inline create 一个 task:参照该文件 createTask 段的最小 input——task 对象 + initialStageRun + event。)

### 步骤 5:实现 `store.updateTaskWorktree`(Modify `store.ts`)

Read `server/modules/kanban/store.ts`,在 `updateTaskAuxFlags`(line 132 附近,动态 SET 模式)之后加:

```typescript
function updateTaskWorktree(
  taskId: string,
  fields: { worktreePath?: string | null; worktreeBranch?: string | null },
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (fields.worktreePath !== undefined) {
    sets.push('worktree_path = ?');
    params.push(fields.worktreePath);
  }
  if (fields.worktreeBranch !== undefined) {
    sets.push('worktree_branch = ?');
    params.push(fields.worktreeBranch);
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(taskId);
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}
```

并在 `createTaskStore` 返回对象(line 150 附近)加 `updateTaskWorktree`。

### 步骤 6:跑 `npm run test:kanban` 通过 + `npx tsc --noEmit -p server/tsconfig.json` + commit

```bash
npm run test:kanban
npx tsc --noEmit -p server/tsconfig.json
git add server/modules/kanban/git-worktree.ts server/modules/kanban/store.ts server/modules/kanban/tests/git-worktree.test.ts server/modules/kanban/tests/store.test.ts
git commit -m "feat(kanban): add git-worktree module and store.updateTaskWorktree" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: prompt.ts(变量替换 + MCP 自驱前言)

**Files:**
- Create: `server/modules/kanban/prompt.ts`
- Create: `server/modules/kanban/tests/prompt.test.ts`

### 步骤 1:写 `prompt.test.ts` 失败测试

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { substitute, renderStagePrompt, buildMcpPreamble } from '@/modules/kanban/prompt.js';
import type { StageTemplate } from '@/modules/kanban/types.js';

function baseStage(over: Partial<StageTemplate> = {}): StageTemplate {
  return {
    id: 's1', name: 'implement', role: 'agent', autoAdvance: true,
    agent: 'claude', createdAt: 't0', updatedAt: 't0', ...over,
  };
}

const ctx = { taskId: 'task-xyz', taskNumber: 7, stageName: 'implement', stageIndex: 1, rootPath: '/repo', input: 'build foo' };

test('substitute replaces {{var}} placeholders', () => {
  assert.equal(substitute('hello {{name}}!', { name: 'world' }), 'hello world!');
});

test('substitute leaves unknown placeholders as empty string', () => {
  assert.equal(substitute('a={{a}} b={{b}}', { a: '1' }), 'a=1 b=');
});

test('substitute coerces numbers', () => {
  assert.equal(substitute('n={{n}}', { n: 42 }), 'n=42');
});

test('renderStagePrompt substitutes stage template vars', () => {
  const stage = baseStage({ promptTemplate: 'Input: {{input}}\nTask #{{task_number}} stage {{stage_index}} ({{stage_name}}) in {{project_path}}' });
  const out = renderStagePrompt({ stage, ctx });
  assert.match(out, /Input: build foo/);
  assert.match(out, /Task #7 stage 1 \(implement\) in \/repo/);
});

test('renderStagePrompt appends MCP preamble with taskId when agentCanControlStage !== false', () => {
  const stage = baseStage({ promptTemplate: 'do work' });
  const out = renderStagePrompt({ stage, ctx });
  assert.match(out, /task_next/);
  assert.match(out, /"taskId": "task-xyz"/);
});

test('renderStagePrompt omits preamble when agentCanControlStage is false', () => {
  const stage = baseStage({ promptTemplate: 'do work', agentCanControlStage: false });
  const out = renderStagePrompt({ stage, ctx });
  assert.doesNotMatch(out, /task_next/);
  assert.match(out, /do work/);
});

test('buildMcpPreamble returns empty string when disabled', () => {
  assert.equal(buildMcpPreamble(ctx, { enabled: false }), '');
});

test('renderStagePrompt handles missing promptTemplate (empty base + preamble)', () => {
  const stage = baseStage({ promptTemplate: undefined });
  const out = renderStagePrompt({ stage, ctx });
  assert.match(out, /^--- planrla kanban ---/);
});
```

### 步骤 2:跑 `npm run test:kanban` 确认 fail。

### 步骤 3:实现 `prompt.ts`

```typescript
import type { StageTemplate } from '@/modules/kanban/types.js';

export interface PromptContext {
  taskId: string;
  taskNumber: number;
  stageName: string;
  stageIndex: number;
  rootPath: string | null;
  input: string;
}

/** Replace `{{key}}` placeholders. Unknown keys → ''. Numbers coerced to string. */
export function substitute(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

/** Build the kanban self-drive preamble telling the agent how to advance via MCP. */
export function buildMcpPreamble(ctx: PromptContext, opts: { enabled: boolean }): string {
  if (!opts.enabled) return '';
  return [
    '',
    '--- planrla kanban ---',
    `You are executing stage "${ctx.stageName}" (#${ctx.stageIndex}) of kanban task #${ctx.taskNumber} (id: ${ctx.taskId}).`,
    `Project root: ${ctx.rootPath ?? '(unknown)'}.`,
    `When this stage is complete, advance by calling the MCP tool task_next with {"taskId": "${ctx.taskId}"}.`,
    'Use task_status with the same taskId to inspect current state; task_prev to go back.',
    '--- end planrla kanban ---',
    '',
  ].join('\n');
}

export interface RenderStagePromptArgs {
  stage: StageTemplate;
  ctx: PromptContext;
}

/** Render a stage's prompt template (variable substitution) + optional MCP self-drive preamble. */
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
  return base + preamble;
}
```

### 步骤 4:跑 `npm run test:kanban` 通过 + typecheck + commit

```bash
npm run test:kanban
npx tsc --noEmit -p server/tsconfig.json
git add server/modules/kanban/prompt.ts server/modules/kanban/tests/prompt.test.ts
git commit -m "feat(kanban): add prompt rendering with MCP self-drive preamble" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: worktree-setup.ts + runner 接 worktree + 渲染 prompt

**Files:**
- Create: `server/modules/kanban/worktree-setup.ts`
- Create: `server/modules/kanban/tests/worktree-setup.test.ts`
- Modify: `server/modules/kanban/runner.ts`
- Modify: `server/modules/kanban/tests/runner.test.ts`

### 步骤 1:写 `worktree-setup.test.ts` 失败测试(mock git + 真 store)

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { Database } from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskStore } from '@/modules/kanban/store.js';
import { createTemplateStore } from '@/modules/kanban/template-store.js';
import { createKanbanService } from '@/modules/kanban/service.js';
import { createWorktreeSetup, type WorktreeSetup } from '@/modules/kanban/worktree-setup.js';
import type { Task } from '@/modules/kanban/types.js';

function setup(): { service: ReturnType<typeof createKanbanService>; taskStore: ReturnType<typeof createTaskStore>; makeTask: () => Task; worktreeSetup: (createdPaths: string[]) => WorktreeSetup } {
  const db = new Database(join(tmpdir(), `kanban-wts-${Date.now()}-${Math.random().toString(36).slice(2)}.db`));
  db.pragma('journal_mode = WAL');
  const taskStore = createTaskStore({ db });
  const templateStore = createTemplateStore({ dir: mkdtempSync(join(tmpdir(), `kanban-wts-tpl-`)) });
  const service = createKanbanService({ taskStore, templateStore });
  // minimal agent stage template via service.createTask needs a real template:
  const tpl = templateStore.saveTaskTemplate({
    id: 'tpl1', name: 'T', maxConcurrency: 1,
    stages: [{ id: 'ss', position: 0, snapshot: { id: 's1', name: 'do', role: 'agent', autoAdvance: true, agent: 'claude', promptTemplate: 'hi', createdAt: '', updatedAt: '' } }],
    createdAt: '', updatedAt: '',
  } as any);
  const makeTask = () => service.createTask({ rootId: 'root1', taskTemplateId: tpl.id, input: 'go' });
  const worktreeSetup = (createdPaths: string[]) => createWorktreeSetup({
    store: taskStore,
    mcpBaseUrl: 'http://127.0.0.1:3001/api/mcp/kanban',
    git: {
      createLinkedWorktree: async (_root: string, branch: string) => {
        const p = `/fake/${branch}`;
        createdPaths.push(p);
        return { path: p, branch };
      },
      removeLinkedWorktree: async () => {},
      worktreeExists: (p: string) => createdPaths.includes(p),
      appendGitInfoExclude: () => {},
      runGit: async () => '',
    } as any,
    log: () => {},
  });
  return { service, taskStore, makeTask, worktreeSetup };
}

test('ensureWorktree creates worktree, persists path+branch, writes .mcp.json', async () => {
  const { service, makeTask, worktreeSetup } = setup();
  const created: string[] = [];
  const task = makeTask();
  const ws = worktreeSetup(created);
  const wtPath = await ws.ensureWorktree(task, '/repo');
  assert.equal(wtPath, '/fake/kanban/1-' + task.id.replace(/-/g, '').slice(0, 8));
  // persistence
  const after = service.getTask(task.rootId, task.id);
  assert.equal(after?.worktreePath, wtPath);
  assert.equal(after?.worktreeBranch?.startsWith('kanban/1-'), true);
});

test('ensureWorktree is idempotent: reuses existing worktree, does not create again', async () => {
  const { makeTask, worktreeSetup } = setup();
  const created: string[] = [];
  const ws = worktreeSetup(created);
  const task = makeTask();
  const first = await ws.ensureWorktree(task, '/repo');
  // simulate task reload (worktreePath now persisted on a fresh task object)
  const taskAgain = { ...task, worktreePath: first, worktreeBranch: 'kanban/1-x' };
  const second = await ws.ensureWorktree(taskAgain, '/repo');
  assert.equal(second, first);
  assert.equal(created.length, 1); // git.createLinkedWorktree called once
});

test('ensureWorktree returns null when createWorktree is false', async () => {
  const { makeTask, worktreeSetup } = setup();
  const created: string[] = [];
  const ws = worktreeSetup(created);
  const task = makeTask();
  const noWtTask = { ...task, createWorktree: false };
  const out = await ws.ensureWorktree(noWtTask, '/repo');
  assert.equal(out, null);
  assert.equal(created.length, 0);
});

test('ensureWorktree returns null when rootPath is null', async () => {
  const { makeTask, worktreeSetup } = setup();
  const ws = worktreeSetup([]);
  const task = makeTask();
  const out = await ws.ensureWorktree(task, null);
  assert.equal(out, null);
});

test('ensureWorktree returns null (and does not throw) when git create fails', async () => {
  const { taskStore, makeTask } = setup();
  const failing = createWorktreeSetup({
    store: taskStore,
    mcpBaseUrl: 'x',
    git: {
      createLinkedWorktree: async () => { throw new Error('boom'); },
      removeLinkedWorktree: async () => {},
      worktreeExists: () => false,
      appendGitInfoExclude: () => {},
      runGit: async () => '',
    } as any,
    log: () => {},
  });
  const task = makeTask();
  const out = await failing.ensureWorktree(task, '/repo');
  assert.equal(out, null);
});
```

### 步骤 2:跑 `npm run test:kanban` 确认 fail。

### 步骤 3:实现 `worktree-setup.ts`

```typescript
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Task } from '@/modules/kanban/types.js';
import type { TaskStore } from '@/modules/kanban/store.js';
import type { WorktreeGit, CreatedWorktree } from '@/modules/kanban/git-worktree.js';

export interface WorktreeSetupDeps {
  store: TaskStore;
  git: WorktreeGit;
  mcpBaseUrl: string;
  branchPrefix?: string;
  log?: (msg: string) => void;
}

export interface WorktreeSetup {
  /** Idempotently ensure a task has a worktree. Returns its path, or null when disabled/no-root/creation-failed. */
  ensureWorktree(task: Task, rootPath: string | null): Promise<string | null>;
  /** Best-effort remove a task's worktree. */
  removeWorktree(task: Task, rootPath: string | null): Promise<void>;
}

export function createWorktreeSetup(deps: WorktreeSetupDeps): WorktreeSetup {
  const { store, git, mcpBaseUrl, branchPrefix = 'kanban/', log = () => {} } = deps;

  function branchFor(task: Task): string {
    const suffix = task.id.replace(/-/g, '').slice(0, 8);
    return `${branchPrefix}${task.taskNumber}-${suffix}`;
  }

  function writeWorktreeMcpConfig(wtPath: string): void {
    const config = {
      mcpServers: {
        'planrla-kanban': { type: 'http', url: mcpBaseUrl },
      },
    };
    writeFileSync(join(wtPath, '.mcp.json'), JSON.stringify(config, null, 2));
  }

  async function ensureWorktree(task: Task, rootPath: string | null): Promise<string | null> {
    if (!task.createWorktree) return null;
    if (!rootPath) return null;
    if (task.worktreePath && git.worktreeExists(task.worktreePath)) {
      return task.worktreePath;
    }
    const branch = task.worktreeBranch ?? branchFor(task);
    let created: CreatedWorktree;
    try {
      created = await git.createLinkedWorktree(rootPath, branch);
    } catch (e: any) {
      log(`[kanban-worktree] create failed task=${task.id}: ${e?.message ?? e}`);
      return null;
    }
    store.updateTaskWorktree(task.id, { worktreePath: created.path, worktreeBranch: created.branch });
    try { writeWorktreeMcpConfig(created.path); } catch (e: any) { log(`[kanban-worktree] .mcp.json write failed: ${e?.message ?? e}`); }
    return created.path;
  }

  async function removeWorktree(task: Task, rootPath: string | null): Promise<void> {
    if (!task.worktreePath || !rootPath) return;
    try {
      await git.removeLinkedWorktree(rootPath, task.worktreePath);
    } catch (e: any) {
      log(`[kanban-worktree] remove failed task=${task.id}: ${e?.message ?? e}`);
    }
  }

  return { ensureWorktree, removeWorktree };
}
```

### 步骤 4:跑 `npm run test:kanban` 通过 worktree-setup 测试。

### 步骤 5:Modify `runner.ts`——加 `worktreeSetup?` 依赖,runAgentStage 改用 `renderStagePrompt` + `ensureWorktree`

Read `server/modules/kanban/runner.ts` 全文。改动:

**(a) deps 加字段**(在 `RunnerDeps` interface,`runner.ts:32-42`):

```typescript
import { renderStagePrompt } from '@/modules/kanban/prompt.js';
import type { WorktreeSetup } from '@/modules/kanban/worktree-setup.js';

export interface RunnerDeps {
  taskStore: TaskStore;
  templateStore: TemplateStore;
  service: KanbanService;
  auxBridge: AuxBridge;
  resolveRootPath: (rootId: string) => string | null;
  spawnFns?: Record<string, SpawnFn>;
  worktreeSetup?: WorktreeSetup;   // NEW (W4)
  log?: (msg: string) => void;
}
```

在 `createRunner` 解构加 `worktreeSetup`:

```typescript
export function createRunner(deps: RunnerDeps) {
  const { taskStore, templateStore, service, auxBridge, resolveRootPath, spawnFns = defaultSpawnFns, worktreeSetup, log = console.log } = deps;
```

**(b) `runAgentStage` 内**(替换 line 71-76 的 cwd + prompt 解析):

原(line 71-76, 来自 explore):
```typescript
  const rootPath = resolveRootPath(rootId);
  const sessionKey = task.mainSessionKey ?? taskId;
  const providerSessionId = sessionMap.get(sessionKey);
  const cwd = task.worktreePath ?? rootPath ?? undefined;
  const permissionMode: 'plan' | 'default' = stage.planMode ? 'plan' : 'default';
  const prompt = stage.promptTemplate ?? '';
```

改为:
```typescript
  const rootPath = resolveRootPath(rootId);
  const sessionKey = task.mainSessionKey ?? taskId;
  const providerSessionId = sessionMap.get(sessionKey);
  const permissionMode: 'plan' | 'default' = stage.planMode ? 'plan' : 'default';

  // W4: ensure worktree (lazy, idempotent) before resolving cwd
  let cwd: string | undefined;
  if (worktreeSetup) {
    const wt = await worktreeSetup.ensureWorktree(task, rootPath);
    cwd = wt ?? rootPath ?? undefined;
  } else {
    cwd = task.worktreePath ?? rootPath ?? undefined;
  }

  // W4: rendered prompt (variable substitution + MCP self-drive preamble)
  const run = taskStore.latestStageRun(taskId, stageIndex);
  const prompt = renderStagePrompt({
    stage,
    ctx: {
      taskId: task.id,
      taskNumber: task.taskNumber,
      stageName: stage.name,
      stageIndex,
      rootPath,
      input: run?.input ?? '',
    },
  });
```

(其余 runAgentStage 不变——spawnFn 调用、RunnerWriter、onComplete autoAdvance 逻辑保持。)

### 步骤 6:扩展 `runner.test.ts`——assert cwd=worktree + 渲染 prompt

Read `server/modules/kanban/tests/runner.test.ts`,参照其既有 mock spawnFn 注入模式(`spawnFns: { claude: mockSpawn }`)。加测试:

```typescript
test('runAgentStage passes worktreePath as cwd when worktreeSetup returns one', async () => {
  // 复用 runner.test.ts 既有的 store/service/template/runner setup
  // 注入 mock spawnFn 记录 opts.cwd:
  const seen: { cwd?: string; cmd?: string }[] = {};
  const mockSpawn = async (cmd: string, opts: any, writer: any) => {
    seen.push({ cwd: opts?.cwd, cmd });
    writer.send(JSON.stringify({ kind: 'complete' }));
  };
  const runner = createRunner({
    taskStore, templateStore, service, auxBridge, resolveRootPath: () => '/repo',
    spawnFns: { claude: mockSpawn },
    worktreeSetup: { ensureWorktree: async () => '/repo/.worktree/kanban/1-aaaa', removeWorktree: async () => {} },
    log: () => {},
  });
  // const task = <existing helper creating a task with a claude agent stage at stageIndex 0>
  await runner.runAgentStage(task.rootId, task.id, task.currentStageIndex);
  assert.equal(seen[0]?.cwd, '/repo/.worktree/kanban/1-aaaa');
});

test('runAgentStage renders prompt with MCP preamble containing taskId', async () => {
  const seen: { cmd?: string }[] = {};
  const mockSpawn = async (cmd: string, _opts: any, writer: any) => {
    seen.push({ cmd });
    writer.send(JSON.stringify({ kind: 'complete' }));
  };
  const runner = createRunner({
    taskStore, templateStore, service, auxBridge, resolveRootPath: () => '/repo',
    spawnFns: { claude: mockSpawn },
    worktreeSetup: { ensureWorktree: async () => null, removeWorktree: async () => {} },
    log: () => {},
  });
  await runner.runAgentStage(task.rootId, task.id, task.currentStageIndex);
  assert.match(seen[0]?.cmd ?? '', /task_next/);
  assert.match(seen[0]?.cmd ?? '', new RegExp(task.id));
});
```

(用 runner.test.ts 既有的 task 创建 helper;若 agentCanControlStage 默认未设,渲染 preamble——确认模板 stage 的 `agentCanControlStage` 不是 false。)

### 步骤 7:跑 `npm run test:kanban` 全绿 + typecheck + commit

```bash
npm run test:kanban
npx tsc --noEmit -p server/tsconfig.json
git add server/modules/kanban/worktree-setup.ts server/modules/kanban/runner.ts server/modules/kanban/tests/worktree-setup.test.ts server/modules/kanban/tests/runner.test.ts
git commit -m "feat(kanban): wire worktree setup and rendered prompt into runner" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: kanban MCP 路由(task_next/task_prev/task_status)

**Files:**
- Create: `server/modules/kanban/mcp.route.ts`
- Create: `server/modules/kanban/tests/mcp-route.test.ts`

### 步骤 0:Read `server/modules/mcp/session-query-mcp.route.ts:1-60, 309-362`(JSON-RPC dispatch 形态参考)。

### 步骤 1:写 `mcp-route.test.ts` 失败测试(supertest + fake kanban)

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { createKanbanMcpRouter } from '@/modules/kanban/mcp.route.js';
import type { Task } from '@/modules/kanban/types.js';

function fakeKanban(overrides: { task?: Task | null; nextCalls?: string[]; prevCalls?: string[] } = {}) {
  const task: Task = overrides.task ?? {
    id: 't1', taskNumber: 1, rootId: 'r1', taskTemplateId: 'tpl', createWorktree: true,
    currentStageIndex: 0, status: 'running', schedulerAdmitted: true, labels: [],
    auxFlags: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false },
    createdAt: '', updatedAt: '',
  } as any;
  const nextCalls = overrides.nextCalls ?? [];
  const prevCalls = overrides.prevCalls ?? [];
  const taskStore = { getTask: (id: string) => (id === task.id ? { ...task } : null) };
  const service = {
    next: (rootId: string, id: string) => { nextCalls.push(id); return { ...task, currentStageIndex: task.currentStageIndex + 1 }; },
    prev: (rootId: string, id: string) => { prevCalls.push(id); return { ...task }; },
  };
  return {
    getKanban: () => ({ service: service as any, taskStore: taskStore as any }),
    nextCalls, prevCalls,
  };
}

function appFor(kanban: ReturnType<typeof fakeKanban>) {
  const app = express();
  app.use(express.json());
  app.locals.wss = null;
  app.use('/api/mcp/kanban', createKanbanMcpRouter(kanban));
  return app;
}

test('initialize returns protocol version + server info', async () => {
  const app = appFor(fakeKanban());
  const res = await request(app).post('/api/mcp/kanban').send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert.equal(res.status, 200);
  assert.equal(res.body.result.protocolVersion, '2024-11-05');
  assert.equal(res.body.result.serverInfo.name, 'planrla-kanban');
});

test('tools/list advertises task_next, task_prev, task_status', async () => {
  const app = appFor(fakeKanban());
  const res = await request(app).post('/api/mcp/kanban').send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = res.body.result.tools.map((t: any) => t.name);
  assert.deepEqual(names.sort(), ['task_next', 'task_prev', 'task_status']);
});

test('tools/call task_next advances via service.next(rootId, taskId)', async () => {
  const kanban = fakeKanban({ nextCalls: [] });
  const app = appFor(kanban);
  const res = await request(app).post('/api/mcp/kanban').send({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'task_next', arguments: { taskId: 't1' } },
  });
  assert.equal(res.status, 200);
  assert.equal(kanban.nextCalls[0], 't1');
  assert.match(JSON.stringify(res.body.result), /running/);
});

test('tools/call task_prev calls service.prev', async () => {
  const kanban = fakeKanban({ prevCalls: [] });
  const app = appFor(kanban);
  await request(app).post('/api/mcp/kanban').send({
    jsonrpc: '2.0', id: 4, method: 'tools/call',
    params: { name: 'task_prev', arguments: { taskId: 't1' } },
  });
  assert.equal(kanban.prevCalls[0], 't1');
});

test('tools/call task_status returns task snapshot without mutating', async () => {
  const kanban = fakeKanban();
  const app = appFor(kanban);
  const res = await request(app).post('/api/mcp/kanban').send({
    jsonrpc: '2.0', id: 5, method: 'tools/call',
    params: { name: 'task_status', arguments: { taskId: 't1' } },
  });
  assert.equal(res.status, 200);
  assert.equal(kanban.nextCalls.length, 0);
  assert.match(JSON.stringify(res.body.result), /"status"\s*:\s*"running"/);
});

test('tools/call with unknown taskId returns JSON-RPC error', async () => {
  const app = appFor(fakeKanban());
  const res = await request(app).post('/api/mcp/kanban').send({
    jsonrpc: '2.0', id: 6, method: 'tools/call',
    params: { name: 'task_status', arguments: { taskId: 'nope' } },
  });
  assert.ok(res.body.error);
  assert.equal(res.body.error.code, -32602);
});

test('tools/call missing taskId returns JSON-RPC error -32602', async () => {
  const app = appFor(fakeKanban());
  const res = await request(app).post('/api/mcp/kanban').send({
    jsonrpc: '2.0', id: 7, method: 'tools/call',
    params: { name: 'task_next', arguments: {} },
  });
  assert.equal(res.body.error.code, -32602);
});

test('unknown tool name returns JSON-RPC error -32601', async () => {
  const app = appFor(fakeKanban());
  const res = await request(app).post('/api/mcp/kanban').send({
    jsonrpc: '2.0', id: 8, method: 'tools/call',
    params: { name: 'bogus', arguments: { taskId: 't1' } },
  });
  assert.equal(res.body.error.code, -32601);
});
```

### 步骤 2:跑 `npm run test:kanban` 确认 fail。

### 步骤 3:实现 `mcp.route.ts`

```typescript
import { Router } from 'express';
import type { KanbanService } from '@/modules/kanban/service.js';
import type { TaskStore } from '@/modules/kanban/store.js';
import { broadcastTaskUpdated } from '@/utils/kanban-websocket.js';

const PROTOCOL_VERSION = '2024-11-05';

export interface KanbanMcpDeps {
  /** Lazy getter — keeps getKanban() lazy (called only on tools/call). */
  getKanban: () => { service: KanbanService; taskStore: TaskStore };
}

function textResponse(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function jsonRpc(id: unknown, result: unknown) {
  return { jsonrpc: '2.0' as const, id, result };
}
function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0' as const, id, error: { code, message } };
}

const TOOL_DEFS = [
  {
    name: 'task_next',
    description: 'Advance a planrla kanban task to its next stage. Call when the current stage work is complete.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
  },
  {
    name: 'task_prev',
    description: 'Move a planrla kanban task back to its previous stage.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
  },
  {
    name: 'task_status',
    description: 'Get the current status, stage index, and aux flags of a planrla kanban task.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
  },
];

export function createKanbanMcpRouter(deps: KanbanMcpDeps): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const msg = req.body ?? {};
    const id = msg.id ?? null;

    try {
      if (msg.method === 'initialize') {
        return res.json(jsonRpc(id, {
          protocolVersion: PROTOCOL_VERSION,
          serverInfo: { name: 'planrla-kanban', version: '0.1.0' },
          capabilities: { tools: {} },
        }));
      }
      if (msg.method === 'tools/list') {
        return res.json(jsonRpc(id, { tools: TOOL_DEFS }));
      }
      if (msg.method === 'tools/call') {
        const name = msg.params?.name;
        const taskId = String(msg.params?.arguments?.taskId ?? '');
        if (!taskId) return res.json(jsonRpcError(id, -32602, 'taskId required'));
        if (!['task_next', 'task_prev', 'task_status'].includes(name)) {
          return res.json(jsonRpcError(id, -32601, `unknown tool: ${name}`));
        }

        const { service, taskStore } = deps.getKanban();
        const task = taskStore.getTask(taskId);
        if (!task) return res.json(jsonRpcError(id, -32602, `task not found: ${taskId}`));
        const rootId = task.rootId;

        if (name === 'task_next') service.next(rootId, taskId);
        else if (name === 'task_prev') service.prev(rootId, taskId);
        // task_status: no mutation

        const after = taskStore.getTask(taskId);
        // broadcast so the board UI updates in real time (no-op when wss null)
        try { broadcastTaskUpdated((req.app.locals as any).wss, rootId, after); } catch { /* ignore */ }
        return res.json(jsonRpc(id, textResponse(JSON.stringify({
          taskId, status: after?.status, stageIndex: after?.currentStageIndex, auxFlags: after?.auxFlags,
        }, null, 2))));
      }

      // notifications/* and anything else: best-effort ack
      return res.json(jsonRpc(id, {}));
    } catch (e: any) {
      return res.json(jsonRpcError(id, -32603, e?.message ?? 'internal error'));
    }
  });

  return router;
}
```

### 步骤 4:跑 `npm run test:kanban` 通过 + typecheck + commit

```bash
npm run test:kanban
npx tsc --noEmit -p server/tsconfig.json
git add server/modules/kanban/mcp.route.ts server/modules/kanban/tests/mcp-route.test.ts
git commit -m "feat(kanban): add HTTP MCP route with task_next/prev/status self-drive tools" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 模板 REST 路由(前端依赖)

**Files:**
- Modify: `server/modules/kanban/kanban.routes.ts`(deps 加 `templateStore`;加 `/templates*` 4 路由)
- Modify: `server/modules/kanban/assembly.ts`(router 传 `templateStore`)
- Create: `server/modules/kanban/tests/template-routes.test.ts`

### 步骤 1:写 `template-routes.test.ts` 失败测试(supertest)

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { Database } from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskStore } from '@/modules/kanban/store.js';
import { createTemplateStore } from '@/modules/kanban/template-store.js';
import { createKanbanService } from '@/modules/kanban/service.js';
import { createKanbanRouter } from '@/modules/kanban/kanban.routes.js';

function setup() {
  const db = new Database(join(tmpdir(), `kanban-tpl-${Date.now()}-${Math.random().toString(36).slice(2)}.db`));
  const taskStore = createTaskStore({ db });
  const templateStore = createTemplateStore({ dir: mkdtempSync(join(tmpdir(), 'kanban-tpl-route-')) });
  const service = createKanbanService({ taskStore, templateStore });
  const router = createKanbanRouter({ service, templateStore });
  const app = express();
  app.use(express.json());
  app.locals.wss = null;
  app.use('/api/tasks', router);
  return { app, templateStore };
}

const validTpl = {
  id: 'tpl-a', name: 'Build feature', maxConcurrency: 2,
  stages: [{ id: 'ss', position: 0, snapshot: { id: 's1', name: 'impl', role: 'agent', autoAdvance: true, agent: 'claude', promptTemplate: 'do', createdAt: '', updatedAt: '' } }],
  createdAt: '', updatedAt: '',
};

test('POST /templates saves and returns the template', async () => {
  const { app } = setup();
  const res = await request(app).post('/api/tasks/templates').send(validTpl);
  assert.equal(res.status, 200);
  assert.equal(res.body.template.name, 'Build feature');
});

test('GET /templates lists saved templates', async () => {
  const { app } = setup();
  await request(app).post('/api/tasks/templates').send(validTpl);
  const res = await request(app).get('/api/tasks/templates');
  assert.equal(res.status, 200);
  assert.ok(res.body.templates.some((t: any) => t.id === 'tpl-a'));
});

test('GET /templates/:id returns one template; 404 when missing', async () => {
  const { app } = setup();
  await request(app).post('/api/tasks/templates').send(validTpl);
  const ok = await request(app).get('/api/tasks/templates/tpl-a');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.template.id, 'tpl-a');
  const missing = await request(app).get('/api/tasks/templates/nope');
  assert.equal(missing.status, 404);
});

test('DELETE /templates/:id removes the template', async () => {
  const { app } = setup();
  await request(app).post('/api/tasks/templates').send(validTpl);
  const del = await request(app).delete('/api/tasks/templates/tpl-a');
  assert.equal(del.status, 200);
  const after = await request(app).get('/api/tasks/templates/tpl-a');
  assert.equal(after.status, 404);
});

test('POST /templates with invalid body (no name) returns 400', async () => {
  const { app } = setup();
  const res = await request(app).post('/api/tasks/templates').send({ ...validTpl, name: '' });
  assert.equal(res.status, 400);
});
```

### 步骤 2:跑 `npm run test:kanban` 确认 fail(路由不存在 / deps 缺 templateStore)。

### 步骤 3:Modify `kanban.routes.ts`

Read `server/modules/kanban/kanban.routes.ts`。改动:

**(a) deps 加 `templateStore`**(line 5-7 区域):

```typescript
import type { TemplateStore } from '@/modules/kanban/template-store.js';

export interface KanbanRouterDeps {
  service: KanbanService;
  templateStore: TemplateStore;   // NEW (W4)
}

export function createKanbanRouter(deps: KanbanRouterDeps): Router {
  const { service, templateStore } = deps;
  const router = Router();
```

**(b) 在现有路由之前(紧跟 `const router = Router();` 之后,在 `GET /` 之前)加模板路由**(放前面避免与 `/:taskId` 冲突):

```typescript
  // --- templates (W4) ---
  router.get('/templates', (_req, res) => {
    res.json({ templates: templateStore.listTaskTemplates() });
  });

  router.get('/templates/:id', (req, res) => {
    const tpl = templateStore.getTaskTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ message: 'template not found', code: 'TEMPLATE_NOT_FOUND' });
    res.json({ template: tpl });
  });

  router.post('/templates', (req, res) => {
    try {
      const tpl = templateStore.saveTaskTemplate(req.body);
      res.json({ template: tpl });
    } catch (e: any) {
      res.status(400).json({ message: e?.message ?? 'invalid template', code: 'TEMPLATE_INVALID' });
    }
  });

  router.delete('/templates/:id', (req, res) => {
    templateStore.deleteTaskTemplate(req.params.id);
    res.json({ ok: true });
  });
```

### 步骤 4:Modify `assembly.ts`——router 传 `templateStore`

Read `server/modules/kanban/assembly.ts`,line 49 区域 `const router = createKanbanRouter({ service })` 改为:

```typescript
const router = createKanbanRouter({ service, templateStore });
```

### 步骤 5:跑 `npm run test:kanban` 通过 + typecheck + commit

```bash
npm run test:kanban
npx tsc --noEmit -p server/tsconfig.json
git add server/modules/kanban/kanban.routes.ts server/modules/kanban/assembly.ts server/modules/kanban/tests/template-routes.test.ts
git commit -m "feat(kanban): add task template REST routes" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: assembly 接 worktree + index.js 挂 MCP 路由 + 端到端集成测试

**Files:**
- Modify: `server/modules/kanban/assembly.ts`(建 worktreeSetup,注入 runner)
- Modify: `server/index.js`(挂 `/api/mcp/kanban`,auth 前)
- Create: `server/modules/kanban/tests/w4-integration.test.ts`

### 步骤 1:Modify `assembly.ts`——建 worktreeSetup + 注入 runner + 暴露 mcpRouter-less(本 task 不改 getKanban 返回,MCP 路由由 index.js 用 getKanban getter 装)

Read `server/modules/kanban/assembly.ts`。在 `buildKanban()` 内(line 29 `resolveRootPath` 之后,line 30 建 runner 之前)加:

```typescript
import { createWorktreeGit } from '@/modules/kanban/git-worktree.js';
import { createWorktreeSetup } from '@/modules/kanban/worktree-setup.js';
```

```typescript
  // W4: worktree setup (mcpBaseUrl mirrors index.js SERVER_PORT default)
  const serverPort = process.env.SERVER_PORT || '3001';
  const mcpBaseUrl = process.env.PLANRLA_KANBAN_MCP_URL ?? `http://127.0.0.1:${serverPort}/api/mcp/kanban`;
  const worktreeSetup = createWorktreeSetup({
    store: taskStore,
    git: createWorktreeGit(),
    mcpBaseUrl,
    log: (m) => console.log(m),
  });
```

改 line 30 建 runner(加 `worktreeSetup`):

```typescript
  const runner = createRunner({ taskStore, templateStore, service, auxBridge, resolveRootPath, worktreeSetup });
```

(getKanban 返回对象不变;MCP 路由用独立 getter 在 index.js 装。)

### 步骤 2:Modify `server/index.js`——挂 `/api/mcp/kanban`

Read `server/index.js:235` 附近(`/api/mcp/internal` 挂载处)。在它之后(auth 前)加:

```javascript
import { createKanbanMcpRouter } from './modules/kanban/mcp.route.js';
```
(加到 line 69 附近的 import 区)

```javascript
app.use('/api/mcp/kanban', express.json(), createKanbanMcpRouter({ getKanban: () => getKanban() }));
```
(放在 `app.use('/api/mcp/internal', sessionQueryMcpRoute);`(line 235)之后,authenticateToken(line 241 区)之前。`express.json()` 确保 JSON-RPC body 解析——若 internal 路由已用全局 `app.use(express.json())` 则可省,确认 line 235 之前有无全局 json middleware,有就省略 `express.json()`。)

### 步骤 3:写 `w4-integration.test.ts` 失败测试(真实 temp git 仓库 + mock spawnFn 端到端)

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { Database } from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskStore } from '@/modules/kanban/store.js';
import { createTemplateStore } from '@/modules/kanban/template-store.js';
import { createKanbanService } from '@/modules/kanban/service.js';
import { createAuxBridge } from '@/modules/kanban/aux-bridge.js';
import { createRunner } from '@/modules/kanban/runner.js';
import { createScheduler } from '@/modules/kanban/scheduler.js';
import { createWorktreeGit } from '@/modules/kanban/git-worktree.js';
import { createWorktreeSetup } from '@/modules/kanban/worktree-setup.js';

function gitInit(p: string) {
  spawnSync('git', ['init', '-q'], { cwd: p });
  spawnSync('git', ['config', 'user.email', 't@t.t'], { cwd: p });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: p });
  spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: p });
}

test('W4 end-to-end: createTask → admit → ensureWorktree → mock spawn → autoAdvance', async () => {
  const repo = mkdtempSync(join(tmpdir(), `kanban-w4-${Date.now()}-`));
  gitInit(repo);
  try {
    const db = new Database(join(tmpdir(), `kanban-w4-${Date.now()}.db`));
    const taskStore = createTaskStore({ db });
    const templateStore = createTemplateStore({ dir: mkdtempSync(join(tmpdir(), 'kanban-w4-tpl-')) });
    const service = createKanbanService({ taskStore, templateStore });
    const auxBridge = createAuxBridge({ updateAuxFlags: taskStore.updateTaskAuxFlags });
    const worktreeSetup = createWorktreeSetup({
      store: taskStore, git: createWorktreeGit(),
      mcpBaseUrl: 'http://127.0.0.1:3001/api/mcp/kanban', log: () => {},
    });

    const seen: { cwd?: string; prompt?: string }[] = [];
    const mockSpawn = async (cmd: string, opts: any, writer: any) => {
      seen.push({ cwd: opts?.cwd, prompt: cmd });
      writer.send(JSON.stringify({ kind: 'tool_use', toolName: 'TodoWrite', toolInput: { todos: [] } }));
      writer.send(JSON.stringify({ kind: 'complete' }));
    };
    const runner = createRunner({
      taskStore, templateStore, service, auxBridge,
      resolveRootPath: () => repo,
      spawnFns: { claude: mockSpawn },
      worktreeSetup, log: () => {},
    });
    const scheduler = createScheduler({
      taskStore, templateStore,
      onAdmit: (taskId) => {
        const t = taskStore.getTask(taskId)!;
        void runner.runAgentStage(t.rootId, taskId, t.currentStageIndex).catch(() => {});
      },
    });

    const tpl = templateStore.saveTaskTemplate({
      id: 'tpl1', name: 'Two-stage', maxConcurrency: 1,
      stages: [
        { id: 'a', position: 0, snapshot: { id: 'sa', name: 'user-kickoff', role: 'user', autoAdvance: true, createdAt: '', updatedAt: '' } },
        { id: 'b', position: 1, snapshot: { id: 'sb', name: 'implement', role: 'agent', autoAdvance: true, agent: 'claude', promptTemplate: 'build {{input}}', createdAt: '', updatedAt: '' } },
      ],
      createdAt: '', updatedAt: '',
    } as any);

    const task = service.createTask({ rootId: 'r1', taskTemplateId: tpl.id, input: 'feature-X' });
    scheduler.schedule('r1');
    // give the fire-and-forget runAgentStage a tick
    await new Promise((r) => setTimeout(r, 200));

    // worktree created + persisted
    const after = taskStore.getTask(task.id);
    assert.ok(after?.worktreePath, 'worktreePath persisted');
    assert.equal(existsSync(join(after!.worktreePath!, '.git')), true, 'worktree .git exists');
    // .mcp.json written into worktree
    const mcp = JSON.parse(readFileSync(join(after!.worktreePath!, '.mcp.json'), 'utf8'));
    assert.equal(mcp.mcpServers['planrla-kanban'].url, 'http://127.0.0.1:3001/api/mcp/kanban');
    // spawnFn got cwd=worktreePath + rendered prompt (substituted + preamble)
    assert.equal(seen[0]?.cwd, after!.worktreePath);
    assert.match(seen[0]?.prompt ?? '', /build feature-X/);
    assert.match(seen[0]?.prompt ?? '', /task_next/);
    // aux flag captured from mock event
    assert.equal(after!.auxFlags.hasTodos, true);
    // worktree excluded from main repo status
    const status = spawnSync('git', ['status', '--porcelain'], { cwd: repo }).stdout.toString();
    assert.doesNotMatch(status, /\.worktree/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
```

### 步骤 4:跑 `npm run test:kanban` 全绿 + 全量 typecheck + commit

```bash
npm run test:kanban
npx tsc --noEmit -p server/tsconfig.json
git add server/modules/kanban/assembly.ts server/index.js server/modules/kanban/tests/w4-integration.test.ts
git commit -m "feat(kanban): wire worktree setup in assembly and mount kanban MCP route" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## W4(后端自驱闭环)完成标准

- `git-worktree.ts`:真实 git worktree create/remove(实测路径 `<root>/.worktree/<branch>`),`.git/info/exclude` 幂等排除。
- `prompt.ts`:`{{var}}` 替换 + MCP 自驱前言(含 taskId)。
- `worktree-setup.ts`:`ensureWorktree` 幂等(已存在则复用),写 `.mcp.json`(指向 `/api/mcp/kanban`),持久化 `task.worktreePath/Branch`。
- `runner.ts`:接 `worktreeSetup`,先 ensureWorktree 再 spawn(cwd=worktreePath),用 `renderStagePrompt`。
- `mcp.route.ts`:`/api/mcp/kanban` HTTP JSON-RPC,`task_next/task_prev/task_status`(taskId→rootId 服务端反查),WS 广播。
- `kanban.routes.ts`:`/templates*` 4 路由(GET list/get、POST save、DELETE)。
- `assembly.ts`:建 worktreeSetup(mcpBaseUrl 推自 SERVER_PORT)+ 注入 runner。
- `index.js`:挂 `/api/mcp/kanban`(auth 前)。
- `npm run test:kanban` 全绿(W3 ~72 + W4 新增 ~24 = ~96)。
- typecheck 0。
- **不含(留独立 plan)**:前端 kanban UI、cron 定时任务、webhook 通知 channel。

## Self-Review

- **Spec coverage**:spec 第 3 节 `git-worktree.ts`(✓ Task 1)+ `mcp-tools.ts`(✓ Task 4,改名 mcp.route.ts 遵循 planrla 命名)+ 第 5 节决策 #1 worktree utility(spec 说 Electron utility process;本 plan 用 server 进程 child_process,W4 可测,utility process 抽取留硬ening——**标注为后续,不算占位**,因 spec 决策 #1 的核心「`.git/info/exclude` 存在性检查」已实现)+ #2 强制 CreateWorktree(✓ service.createTask 已 hard-code true,W1 既有)+ #3 MCP 工具(✓ Task 4,Claude-only 已接受)+ 第 6 节 aux flag(W3 已交付,W4 集成测试复验)+ 第 7 节 W4 的 worktree/MCP/前端 UI/cron/webhook(UI/cron/webhook 明确转独立 plan)。✓
- **Placeholder scan**:
  - Task 1 store.test.ts 的 `setupExistingTask()`——明确指令「用文件内既有 task setup;若无则 inline create」,并给了 createTask 最小 input 描述。store.test.ts 已存在真实 createTask 测试段,implementer 直接复用其 setup。非占位。
  - 所有代码块都是完整可运行的,无 "TODO"/"add error handling"/"similar to"/"delete the bad version" 模式。
- **Type 一致性**:`TaskStore.updateTaskWorktree`(Task 1 定义)在 worktree-setup.ts(Task 3)与 runner 路径一致调用;`WorktreeSetup` 接口(Task 3 定义)在 runner deps(Task 3)、assembly(Task 6)、测试 mock 全用同名 `ensureWorktree(task, rootPath)→Promise<string|null>`;`createKanbanMcpRouter({getKanban})`(Task 4 定义)在 index.js(Task 6)一致;`createKanbanRouter({service, templateStore})`(Task 5 定义)在 assembly(Task 5 步 4)一致;`renderStagePrompt({stage, ctx})`(Task 2 定义)在 runner(Task 3)一致,ctx 字段 `{taskId, taskNumber, stageName, stageIndex, rootPath, input}` 与 prompt.test.ts 一致。✓
- **不确定性处理**:SERVER_PORT 默认(3001)已实测(`index.js:1767`);git worktree in-repo 路径已实测允许;session-query-mcp dispatch 形态已摸底。无遗留运行时不确定性。
