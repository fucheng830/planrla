import assert from 'node:assert/strict';
import test from 'node:test';

import type { Task } from '../../kanban/types';

import { buildInboxThreads, formatRelativeTime } from './inboxThreads';

const task = (overrides: Partial<Task>): Task => ({
  id: 'task-1',
  taskNumber: 7,
  rootId: 'root-1',
  taskTemplateId: 'tpl-1',
  createWorktree: false,
  currentStageIndex: 0,
  status: 'running',
  schedulerAdmitted: true,
  labels: [],
  auxFlags: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false },
  createdAt: '2026-08-25T10:00:00.000Z',
  updatedAt: '2026-08-25T10:00:00.000Z',
  ...overrides,
});

test('formatRelativeTime buckets timestamps', () => {
  assert.equal(formatRelativeTime(Date.now() - 5_000), '刚刚');
  assert.equal(formatRelativeTime(Date.now() - 5 * 60_000), '5 分钟前');
  assert.equal(formatRelativeTime(Date.now() - 3 * 3_600_000), '3 小时前');
  assert.equal(formatRelativeTime(Date.now() - 2 * 86_400_000), '2 天前');
  assert.equal(formatRelativeTime(null), '—');
  assert.equal(formatRelativeTime('not-a-date'), '—');
});

test('buildInboxThreads maps waiting kanban tasks to unread AI threads', () => {
  const threads = buildInboxThreads({
    projectName: 'planrla',
    tasks: [task({ id: 'w1', status: 'waiting_user' })],
    runningSessions: [],
    cronTasks: [],
  });
  assert.equal(threads.length, 1);
  assert.equal(threads[0].channel, 'ai');
  assert.equal(threads[0].state, 'waiting');
  assert.equal(threads[0].unread, true);
  assert.match(threads[0].title, /任务 #7 等待确认/);
});

test('buildInboxThreads surfaces running sessions and cron runs from real sources', () => {
  const threads = buildInboxThreads({
    projectName: 'planrla',
    tasks: [task({ id: 'r1', status: 'running' })],
    runningSessions: [{ sessionId: 'sess-abcd1234', provider: 'claude', startedAt: Date.now() - 60_000 }],
    cronTasks: [
      { id: 'c1', name: '每日总结', provider: 'claude', cronExpression: '0 18 * * *', lastRunAt: '2026-08-25T10:00:00.000Z', runCount: 12 },
    ],
  });
  assert.equal(threads.length, 3);
  const running = threads.find((t) => t.id === 'session-running-sess-abcd1234');
  assert.equal(running?.channel, 'ai');
  assert.equal(running?.state, 'running');
  const cron = threads.find((t) => t.id === 'cron-run-c1');
  assert.equal(cron?.channel, 'system');
  assert.match(cron?.preview ?? '', /第 12 次触发/);
});

test('buildInboxThreads skips terminal tasks and never-run cron prompts', () => {
  const threads = buildInboxThreads({
    projectName: 'planrla',
    tasks: [
      task({ id: 'ok', status: 'success' }),
      task({ id: 'cancel', status: 'cancelled' }),
      task({ id: 'fail', status: 'fail' }),
    ],
    runningSessions: [],
    cronTasks: [{ id: 'c2', name: '未跑过', provider: 'claude', cronExpression: '0 9 * * *', lastRunAt: null, runCount: 0 }],
  });
  assert.deepEqual(threads.map((t) => t.id), ['kanban-fail-fail']);
});

test('buildInboxThreads orders waiting before running before complete', () => {
  const threads = buildInboxThreads({
    projectName: 'planrla',
    tasks: [task({ id: 'r', status: 'running' }), task({ id: 'w', status: 'waiting_user' })],
    runningSessions: [],
    cronTasks: [{ id: 'c', name: 'n', provider: 'claude', cronExpression: '* * * * *', lastRunAt: new Date().toISOString(), runCount: 1 }],
  });
  assert.deepEqual(threads.map((t) => t.state), ['waiting', 'running', 'complete']);
});
