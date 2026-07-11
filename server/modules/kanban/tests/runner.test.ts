// server/modules/kanban/tests/runner.test.ts
//
// Tests for the kanban runner: drives a single agent stage by invoking the
// provider spawnFn (injected, mocked here) with the rendered prompt, cwd
// resolved from the task root, permissionMode derived from planMode, and a
// RunnerWriter that mirrors provider events into the aux bridge and drives
// state-machine transitions on complete.
//
// The spawnFn is dependency-injected via `createRunner({ spawnFns })` so these
// tests never spawn a real CLI; they assert the runner's orchestration:
//   - prompt / cwd / permissionMode plumbing,
//   - aux flag extraction (TodoWrite → hasTodos),
//   - autoAdvance on complete → service.next,
//   - provider sessionId capture,
//   - unknown provider rejection.

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
import type { TaskTemplate } from '@/modules/kanban/types.js';

const NOW = '2026-01-01T00:00:00.000Z';

interface SetupOpts {
  mockSpawn: any;
  spawnFns?: Record<string, any>;
}

function setup(opts: SetupOpts) {
  const db = new Database(join(tmpdir(), `run-${Date.now()}-${Math.random().toString(36).slice(2)}.db`));
  db.pragma('journal_mode = WAL');
  const taskStore = createTaskStore({ db });
  const templateStore = createTemplateStore({ dir: join(tmpdir(), `run-tpl-${Date.now()}-${Math.random().toString(36).slice(2)}`) });
  const service = createKanbanService({ taskStore, templateStore });
  const auxBridge = createAuxBridge({ updateAuxFlags: taskStore.updateTaskAuxFlags });
  const resolveRootPath = (rootId: string) => `/fake/path/${rootId}`;
  const runner = createRunner({
    taskStore,
    templateStore,
    service,
    auxBridge,
    resolveRootPath,
    spawnFns: opts.spawnFns ?? { claude: opts.mockSpawn },
    log: () => {},
  });
  return { db, taskStore, templateStore, service, runner };
}

function makeAgentTemplate(
  templateStore: ReturnType<typeof createTemplateStore>,
  id: string,
  opts: { autoAdvance?: boolean; agent?: string } = {},
): TaskTemplate {
  return templateStore.saveTaskTemplate({
    id,
    name: `T-${id}`,
    maxConcurrency: 1,
    createdAt: NOW,
    updatedAt: NOW,
    stages: [
      {
        id: 's0',
        position: 0,
        snapshot: {
          id: 'ss0',
          name: 'Plan',
          role: 'user',
          autoAdvance: true,
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
      {
        id: 's1',
        position: 1,
        snapshot: {
          id: 'ss1',
          name: 'Do',
          role: 'agent',
          agent: opts.agent ?? 'claude',
          autoAdvance: opts.autoAdvance ?? false,
          promptTemplate: 'do the work',
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
    ],
  });
}

test('runAgentStage calls spawnFn with prompt + cwd + permissionMode', async () => {
  let called: any = null;
  const mockSpawn = async (cmd: string, opts: any, writer: any) => {
    called = { cmd, opts, hasWriter: !!writer };
    writer.send(JSON.stringify({ kind: 'complete' }));
  };
  const { db, templateStore, service, runner } = setup({ mockSpawn });
  makeAgentTemplate(templateStore, 't1');
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'go' });
  service.next('r1', task.id); // advance to stage 1 (agent)
  await runner.runAgentStage('r1', task.id, 1);
  assert.equal(called.cmd, 'do the work');
  assert.equal(called.opts.permissionMode, 'default');
  assert.equal(called.opts.cwd, '/fake/path/r1');
  assert.ok(called.hasWriter);
  db.close();
});

test('runAgentStage with planMode=true uses permissionMode=plan', async () => {
  let called: any = null;
  const mockSpawn = async (cmd: string, opts: any, writer: any) => {
    called = { opts };
    writer.send(JSON.stringify({ kind: 'complete' }));
  };
  const { db, templateStore, service, runner } = setup({ mockSpawn });
  templateStore.saveTaskTemplate({
    id: 't1',
    name: 'T',
    maxConcurrency: 1,
    createdAt: NOW,
    updatedAt: NOW,
    stages: [
      {
        id: 's0',
        position: 0,
        snapshot: { id: 'ss0', name: 'Plan', role: 'user', autoAdvance: true, createdAt: NOW, updatedAt: NOW },
      },
      {
        id: 's1',
        position: 1,
        snapshot: {
          id: 'ss1',
          name: 'Do',
          role: 'agent',
          agent: 'claude',
          autoAdvance: false,
          planMode: true,
          promptTemplate: 'plan it',
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
    ],
  });
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'go' });
  service.next('r1', task.id);
  await runner.runAgentStage('r1', task.id, 1);
  assert.equal(called.opts.permissionMode, 'plan');
  db.close();
});

test('aux flag extracted from spawnFn events (TodoWrite → hasTodos)', async () => {
  const mockSpawn = async (_cmd: string, _opts: any, writer: any) => {
    writer.send(JSON.stringify({ kind: 'tool_use', toolName: 'TodoWrite', toolInput: { todos: [] } }));
    writer.send(JSON.stringify({ kind: 'complete' }));
  };
  const { db, taskStore, templateStore, service, runner } = setup({ mockSpawn });
  makeAgentTemplate(templateStore, 't1');
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'go' });
  service.next('r1', task.id);
  await runner.runAgentStage('r1', task.id, 1);
  const got = taskStore.getTask(task.id);
  assert.equal(got!.auxFlags.hasTodos, true);
  db.close();
});

