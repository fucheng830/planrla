import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskStore } from '@/modules/kanban/store.js';
import { createTemplateStore } from '@/modules/kanban/template-store.js';
import { createScheduleStore } from '@/modules/kanban/schedule-store.js';
import { createKanbanService } from '@/modules/kanban/service.js';
import { createKanbanCron, type CronModule } from '@/modules/kanban/cron-driver.js';

/**
 * Mock cron module: captures the latest scheduled callback so the test can
 * fire it manually (no real timer). Mirrors the cron-driver test pattern but
 * goes through the real scheduleStore + service for an end-to-end flow.
 */
function mockCron(): { mod: CronModule; fire: () => void } {
  let cb: (() => void) | null = null;
  const mod: CronModule = {
    schedule: (_expr, c) => {
      cb = c;
      return { stop: () => { cb = null; } };
    },
    validate: (expr) => /^[0-9*/ ]+$/.test(expr), // permissive: allow "0 9 * * *"
  };
  return { mod, fire: () => cb?.() };
}

const NOW = new Date().toISOString();

/** Builds an in-memory kanban stack (stores + service + driver) for one test. */
function makeStack() {
  const db = new Database(join(tmpdir(), `w4x-${Date.now()}-${Math.random().toString(36).slice(2)}.db`));
  const taskStore = createTaskStore({ db });
  const templateStore = createTemplateStore({ dir: mkdtempSync(join(tmpdir(), 'w4x-tpl-')) });
  const scheduleStore = createScheduleStore({ db });
  // A real template is required for service.createTask to succeed.
  const tpl = templateStore.saveTaskTemplate({
    id: 'tpl1', name: 'T', maxConcurrency: 1,
    stages: [{
      id: 'ss', position: 0,
      snapshot: { id: 's1', name: 'do', role: 'user', autoAdvance: true, createdAt: NOW, updatedAt: NOW },
    }],
    createdAt: NOW, updatedAt: NOW,
  } as any);
  const service = createKanbanService({ taskStore, templateStore });
  const { mod, fire } = mockCron();
  const driver = createKanbanCron({ scheduleStore, service, cron: mod });
  return { scheduleStore, service, driver, tpl, fire };
}

test('integration: schedule saved → cronDriver.start registers → firing creates a task + updates lastRunAt', () => {
  const { scheduleStore, service, driver, tpl, fire } = makeStack();

  scheduleStore.saveSchedule({
    id: 'sch1', rootId: 'r1', taskTemplateId: tpl.id,
    cronExpression: '0 9 * * *', enabled: true,
    input: 'daily-report', lastRunAt: null,
    createdAt: NOW, updatedAt: NOW,
  });
  driver.start();

  // before fire: no task
  assert.equal(service.listTasks('r1').length, 0);

  // fire the cron callback
  fire();

  // after fire: a task exists for r1, derived from the scheduled template
  const tasks = service.listTasks('r1');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].taskTemplateId, tpl.id);

  // lastRunAt updated by the driver after the trigger
  const sch = scheduleStore.getSchedule('sch1');
  assert.ok(sch?.lastRunAt, 'schedule lastRunAt updated after trigger');
});

test('integration: reload after delete stops the schedule (firing is a no-op)', () => {
  const { scheduleStore, service, driver, tpl, fire } = makeStack();

  scheduleStore.saveSchedule({
    id: 'sch1', rootId: 'r1', taskTemplateId: tpl.id,
    cronExpression: '0 9 * * *', enabled: true,
    input: '', lastRunAt: null,
    createdAt: NOW, updatedAt: NOW,
  });
  driver.start();

  scheduleStore.deleteSchedule('sch1');
  driver.reload();   // simulates the router's cronDriver.reload() after delete

  fire();            // the old callback was stopped → fire is a no-op (cb null)
  assert.equal(service.listTasks('r1').length, 0);  // no task created
});
