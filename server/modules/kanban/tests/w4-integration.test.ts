// server/modules/kanban/tests/w4-integration.test.ts
//
// W4 end-to-end integration test: proves the whole self-driving kanban loop
// works against a REAL temp git repo (no mocks at the git layer):
//   createTask → scheduler admits → runner.ensureWorktree runs a real
//   `git worktree add` and writes `.mcp.json` → injected mock spawnFn is
//   invoked with cwd = worktreePath and a rendered prompt (variable
//   substitution + MCP self-drive preamble) → autoAdvance on complete.
//
// This is the single test that proves the assembly wiring (Part A) and the
// worktree isolate + MCP preamble contract all click together. The scheduler
// is the real one, the service is the real one, the git layer is the real
// `git` binary; only the provider spawnFn is mocked.

import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskStore } from '@/modules/kanban/store.js';
import { createTemplateStore } from '@/modules/kanban/template-store.js';
import { createKanbanService } from '@/modules/kanban/service.js';
import { createAuxBridge } from '@/modules/kanban/aux-bridge.js';
import { createRunner } from '@/modules/kanban/runner.js';
import { createScheduler } from '@/modules/kanban/scheduler.js';
import { createWorktreeGit } from '@/modules/kanban/git-worktree.js';
import { createWorktreeSetup } from '@/modules/kanban/worktree-setup.js';

function gitInit(p: string) {
  spawnSync('git', ['init', '-q'], { cwd: p });
  spawnSync('git', ['config', 'user.email', 't@t.t'], { cwd: p });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: p });
  spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: p });
}

test('W4 end-to-end: createTask → admit → ensureWorktree → mock spawn → autoAdvance', async () => {
  const repo = mkdtempSync(join(tmpdir(), `kanban-w4-${Date.now()}-`));
  gitInit(repo);
  try {
    const db = new Database(join(tmpdir(), `kanban-w4-${Date.now()}-${Math.random().toString(36).slice(2)}.db`));
    db.pragma('journal_mode = WAL');
    const taskStore = createTaskStore({ db });
    const templateStore = createTemplateStore({ dir: mkdtempSync(join(tmpdir(), 'kanban-w4-tpl-')) });
    const service = createKanbanService({ taskStore, templateStore });
    const auxBridge = createAuxBridge({ updateAuxFlags: taskStore.updateTaskAuxFlags });
    const worktreeSetup = createWorktreeSetup({
      store: taskStore,
      git: createWorktreeGit(),
      mcpBaseUrl: 'http://127.0.0.1:3001/api/mcp/kanban',
      log: () => {},
    });

    const seen: { cwd?: string; prompt?: string }[] = [];
    const mockSpawn = async (cmd: string, opts: any, writer: any) => {
      seen.push({ cwd: opts?.cwd, prompt: cmd });
      writer.send(JSON.stringify({ kind: 'tool_use', toolName: 'TodoWrite', toolInput: { todos: [] } }));
      writer.send(JSON.stringify({ kind: 'complete' }));
    };
    const runner = createRunner({
      taskStore,
      templateStore,
      service,
      auxBridge,
      resolveRootPath: () => repo,
      spawnFns: { claude: mockSpawn },
      worktreeSetup,
      log: () => {},
    });
    const scheduler = createScheduler({
      taskStore,
      templateStore,
      onAdmit: (taskId) => {
        const t = taskStore.getTask(taskId);
        if (!t) return;
        const tpl = templateStore.getTaskTemplate(t.taskTemplateId);
        const stage = tpl?.stages[t.currentStageIndex]?.snapshot;
        if (!stage) return;
        if (stage.role === 'agent' && stage.agent) {
          void runner.runAgentStage(t.rootId, taskId, t.currentStageIndex).catch(() => {});
        } else if (stage.role === 'user' && stage.autoAdvance) {
          try { service.next(t.rootId, taskId); }
          catch { /* user-stage autoAdvance; scheduler re-loop handles the agent stage */ }
        }
      },
    });

    const tpl = templateStore.saveTaskTemplate({
      id: 'tpl1',
      name: 'Two-stage',
      maxConcurrency: 1,
      stages: [
        { id: 'a', position: 0, snapshot: { id: 'sa', name: 'user-kickoff', role: 'user', autoAdvance: true, createdAt: '', updatedAt: '' } },
        { id: 'b', position: 1, snapshot: { id: 'sb', name: 'implement', role: 'agent', autoAdvance: true, agent: 'claude', promptTemplate: 'build {{input}}', createdAt: '', updatedAt: '' } },
      ],
      createdAt: '',
      updatedAt: '',
    } as any);

    const task = service.createTask({ rootId: 'r1', taskTemplateId: tpl.id, input: 'feature-X' });
    // Single schedule() call admits the user stage (autoAdvance → service.next
    // moves to agent stage at queued), then the scheduler's internal re-loop
    // admits the agent stage → onAdmit → runner.runAgentStage (async, fires
    // real `git worktree add`). Poll deterministically for completion instead
    // of a fixed sleep — the runner promise is swallowed by `void` inside
    // onAdmit, so we observe its side effect (worktreePath persisted).
    scheduler.schedule('r1');
    const deadline = Date.now() + 5000;
    let after = taskStore.getTask(task.id);
    while ((!after?.worktreePath || seen.length === 0) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      after = taskStore.getTask(task.id);
    }

    assert.ok(after?.worktreePath, 'worktreePath persisted');
    assert.equal(existsSync(join(after!.worktreePath!, '.git')), true, 'worktree .git exists');
    const mcp = JSON.parse(readFileSync(join(after!.worktreePath!, '.mcp.json'), 'utf8'));
    assert.equal(mcp.mcpServers['planrla-kanban'].url, 'http://127.0.0.1:3001/api/mcp/kanban');
    assert.equal(seen.length, 1, 'spawnFn called once');
    assert.equal(seen[0]?.cwd, after!.worktreePath);
    assert.match(seen[0]?.prompt ?? '', /build feature-X/);
    assert.match(seen[0]?.prompt ?? '', /task_next/);
    assert.equal(after!.auxFlags.hasTodos, true);

    // Main repo status stays clean (.worktree/ excluded via .git/info/exclude).
    const status = spawnSync('git', ['status', '--porcelain'], { cwd: repo }).stdout.toString();
    assert.doesNotMatch(status, /\.worktree/);

    // T3 carry: removeWorktree cleans up + git worktree list no longer shows it.
    const beforeList = spawnSync('git', ['worktree', 'list'], { cwd: repo }).stdout.toString();
    assert.match(beforeList, /kanban\/1-/);
    await worktreeSetup.removeWorktree(after!, repo);
    const afterList = spawnSync('git', ['worktree', 'list'], { cwd: repo }).stdout.toString();
    assert.doesNotMatch(afterList, /kanban\/1-/);
    assert.equal(existsSync(after!.worktreePath!), false, 'worktree dir removed');
  } finally {
    // Windows: git/file handles can linger briefly after `git worktree remove`,
    // making rmSync hit EBUSY/ENOTEMPTY. Retry a few times; if it still fails,
    // leave the temp dir for the OS to clean (assertions already passed).
    for (let i = 0; i < 5; i++) {
      try { rmSync(repo, { recursive: true, force: true }); break; }
      catch { await new Promise((r) => setTimeout(r, 200)); }
    }
  }
});
