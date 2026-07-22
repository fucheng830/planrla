import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';

import { createTaskStore } from '@/modules/kanban/store.js';
import { createTemplateStore } from '@/modules/kanban/template-store.js';
import { createKanbanService } from '@/modules/kanban/service.js';
import { createKanbanRouter } from '@/modules/kanban/kanban.routes.js';

const NOW = '2026-01-01T00:00:00.000Z';

function setupApp() {
  const db = new Database(join(tmpdir(), `route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`));
  db.pragma('journal_mode = WAL');
  const taskStore = createTaskStore({ db });
  const templateStore = createTemplateStore({ dir: join(tmpdir(), `route-tpl-${Date.now()}-${Math.random().toString(36).slice(2)}`) });
  const service = createKanbanService({ taskStore, templateStore });
  const router = createKanbanRouter({
    service, taskStore, templateStore,
    scheduler: { schedule: () => {} },
    scheduleStore: { listSchedules: () => [], listAllEnabledSchedules: () => [], getSchedule: () => null, saveSchedule: (s: any) => s, deleteSchedule: () => {}, updateLastRun: () => {} } as any,
    cronDriver: { reload: () => {} } as any,
    resolveRootPath: () => null,
    runner: { startReviewComment: () => { throw new Error('not used in this test'); } },
    resolveToolApproval: () => {},
  });
  const app = express();
  app.use(express.json());
  app.locals.wss = null;
  app.use('/api/tasks', router);
  return { app, db, templateStore, service };
}

function saveTpl(templateStore: any, id: string) {
  templateStore.saveTaskTemplate({
    id, name: `T-${id}`, maxConcurrency: 1, createdAt: NOW, updatedAt: NOW,
    stages: [
      { id: 's0', position: 0, snapshot: { id: 'ss0', name: 'Plan', role: 'user', autoAdvance: false, createdAt: NOW, updatedAt: NOW } },
      { id: 's1', position: 1, snapshot: { id: 'ss1', name: 'Do', role: 'user', autoAdvance: false, createdAt: NOW, updatedAt: NOW } },
    ],
  });
}

test('POST /api/tasks creates a task', async () => {
  const { app, db, templateStore } = setupApp();
  saveTpl(templateStore, 't1');
  const res = await request(app).post('/api/tasks').send({ rootId: 'r1', taskTemplateId: 't1', input: 'do thing' });
  assert.equal(res.status, 200);
  assert.equal(res.body.task.status, 'waiting_user');
  assert.equal(res.body.task.rootId, 'r1');
  db.close();
});

test('POST /api/tasks rejects missing rootId', async () => {
  const { app, db } = setupApp();
  const res = await request(app).post('/api/tasks').send({ taskTemplateId: 't1' });
  assert.equal(res.status, 400);
  db.close();
});

test('POST /api/tasks/:taskId/next advances stage', async () => {
  const { app, db, templateStore, service } = setupApp();
  saveTpl(templateStore, 't1');
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'x' });
  const res = await request(app).post(`/api/tasks/${task.id}/next`).send({ rootId: 'r1' });
  assert.equal(res.status, 200);
  assert.equal(res.body.task.currentStageIndex, 1);
  db.close();
});

test('POST /api/tasks/:taskId/next with wrong rootId returns 403', async () => {
  const { app, db, templateStore, service } = setupApp();
  saveTpl(templateStore, 't1');
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'x' });
  const res = await request(app).post(`/api/tasks/${task.id}/next`).send({ rootId: 'other-root' });
  assert.equal(res.status, 403);
  db.close();
});

test('GET /api/tasks lists tasks for root', async () => {
  const { app, db, templateStore, service } = setupApp();
  saveTpl(templateStore, 't1');
  service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'a' });
  service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'b' });
  const res = await request(app).get('/api/tasks').query({ rootId: 'r1' });
  assert.equal(res.status, 200);
  assert.equal(res.body.tasks.length, 2);
  db.close();
});

function setupAnswerApp(captured: any[]) {
  const db = new Database(join(tmpdir(), `route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`));
  db.pragma('journal_mode = WAL');
  const taskStore = createTaskStore({ db });
  const templateStore = createTemplateStore({ dir: join(tmpdir(), `route-tpl-${Date.now()}-${Math.random().toString(36).slice(2)}`) });
  const service = createKanbanService({ taskStore, templateStore });
  const router = createKanbanRouter({
    service, taskStore, templateStore,
    scheduler: { schedule: () => {} },
    scheduleStore: { listSchedules: () => [], listAllEnabledSchedules: () => [], getSchedule: () => null, saveSchedule: (s: any) => s, deleteSchedule: () => {}, updateLastRun: () => {} } as any,
    cronDriver: { reload: () => {} } as any,
    resolveRootPath: () => null,
    runner: { startReviewComment: () => { throw new Error('not used in this test'); } },
    resolveToolApproval: (requestId: string, decision: any) => { captured.push({ requestId, decision }); },
  });
  const app = express();
  app.use(express.json());
  app.locals.wss = null;
  app.use('/api/tasks', router);
  return { app, db, templateStore, service, taskStore };
}

