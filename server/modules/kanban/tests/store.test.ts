import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import { createTaskStore } from '@/modules/kanban/store.js';

function newTestStore() {
  const dbPath = join(tmpdir(), `kanban-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  return createTaskStore({ db });
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
  assert.equal(got!.auxFlags.askUserWaiting, false);
});

test('listQueuedTasks returns queued tasks ordered by created_at asc', () => {
  const store = newTestStore();
  const t1 = '2026-01-01T00:00:00.000Z';
  const t2 = '2026-01-02T00:00:00.000Z';
  for (const [id, num, createdAt] of [['b', 2, t2], ['a', 1, t1]] as const) {
    store.createTask({
      task: { id, taskNumber: num, rootId: 'root-1', taskTemplateId: 'tpl', createWorktree: true, currentStageIndex: 0, status: 'queued', schedulerAdmitted: false, labels: [], auxFlags: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false }, createdAt, updatedAt: createdAt },
      initialStageRun: { id: `run-${id}`, taskId: id, stageIndex: 0, stageName: 'S', role: 'user', status: 'approved', createdAt, updatedAt: createdAt },
      event: { id: `ev-${id}`, taskId: id, type: 'task_created', createdAt },
    });
  }
  // 再加一个非 queued 的,确认被过滤
  store.createTask({
    task: { id: 'c', taskNumber: 3, rootId: 'root-1', taskTemplateId: 'tpl', createWorktree: true, currentStageIndex: 0, status: 'running', schedulerAdmitted: true, labels: [], auxFlags: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false }, createdAt: t2, updatedAt: t2 },
    initialStageRun: { id: 'run-c', taskId: 'c', stageIndex: 0, stageName: 'S', role: 'user', status: 'approved', createdAt: t2, updatedAt: t2 },
    event: { id: 'ev-c', taskId: 'c', type: 'task_created', createdAt: t2 },
  });
  const queued = store.listQueuedTasks('root-1');
  assert.equal(queued.length, 2);
  assert.equal(queued[0].id, 'a');
  assert.equal(queued[1].id, 'b');
});

test('listTasks returns all tasks for a root', () => {
  const store = newTestStore();
  const now = '2026-01-01T00:00:00.000Z';
  store.createTask({ task: { id: 'a', taskNumber: 1, rootId: 'root-1', taskTemplateId: 'tpl', createWorktree: true, currentStageIndex: 0, status: 'queued', schedulerAdmitted: false, labels: [], auxFlags: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false }, createdAt: now, updatedAt: now }, initialStageRun: { id: 'ra', taskId: 'a', stageIndex: 0, stageName: 'S', role: 'user', status: 'approved', createdAt: now, updatedAt: now }, event: { id: 'ea', taskId: 'a', type: 'task_created', createdAt: now } });
  const all = store.listTasks('root-1');
  assert.equal(all.length, 1);
});

test('updateTaskStatus terminal clears schedulerAdmitted + sets completedAt', () => {
  const store = newTestStore();
  const now = '2026-01-01T00:00:00.000Z';
  store.createTask({ task: { id: 't', taskNumber: 1, rootId: 'root-1', taskTemplateId: 'tpl', createWorktree: true, currentStageIndex: 0, status: 'running', schedulerAdmitted: true, labels: [], auxFlags: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false }, createdAt: now, updatedAt: now }, initialStageRun: { id: 'rt', taskId: 't', stageIndex: 0, stageName: 'S', role: 'user', status: 'approved', createdAt: now, updatedAt: now }, event: { id: 'et', taskId: 't', type: 'task_created', createdAt: now } });
  store.updateTaskStatus('t', 'fail');
  const got = store.getTask('t');
  assert.ok(got);
  assert.equal(got!.status, 'fail');
  assert.equal(got!.schedulerAdmitted, false);
  assert.ok(got!.completedAt);
});

test('updateTaskStatus non-terminal keeps schedulerAdmitted and no completedAt', () => {
  const store = newTestStore();
  const now = '2026-01-01T00:00:00.000Z';
  store.createTask({ task: { id: 't', taskNumber: 1, rootId: 'root-1', taskTemplateId: 'tpl', createWorktree: true, currentStageIndex: 0, status: 'queued', schedulerAdmitted: true, labels: [], auxFlags: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false }, createdAt: now, updatedAt: now }, initialStageRun: { id: 'rt', taskId: 't', stageIndex: 0, stageName: 'S', role: 'user', status: 'approved', createdAt: now, updatedAt: now }, event: { id: 'et', taskId: 't', type: 'task_created', createdAt: now } });
  store.updateTaskStatus('t', 'running');
  const got = store.getTask('t');
  assert.ok(got);
  assert.equal(got!.status, 'running');
  assert.equal(got!.schedulerAdmitted, true);
  assert.equal(got!.completedAt, undefined);
});

test('latestStageRun returns most recent run for a stage', () => {
  const store = newTestStore();
  const t1 = '2026-01-01T00:00:00.000Z';
  const t2 = '2026-01-02T00:00:00.000Z';
  store.createTask({ task: { id: 't', taskNumber: 1, rootId: 'root-1', taskTemplateId: 'tpl', createWorktree: true, currentStageIndex: 0, status: 'queued', schedulerAdmitted: false, labels: [], auxFlags: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false }, createdAt: t1, updatedAt: t1 }, initialStageRun: { id: 'run-early', taskId: 't', stageIndex: 0, stageName: 'S', role: 'user', status: 'approved', createdAt: t1, updatedAt: t1 }, event: { id: 'et', taskId: 't', type: 'task_created', createdAt: t1 } });
  store.insertStageRun({ id: 'run-late', taskId: 't', stageIndex: 0, stageName: 'S', role: 'user', status: 'running', createdAt: t2, updatedAt: t2 });
  const latest = store.latestStageRun('t', 0);
  assert.ok(latest);
  assert.equal(latest!.id, 'run-late');
});

test('updateTaskAuxFlags patches individual flags', () => {
  const store = newTestStore();
  const now = '2026-01-01T00:00:00.000Z';
  store.createTask({ task: { id: 't', taskNumber: 1, rootId: 'root-1', taskTemplateId: 'tpl', createWorktree: true, currentStageIndex: 0, status: 'queued', schedulerAdmitted: false, labels: [], auxFlags: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false }, createdAt: now, updatedAt: now }, initialStageRun: { id: 'rt', taskId: 't', stageIndex: 0, stageName: 'S', role: 'user', status: 'approved', createdAt: now, updatedAt: now }, event: { id: 'et', taskId: 't', type: 'task_created', createdAt: now } });
  store.updateTaskAuxFlags('t', { askUserWaiting: true, hasPlan: true });
  let got = store.getTask('t');
  assert.equal(got!.auxFlags.askUserWaiting, true);
  assert.equal(got!.auxFlags.hasPlan, true);
  assert.equal(got!.auxFlags.hasTodos, false); // 未改
  store.updateTaskAuxFlags('t', { askUserWaiting: false });
  got = store.getTask('t');
  assert.equal(got!.auxFlags.askUserWaiting, false);
  assert.equal(got!.auxFlags.hasPlan, true); // 保持
});

test('updateTaskStage resets schedulerAdmitted to 0', () => {
  const store = newTestStore();
  const now = '2026-01-01T00:00:00.000Z';
  store.createTask({
    task: { id: 't', taskNumber: 1, rootId: 'root-1', taskTemplateId: 'tpl', createWorktree: true, currentStageIndex: 0, status: 'running', schedulerAdmitted: true, labels: [], auxFlags: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false }, createdAt: now, updatedAt: now },
    initialStageRun: { id: 'rt', taskId: 't', stageIndex: 0, stageName: 'S', role: 'user', status: 'approved', createdAt: now, updatedAt: now },
    event: { id: 'et', taskId: 't', type: 'task_created', createdAt: now },
  });
  assert.equal(store.getTask('t')!.schedulerAdmitted, true);
  store.updateTaskStage('t', 1, 'queued');
  const got = store.getTask('t');
  assert.ok(got);
  assert.equal(got!.schedulerAdmitted, false);
  assert.equal(got!.currentStageIndex, 1);
  assert.equal(got!.status, 'queued');
});

test('nextTaskNumber returns MAX(task_number)+1 per root (0 → 1)', () => {
  const store = newTestStore();
  const now = '2026-01-01T00:00:00.000Z';
  assert.equal(store.nextTaskNumber('root-1'), 1);
  store.createTask({
    task: { id: 'a', taskNumber: 1, rootId: 'root-1', taskTemplateId: 'tpl', createWorktree: true, currentStageIndex: 0, status: 'queued', schedulerAdmitted: false, labels: [], auxFlags: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false }, createdAt: now, updatedAt: now },
    initialStageRun: { id: 'ra', taskId: 'a', stageIndex: 0, stageName: 'S', role: 'user', status: 'approved', createdAt: now, updatedAt: now },
    event: { id: 'ea', taskId: 'a', type: 'task_created', createdAt: now },
  });
  store.createTask({
    task: { id: 'b', taskNumber: 5, rootId: 'root-1', taskTemplateId: 'tpl', createWorktree: true, currentStageIndex: 0, status: 'queued', schedulerAdmitted: false, labels: [], auxFlags: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false }, createdAt: now, updatedAt: now },
    initialStageRun: { id: 'rb', taskId: 'b', stageIndex: 0, stageName: 'S', role: 'user', status: 'approved', createdAt: now, updatedAt: now },
    event: { id: 'eb', taskId: 'b', type: 'task_created', createdAt: now },
  });
  assert.equal(store.nextTaskNumber('root-1'), 6);
  // 不同 root 独立计数
  assert.equal(store.nextTaskNumber('root-2'), 1);
});

test('labels survive corrupt JSON via fallback to []', () => {
  const dbPath = join(tmpdir(), `kanban-labels-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  const store = createTaskStore({ db });
  const now = '2026-01-01T00:00:00.000Z';
  store.createTask({
    task: { id: 't', taskNumber: 1, rootId: 'root-1', taskTemplateId: 'tpl', createWorktree: true, currentStageIndex: 0, status: 'queued', schedulerAdmitted: false, labels: ['bug', 'ui'], auxFlags: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false }, createdAt: now, updatedAt: now },
    initialStageRun: { id: 'rt', taskId: 't', stageIndex: 0, stageName: 'S', role: 'user', status: 'approved', createdAt: now, updatedAt: now },
    event: { id: 'et', taskId: 't', type: 'task_created', createdAt: now },
  });
  // 正常情况
  assert.deepEqual(store.getTask('t')!.labels, ['bug', 'ui']);
  // 破坏 labels_json
  db.prepare("UPDATE tasks SET labels_json = '{not valid json' WHERE id = ?").run('t');
  // 兜底返回 []
  const got = store.getTask('t');
  assert.ok(got);
  assert.deepEqual(got!.labels, []);
});

