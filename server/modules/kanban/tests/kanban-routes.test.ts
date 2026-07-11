import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  const router = createKanbanRouter({ service, templateStore });
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
