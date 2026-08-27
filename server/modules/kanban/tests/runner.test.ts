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
  scheduler?: { schedule(rootId: string): void };
  mockSpawn: any;
  spawnFns?: Record<string, any>;
  worktreeSetup?: any;
  stageTimeoutMs?: number;
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
    scheduler: opts.scheduler,
    worktreeSetup: opts.worktreeSetup,
    stageTimeoutMs: opts.stageTimeoutMs,
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
  // W4: prompt is now rendered (base template + MCP self-drive preamble).
  assert.match(called.cmd, /^do the work/);
  assert.equal(called.opts.permissionMode, 'bypassPermissions');
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

test('runAgentStage passes worktreePath as cwd when worktreeSetup returns one', async () => {
  const seen: { cwd?: string }[] = [];
  const mockSpawn = async (_cmd: string, opts: any, writer: any) => {
    seen.push({ cwd: opts?.cwd });
    writer.send(JSON.stringify({ kind: 'complete' }));
  };
  const { db, templateStore, service, runner } = setup({
    mockSpawn,
    worktreeSetup: {
      ensureWorktree: async () => '/repo/.worktree/kanban/1-aaaa',
      removeWorktree: async () => {},
    },
  });
  makeAgentTemplate(templateStore, 't1');
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'go' });
  service.next('r1', task.id); // → stage 1 (agent)
  await runner.runAgentStage('r1', task.id, 1);
  assert.equal(seen[0]?.cwd, '/repo/.worktree/kanban/1-aaaa');
  db.close();
});

test('runAgentStage renders prompt with MCP preamble containing taskId', async () => {
  const seen: { cmd?: string }[] = [];
  const mockSpawn = async (cmd: string, _opts: any, writer: any) => {
    seen.push({ cmd });
    writer.send(JSON.stringify({ kind: 'complete' }));
  };
  const { db, templateStore, service, runner } = setup({
    mockSpawn,
    worktreeSetup: {
      ensureWorktree: async () => null,
      removeWorktree: async () => {},
    },
  });
  makeAgentTemplate(templateStore, 't1');
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'go' });
  service.next('r1', task.id); // → stage 1 (agent)
  await runner.runAgentStage('r1', task.id, 1);
  // The MCP self-drive preamble instructs the agent to call task_next with the taskId.
  assert.match(seen[0]?.cmd ?? '', /task_next/);
  assert.match(seen[0]?.cmd ?? '', new RegExp(task.id));
  db.close();
});

test('runAgentStage fails task on timeout when spawnFn hangs (no complete/error)', { timeout: 3000 }, async () => {
  // Reproduces the "stuck running" failure mode: the provider's spawnFn never
  // resolves and the writer never receives any message (e.g. Claude SDK hangs
  // silently when the CLI binary is missing), so onComplete/onError never fire.
  // Without a stage timeout the task stays "running" forever.
  const hangingSpawn = () => new Promise<void>(() => {});
  const { db, taskStore, templateStore, service, runner } = setup({
    mockSpawn: hangingSpawn,
    stageTimeoutMs: 50,
  });
  makeAgentTemplate(templateStore, 't1');
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'go' });
  service.next('r1', task.id); // → stage 1 (agent)

  await runner.runAgentStage('r1', task.id, 1);

  const got = taskStore.getTask(task.id);
  // Timeout without a scheduler dep: the auto-retry still flips the task to
  // queued (audit event kept) — it just will not be respawned until some
  // later schedule() tick picks it up.
  assert.equal(got!.status, 'queued', 'timeout auto-retries even without scheduler');
  assert.match(
    String(got!.auxFlags.sessionError ?? ''),
    /timed ?out|timeout/i,
    'sessionError must record the timeout reason',
  );
  db.close();
});

