import assert from 'node:assert/strict';
import test from 'node:test';

import { createKanbanCron, type CronModule } from '@/modules/kanban/cron-driver.js';

function mockCron(): {
  mod: CronModule;
  registered: { id: string; expr: string; cb: () => void; stopped: boolean }[];
} {
  const registered: { id: string; expr: string; cb: () => void; stopped: boolean }[] = [];
  const mod: CronModule = {
    schedule: (expr, cb) => {
      const id = `task-${registered.length}`;
      const entry = { id, expr, cb, stopped: false };
      registered.push(entry);
      return { stop: () => { entry.stopped = true; } };
    },
    validate: (expr) => /^[0-9*/ ]+$/.test(expr), // permissive: allow "0 9 * * *"
  };
  return { mod, registered };
}

test('start registers all enabled schedules', () => {
  const { mod, registered } = mockCron();
  const scheduleStore = {
    listAllEnabledSchedules: () => [
      { id: 's1', rootId: 'r1', taskTemplateId: 'tpl', cronExpression: '0 9 * * *', input: 'a', enabled: true } as any,
      { id: 's2', rootId: 'r1', taskTemplateId: 'tpl', cronExpression: '*/5 * * * *', input: 'b', enabled: true } as any,
    ],
    updateLastRun: () => {},
  } as any;
  const driver = createKanbanCron({ scheduleStore, service: { createTask: () => {} } as any, cron: mod });
  driver.start();
  assert.equal(registered.length, 2);
  assert.equal(registered[0].expr, '0 9 * * *');
});

test('trigger (firing registered callback) calls service.createTask + updateLastRun', () => {
  const { mod, registered } = mockCron();
  const created: any[] = [];
  const lastRuns: string[] = [];
  const scheduleStore = {
    listAllEnabledSchedules: () => [
      { id: 's1', rootId: 'r1', taskTemplateId: 'tpl', cronExpression: '0 9 * * *', input: 'morning', enabled: true } as any,
    ],
    updateLastRun: (id: string, _at: string) => { lastRuns.push(id); },
  } as any;
  const service = {
    createTask: (a: any) => { created.push(a); return { id: 'task-1' }; },
  } as any;
  const driver = createKanbanCron({ scheduleStore, service, cron: mod });
  driver.start();
  registered[0].cb(); // fire the registered callback manually (simulates cron triggering)
  assert.deepEqual(created, [{ rootId: 'r1', taskTemplateId: 'tpl', input: 'morning' }]);
  assert.deepEqual(lastRuns, ['s1']);
});

test('trigger schedules the root so the fresh task is admitted immediately', () => {
  const { mod, registered } = mockCron();
  const scheduledRoots: string[] = [];
  const scheduleStore = {
    listAllEnabledSchedules: () => [
      { id: 's1', rootId: 'r1', taskTemplateId: 'tpl', cronExpression: '0 9 * * *', input: 'x', enabled: true } as any,
    ],
    updateLastRun: () => {},
  } as any;
  const service = { createTask: () => ({ id: 'task-1' }) } as any;
  const scheduler = { schedule: (rootId: string) => { scheduledRoots.push(rootId); } };
  const driver = createKanbanCron({ scheduleStore, service, scheduler, cron: mod });
  driver.start();
  registered[0].cb();
  assert.deepEqual(scheduledRoots, ['r1']);
});

test('reload stops all + re-registers from store', () => {
  const { mod, registered } = mockCron();
  let count = 1;
  let prefix = 'a';
  const scheduleStore = {
    listAllEnabledSchedules: () =>
      Array.from(
        { length: count },
        (_, i) =>
          ({ id: `${prefix}${i + 1}`, rootId: 'r1', taskTemplateId: 'tpl', cronExpression: '0 9 * * *', input: '', enabled: true }) as any,
      ),
    updateLastRun: () => {},
  } as any;
  const driver = createKanbanCron({ scheduleStore, service: { createTask: () => {} } as any, cron: mod });
  driver.start();
  assert.equal(registered.length, 1);
  count = 3;
  prefix = 'b';
  driver.reload();
  assert.equal(registered.length, 4); // 1 original (stopped) + 3 re-registered
  assert.equal(registered[0].stopped, true); // the original was stopped
  assert.equal(registered[1].id, 'task-1'); // re-registered tasks are new entries
  assert.equal(registered[1].stopped, false);
});

test('invalid cron expression is skipped (not registered)', () => {
  const { mod, registered } = mockCron();
  const scheduleStore = {
    listAllEnabledSchedules: () => [
      { id: 's1', rootId: 'r1', taskTemplateId: 'tpl', cronExpression: 'not-a-cron-expr!!!', input: '', enabled: true } as any,
    ],
    updateLastRun: () => {},
  } as any;
  const driver = createKanbanCron({ scheduleStore, service: { createTask: () => {} } as any, cron: mod });
  driver.start();
  assert.equal(registered.length, 0); // validate failed → skipped
});

test('stop clears all registered tasks', () => {
  const { mod, registered } = mockCron();
  const scheduleStore = {
    listAllEnabledSchedules: () => [
      { id: 's1', rootId: 'r1', taskTemplateId: 'tpl', cronExpression: '0 9 * * *', input: '', enabled: true } as any,
    ],
    updateLastRun: () => {},
  } as any;
  const driver = createKanbanCron({ scheduleStore, service: { createTask: () => {} } as any, cron: mod });
  driver.start();
  driver.stop();
  assert.equal(registered[0].stopped, true);
});