test('POST /api/tasks/:taskId/answer resolves the pending approval and clears flags', async () => {
  const captured: any[] = [];
  const { app, db, templateStore, service, taskStore } = setupAnswerApp(captured);
  saveTpl(templateStore, 't1');
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'x' });
  taskStore.updateTaskAuxFlags(task.id, {
    askUserWaiting: true,
    pendingAskUser: { requestId: 'req-1', questions: { questions: [] }, capturedAt: NOW },
  });

  const res = await request(app)
    .post(`/api/tasks/${task.id}/answer`)
    .send({ rootId: 'r1', answers: ['option A'] });

  assert.equal(res.status, 200);
  assert.deepEqual(captured, [{ requestId: 'req-1', decision: { allow: true, updatedInput: ['option A'] } }]);
  assert.equal(res.body.task.auxFlags.askUserWaiting, false);
  assert.equal(res.body.task.auxFlags.pendingAskUser, null);
  db.close();
});

test('POST /api/tasks/:taskId/answer rejects when no question is pending', async () => {
  const captured: any[] = [];
  const { app, db, templateStore, service } = setupAnswerApp(captured);
  saveTpl(templateStore, 't1');
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'x' });

  const res = await request(app)
    .post(`/api/tasks/${task.id}/answer`)
    .send({ rootId: 'r1', answers: [] });

  assert.equal(res.status, 400);
  assert.equal(captured.length, 0);
  db.close();
});

test('POST /api/tasks/:taskId/answer rejects a task from another root', async () => {
  const captured: any[] = [];
  const { app, db, templateStore, service } = setupAnswerApp(captured);
  saveTpl(templateStore, 't1');
  const task = service.createTask({ rootId: 'r2', taskTemplateId: 't1', input: 'x' });

  const res = await request(app)
    .post(`/api/tasks/${task.id}/answer`)
    .send({ rootId: 'r1', answers: [] });

  assert.equal(res.status, 404);
  assert.equal(captured.length, 0);
  db.close();
});

// --------------------------- TaskMaster-inspired: /next + /expand ---------------------------

function setupAppWithDecompose(decomposePrdFn: any) {
  const db = new Database(join(tmpdir(), `route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`));
  db.pragma('journal_mode = WAL');
  const taskStore = createTaskStore({ db });
  const templateStore = createTemplateStore({ dir: join(tmpdir(), `route-tpl-${Date.now()}-${Math.random().toString(36).slice(2)}`) });
  const service = createKanbanService({ taskStore, templateStore });
  const router = createKanbanRouter({
    service, taskStore, templateStore,
    scheduler: { schedule: () => {} },
    scheduleStore: { listSchedules: () => [], listAllEnabledSchedules: () => [], getSchedule: () => null, saveSchedule: (s: any) => s, deleteSchedule: () => {}, updateLastRun: () => {} } as any,
    cronDriver: { reload: () => {} } as any,
    resolveRootPath: () => null,
    runner: { startReviewComment: () => { throw new Error('not used in this test'); } },
    resolveToolApproval: () => {},
    decomposePrdFn,
  });
  const app = express();
  app.use(express.json());
  app.locals.wss = null;
  app.use('/api/tasks', router);
  return { app, db, templateStore, service, taskStore };
}

test('GET /api/tasks/next returns the highest-priority runnable task', async () => {
  const { app, db, templateStore, service } = setupAppWithDecompose(undefined);
  saveTpl(templateStore, 't1');
  service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'later', priority: 'low' });
  const high = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'urgent', priority: 'high' });
  const res = await request(app).get('/api/tasks/next?rootId=r1');
  assert.equal(res.status, 200);
  assert.equal(res.body.task.id, high.id);
  db.close();
});

test('GET /api/tasks/next returns null task when nothing is runnable', async () => {
  const { app, db } = setupAppWithDecompose(undefined);
  const res = await request(app).get('/api/tasks/next?rootId=r1');
  assert.equal(res.status, 200);
  assert.equal(res.body.task, null);
  db.close();
});

test('POST /api/tasks/:taskId/expand decomposes and replaces the task', async () => {
  const calls: any[] = [];
  const decomposePrdFn = async (opts: any) => {
    calls.push(opts);
    return [
      { title: 'a', input: 'part a', priority: 'medium', dependsOn: [] },
      { title: 'b', input: 'part b', priority: 'high', dependsOn: [0] },
    ];
  };
  const { app, db, templateStore, service, taskStore } = setupAppWithDecompose(decomposePrdFn);
  saveTpl(templateStore, 't1');
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'big thing' });
  const res = await request(app).post(`/api/tasks/${task.id}/expand`).send({ rootId: 'r1' });
  assert.equal(res.status, 200);
  assert.equal(res.body.created.length, 2);
  assert.equal(res.body.cancelled.status, 'cancelled');
  assert.equal(res.body.created[1].dependencies[0], res.body.created[0].id);
  assert.equal(calls.length, 1);
  assert.match(calls[0].prd, /big thing/);
  assert.ok(taskStore.listTaskEvents(task.id).some((e) => e.type === 'task_expanded'));
  db.close();
});
