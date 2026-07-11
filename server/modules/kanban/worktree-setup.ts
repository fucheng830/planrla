// server/modules/kanban/worktree-setup.ts
//
// Kanban-level worktree orchestrator. Wraps the pure-git git-worktree module
// with task-aware semantics:
//   - ensureWorktree(task, rootPath) is idempotent: if the task already has a
//     worktree path on disk, reuse it; otherwise create one, persist its path
//     + branch via taskStore.updateTaskWorktree, and write a `.mcp.json` into
//     the worktree pointing the agent at the kanban MCP HTTP endpoint.
//   - Returns null (rather than throwing) when the task opts out
//     (createWorktree=false), has no rootPath, or git creation fails — callers
//     fall back to the root project path.
//   - removeWorktree(task, rootPath) is a best-effort teardown inverse.
//
// The `.mcp.json` write is wrapped in try/catch: it is a convenience for the
// spawned agent, not a correctness requirement, so a failure (e.g. an unusual
// path that can't be written) is logged and swallowed.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Task } from '@/modules/kanban/types.js';
import type { TaskStore } from '@/modules/kanban/store.js';
import type { WorktreeGit, CreatedWorktree } from '@/modules/kanban/git-worktree.js';

export interface WorktreeSetupDeps {
  store: TaskStore;
  git: WorktreeGit;
  mcpBaseUrl: string;
  branchPrefix?: string;
  log?: (msg: string) => void;
}

export interface WorktreeSetup {
  /** Idempotently ensure a task has a worktree. Returns its path, or null when disabled/no-root/creation-failed. */
  ensureWorktree(task: Task, rootPath: string | null): Promise<string | null>;
  /** Best-effort remove a task's worktree. */
  removeWorktree(task: Task, rootPath: string | null): Promise<void>;
}

export function createWorktreeSetup(deps: WorktreeSetupDeps): WorktreeSetup {
  const { store, git, mcpBaseUrl, branchPrefix = 'kanban/', log = () => {} } = deps;

  function branchFor(task: Task): string {
    const suffix = task.id.replace(/-/g, '').slice(0, 8);
    return `${branchPrefix}${task.taskNumber}-${suffix}`;
  }

  function writeWorktreeMcpConfig(wtPath: string): void {
    const config = {
      mcpServers: {
        'planrla-kanban': { type: 'http', url: mcpBaseUrl },
      },
    };
    writeFileSync(join(wtPath, '.mcp.json'), JSON.stringify(config, null, 2));
  }

  async function ensureWorktree(task: Task, rootPath: string | null): Promise<string | null> {
    if (!task.createWorktree) return null;
    if (!rootPath) return null;
    if (task.worktreePath && git.worktreeExists(task.worktreePath)) {
      return task.worktreePath;
    }
    const branch = task.worktreeBranch ?? branchFor(task);
    let created: CreatedWorktree;
    try {
      created = await git.createLinkedWorktree(rootPath, branch);
    } catch (e: any) {
      log(`[kanban-worktree] create failed task=${task.id}: ${e?.message ?? e}`);
      return null;
    }
    try {
      store.updateTaskWorktree(task.id, { worktreePath: created.path, worktreeBranch: created.branch });
    } catch (e: any) {
      log(`[kanban-worktree] persist worktree path failed task=${task.id}: ${e?.message ?? e}`);
    }
    try {
      writeWorktreeMcpConfig(created.path);
    } catch (e: any) {
      log(`[kanban-worktree] .mcp.json write failed: ${e?.message ?? e}`);
    }
    return created.path;
  }

  async function removeWorktree(task: Task, rootPath: string | null): Promise<void> {
    if (!task.worktreePath || !rootPath) return;
    try {
      await git.removeLinkedWorktree(rootPath, task.worktreePath);
    } catch (e: any) {
      log(`[kanban-worktree] remove failed task=${task.id}: ${e?.message ?? e}`);
    }
  }

  return { ensureWorktree, removeWorktree };
}