test('updateTaskWorktree persists worktreePath and worktreeBranch', () => {
  const store = newTestStore();
  const now = '2026-01-01T00:00:00.000Z';
  store.createTask({
    task: { id: 't', taskNumber: 1, rootId: 'root-1', taskTemplateId: 'tpl', createWorktree: true, currentStageIndex: 0, status: 'queued', schedulerAdmitted: false, labels: [], auxFlags: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false }, createdAt: now, updatedAt: now },
    initialStageRun: { id: 'rt', taskId: 't', stageIndex: 0, stageName: 'S', role: 'user', status: 'approved', createdAt: now, updatedAt: now },
    event: { id: 'et', taskId: 't', type: 'task_created', createdAt: now },
  });
  store.updateTaskWorktree('t', { worktreePath: '/repo/.worktree/x', worktreeBranch: 'kanban/1-aaaa' });
  const after = store.getTask('t');
  assert.equal(after?.worktreePath, '/repo/.worktree/x');
  assert.equal(after?.worktreeBranch, 'kanban/1-aaaa');
});

test('updateTaskWorktree no-op when no fields given', () => {
  const store = newTestStore();
  const now = '2026-01-01T00:00:00.000Z';
  store.createTask({
    task: { id: 't', taskNumber: 1, rootId: 'root-1', taskTemplateId: 'tpl', createWorktree: true, currentStageIndex: 0, status: 'queued', schedulerAdmitted: false, labels: [], auxFlags: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false }, createdAt: now, updatedAt: now },
    initialStageRun: { id: 'rt', taskId: 't', stageIndex: 0, stageName: 'S', role: 'user', status: 'approved', createdAt: now, updatedAt: now },
    event: { id: 'et', taskId: 't', type: 'task_created', createdAt: now },
  });
  const before = store.getTask('t');
  store.updateTaskWorktree('t', {});
  const after = store.getTask('t');
  assert.deepEqual(after?.worktreePath, before?.worktreePath);
});
