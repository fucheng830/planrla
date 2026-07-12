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
import { createScheduleStore } from '@/modules/kanban/schedule-store.js';
import { createKanbanService } from '@/modules/kanban/service.js';
import { createKanbanRouter } from '@/modules/kanban/kanban.routes.js';

function setup() {
  const db = new Database(join(tmpdir(), `sch-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`));
  const taskStore = createTaskStore({ db });
  const templateStore = createTemplateStore({ dir: mkdtempSync(join(tmpdir(), 'sch-route-tpl-')) });
  const scheduleStore = createScheduleStore({ db });
  const service = createKanbanService({ taskStore, templateStore });
  const reloadCalls: number[] = [];
  const router = createKanbanRouter({
    service, templateStore,
    scheduler: { schedule: () => {} },
    scheduleStore,
    cronDriver: { reload: () => { reloadCalls.push(1); } },
  });
  const app = express();
  app.use(express.json());
  app.locals.wss = null;
  // fake auth so req.user.userId exists (needed for notification calls in POST /)
  app.use((req: any, _res: any, next: any) => { req.user = { userId: 1 }; next(); });
  app.use('/api/tasks', router);
  return { app, scheduleStore, reloadCalls, db };
}

const NOW = '2026-01-01T00:00:00.000Z';
const validSch = {
  id: 'sch1',
  rootId: 'r1',
  taskTemplateId: 'tpl',
  cronExpression: '0 9 * * *',
  enabled: true,
  input: 'morning',
  lastRunAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

test('POST /schedules with valid cron saves + reloads driver', async () => {
  const { app, reloadCalls, db } = setup();
  const res = await request(app).post('/api/tasks/schedules').send(validSch);
  assert.equal(res.status, 200);
  assert.equal(res.body.schedule.id, 'sch1');
  assert.equal(res.body.schedule.cronExpression, '0 9 * * *');
  assert.equal(reloadCalls.length, 1, 'cronDriver.reload should be called once after save');
  db.close();
});

test('POST /schedules with invalid cron returns 400 and skips save', async () => {
  const { app, reloadCalls, scheduleStore, db } = setup();
  const res = await request(app).post('/api/tasks/schedules').send({ ...validSch, cronExpression: 'not-valid!!' });
  assert.equal(res.status, 400);
  assert.match(JSON.stringify(res.body), /invalid cronExpression/);
  assert.equal(reloadCalls.length, 0, 'cronDriver.reload must NOT be called on invalid cron');
  assert.equal(scheduleStore.getSchedule('sch1'), null, 'invalid schedule must not be persisted');
  db.close();
});

test('POST /schedules with missing cronExpression returns 400', async () => {
  const { app, db } = setup();
  const { cronExpression, ...noCron } = validSch as any;
  const res = await request(app).post('/api/tasks/schedules').send(noCron);
  assert.equal(res.status, 400);
  db.close();
});

test('GET /schedules?rootId lists saved schedules', async () => {
  const { app, db } = setup();
  await request(app).post('/api/tasks/schedules').send(validSch);
  const res = await request(app).get('/api/tasks/schedules').query({ rootId: 'r1' });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.schedules));
  assert.ok(res.body.schedules.some((s: any) => s.id === 'sch1'));
  db.close();
});

test('GET /schedules without rootId returns 400', async () => {
  const { app, db } = setup();
  const res = await request(app).get('/api/tasks/schedules');
  assert.equal(res.status, 400);
  db.close();
});

test('GET /schedules?rootId only returns schedules for that root', async () => {
  const { app, db } = setup();
  await request(app).post('/api/tasks/schedules').send(validSch);
  await request(app).post('/api/tasks/schedules').send({ ...validSch, id: 'sch2', rootId: 'r2' });
  const r1 = await request(app).get('/api/tasks/schedules').query({ rootId: 'r1' });
  const r2 = await request(app).get('/api/tasks/schedules').query({ rootId: 'r2' });
  assert.equal(r1.body.schedules.length, 1);
  assert.equal(r2.body.schedules.length, 1);
  db.close();
});

test('DELETE /schedules/:id removes + reloads driver', async () => {
  const { app, reloadCalls, scheduleStore, db } = setup();
  await request(app).post('/api/tasks/schedules').send(validSch);
  const before = reloadCalls.length;
  const res = await request(app).delete('/api/tasks/schedules/sch1');
  assert.equal(res.status, 200);
  assert.equal(reloadCalls.length, before + 1, 'cronDriver.reload should be called after delete');
  assert.equal(scheduleStore.getSchedule('sch1'), null, 'schedule must be deleted from store');
  const list = await request(app).get('/api/tasks/schedules').query({ rootId: 'r1' });
  assert.equal(list.body.schedules.length, 0);
  db.close();
});

test('POST /schedules (upsert) on existing id updates + reloads', async () => {
  const { app, scheduleStore, reloadCalls, db } = setup();
  await request(app).post('/api/tasks/schedules').send(validSch);
  const before = reloadCalls.length;
  // change cron expression, keep id
  const res = await request(app).post('/api/tasks/schedules').send({ ...validSch, cronExpression: '*/5 * * * *' });
  assert.equal(res.status, 200);
  assert.equal(reloadCalls.length, before + 1, 'reload should fire on update');
  assert.equal(scheduleStore.listSchedules('r1').length, 1, 'still one schedule (upsert, not insert)');
  assert.equal(scheduleStore.getSchedule('sch1')?.cronExpression, '*/5 * * * *');
  db.close();
});