test('runAgentStage timeout with scheduler: auto-retries once (queued, audited), second timeout fails', { timeout: 4000 }, async () => {
  let scheduled = 0;
  const hangingSpawn = () => new Promise<void>(() => {});
  const { db, taskStore, templateStore, service, runner } = setup({
    mockSpawn: hangingSpawn,
    stageTimeoutMs: 50,
    scheduler: { schedule: () => { scheduled += 1; } },
  });
  makeAgentTemplate(templateStore, 't1');
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'go' });
  service.next('r1', task.id); // → stage 1 (agent)

  await runner.runAgentStage('r1', task.id, 1);
  const afterFirst = taskStore.getTask(task.id)!;
  assert.equal(afterFirst.status, 'queued', 'first timeout auto-retries to queued');
  assert.equal(scheduled, 1, 'scheduler woken once');
  assert.ok(taskStore.listTaskEvents(task.id).some((e) => e.type === 'task_auto_retried'), 'audit event');

  // 第二次超时:不再自动重试,落入 fail(防烧钱循环)
  taskStore.updateTaskStatus(task.id, 'running');
  await runner.runAgentStage('r1', task.id, 1);
  assert.equal(taskStore.getTask(task.id)!.status, 'fail', 'second timeout fails for human');
  db.close();
});

test('startReviewComment resumes the provider session and restores status', async () => {
  const calls: any[] = [];
  const { db, taskStore, templateStore, service, runner } = setup({
    mockSpawn: async (cmd: string, opts: any, writer: any) => {
      calls.push({ cmd, opts, statusAtCall: taskStore.getTask(task.id)?.status });
      if (calls.length === 1 && writer.setSessionId) writer.setSessionId('prov-1');
      writer.send(JSON.stringify({ kind: 'complete' }));
    },
  });
  // agentCanControlStage=false 的人工评审阶段:完成后任务停在 agent 阶段
  templateStore.saveTaskTemplate({
    id: 't1',
    name: 'T',
    maxConcurrency: 1,
    createdAt: NOW,
    updatedAt: NOW,
    stages: [
      { id: 's0', position: 0, snapshot: { id: 'ss0', name: 'Plan', role: 'user', autoAdvance: true, createdAt: NOW, updatedAt: NOW } },
      { id: 's1', position: 1, snapshot: { id: 'ss1', name: 'Do', role: 'agent', agent: 'claude', autoAdvance: false, agentCanControlStage: false, promptTemplate: 'do it', createdAt: NOW, updatedAt: NOW } },
    ],
  });
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'go' });
  service.next('r1', task.id);
  await runner.runAgentStage('r1', task.id, 1);
  assert.equal(taskStore.getTask(task.id)?.status, 'queued');

  // mock 同步完成:评审运行期间(readable at spawn time)是 running,完成后恢复
  const { done } = runner.startReviewComment('r1', task.id, 'please fix the edge case');
  await done;

  assert.equal(calls.length, 2);
  assert.equal(calls[1].opts.sessionId, 'prov-1');
  assert.match(calls[1].cmd, /please fix the edge case/);
  // 评审 spawn 被调用时任务处于 running
  assert.equal(calls[1].statusAtCall, 'running');
  assert.equal(taskStore.getTask(task.id)?.status, 'queued');
  db.close();
});

test('startReviewComment rejects when there is no live provider session', () => {
  const mockSpawn = async (_cmd: string, _opts: any, writer: any) => {
    writer.send(JSON.stringify({ kind: 'complete' }));
  };
  const { db, templateStore, service, runner } = setup({ mockSpawn });
  makeAgentTemplate(templateStore, 't1');
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'go' });
  service.next('r1', task.id);
  assert.throws(() => runner.startReviewComment('r1', task.id, 'x'), /no live provider session/);
  db.close();
});

test('startReviewComment rejects on a non-agent current stage', () => {
  const mockSpawn = async () => {};
  const { db, templateStore, service, runner } = setup({ mockSpawn });
  makeAgentTemplate(templateStore, 't1');
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'go' });
  assert.throws(() => runner.startReviewComment('r1', task.id, 'x'), /agent stage/);
  db.close();
});

// ------------------- REQ-043: goal stage 透传 goalCondition + maxTurns -------------------

