import test from 'node:test';
import assert from 'node:assert/strict';

import { formatUtcSqlite, parseNaiveUtcIso, shouldCatchUp } from './catch-up.js';

const NOW = Date.UTC(2026, 8, 22, 2, 0, 0); // 2026-09-22 10:00 本地(UTC+8)

test('shouldCatchUp: 错过的计划点需要补跑', () => {
  const task = { enabled: true, catchUp: true, nextRunAt: '2026-09-22 01:00:00' };
  assert.deepEqual(shouldCatchUp(task, NOW), { shouldCatchUp: true });
});

test('shouldCatchUp: 未到计划点不补跑', () => {
  const task = { enabled: true, catchUp: true, nextRunAt: '2026-09-22 03:00:00' };
  assert.equal(shouldCatchUp(task, NOW).shouldCatchUp, false);
});

test('shouldCatchUp: 超过 7 天窗口不补跑(任务失效)', () => {
  const task = { enabled: true, catchUp: true, nextRunAt: '2026-09-01 01:00:00' };
  assert.deepEqual(shouldCatchUp(task, NOW), { shouldCatchUp: false, reason: 'too-old' });
});

test('shouldCatchUp: 关闭开关/禁用/无计划点均不补跑', () => {
  assert.equal(shouldCatchUp({ enabled: true, catchUp: false, nextRunAt: '2026-09-22 01:00:00' }, NOW).shouldCatchUp, false);
  assert.equal(shouldCatchUp({ enabled: false, catchUp: true, nextRunAt: '2026-09-22 01:00:00' }, NOW).shouldCatchUp, false);
  assert.equal(shouldCatchUp({ enabled: true, catchUp: true, nextRunAt: null }, NOW).shouldCatchUp, false);
});

test('parseNaiveUtcIso: SQLite CURRENT_TIMESTAMP 裸串按 UTC 解析', () => {
  assert.equal(parseNaiveUtcIso('2026-09-22 01:00:00'), Date.UTC(2026, 8, 22, 1, 0, 0));
  assert.equal(parseNaiveUtcIso('2026-09-22T01:00:00Z'), Date.UTC(2026, 8, 22, 1, 0, 0));
  assert.equal(parseNaiveUtcIso('garbage'), null);
});

test('formatUtcSqlite: 毫秒转 SQLite 裸串', () => {
  assert.equal(formatUtcSqlite(Date.UTC(2026, 8, 22, 1, 2, 3)), '2026-09-22 01:02:03');
});
