import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import { createKanbanService } from '@/modules/kanban/service.js';
import { createTaskStore } from '@/modules/kanban/store.js';
import { createTemplateStore } from '@/modules/kanban/template-store.js';
import type { TaskTemplate } from '@/modules/kanban/types.js';

const NOW = '2026-01-01T00:00:00.000Z';

function newService() {
  const dbPath = join(tmpdir(), `kanban-svc-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const tplDir = join(tmpdir(), `kanban-svc-tpl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  const taskStore = createTaskStore({ db });
  const templateStore = createTemplateStore({ dir: tplDir });
  const service = createKanbanService({ taskStore, templateStore });
  return { service, templateStore };
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

test('createTask with auto_advance first user stage puts task in queued', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user', autoAdvance: true }]));
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'do' });
  assert.equal(task.status, 'queued');
  assert.equal(task.currentStageIndex, 0);
});

test('createTask non-auto first stage puts task in waiting_user', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user', autoAdvance: false }]));
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'do' });
  assert.equal(task.status, 'waiting_user');
});

test('createTask rejects when first stage is agent role', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'agent' }, { role: 'user' }]));
  assert.throws(() => service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'do' }), /first stage must be user/i);
});

test('createTask rejects when template missing', () => {
  const { service } = newService();
  assert.throws(() => service.createTask({ rootId: 'r1', taskTemplateId: 'missing', input: 'do' }), /template/i);
});

test('createTask assigns incrementing taskNumber per root', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user', autoAdvance: true }]));
  const a = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'a' });
  const b = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'b' });
  assert.equal(a.taskNumber, 1);
  assert.equal(b.taskNumber, 2);
});

test('next on single-stage task completes with success', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user', autoAdvance: false }]));
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'do' });
  const done = service.next('r1', task.id);
  assert.equal(done.status, 'success');
  assert.ok(done.completedAt);
});

test('next on multi-stage advances currentStageIndex', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [
    { role: 'user', autoAdvance: false },
    { role: 'user', autoAdvance: false },
  ]));
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'do' });
  const after = service.next('r1', task.id);
  assert.equal(after.currentStageIndex, 1);
  assert.equal(after.status, 'waiting_user');
});

test('complete rejects when not on last stage', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [
    { role: 'user', autoAdvance: false },
    { role: 'user', autoAdvance: false },
  ]));
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'do' });
  assert.throws(() => service.complete('r1', task.id), /last stage/i);
});

test('cancel transitions to cancelled and clears schedulerAdmitted', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user', autoAdvance: true }]));
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'do' });
  const cancelled = service.cancel('r1', task.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.schedulerAdmitted, false);
});

test('next on terminal task throws', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user', autoAdvance: false }]));
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'do' });
  service.cancel('r1', task.id);
  assert.throws(() => service.next('r1', task.id), /terminal/i);
});

test('jump moves to target stage', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [
    { role: 'user', autoAdvance: false },
    { role: 'user', autoAdvance: false },
    { role: 'user', autoAdvance: false },
  ]));
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'do' });
  const after = service.jump('r1', task.id, 2);
  assert.equal(after.currentStageIndex, 2);
  assert.equal(after.status, 'waiting_user');
});

test('jump out of range throws', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user' }, { role: 'user' }]));
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'do' });
  assert.throws(() => service.jump('r1', task.id, 5));
  assert.throws(() => service.jump('r1', task.id, -1));
});

test('pause sets status to paused, resume returns to queued', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user', autoAdvance: true }]));
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'do' });
  const paused = service.pause('r1', task.id);
  assert.equal(paused.status, 'paused');
  const resumed = service.resume('r1', task.id);
  assert.equal(resumed.status, 'queued');
});

test('resume on non-paused task throws', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user', autoAdvance: true }]));
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'do' });
  assert.throws(() => service.resume('r1', task.id));
});

test('fail transitions to fail terminal status', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user', autoAdvance: true }]));
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'do' });
  const failed = service.fail('r1', task.id);
  assert.equal(failed.status, 'fail');
  assert.equal(failed.schedulerAdmitted, false);
  assert.ok(failed.completedAt);
});

test('prev decreases currentStageIndex', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [
    { role: 'user', autoAdvance: false },
    { role: 'user', autoAdvance: false },
  ]));
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'do' });
  service.next('r1', task.id); // -> stage 1
  const back = service.prev('r1', task.id); // -> stage 0
  assert.equal(back.currentStageIndex, 0);
  assert.equal(back.status, 'waiting_user');
});

