// server/modules/kanban/tests/service-terminal-worktree.test.ts
//
// Tests the W4 follow-up: when a task transitions to a terminal status
// (success/fail/cancelled) the service fires its optional `onTerminal` hook
// exactly once, and — when the hook is wired to worktreeSetup.removeWorktree
// as assembly wires it — the on-disk worktree and its `git worktree`
// registration are actually cleaned up.
//
// The non-terminal transitions (next on a multi-stage template, prev, pause,
// resume) must NOT fire the hook.
//
// Part 1 uses a real store + service with a recording onTerminal (no git).
// Part 2 drives a real `git worktree add` against a temp repo and proves the
// worktree dir + `git worktree list` entry are gone after `service.cancel`.

import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskStore } from '@/modules/kanban/store.js';
import { createTemplateStore } from '@/modules/kanban/template-store.js';
import { createKanbanService } from '@/modules/kanban/service.js';
import { createWorktreeGit } from '@/modules/kanban/git-worktree.js';
import { createWorktreeSetup } from '@/modules/kanban/worktree-setup.js';
import type { Task } from '@/modules/kanban/types.js';

function gitInit(p: string) {
  spawnSync('git', ['init', '-q'], { cwd: p });
  spawnSync('git', ['config', 'user.email', 't@t.t'], { cwd: p });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: p });
  spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: p });
}

// Shared three-stage template: user (auto-advance) → agent → user (last stage).
// Three stages lets us exercise next() as a NON-terminal transition (0→1)
// before completing from the last stage.
function makeThreeStageTemplate(store: ReturnType<typeof createTemplateStore>) {
  return store.saveTaskTemplate({
    id: 'tpl3', name: 'Three', maxConcurrency: 1,
    stages: [
      { id: 'a', position: 0, snapshot: { id: 'sa', name: 'kickoff', role: 'user', autoAdvance: true, createdAt: '', updatedAt: '' } },
      { id: 'b', position: 1, snapshot: { id: 'sb', name: 'impl', role: 'agent', autoAdvance: false, agent: 'claude', promptTemplate: 'do', createdAt: '', updatedAt: '' } },
      { id: 'c', position: 2, snapshot: { id: 'sc', name: 'review', role: 'user', autoAdvance: false, createdAt: '', updatedAt: '' } },
    ],
    createdAt: '', updatedAt: '',
  } as any);
}

function setup() {
  const db = new Database(join(tmpdir(), `kanban-term-${Date.now()}-${Math.random().toString(36).slice(2)}.db`));
  db.pragma('journal_mode = WAL');
  const taskStore = createTaskStore({ db });
  const templateStore = createTemplateStore({ dir: mkdtempSync(join(tmpdir(), 'kanban-term-tpl-')) });
  return { taskStore, templateStore };
}

// ===== Part 1: hook fires exactly once per terminal transition, never on non-terminal =====

test('onTerminal fires once on cancel with the updated (terminal) task', () => {
  const { taskStore, templateStore } = setup();
  const seen: Task[] = [];
  const service = createKanbanService({
    taskStore, templateStore,
    onTerminal: (t) => { seen.push(t); },
  });
  const tpl = makeThreeStageTemplate(templateStore);
  const task = service.createTask({ rootId: 'r1', taskTemplateId: tpl.id, input: 'go' });
  service.cancel('r1', task.id);
  assert.equal(seen.length, 1, 'onTerminal fired once');
  assert.equal(seen[0].id, task.id);
  assert.equal(seen[0].status, 'cancelled');
});

test('onTerminal fires once on fail with the updated (terminal) task', () => {
  const { taskStore, templateStore } = setup();
  const seen: Task[] = [];
  const service = createKanbanService({
    taskStore, templateStore,
    onTerminal: (t) => { seen.push(t); },
  });
  const tpl = makeThreeStageTemplate(templateStore);
  const task = service.createTask({ rootId: 'r1', taskTemplateId: tpl.id, input: 'go' });
  service.fail('r1', task.id);
  assert.equal(seen.length, 1, 'onTerminal fired once');
  assert.equal(seen[0].id, task.id);
  assert.equal(seen[0].status, 'fail');
});

test('onTerminal fires once on complete (last stage) with the updated (terminal) task', () => {
  const { taskStore, templateStore } = setup();
  const seen: Task[] = [];
  const service = createKanbanService({
    taskStore, templateStore,
    onTerminal: (t) => { seen.push(t); },
  });
  const tpl = makeThreeStageTemplate(templateStore);
  const task = service.createTask({ rootId: 'r1', taskTemplateId: tpl.id, input: 'go' });
  // advance 0→1 (non-terminal), then 1→2 (non-terminal), then complete on last stage
  service.next('r1', task.id);
  service.next('r1', task.id);
  assert.equal(seen.length, 0, 'next advances do not fire onTerminal');
  service.complete('r1', task.id);
  assert.equal(seen.length, 1, 'onTerminal fired once on complete');
  assert.equal(seen[0].id, task.id);
  assert.equal(seen[0].status, 'success');
});

