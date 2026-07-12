// server/modules/kanban/worktree-setup.ts
//
// Kanban-level worktree orchestrator. Wraps the pure-git git-worktree module
// with task-aware semantics:
//   - ensureWorktree(task, rootPath) is idempotent: if the task already has a
//     worktree path on disk, reuse it; otherwise create one, persist its path
//     + branch via taskStore.updateTaskWorktree, write a `.mcp.json` into the
//     worktree pointing the agent at the kanban MCP HTTP endpoint, and link the
//     worktree's node_modules to the main repo's (junction) so the agent can run
//     tsc/build without a reinstall.
//   - Returns null (rather than throwing) when the task opts out
//     (createWorktree=false), has no rootPath, or git creation fails — callers
//     fall back to the root project path.
//   - removeWorktree(task, rootPath) is a best-effort teardown inverse.
//
// The `.mcp.json` write and node_modules link are wrapped in try/catch: they
// are conveniences for the spawned agent, not correctness requirements, so a
// failure (e.g. an unusual path, or a platform where the junction can't be
// created) is logged and swallowed.

import { existsSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

  /**
   * Link the worktree's node_modules to the main repo's node_modules via a
   * Windows directory junction (no elevation required, unlike a symlink).
   * On POSIX the 'junction' type is ignored and a normal symlink is created.
   * This lets the spawned agent run `npx tsc` / `npm run build` inside the
   * worktree without an expensive reinstall. Idempotent: no-op if the link
   * already exists. Throws on failure; callers swallow + log.
   */
  function linkWorktreeNodeModules(wtPath: string, rootPath: string): void {
    const linkPath = join(wtPath, 'node_modules');
    if (existsSync(linkPath)) return;
    const target = join(rootPath, 'node_modules');
    symlinkSync(target, linkPath, 'junction');
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
    try {
      linkWorktreeNodeModules(created.path, rootPath);
      log(`[kanban-worktree] linked node_modules task=${task.id}`);
    } catch (e: any) {
      log(`[kanban-worktree] node_modules link failed task=${task.id}: ${e?.message ?? e}`);
    }
    return created.path;
  }

  async function removeWorktree(task: Task, rootPath: string | null): Promise<void> {
    if (!task.worktreePath || !rootPath) return;
    // Tear down the node_modules junction first. rmSync on a directory that
    // contains a junction fails on the reparse point. Note: existsSync is the
    // WRONG guard here — it follows the junction to its target and returns
    // false when the target is absent (e.g. a fresh test repo with no
    // node_modules), even though the link itself exists. Use rmSync directly:
    // force:true makes it a no-op when the link is absent, and Node (≥16.7)
    // recognises the directory reparse point and removes the link itself
    // without recursing into the target — safe, won't touch the main repo's
    // node_modules. Done before tearing down the rest of the worktree dir.
    try {
      rmSync(join(task.worktreePath, 'node_modules'), { recursive: true, force: true });
    } catch (e: any) {
      log(`[kanban-worktree] node_modules unlink failed task=${task.id}: ${e?.message ?? e}`);
    }
    try {
      await git.removeLinkedWorktree(rootPath, task.worktreePath);
    } catch (e: any) {
      log(`[kanban-worktree] remove failed task=${task.id}: ${e?.message ?? e}`);
    }
  }

  return { ensureWorktree, removeWorktree };
}
