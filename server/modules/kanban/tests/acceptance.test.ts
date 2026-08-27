import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';

import { createTaskStore } from '@/modules/kanban/store.js';
import { createTemplateStore } from '@/modules/kanban/template-store.js';
import { createKanbanService } from '@/modules/kanban/service.js';
import { createKanbanRouter } from '@/modules/kanban/kanban.routes.js';
import { createRunner } from '@/modules/kanban/runner.js';
import { createAuxBridge } from '@/modules/kanban/aux-bridge.js';

const NOW = '2026-01-01T00:00:00.000Z';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kanban-accept-'));
  git(['init'], dir);
  git(['config', 'user.email', 'test@example.com'], dir);
  git(['config', 'user.name', 'Test'], dir);
  writeFileSync(join(dir, 'base.txt'), 'base\n');
  git(['add', '.'], dir);
  git(['commit', '-m', 'base'], dir);
  return dir;
}

/** 在 dir 仓库上开任务分支并提交一个文件,然后切回原分支(模拟 agent 在 worktree 的提交)。 */
function branchWith(dir: string, branch: string, filename: string, content: string): void {
  git(['checkout', '-b', branch], dir);
  writeFileSync(join(dir, filename), content);
  git(['add', '.'], dir);
  git(['commit', '-m', `commit ${filename}`], dir);
  git(['checkout', '-'], dir);
}

interface Fixture {
  app: express.Express;
  db: Database.Database;
  service: ReturnType<typeof createKanbanService>;
  taskStore: ReturnType<typeof createTaskStore>;
  templateStore: ReturnType<typeof createTemplateStore>;
  scheduled: string[];
  rootDir: string;
  cleanup: () => void;
}

/** supertest app:resolveRootPath 指向真实临时仓库,merge 走真 git。 */
function setupApp(rootDir: string): Fixture {
  const db = new Database(':memory:');
  const taskStore = createTaskStore({ db });
  const templateStore = createTemplateStore({ dir: mkdtempSync(join(tmpdir(), 'kanban-accept-tpl-')) });
  const service = createKanbanService({ taskStore, templateStore });
  const scheduled: string[] = [];
  const router = createKanbanRouter({
    service, taskStore, templateStore,
    scheduler: { schedule: (rootId) => { scheduled.push(rootId); } },
    scheduleStore: { listSchedules: () => [], listAllEnabledSchedules: () => [], getSchedule: () => null, saveSchedule: (s: any) => s, deleteSchedule: () => {}, updateLastRun: () => {} } as any,
    cronDriver: { reload: () => {} } as any,
    resolveRootPath: () => rootDir,
    runner: { startReviewComment: () => { throw new Error('not used'); } },
    resolveToolApproval: () => {},
  });
  const app = express();
  app.use(express.json());
  app.locals.wss = null;
  app.use('/api/tasks', router);
  return { app, db, service, taskStore, templateStore, scheduled, rootDir, cleanup: () => db.close() };
}

const USER_USER_TEMPLATE = {
  id: 'tpl', name: 'T', maxConcurrency: 1, createdAt: NOW, updatedAt: NOW,
  stages: [
    { id: 's0', position: 0, snapshot: { id: 'ss0', name: '需求', role: 'user' as const, autoAdvance: false, createdAt: NOW, updatedAt: NOW } },
    { id: 's1', position: 1, snapshot: { id: 'ss1', name: '交付', role: 'user' as const, autoAdvance: false, createdAt: NOW, updatedAt: NOW } },
  ],
};

/** 创建模板 + 推到 success 终态的任务,可选绑分支/provider 会话。 */
function successTask(fx: Fixture, opts: { branch?: string; providerSessionId?: string } = {}) {
  fx.templateStore.saveTaskTemplate(USER_USER_TEMPLATE);
  const task = fx.service.createTask({ rootId: 'r1', taskTemplateId: 'tpl', input: '做一个功能' });
  if (opts.providerSessionId) fx.taskStore.updateProviderSessionId(task.id, opts.providerSessionId);
  fx.service.next('r1', task.id);
  fx.service.next('r1', task.id);
  if (opts.branch) fx.taskStore.updateTaskWorktree(task.id, { worktreeBranch: opts.branch });
  return fx.taskStore.getTask(task.id)!;
}

