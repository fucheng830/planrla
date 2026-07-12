import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createScheduleStore } from '@/modules/kanban/schedule-store.js';

function db() {
  return new Database(
    join(tmpdir(), `sch-${Date.now()}-${Math.random().toString(36).slice(2)}.db`),
  );
}
const NOW = new Date().toISOString();
const base = {
  rootId: 'r1',
  taskTemplateId: 'tpl',
  cronExpression: '0 9 * * *',
  enabled: true,
  input: '',
  lastRunAt: null as string | null,
  createdAt: NOW,
  updatedAt: NOW,
};

test('save + get + list', () => {
  const s = createScheduleStore({ db: db() });
  const saved = s.saveSchedule({ ...base, id: 's1' });
  assert.equal(saved.id, 's1');
  assert.equal(s.getSchedule('s1')?.cronExpression, '0 9 * * *');
  assert.equal(s.listSchedules('r1').length, 1);
});

test('listAllEnabledSchedules only enabled', () => {
  const s = createScheduleStore({ db: db() });
  s.saveSchedule({ ...base, id: 's1', enabled: true });
  s.saveSchedule({ ...base, id: 's2', enabled: false });
  assert.equal(s.listAllEnabledSchedules().length, 1);
});

test('save updates existing (idempotent by id)', () => {
  const s = createScheduleStore({ db: db() });
  s.saveSchedule({ ...base, id: 's1', cronExpression: '0 9 * * *' });
  s.saveSchedule({ ...base, id: 's1', cronExpression: '*/5 * * * *' });
  assert.equal(s.listSchedules('r1').length, 1);
  assert.equal(s.getSchedule('s1')?.cronExpression, '*/5 * * * *');
});

test('delete + updateLastRun', () => {
  const s = createScheduleStore({ db: db() });
  s.saveSchedule({ ...base, id: 's1' });
  s.updateLastRun('s1', NOW);
  assert.equal(s.getSchedule('s1')?.lastRunAt, NOW);
  s.deleteSchedule('s1');
  assert.equal(s.getSchedule('s1'), null);
});