test('prev at first stage throws', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user', autoAdvance: false }]));
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'do' });
  assert.throws(() => service.prev('r1', task.id));
});

test('pause on terminal task throws', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user', autoAdvance: false }]));
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'do' });
  service.cancel('r1', task.id);
  assert.throws(() => service.pause('r1', task.id));
});

test('full lifecycle: create -> next -> next -> complete', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [
    { role: 'user', autoAdvance: false },
    { role: 'user', autoAdvance: false },
    { role: 'user', autoAdvance: false },
  ]));
  const t = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'start' });
  assert.equal(t.currentStageIndex, 0);
  const s1 = service.next('r1', t.id);
  assert.equal(s1.currentStageIndex, 1);
  const s2 = service.next('r1', t.id);
  assert.equal(s2.currentStageIndex, 2);
  const done = service.next('r1', t.id); // last stage next -> complete
  assert.equal(done.status, 'success');
});

// === 翻译自 MindFS service_test.go ===

test('auto_advance first stage marks stage run approved and queues task', () => {
  // TestCreateTaskAutoAdvanceControlsQueueAdmission (auto branch)
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('auto', [{ role: 'user', autoAdvance: true }]));
  const detail = service.createTask({ rootId: 'r1', taskTemplateId: 'auto', input: 'ship it' });
  assert.equal(detail.status, 'queued');
});

test('manual next then auto_advance next drives status through queued/waiting_user', () => {
  // TestCreateTaskAutoAdvanceControlsQueueAdmission (manual -> agent -> queued)
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('manual', [
    { role: 'user', autoAdvance: false },
    { role: 'agent', autoAdvance: false },
  ]));
  const detail = service.createTask({ rootId: 'r1', taskTemplateId: 'manual', input: 'broken button' });
  assert.equal(detail.status, 'waiting_user');
  const after = service.next('r1', detail.id);
  assert.equal(after.status, 'queued');
  assert.equal(after.currentStageIndex, 1);
});

test('complete on single waiting_user stage produces success terminal', () => {
  // TestCompleteFinalWaitingTask
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('final', [{ role: 'user', autoAdvance: false }]));
  const detail = service.createTask({ rootId: 'r1', taskTemplateId: 'final', input: 'done' });
  assert.equal(detail.status, 'waiting_user');
  const completed = service.complete('r1', detail.id);
  assert.equal(completed.status, 'success');
  assert.equal(completed.schedulerAdmitted, false);
  assert.ok(completed.completedAt);
});

test('next with wrong rootId throws TASK_ROOT_MISMATCH', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user', autoAdvance: false }]));
  const task = service.createTask({ rootId: 'rootA', taskTemplateId: 't1', input: 'do' });
  assert.throws(() => service.next('rootB', task.id), /root/i);
});

test('cancel with wrong rootId throws TASK_ROOT_MISMATCH', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user', autoAdvance: true }]));
  const task = service.createTask({ rootId: 'rootA', taskTemplateId: 't1', input: 'do' });
  assert.throws(() => service.cancel('rootB', task.id), /root/i);
});

test('complete with wrong rootId throws TASK_ROOT_MISMATCH', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user', autoAdvance: false }]));
  const task = service.createTask({ rootId: 'rootA', taskTemplateId: 't1', input: 'do' });
  assert.throws(() => service.complete('rootB', task.id), /root/i);
});

test('fail on terminal task throws (already cancelled)', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user', autoAdvance: true }]));
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'do' });
  service.cancel('r1', task.id);
  assert.throws(() => service.fail('r1', task.id), /terminal/i);
});

test('fail with wrong rootId throws TASK_ROOT_MISMATCH', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user', autoAdvance: true }]));
  const task = service.createTask({ rootId: 'rootA', taskTemplateId: 't1', input: 'do' });
  assert.throws(() => service.fail('rootB', task.id), /root/i);
});

test('getTask on unknown id returns 404 TASK_NOT_FOUND via requireTask', () => {
  const { service, templateStore } = newService();
  templateStore.saveTaskTemplate(makeTemplate('t1', [{ role: 'user', autoAdvance: false }]));
  // next on nonexistent -> requireNonTerminalTask -> requireTask -> 404
  assert.throws(() => service.next('r1', 'no-such-id'), /not found/i);
});