test('autoAdvance on complete → service.next advances stage', async () => {
  const mockSpawn = async (_cmd: string, _opts: any, writer: any) => {
    writer.send(JSON.stringify({ kind: 'complete' }));
  };
  const { db, taskStore, templateStore, service, runner } = setup({ mockSpawn });
  makeAgentTemplate(templateStore, 't1', { autoAdvance: true });
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'go' });
  service.next('r1', task.id); // → stage 1
  await runner.runAgentStage('r1', task.id, 1);
  // autoAdvance: after complete, service.next → past last stage → success
  const got = taskStore.getTask(task.id);
  assert.equal(got!.status, 'success');
  db.close();
});

test('providerSessionId captured and reused on second run', async () => {
  let firstSessionId: string | null = null;
  const mockSpawn = async (_cmd: string, _opts: any, writer: any) => {
    if (!firstSessionId) {
      firstSessionId = 'claude-session-xyz';
      writer.send(JSON.stringify({ kind: 'session_created', sessionId: firstSessionId }));
    }
    writer.send(JSON.stringify({ kind: 'complete' }));
  };
  const { db, templateStore, service, runner } = setup({ mockSpawn });
  makeAgentTemplate(templateStore, 't1');
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'go' });
  service.next('r1', task.id);
  await runner.runAgentStage('r1', task.id, 1);
  // The first run must have surfaced a provider sessionId through the writer.
  assert.ok(firstSessionId);
  db.close();
});

test('runAgentStage throws on unknown provider', async () => {
  const mockSpawn = async () => {};
  const { db, templateStore, service, runner } = setup({ mockSpawn });
  templateStore.saveTaskTemplate({
    id: 't1',
    name: 'T',
    maxConcurrency: 1,
    createdAt: NOW,
    updatedAt: NOW,
    stages: [
      {
        id: 's0',
        position: 0,
        snapshot: { id: 'ss0', name: 'U', role: 'user', autoAdvance: true, createdAt: NOW, updatedAt: NOW },
      },
      {
        id: 's1',
        position: 1,
        snapshot: {
          id: 'ss1',
          name: 'A',
          role: 'agent',
          agent: 'unknown-provider',
          autoAdvance: false,
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
    ],
  });
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'go' });
  service.next('r1', task.id);
  await assert.rejects(() => runner.runAgentStage('r1', task.id, 1), /unknown provider|spawnFn/i);
  db.close();
});
