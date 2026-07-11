import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createKanbanService } from '@/modules/kanban/service.js';
import { createTaskStore } from '@/modules/kanban/store.js';
import { createTemplateStore } from '@/modules/kanban/template-store.js';
import type { TaskTemplate } from '@/modules/kanban/types.js';

const NOW = '2026-01-01T00:00:00.000Z';

function newService() {
  const dbPath = join(tmpdir(), `kanban-svc-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const tplDir = join(tmpdir(), `kanban-svc-tpl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const taskStore = createTaskStore({ dbPath });
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
