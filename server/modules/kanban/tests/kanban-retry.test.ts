import test from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';

import { createTaskStore } from '@/modules/kanban/store.js';
import { createKanbanService } from '@/modules/kanban/service.js';
import { createTemplateStore } from '@/modules/kanban/template-store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NOW = new Date().toISOString();

function setup() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE tasks (
    id TEXT PRIMARY KEY, task_number INTEGER, root_id TEXT, task_template_id TEXT,
    task_template_name TEXT, create_worktree INTEGER DEFAULT 0, worktree_branch_mode TEXT,
    worktree_branch TEXT, worktree_path TEXT, current_stage_index INTEGER, status TEXT,
    scheduler_admitted INTEGER DEFAULT 0, main_session_key TEXT, worktree_root_id TEXT,
    labels_json TEXT DEFAULT '[]', priority TEXT, dependencies_json TEXT,
    provider_session_id TEXT, aux_ask_user_waiting INTEGER DEFAULT 0, aux_has_plan INTEGER DEFAULT 0,
    aux_has_todos INTEGER DEFAULT 0, aux_has_task INTEGER DEFAULT 0, aux_session_error TEXT,
    pending_ask_user TEXT, created_at TEXT, updated_at TEXT, completed_at TEXT
  );
  CREATE TABLE stage_runs (id TEXT PRIMARY KEY, task_id TEXT, stage_index INTEGER, stage_name TEXT, role TEXT, status TEXT, input TEXT, rendered_prompt TEXT, session_key TEXT, started_at TEXT, finished_at TEXT, created_at TEXT, updated_at TEXT);
  CREATE TABLE task_events (id TEXT PRIMARY KEY, task_id TEXT, type TEXT, payload_json TEXT, stage_run_id TEXT, created_at TEXT);`);
  const dir = mkdtempSync(join(tmpdir(), 'kanban-retry-'));
  const templateStore = createTemplateStore({ dir });
  const taskStore = createTaskStore({ db });
  const service = createKanbanService({ taskStore, templateStore, onTerminal: () => {}, onDeleteTask: () => {} });
  return { db, taskStore, templateStore, service, dir };
}

test('retry: fail → queued, provider_session_id and completed_at cleared, attempt audited', () => {
  const { db, taskStore, templateStore, service, dir } = setup();
  templateStore.saveTaskTemplate({
    id: 't', name: 'T', maxConcurrency: 1, createdAt: NOW, updatedAt: NOW,
    stages: [
      { id: 's0', position: 0, snapshot: { id: 'ss0', name: '需求', role: 'user', autoAdvance: true, createdAt: NOW, updatedAt: NOW } },
      { id: 's1', position: 1, snapshot: { id: 'ss1', name: '开工', role: 'agent', agent: 'claude', autoAdvance: false, createdAt: NOW, updatedAt: NOW } },
    ],
  });
  const task = service.createTask({ rootId: 'r', taskTemplateId: 't', input: 'do it' });
  service.next('r', task.id);
  taskStore.updateProviderSessionId(task.id, 'prov-123');
  service.fail('r', task.id);
  assert.equal(taskStore.getTask(task.id)!.status, 'fail');
  assert.ok(taskStore.getTask(task.id)!.completedAt, 'fail sets completed_at');

  const retried = service.retry('r', task.id);
  assert.equal(retried.status, 'queued');
  assert.equal(retried.providerSessionId, undefined, 'provider session cleared for fresh rerun');
  assert.equal(retried.completedAt, undefined, 'completed_at cleared on retry');
  const attempts = taskStore.listTaskEvents(task.id).filter((e) => e.type === 'task_retried');
  assert.equal(attempts.length, 1);
  assert.equal(JSON.parse(attempts[0].payloadJson ?? '{}').attempt, 1);

  // retry a non-failed task must throw
  assert.throws(() => service.retry('r', task.id));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
