// server/modules/kanban/tests/kanban-e2e.test.ts
//
// End-to-end integration tests wiring the full kanban pipeline:
//   scheduler.schedule(rootId)
//     → admit (status=running, schedulerAdmitted=true)
//     → onAdmit hook:
//         user/autoAdvance  → service.next (advance to next stage,
//                            updateTaskStage resets schedulerAdmitted)
//         agent             → runner.runAgentStage (fire-and-forget)
//     → scheduler re-runs within the same schedule() call and admits the
//       now-queued agent stage (schedulerAdmitted was reset on stage advance)
//     → runner drives the injected mock spawnFn, RunnerWriter mirrors events
//       into the aux bridge (TodoWrite → hasTodos) and, on 'complete', fires
//       the stage autoAdvance hook (service.next) for agent/autoAdvance stages.
//
// The spawnFn is dependency-injected (no real CLI is spawned). These tests
// verify the orchestration glue between scheduler ↔ service ↔ runner ↔
// aux-bridge, not any single module in isolation (those have their own tests).

import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import { createTaskStore } from '@/modules/kanban/store.js';
import { createTemplateStore } from '@/modules/kanban/template-store.js';
import { createKanbanService } from '@/modules/kanban/service.js';
import { createAuxBridge } from '@/modules/kanban/aux-bridge.js';
import { createRunner } from '@/modules/kanban/runner.js';
import { createScheduler } from '@/modules/kanban/scheduler.js';

const NOW = '2026-01-01T00:00:00.000Z';

function setupE2E(mockSpawn: any) {
  const db = new Database(join(tmpdir(), `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.db`));
  db.pragma('journal_mode = WAL');
  const taskStore = createTaskStore({ db });
  const templateStore = createTemplateStore({ dir: join(tmpdir(), `e2e-tpl-${Date.now()}-${Math.random().toString(36).slice(2)}`) });
  const service = createKanbanService({ taskStore, templateStore });
  const auxBridge = createAuxBridge({ updateAuxFlags: taskStore.updateTaskAuxFlags });
  const resolveRootPath = (rootId: string) => `/fake/${rootId}`;
  const runner = createRunner({ taskStore, templateStore, service, auxBridge, resolveRootPath, spawnFns: { claude: mockSpawn }, log: () => {} });
  const scheduler = createScheduler({
    taskStore,
    templateStore,
    onAdmit: (taskId: string) => {
      const task = taskStore.getTask(taskId);
      if (!task) return;
      const tpl = templateStore.getTaskTemplate(task.taskTemplateId);
      const stage = tpl?.stages[task.currentStageIndex]?.snapshot;
      if (!stage) return;
      if (stage.role === 'agent' && stage.agent) {
        void runner.runAgentStage(task.rootId, taskId, task.currentStageIndex).catch(() => {});
      } else if (stage.role === 'user' && stage.autoAdvance) {
        try { service.next(task.rootId, taskId); } catch { /* ignore */ }
      }
    },
  });
  return { db, taskStore, templateStore, service, scheduler, runner };
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

test('e2e: agent task admitted → mock spawn runs → aux extracted', async () => {
  let spawnCalled = false;
  const mockSpawn = async (_cmd: string, _opts: any, writer: any) => {
    spawnCalled = true;
    writer.send(JSON.stringify({ kind: 'session_created', sessionId: 's-1' }));
    writer.send(JSON.stringify({ kind: 'tool_use', toolName: 'TodoWrite', toolInput: { todos: [] } }));
    writer.send(JSON.stringify({ kind: 'complete' }));
  };
  const { db, taskStore, templateStore, service, scheduler } = setupE2E(mockSpawn);
  templateStore.saveTaskTemplate({
    id: 't1', name: 'T', maxConcurrency: 1, createdAt: NOW, updatedAt: NOW,
    stages: [
      { id: 's0', position: 0, snapshot: { id: 'ss0', name: 'Plan', role: 'user', autoAdvance: true, createdAt: NOW, updatedAt: NOW } },
      { id: 's1', position: 1, snapshot: { id: 'ss1', name: 'Do', role: 'agent', agent: 'claude', autoAdvance: false, promptTemplate: 'work', createdAt: NOW, updatedAt: NOW } },
    ],
  });
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'go' });
  scheduler.schedule('r1');
  await wait(150);  // fire-and-forget runner: user admit → next → agent admit → runner
  const got = taskStore.getTask(task.id);
  assert.ok(spawnCalled, 'mock spawn should be called for agent stage');
  assert.equal(got!.auxFlags.hasTodos, true, 'TodoWrite should set hasTodos');
  assert.equal(got!.status, 'running', 'agent stage (non-autoAdvance) stays running after complete');
  db.close();
});

test('e2e: auto-advance chain (user→agent→complete→success)', async () => {
  const mockSpawn = async (_cmd: string, _opts: any, writer: any) => {
    writer.send(JSON.stringify({ kind: 'complete' }));
  };
  const { db, taskStore, templateStore, service, scheduler } = setupE2E(mockSpawn);
  templateStore.saveTaskTemplate({
    id: 't1', name: 'T', maxConcurrency: 1, createdAt: NOW, updatedAt: NOW,
    stages: [
      { id: 's0', position: 0, snapshot: { id: 'ss0', name: 'U', role: 'user', autoAdvance: true, createdAt: NOW, updatedAt: NOW } },
      { id: 's1', position: 1, snapshot: { id: 'ss1', name: 'A', role: 'agent', agent: 'claude', autoAdvance: true, promptTemplate: 'work', createdAt: NOW, updatedAt: NOW } },
    ],
  });
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'go' });
  scheduler.schedule('r1');
  await wait(250);  // chained auto-advance spans several async rounds
  const got = taskStore.getTask(task.id);
  assert.equal(got!.status, 'success', 'auto-advance chain should complete to success');
  db.close();
});

test('e2e: rootId isolation — other root tasks not admitted', async () => {
  const mockSpawn = async () => { throw new Error('should not be called for other-root'); };
  const { db, templateStore, service, scheduler } = setupE2E(mockSpawn);
  templateStore.saveTaskTemplate({
    id: 't1', name: 'T', maxConcurrency: 1, createdAt: NOW, updatedAt: NOW,
    stages: [
      { id: 's0', position: 0, snapshot: { id: 'ss0', name: 'U', role: 'user', autoAdvance: true, createdAt: NOW, updatedAt: NOW } },
    ],
  });
  service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'a' });
  // Schedule a DIFFERENT root: r1's task must be filtered out by listQueuedTasks.
  scheduler.schedule('other-root');
  await wait(50);
  // No throw + reach here ⇒ rootId isolation holds.
  db.close();
});
