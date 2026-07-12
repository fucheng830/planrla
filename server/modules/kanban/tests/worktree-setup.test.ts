// server/modules/kanban/tests/worktree-setup.test.ts
//
// Tests for the kanban-level worktree orchestrator: ensureWorktree is
// idempotent (creates on first call, reuses on second), honors the
// createWorktree=false and null-rootPath opt-outs, and degrades to null
// (rather than throwing) when the underlying git create fails.
//
// The git layer is mocked so no real `git worktree add` is run; the store +
// service + template-store are real (in-memory sqlite + temp dir) so the
// persisted worktreePath/worktreeBranch round-trip is exercised end to end.

import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskStore } from '@/modules/kanban/store.js';
import { createTemplateStore } from '@/modules/kanban/template-store.js';
import { createKanbanService } from '@/modules/kanban/service.js';
import { createWorktreeSetup, type WorktreeSetup } from '@/modules/kanban/worktree-setup.js';
import type { Task } from '@/modules/kanban/types.js';

function setup(): {
  service: ReturnType<typeof createKanbanService>;
  taskStore: ReturnType<typeof createTaskStore>;
  makeTask: () => Task;
  worktreeSetup: (createdPaths: string[]) => WorktreeSetup;
} {
  const db = new Database(join(tmpdir(), `kanban-wts-${Date.now()}-${Math.random().toString(36).slice(2)}.db`));
  db.pragma('journal_mode = WAL');
  const taskStore = createTaskStore({ db });
  const templateStore = createTemplateStore({ dir: mkdtempSync(join(tmpdir(), `kanban-wts-tpl-`)) });
  const service = createKanbanService({ taskStore, templateStore });
  const tpl = templateStore.saveTaskTemplate({
    id: 'tpl1', name: 'T', maxConcurrency: 1,
    stages: [
      { id: 'su', position: 0, snapshot: { id: 'su1', name: 'start', role: 'user', autoAdvance: true, createdAt: '', updatedAt: '' } },
      { id: 'ss', position: 1, snapshot: { id: 's1', name: 'do', role: 'agent', autoAdvance: true, agent: 'claude', promptTemplate: 'hi', createdAt: '', updatedAt: '' } },
    ],
    createdAt: '', updatedAt: '',
  } as any);
  const makeTask = () => service.createTask({ rootId: 'root1', taskTemplateId: tpl.id, input: 'go' });
  const worktreeSetup = (createdPaths: string[]) => createWorktreeSetup({
    store: taskStore,
    mcpBaseUrl: 'http://127.0.0.1:3001/api/mcp/kanban',
    git: {
      createLinkedWorktree: async (_root: string, branch: string) => {
        const p = mkdtempSync(join(tmpdir(), 'kanban-wt-mock-'));
        createdPaths.push(p);
        return { path: p, branch };
      },
      removeLinkedWorktree: async () => {},
      worktreeExists: (p: string) => createdPaths.includes(p),
      appendGitInfoExclude: () => {},
      runGit: async () => '',
    } as any,
    log: () => {},
  });
  return { service, taskStore, makeTask, worktreeSetup };
}

test('ensureWorktree creates worktree, persists path+branch, writes .mcp.json', async () => {
  const { service, makeTask, worktreeSetup } = setup();
  const created: string[] = [];
  const task = makeTask();
  const ws = worktreeSetup(created);
  const wtPath = await ws.ensureWorktree(task, '/repo');
  assert.ok(wtPath, 'ensureWorktree should return a path');
  assert.equal(wtPath, created[0]);
  const after = service.getTask(task.rootId, task.id);
  assert.equal(after?.worktreePath, wtPath);
  assert.equal(after?.worktreeBranch?.startsWith('kanban/1-'), true);
  const mcp = JSON.parse(readFileSync(join(wtPath!, '.mcp.json'), 'utf8'));
  assert.equal(mcp.mcpServers['planrla-kanban'].type, 'http');
  assert.equal(mcp.mcpServers['planrla-kanban'].url, 'http://127.0.0.1:3001/api/mcp/kanban');
});

test('ensureWorktree is idempotent: reuses existing worktree, does not create again', async () => {
  const { makeTask, worktreeSetup } = setup();
  const created: string[] = [];
  const ws = worktreeSetup(created);
  const task = makeTask();
  const first = await ws.ensureWorktree(task, '/repo');
  assert.ok(first, 'first call should create a worktree');
  const taskAgain = { ...task, worktreePath: first!, worktreeBranch: 'kanban/1-x' };
  const second = await ws.ensureWorktree(taskAgain, '/repo');
  assert.equal(second, first);
  assert.equal(created.length, 1);
});

test('ensureWorktree returns null when createWorktree is false', async () => {
  const { makeTask, worktreeSetup } = setup();
  const created: string[] = [];
  const ws = worktreeSetup(created);
  const task = makeTask();
  const noWtTask = { ...task, createWorktree: false };
  const out = await ws.ensureWorktree(noWtTask, '/repo');
  assert.equal(out, null);
  assert.equal(created.length, 0);
});

test('ensureWorktree returns null when rootPath is null', async () => {
  const { makeTask, worktreeSetup } = setup();
  const ws = worktreeSetup([]);
  const task = makeTask();
  const out = await ws.ensureWorktree(task, null);
  assert.equal(out, null);
});

test('ensureWorktree returns null (and does not throw) when git create fails', async () => {
  const { taskStore, makeTask } = setup();
  const failing = createWorktreeSetup({
    store: taskStore,
    mcpBaseUrl: 'x',
    git: {
      createLinkedWorktree: async () => { throw new Error('boom'); },
      removeLinkedWorktree: async () => {},
      worktreeExists: () => false,
      appendGitInfoExclude: () => {},
      runGit: async () => '',
    } as any,
    log: () => {},
  });
  const task = makeTask();
  const out = await failing.ensureWorktree(task, '/repo');
  assert.equal(out, null);
});
