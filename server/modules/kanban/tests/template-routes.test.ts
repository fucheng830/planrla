import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
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