test('merge: success 任务的分支 --no-ff 合并进主仓,审计事件齐全,二次调用幂等', async () => {
  const rootDir = initRepo();
  branchWith(rootDir, 'kanban/1-abc', 'feature.txt', 'hello\n');
  const fx = setupApp(rootDir);
  try {
    const task = successTask(fx, { branch: 'kanban/1-abc', providerSessionId: 'prov-1' });

    const res = await request(fx.app).post(`/api/tasks/${task.id}/merge`).send({ rootId: 'r1' });
    assert.equal(res.status, 200);
    assert.ok(!res.body.alreadyMerged);
    assert.ok(res.body.commit, 'returns merge commit');
    assert.equal(readFileSync(join(rootDir, 'feature.txt'), 'utf-8').replace(/\r\n/g, '\n'), 'hello\n', 'branch content landed on root');
    const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD'], rootDir).trim().split(' ');
    assert.equal(parents.length, 3, '--no-ff merge commit has two parents');
    const events = fx.taskStore.listTaskEvents(task.id).map((e) => e.type);
    assert.ok(events.includes('task_accepted'));
    assert.ok(events.includes('task_merged'));

    const res2 = await request(fx.app).post(`/api/tasks/${task.id}/merge`).send({ rootId: 'r1' });
    assert.equal(res2.status, 200);
    assert.equal(res2.body.alreadyMerged, true, 'second merge is idempotent');
  } finally {
    fx.cleanup();
  }
});

test('merge: 拒绝非 success 任务;已跟踪文件未提交改动拒绝且不改动仓库;untracked 不挡', async () => {
  const rootDir = initRepo();
  branchWith(rootDir, 'kanban/1-abc', 'feature.txt', 'hello\n');
  const fx = setupApp(rootDir);
  try {
    fx.templateStore.saveTaskTemplate(USER_USER_TEMPLATE);
    const task = fx.service.createTask({ rootId: 'r1', taskTemplateId: 'tpl', input: 'x' });
    fx.taskStore.updateTaskWorktree(task.id, { worktreeBranch: 'kanban/1-abc' });

    const notDone = await request(fx.app).post(`/api/tasks/${task.id}/merge`).send({ rootId: 'r1' });
    assert.equal(notDone.status, 409);
    assert.equal(notDone.body.code, 'INVALID_STATUS');

    // untracked 文件不挡验收(planrla 仓常年有 debug 产物)
    writeFileSync(join(rootDir, 'untracked-noise.txt'), 'noise\n');
    // 已跟踪文件改动才挡
    fx.service.next('r1', task.id);
    fx.service.next('r1', task.id);
    writeFileSync(join(rootDir, 'base.txt'), 'uncommitted edit\n');
    const dirty = await request(fx.app).post(`/api/tasks/${task.id}/merge`).send({ rootId: 'r1' });
    assert.equal(dirty.status, 409);
    assert.equal(dirty.body.code, 'REPO_DIRTY');
    assert.equal(readFileSync(join(rootDir, 'base.txt'), 'utf-8').replace(/\r\n/g, '\n'), 'uncommitted edit\n', 'dirty state untouched');
  } finally {
    fx.cleanup();
  }
});

test('merge: 冲突时 409 并自动恢复主仓干净', async () => {
  const rootDir = initRepo();
  branchWith(rootDir, 'kanban/2-conflict', 'base.txt', 'branch version\n');
  git(['commit', '--allow-empty', '-m', 'root diverges'], rootDir);
  writeFileSync(join(rootDir, 'base.txt'), 'root version\n');
  git(['add', '.'], rootDir);
  git(['commit', '-m', 'root edits base'], rootDir);
  const fx = setupApp(rootDir);
  try {
    const task = successTask(fx, { branch: 'kanban/2-conflict' });
    const res = await request(fx.app).post(`/api/tasks/${task.id}/merge`).send({ rootId: 'r1' });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'MERGE_FAILED');
    assert.equal(git(['status', '--porcelain'], rootDir).trim(), '', 'merge --abort restored clean tree');
  } finally {
    fx.cleanup();
  }
});