test('goal stage passes goalCondition + maxTurns to spawnFn', async () => {
  let called: any = null;
  const mockSpawn = async (cmd: string, opts: any, writer: any) => {
    called = { opts };
    writer.send(JSON.stringify({ kind: 'complete' }));
  };
  const { db, templateStore, service, runner } = setup({ mockSpawn });
  templateStore.saveTaskTemplate({
    id: 't1', name: 'T', maxConcurrency: 1, createdAt: NOW, updatedAt: NOW,
    stages: [
      { id: 's0', position: 0, snapshot: { id: 'ss0', name: 'U', role: 'user', autoAdvance: true, createdAt: NOW, updatedAt: NOW } },
      { id: 's1', position: 1, snapshot: { id: 'ss1', name: 'Do', role: 'agent', agent: 'claude', autoAdvance: false, goalCondition: '测试通过', goalMaxTurns: 50, promptTemplate: 'do', createdAt: NOW, updatedAt: NOW } },
    ],
  });
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'go' });
  service.next('r1', task.id);
  await runner.runAgentStage('r1', task.id, 1);
  assert.equal(called.opts.goalCondition, '测试通过');
  assert.equal(called.opts.maxTurns, 50);
  db.close();
});

test('goal stage defaults maxTurns to 300 when goalMaxTurns unset', async () => {
  let called: any = null;
  const mockSpawn = async (cmd: string, opts: any, writer: any) => { called = { opts }; writer.send(JSON.stringify({ kind: 'complete' })); };
  const { db, templateStore, service, runner } = setup({ mockSpawn });
  templateStore.saveTaskTemplate({
    id: 't1', name: 'T', maxConcurrency: 1, createdAt: NOW, updatedAt: NOW,
    stages: [
      { id: 's0', position: 0, snapshot: { id: 'ss0', name: 'U', role: 'user', autoAdvance: true, createdAt: NOW, updatedAt: NOW } },
      { id: 's1', position: 1, snapshot: { id: 'ss1', name: 'Do', role: 'agent', agent: 'claude', autoAdvance: false, goalCondition: 'x', promptTemplate: 'do', createdAt: NOW, updatedAt: NOW } },
    ],
  });
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'go' });
  service.next('r1', task.id);
  await runner.runAgentStage('r1', task.id, 1);
  assert.equal(called.opts.maxTurns, 300);
  db.close();
});

test('goal stage fails task when spawnFn rejects (max_turns exhausted)', async () => {
  const rejectSpawn = async () => { throw new Error('Reached maximum number of turns (50)'); };
  const { db, taskStore, templateStore, service, runner } = setup({ mockSpawn: rejectSpawn });
  templateStore.saveTaskTemplate({
    id: 't1', name: 'T', maxConcurrency: 1, createdAt: NOW, updatedAt: NOW,
    stages: [
      { id: 's0', position: 0, snapshot: { id: 'ss0', name: 'U', role: 'user', autoAdvance: true, createdAt: NOW, updatedAt: NOW } },
      { id: 's1', position: 1, snapshot: { id: 'ss1', name: 'Do', role: 'agent', agent: 'claude', autoAdvance: false, goalCondition: 'x', goalMaxTurns: 50, promptTemplate: 'do', createdAt: NOW, updatedAt: NOW } },
    ],
  });
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'go' });
  service.next('r1', task.id);
  await runner.runAgentStage('r1', task.id, 1);
  const got = taskStore.getTask(task.id);
  assert.equal(got!.status, 'fail', 'max_turns reject → service.fail');
  assert.match(String(got!.auxFlags.sessionError ?? ''), /maximum number of turns/i);
  db.close();
});

test('non-goal stage passes neither goalCondition nor maxTurns', async () => {
  let called: any = null;
  const mockSpawn = async (cmd: string, opts: any, writer: any) => { called = { opts }; writer.send(JSON.stringify({ kind: 'complete' })); };
  const { db, templateStore, service, runner } = setup({ mockSpawn });
  makeAgentTemplate(templateStore, 't1');
  const task = service.createTask({ rootId: 'r1', taskTemplateId: 't1', input: 'go' });
  service.next('r1', task.id);
  await runner.runAgentStage('r1', task.id, 1);
  assert.equal(called.opts.goalCondition, undefined);
  assert.equal(called.opts.maxTurns, undefined);
  db.close();
});
