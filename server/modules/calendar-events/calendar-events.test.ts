import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';
import request from 'supertest';

import { closeConnection, initializeDatabase } from '@/modules/database/index.js';

import { createCalendarEventsRouter } from './calendar-events.routes.js';
import { calendarEventsStore } from './calendar-events.store.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'calendar-events-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function testApp() {
  const app = express();
  app.use(express.json());
  app.use(createCalendarEventsRouter());
  return app;
}

test('POST /calendar-events persists a one-time event and GET returns it', async () => {
  await withIsolatedDatabase(async () => {
    const app = testApp();
    const res = await request(app)
      .post('/')
      .send({
        title: '成片最终验收',
        startsAt: '2026-08-28T16:00',
        durationMinutes: 90,
        remindMinutes: 15,
        notes: '准备验收清单',
        projectPath: 'C:/workspace/项目/planrla',
      });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.title, '成片最终验收');
    assert.equal(res.body.data.durationMinutes, 90);
    assert.deepEqual(res.body.data.assignees, []);

    const list = await request(app).get('/');
    assert.equal(list.status, 200);
    assert.equal(list.body.data.length, 1);
  });
});

test('GET ?projectPath matches windows and unix separators case-insensitively', async () => {
  await withIsolatedDatabase(async () => {
    calendarEventsStore.create({
      title: 'A',
      startsAt: '2026-08-28T16:00',
      projectPath: 'C:/Workspace/项目/Planrla',
    });
    calendarEventsStore.create({
      title: 'B',
      startsAt: '2026-08-29T10:00',
      projectPath: 'D:/other/project',
    });

    const scoped = await request(testApp()).get('/').query({ projectPath: 'c:\\workspace\\项目\\planrla\\' });
    assert.equal(scoped.status, 200);
    assert.equal(scoped.body.data.length, 1);
    assert.equal(scoped.body.data[0].title, 'A');
  });
});

test('POST rejects invalid payloads with 400', async () => {
  await withIsolatedDatabase(async () => {
    const app = testApp();
    const noTitle = await request(app).post('/').send({ startsAt: '2026-08-28T16:00', projectPath: 'C:/p' });
    assert.equal(noTitle.status, 400);

    const badStartsAt = await request(app)
      .post('/')
      .send({ title: 'x', startsAt: '2026-08-28 16:00', projectPath: 'C:/p' });
    assert.equal(badStartsAt.status, 400);
    assert.match(badStartsAt.body.error, /startsAt/);

    const noProject = await request(app).post('/').send({ title: 'x', startsAt: '2026-08-28T16:00' });
    assert.equal(noProject.status, 400);
  });
});

test('DELETE removes an event; unknown ids 404', async () => {
  await withIsolatedDatabase(async () => {
    const app = testApp();
    const created = calendarEventsStore.create({ title: 'x', startsAt: '2026-08-28T16:00', projectPath: 'C:/p' });

    const gone = await request(app).delete(`/${created.id}`);
    assert.equal(gone.status, 200);
    assert.equal(calendarEventsStore.list().length, 0);

    const missing = await request(app).delete('/nope');
    assert.equal(missing.status, 404);
  });
});