test('rework: success → queued,反馈入库、provider 会话保留、事件与调度触发', async () => {
  const rootDir = initRepo();
  const fx = setupApp(rootDir);
  try {
    const task = successTask(fx, { providerSessionId: 'prov-keep' });
    assert.equal(task.status, 'success');

    const res = await request(fx.app).post(`/api/tasks/${task.id}/rework`).send({ rootId: 'r1', feedback: '  按钮溢出,请修复  ' });
    assert.equal(res.status, 200);
    assert.equal(res.body.task.status, 'queued');
    assert.equal(res.body.task.completedAt ?? null, null, 'terminal timestamp cleared');
    assert.equal(res.body.task.providerSessionId, 'prov-keep', 'session kept for resume-style rework');
    assert.deepEqual(fx.scheduled.filter((r) => r === 'r1').length >= 1, true, 'scheduler woken');
    const events = fx.taskStore.listTaskEvents(task.id).filter((e) => e.type === 'task_reworked');
    assert.equal(events.length, 1);
    assert.equal(JSON.parse(events[0].payloadJson ?? '{}').feedback, '按钮溢出,请修复');

    // 空/空白反馈:用另一个 success 任务验证(第一个已回到 queued)。
    const task2 = successTask(fx, { branch: 'kanban/9-x' });
    const empty = await request(fx.app).post(`/api/tasks/${task2.id}/rework`).send({ rootId: 'r1', feedback: '   ' });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.code, 'FEEDBACK_REQUIRED');
  } finally {
    fx.cleanup();
  }
});

test('runner: 返工 spawn 只发送返工指令(会话延续),反馈消费一次', async () => {
  const rootDir = initRepo();
  const db = new Database(':memory:');
  const taskStore = createTaskStore({ db });
  const templateStore = createTemplateStore({ dir: mkdtempSync(join(tmpdir(), 'kanban-accept-tpl2-')) });
  templateStore.saveTaskTemplate({
    id: 'tpl2', name: 'T2', maxConcurrency: 1, createdAt: NOW, updatedAt: NOW,
    stages: [
      { id: 's0', position: 0, snapshot: { id: 'ss0', name: '需求', role: 'user' as const, autoAdvance: true, createdAt: NOW, updatedAt: NOW } },
      { id: 's1', position: 1, snapshot: { id: 'ss1', name: '交付', role: 'agent' as const, agent: 'claude', autoAdvance: false, createdAt: NOW, updatedAt: NOW } },
    ],
  });
  const service = createKanbanService({ taskStore, templateStore });
  const captured: Array<{ prompt: string; opts: any }> = [];
  const runner = createRunner({
    taskStore, templateStore, service,
    auxBridge: createAuxBridge({ updateAuxFlags: () => {} }),
    resolveRootPath: () => rootDir,
    spawnFns: { claude: async (prompt: string, opts: any) => { captured.push({ prompt, opts }); } },
  } as any);

  const task = service.createTask({ rootId: 'r1', taskTemplateId: 'tpl2', input: '做一个功能' });
  service.next('r1', task.id);
  service.next('r1', task.id); // agent 阶段 complete → success(与真实交付终态一致)
  taskStore.updateProviderSessionId(task.id, 'prov-resume');
  taskStore.updateTaskWorktree(task.id, { worktreeBranch: 'kanban/3-rw' });
  service.rework('r1', task.id, '修复移动端溢出');
  // rework 之前任务在 stage1(交付)success;rework 把整任务置回 queued。手动
  // 把 stage run 状态对齐后直接驱动 runner(等价于 scheduler 的 spawn 路径)。
  await runner.runAgentStage('r1', task.id, 1);

  assert.equal(captured.length, 1);
  assert.match(captured[0].prompt, /未通过人工验收/);
  assert.match(captured[0].prompt, /修复移动端溢出/);
  assert.ok(!captured[0].prompt.includes('做一个功能'), 'full stage prompt is NOT re-sent');
  assert.equal(captured[0].opts.sessionId, 'prov-resume', 'provider session resumed');
  assert.equal(taskStore.consumeReworkFeedback(task.id), null, 'feedback consumed once');

  db.close();
  rmSync(rootDir, { recursive: true, force: true });
});
