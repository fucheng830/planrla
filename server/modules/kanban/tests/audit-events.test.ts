// server/modules/kanban/tests/audit-events.test.ts
//
// Tests for the TaskMaster-inspired service additions:
//   - audit events written to task_events at every lifecycle point
//     (timeline data for the detail modal — TaskMaster update_subtask analogue)
//   - getNextTask ("what should I work on next" recommendation)
//   - expandTask (expand_task analogue: replace one task with follow-ups)

import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';

import { createKanbanService } from '@/modules/kanban/service.js';
import { createTaskStore, type TaskStore } from '@/modules/kanban/store.js';
import { createTemplateStore } from '@/modules/kanban/template-store.js';
import type { TaskTemplate } from '@/modules/kanban/types.js';

const NOW = '2026-01-01T00:00:00.000Z';

function newService() {
  const dbPath = join(tmpdir(), `kanban-events-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const tplDir = join(tmpdir(), `kanban-events-tpl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  const taskStore = createTaskStore({ db });
  const templateStore = createTemplateStore({ dir: tplDir });
  const service = createKanbanService({ taskStore, templateStore });
  return { service, taskStore, templateStore, db };
}

function makeTemplate(id: string, stageDefs: Array<{ role: 'user' | 'agent'; autoAdvance?: boolean }>): TaskTemplate {
  return {
    id, name: `T-${id}`, maxConcurrency: 1, createdAt: NOW, updatedAt: NOW,
    stages: stageDefs.map((d, i) => ({
      id: `s${i}`, position: i,
      snapshot: {
        id: `ss${i}`, name: `Stage ${i}`,
        role: d.role, autoAdvance: d.autoAdvance ?? false,
        createdAt: NOW, updatedAt: NOW,
      },
    })),
  };
}

const eventTypes = (taskStore: TaskStore, taskId: string) =>
  taskStore.listTaskEvents(taskId).map((e) => e.type);

// --------------------------- audit events ---------------------------

test('createTask writes task_created with input/priority/dependencies payload', () => {
  const { service, taskStore, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user' }]));
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'do', priority: 'high' });
  const events = taskStore.listTaskEvents(task.id);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'task_created');
  const payload = JSON.parse(events[0].payloadJson!);
  assert.equal(payload.input, 'do');
  assert.equal(payload.priority, 'high');
  assert.deepEqual(payload.dependencies, []);
});

test('stage transitions write stage_advanced / stage_returned / stage_jumped', () => {
  const { service, taskStore, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user' }, { role: 'user' }, { role: 'user' }]));
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'x' });

  service.next('r1', task.id);
  assert.deepEqual(eventTypes(taskStore, task.id), ['task_created', 'stage_advanced']);
  let payload = JSON.parse(taskStore.listTaskEvents(task.id)[1].payloadJson!);
  assert.deepEqual([payload.fromStage, payload.toStage, payload.stageName], [0, 1, 'Stage 1']);

  service.prev('r1', task.id);
  assert.equal(eventTypes(taskStore, task.id).at(-1), 'stage_returned');

  service.jump('r1', task.id, 2);
  const last = taskStore.listTaskEvents(task.id).at(-1)!;
  assert.equal(last.type, 'stage_jumped');
  payload = JSON.parse(last.payloadJson!);
  assert.deepEqual([payload.fromStage, payload.toStage], [0, 2]);
});

test('pause/resume/cancel/fail/complete write their terminal and control events', () => {
  const { service, taskStore, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user' }, { role: 'user' }]));

  const t1 = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'x' });
  service.pause('r1', t1.id);
  service.resume('r1', t1.id);
  service.cancel('r1', t1.id);
  assert.deepEqual(eventTypes(taskStore, t1.id), ['task_created', 'task_paused', 'task_resumed', 'task_cancelled']);

  const t2 = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'x' });
  service.fail('r1', t2.id);
  assert.deepEqual(eventTypes(taskStore, t2.id), ['task_created', 'task_failed']);

  // Advancing past the last stage completes the task.
  const t3 = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'x' });
  service.next('r1', t3.id);
  service.next('r1', t3.id);
  assert.equal(eventTypes(taskStore, t3.id).at(-1), 'task_completed');
  assert.equal(taskStore.getTask(t3.id)!.status, 'success');
});

// --------------------------- getNextTask ---------------------------

test('getNextTask picks highest priority, then oldest, among runnable tasks', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user' }]));
  const medium = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'm', priority: 'medium' });
  const high = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'h', priority: 'high' });
  service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'l', priority: 'low' });
  assert.equal(service.getNextTask('r1')!.id, high.id);

  service.cancel('r1', high.id);
  assert.equal(service.getNextTask('r1')!.id, medium.id);
});

test('getNextTask skips dependency-blocked, admitted, and terminal tasks', () => {
  const { service, taskStore, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user' }]));
  const dep = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'dep' });
  const blocked = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'blocked', priority: 'high', dependencies: [dep.id] });
  // blocked has higher priority but its dependency hasn't succeeded.
  assert.equal(service.getNextTask('r1')!.id, dep.id);

  // Already-admitted tasks are work in flight, not "next".
  taskStore.setSchedulerAdmitted(dep.id, true);
  assert.equal(service.getNextTask('r1'), null);

  // Dependency success unblocks.
  taskStore.setSchedulerAdmitted(dep.id, false);
  service.next('r1', dep.id); // single-stage template -> success
  assert.equal(service.getNextTask('r1')!.id, blocked.id);
});

test('getNextTask returns null when nothing is runnable', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user' }]));
  assert.equal(service.getNextTask('r1'), null);
});

// --------------------------- expandTask ---------------------------

test('expandTask creates dependent follow-ups, cancels the original, and links both sides via events', () => {
  const { service, taskStore, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user' }]));
  const original = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'big task' });

  const { created, cancelled } = service.expandTask('r1', original.id, [
    { input: 'part a' },
    { input: 'part b', dependsOn: [0] },
    { input: 'part c', dependsOn: [1], priority: 'high' },
  ]);

  assert.equal(created.length, 3);
  assert.deepEqual(created[0].dependencies, []);
  assert.deepEqual(created[1].dependencies, [created[0].id]);
  assert.deepEqual(created[2].dependencies, [created[1].id]);
  assert.equal(created[2].priority, 'high');
  assert.equal(cancelled.status, 'cancelled');

  const originalEvents = eventTypes(taskStore, original.id);
  assert.ok(originalEvents.includes('task_expanded'));
  assert.ok(originalEvents.includes('task_cancelled'));
  const expandedPayload = JSON.parse(
    taskStore.listTaskEvents(original.id).find((e) => e.type === 'task_expanded')!.payloadJson!,
  );
  assert.deepEqual(expandedPayload.into.map((x: any) => x.id), created.map((t) => t.id));

  assert.ok(eventTypes(taskStore, created[0].id).includes('task_expanded_from'));
  const fromPayload = JSON.parse(
    taskStore.listTaskEvents(created[0].id).find((e) => e.type === 'task_expanded_from')!.payloadJson!,
  );
  assert.equal(fromPayload.fromTaskId, original.id);
});

test('expandTask rejects empty item lists and terminal tasks', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user' }]));
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'x' });
  assert.throws(() => service.expandTask('r1', task.id, []), /expand produced no tasks/);

  service.cancel('r1', task.id);
  assert.throws(() => service.expandTask('r1', task.id, [{ input: 'y' }]), /terminal/i);
});