test('onTerminal fires once when next() completes the task past the last stage (via completeInternal)', () => {
  // Single-stage template: next() on the only stage has nowhere to advance,
  // so it falls through to completeInternal → success. This proves the
  // next→completeInternal path fires the hook exactly once (no double-fire).
  const { taskStore, templateStore } = setup();
  const seen: Task[] = [];
  const service = createKanbanService({
    taskStore, templateStore,
    onTerminal: (t) => { seen.push(t); },
  });
  const tpl = templateStore.saveTaskTemplate({
    id: 'tpl1', name: 'One', maxConcurrency: 1,
    stages: [
      { id: 'a', position: 0, snapshot: { id: 'sa', name: 'kickoff', role: 'user', autoAdvance: true, createdAt: '', updatedAt: '' } },
    ],
    createdAt: '', updatedAt: '',
  } as any);
  const task = service.createTask({ rootId: 'r1', taskTemplateId: tpl.id, input: 'go' });
  service.next('r1', task.id);
  assert.equal(seen.length, 1, 'onTerminal fired exactly once via completeInternal');
  assert.equal(seen[0].id, task.id);
  assert.equal(seen[0].status, 'success');
});

test('onTerminal does NOT fire on non-terminal transitions (prev/pause/resume)', () => {
  const { taskStore, templateStore } = setup();
  const seen: Task[] = [];
  const service = createKanbanService({
    taskStore, templateStore,
    onTerminal: (t) => { seen.push(t); },
  });
  const tpl = makeThreeStageTemplate(templateStore);
  const task = service.createTask({ rootId: 'r1', taskTemplateId: tpl.id, input: 'go' });
  service.next('r1', task.id);   // 0 → 1
  service.next('r1', task.id);   // 1 → 2
  service.prev('r1', task.id);   // 2 → 1 (non-terminal)
  service.pause('r1', task.id);  // → paused (non-terminal)
  service.resume('r1', task.id); // → queued (non-terminal)
  assert.equal(seen.length, 0, 'no terminal transition occurred');
});

test('service built WITHOUT onTerminal is a no-op (state-machine compat)', () => {
  // Existing W1 state-machine tests build the service without onTerminal;
  // verify terminal transitions still succeed and don't throw.
  const { taskStore, templateStore } = setup();
  const service = createKanbanService({ taskStore, templateStore });
  const tpl = makeThreeStageTemplate(templateStore);
  const task = service.createTask({ rootId: 'r1', taskTemplateId: tpl.id, input: 'go' });
  const cancelled = service.cancel('r1', task.id);
  assert.equal(cancelled.status, 'cancelled');
});

// ===== Part 2: integration — cancel → onTerminal → removeWorktree cleans up on disk =====

test('cancel triggers onTerminal → removeWorktree cleans up worktree dir + git registration', async () => {
  const repo = mkdtempSync(join(tmpdir(), `kanban-term-int-${Date.now()}-`));
  gitInit(repo);
  try {
    const db = new Database(join(tmpdir(), `kanban-term-int-${Date.now()}-${Math.random().toString(36).slice(2)}.db`));
    db.pragma('journal_mode = WAL');
    const taskStore = createTaskStore({ db });
    const templateStore = createTemplateStore({ dir: mkdtempSync(join(tmpdir(), 'kanban-term-int-tpl-')) });
    const worktreeSetup = createWorktreeSetup({
      store: taskStore,
      git: createWorktreeGit(),
      mcpBaseUrl: 'http://127.0.0.1:3001/api/mcp/kanban',
      log: () => {},
    });
    const service = createKanbanService({
      taskStore, templateStore,
      onTerminal: (task) => {
        // Mirror assembly.ts wiring: fire-and-forget best-effort removeWorktree.
        void worktreeSetup.removeWorktree(task, repo).catch(() => {});
      },
    });
    const tpl = templateStore.saveTaskTemplate({
      id: 'tpl1', name: 'T', maxConcurrency: 1,
      stages: [
        { id: 'a', position: 0, snapshot: { id: 'sa', name: 'kickoff', role: 'user', autoAdvance: true, createdAt: '', updatedAt: '' } },
        { id: 'b', position: 1, snapshot: { id: 'sb', name: 'impl', role: 'agent', autoAdvance: false, agent: 'claude', promptTemplate: 'do', createdAt: '', updatedAt: '' } },
      ],
      createdAt: '', updatedAt: '',
    } as any);
    const task = service.createTask({ rootId: 'r1', taskTemplateId: tpl.id, input: 'go' });

    // Create a REAL worktree on disk (mimics what the runner does on admit).
    const wtPath = await worktreeSetup.ensureWorktree(task, repo);
    assert.ok(wtPath, 'ensureWorktree returned a path');
    assert.equal(existsSync(join(wtPath!, '.git')), true, 'worktree .git exists before cancel');
    const beforeList = spawnSync('git', ['worktree', 'list'], { cwd: repo }).stdout.toString();
    assert.match(beforeList, /kanban\/1-/, 'git worktree list shows the branch before cancel');

    // Cancel — onTerminal fires removeWorktree (async, fire-and-forget in the wiring).
    const reloaded = taskStore.getTask(task.id)!;
    service.cancel('r1', task.id);

    // Poll for the async removeWorktree side effect instead of a fixed sleep.
    const deadline = Date.now() + 3000;
    while (existsSync(wtPath!) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(existsSync(wtPath!), false, 'worktree dir removed after cancel');
    const afterList = spawnSync('git', ['worktree', 'list'], { cwd: repo }).stdout.toString();
    assert.doesNotMatch(afterList, /kanban\/1-/, 'git worktree list no longer shows the branch');
    // Sanity: reloaded task had the worktree path set before cancel (proves the
    // removeWorktree branch in worktree-setup actually did work, not early-return).
    assert.equal(reloaded.worktreePath, wtPath);
  } finally {
    // Windows: git/file handles can linger briefly; retry a few times.
    for (let i = 0; i < 5; i++) {
      try { rmSync(repo, { recursive: true, force: true }); break; }
      catch { await new Promise((r) => setTimeout(r, 200)); }
    }
  }
});
