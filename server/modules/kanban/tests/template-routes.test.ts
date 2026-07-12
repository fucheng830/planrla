import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskStore } from '@/modules/kanban/store.js';
import { createTemplateStore } from '@/modules/kanban/template-store.js';
import { createKanbanService } from '@/modules/kanban/service.js';
import { createKanbanRouter } from '@/modules/kanban/kanban.routes.js';

function setup() {
  const db = new Database(join(tmpdir(), `kanban-tpl-${Date.now()}-${Math.random().toString(36).slice(2)}.db`));
  const taskStore = createTaskStore({ db });
  const dir = mkdtempSync(join(tmpdir(), 'kanban-tpl-route-'));
  const templateStore = createTemplateStore({ dir });
  const service = createKanbanService({ taskStore, templateStore });
  const router = createKanbanRouter({ service, templateStore });
  const app = express();
  app.use(express.json());
  app.locals.wss = null;
  app.use('/api/tasks', router);
  return { app, templateStore, dir };
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

test('POST /templates with path-traversal id is rejected (400) and writes no file outside templates dir', async () => {
  const { app, templateStore } = setup();
  const res = await request(app).post('/api/tasks/templates').send({ ...validTpl, id: '../evil' });
  assert.equal(res.status, 400);
  // confirm no template got saved under any reachable id
  assert.equal(templateStore.getTaskTemplate('../evil'), null);
  assert.equal(templateStore.getTaskTemplate('evil'), null);
  // list should not contain it
  assert.equal(templateStore.listTaskTemplates().length, 0);
});

test('POST /templates with id containing slash is rejected (400)', async () => {
  const { app } = setup();
  const res = await request(app).post('/api/tasks/templates').send({ ...validTpl, id: 'a/b' });
  assert.equal(res.status, 400);
});

test('store-level path-traversal defense: bad-id save throws AppError(400), bad-id delete is a safe no-op', () => {
  const { templateStore, dir } = setup();
  // save with traversal id must throw (no file written outside templates dir)
  assert.throws(
    () => templateStore.saveTaskTemplate({ ...validTpl, id: '../evil' } as any),
    (err: any) => err.statusCode === 400 && err.code === 'TEMPLATE_INVALID',
  );
  // delete with traversal id must NOT throw and must NOT remove anything
  assert.doesNotThrow(() => templateStore.deleteTaskTemplate('../evil'));
  // get with traversal id returns null (never constructs an unsafe path)
  assert.equal(templateStore.getTaskTemplate('../evil'), null);

  // Filesystem-level invariant: the ONLY entries in the parent dir are the
  // `kanban-templates/` subdir itself — no `task_template-*.json` escaped to
  // the parent via a traversal id. This is the load-bearing security check.
  const parentEntries = readdirSync(dir);
  assert.deepEqual(parentEntries, ['kanban-templates'], `parent dir must only contain the templates subdir, got ${JSON.stringify(parentEntries)}`);
  const templatesEntries = readdirSync(join(dir, 'kanban-templates'));
  assert.equal(templatesEntries.length, 0, `templates dir must be empty, got ${JSON.stringify(templatesEntries)}`);
});

test('DELETE /templates/:id with path-traversal id is a safe no-op (200, deletes nothing)', async () => {
  const { app, templateStore } = setup();
  await request(app).post('/api/tasks/templates').send(validTpl);
  // Store-level defense is the trust boundary (HTTP layer may normalize `../`).
  // A traversal id must not throw and must not remove anything outside the dir.
  assert.doesNotThrow(() => templateStore.deleteTaskTemplate('../evil'));
  assert.doesNotThrow(() => templateStore.deleteTaskTemplate('a/b'));
  assert.ok(templateStore.getTaskTemplate('tpl-a'), 'legit template still present');
  // HTTP-level: Express rewrites `/../evil`, so this primarily asserts the route
  // does not crash and the legit template survives the request.
  const del = await request(app).delete('/api/tasks/templates/../evil');
  assert.ok(del.status < 500, `expected non-5xx, got ${del.status}`);
  assert.ok(templateStore.getTaskTemplate('tpl-a'), 'legit template survives HTTP delete');
});

test('POST /templates response includes store normalization (updatedAt, stage position)', async () => {
  const { app } = setup();
  const res = await request(app).post('/api/tasks/templates').send(validTpl);
  assert.ok(res.body.template.updatedAt, 'updatedAt should be stamped');
  assert.equal(res.body.template.stages[0].position, 0);
});
