import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTaskStore } from '@/modules/kanban/store.js';

function newTestStore() {
  const dbPath = join(tmpdir(), `kanban-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  return createTaskStore({ dbPath });
}

test('createTask inserts task + initial stage run + event, getTask returns it', () => {
  const store = newTestStore();
  const now = new Date().toISOString();

  const task = store.createTask({
    task: {
      id: 'task-1', taskNumber: 1, rootId: 'root-1',
      taskTemplateId: 'tpl-1', taskTemplateName: 'T',
      createWorktree: true, currentStageIndex: 0,
      status: 'queued', schedulerAdmitted: false,
      labels: [], auxFlags: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false },
      createdAt: now, updatedAt: now,
    },
    initialStageRun: {
      id: 'run-1', taskId: 'task-1', stageIndex: 0, stageName: 'S',
      role: 'user', status: 'approved', createdAt: now, updatedAt: now,
    },
    event: { id: 'ev-1', taskId: 'task-1', type: 'task_created', createdAt: now },
  });

  assert.equal(task.id, 'task-1');
  const got = store.getTask('task-1');
  assert.ok(got);
  assert.equal(got!.status, 'queued');
  assert.equal(got!.taskNumber, 1);
  assert.equal(got!.auxFlags.askUserWaiting, false);
});
