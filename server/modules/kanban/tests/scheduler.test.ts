import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import { createTaskStore } from '@/modules/kanban/store.js';
import { createTemplateStore } from '@/modules/kanban/template-store.js';
import { createKanbanService } from '@/modules/kanban/service.js';
import { createScheduler } from '@/modules/kanban/scheduler.js';

const NOW = '2026-01-01T00:00:00.000Z';

function setup() {
  const db = new Database(join(tmpdir(), `sch-${Date.now()}-${Math.random().toString(36).slice(2)}.db`));
  db.pragma('journal_mode = WAL');
  const taskStore = createTaskStore({ db });
  const templateStore = createTemplateStore({ dir: join(tmpdir(), `sch-tpl-${Date.now()}-${Math.random().toString(36).slice(2)}`) });
  const service = createKanbanService({ taskStore, templateStore });
  const admitted: string[] = [];
  const scheduler = createScheduler({ taskStore, templateStore, onAdmit: (taskId: string) => admitted.push(taskId) });
  return { db, taskStore, templateStore, service, scheduler, admitted };
}

function saveTpl(templateStore: ReturnType<typeof createTemplateStore>, id: string, maxConcurrency: number) {
  templateStore.saveTaskTemplate({
    id, name: `T-${id}`, maxConcurrency, createdAt: NOW, updatedAt: NOW,
    stages: [{ id: 's0', position: 0, snapshot: { id: 'ss0', name: 'Plan', role: 'user', autoAdvance: true, createdAt: NOW, updatedAt: NOW } }],
  });
}

test('schedule admits queued tasks up to maxConcurrency', () => {
  const { db, templateStore, service, scheduler, admitted } = setup();
  saveTpl(templateStore, 't1', 2);
  service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'a' });
  service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'b' });
  service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'c' });
  scheduler.schedule('r1');
  assert.equal(admitted.length, 2);
  db.close();
});

test('schedule marks admitted tasks as running + schedulerAdmitted=true', () => {
  const { db, templateStore, service, scheduler, taskStore } = setup();
  saveTpl(templateStore, 't1', 1);
  service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'a' });
  scheduler.schedule('r1');
  const tasks = taskStore.listTasks('r1');
  const t = tasks[0];
  assert.equal(t.status, 'running');
  assert.equal(t.schedulerAdmitted, true);
  db.close();
});

test('schedule skips already-admitted tasks on re-trigger', () => {
  const { db, templateStore, service, scheduler, admitted } = setup();
  saveTpl(templateStore, 't1', 1);
  service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'a' });
  scheduler.schedule('r1');
  scheduler.schedule('r1');
  assert.equal(admitted.length, 1);
  db.close();
});

test('schedule respects maxConcurrency across multiple templates', () => {
  const { db, templateStore, service, scheduler, admitted } = setup();
  saveTpl(templateStore, 't1', 1);
  saveTpl(templateStore, 't2', 1);
  service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'a' });
  service.createTask({ rootId: 'r1', taskTemplateId: 't2', input: 'b' });
  scheduler.schedule('r1');
  // 简化版 hasSlot 不区分模板,used 全局计:第 2 个任务 used=1>=limit=1 → 不 admit?
  // 决策 2 简化:强制 worktree,hasSlot 只看全局 used < 该任务模板的 limit
  // 实现细节:used 计所有 admitted 非终态任务;limit 用 candidate 的模板 maxConcurrency
  // 这个测试验证行为:两个不同模板,各自 limit=1,但 used 全局计 → 只 admit 1 个(简化版语义)
  assert.equal(admitted.length, 1); // 简化版全局 used
  db.close();
});

test('schedule on root with no tasks does not throw', () => {
  const { db, scheduler } = setup();
  assert.doesNotThrow(() => scheduler.schedule('empty-root'));
  db.close();
});

test('schedule holds tasks with unmet dependencies until dependency succeeds', () => {
  const { db, templateStore, service, scheduler, admitted } = setup();
  saveTpl(templateStore, 't1', 10);
  const dep = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'dep' });
  service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'blocked', dependencies: [dep.id] });

  scheduler.schedule('r1');
  assert.deepEqual(admitted, [dep.id]);

  // dep 走到 success 后(单阶段模板 next 即完成),被阻塞的任务才能进槽
  service.next('r1', dep.id);
  scheduler.schedule('r1');
  assert.equal(admitted.length, 2);
  db.close();
});

test('schedule admits higher priority tasks first', () => {
  const { db, templateStore, service, scheduler, admitted } = setup();
  saveTpl(templateStore, 't1', 2);
  service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'low', priority: 'low' });
  const high = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'high', priority: 'high' });
  service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'mid' });

  scheduler.schedule('r1');
  assert.equal(admitted[0], high.id);
  assert.equal(admitted.length, 2);
  db.close();
});

test('createTask rejects unknown or cross-root dependencies and bad priority', () => {
  const { db, service, templateStore } = setup();
  saveTpl(templateStore, 't1', 1);
  const other = service.createTask({ rootId: 'r2', taskTemplateId: 't1', input: 'other' });

  assert.throws(
    () => service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'x', dependencies: ['missing-id'] }),
    /dependency task .* not found/,
  );
  assert.throws(
    () => service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'x', dependencies: [other.id] }),
    /dependency task .* not found/,
  );
  assert.throws(
    () => service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'x', priority: 'urgent' as any }),
    /invalid priority/,
  );
  db.close();
});
