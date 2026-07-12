import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SpawnAsyncResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type SpawnAsyncFn = (
  cmd: string,
  args: string[],
  opts: { cwd: string },
) => Promise<SpawnAsyncResult>;

export interface WorktreeGitDeps {
  /** Inject for testing; defaults to a real child_process.spawn wrapper. */
  spawnAsync?: SpawnAsyncFn;
}

export interface CreatedWorktree {
  path: string;
  branch: string;
}

/** Resolve the on-disk path for a linked worktree inside <rootPath>/.worktree/<branch>. */
export function resolveWorktreePath(rootPath: string, branch: string): string {
  const safe = branch.replace(/[^A-Za-z0-9._/-]/g, '-');
  return join(rootPath, '.worktree', safe);
}

function defaultSpawn(cmd: string, args: string[], opts: { cwd: string }): Promise<SpawnAsyncResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code: code === null ? -1 : code }));
  });
}

export type WorktreeGit = ReturnType<typeof createWorktreeGit>;

export function createWorktreeGit(deps: WorktreeGitDeps = {}) {
  const spawnAsync = deps.spawnAsync ?? defaultSpawn;

  async function runGit(rootPath: string, args: string[]): Promise<string> {
    const res = await spawnAsync('git', args, { cwd: rootPath });
    if (res.code !== 0) {
      const detail = (res.stderr.trim() || res.stdout.trim() || `exit ${res.code}`);
      throw new Error(`git ${args.join(' ')} failed: ${detail}`);
    }
    return res.stdout;
  }

  /** Append a pattern to <rootPath>/.git/info/exclude idempotently (keeps main repo status clean). */
  function appendGitInfoExclude(rootPath: string, pattern: string): void {
    const excludePath = join(rootPath, '.git', 'info', 'exclude');
    if (!existsSync(excludePath)) return;
    let existing = '';
    try { existing = readFileSync(excludePath, 'utf8'); } catch { /* ignore */ }
    const lines = existing.split(/\r?\n/);
    if (lines.includes(pattern)) return;
    const prefix = existing.length === 0 ? '' : existing.endsWith('\n') ? '' : '\n';
    appendFileSync(excludePath, `${prefix}${pattern}\n`);
  }

  /** Create a linked worktree at <rootPath>/.worktree/<branch> on a new branch from HEAD. */
  async function createLinkedWorktree(rootPath: string, branch: string): Promise<CreatedWorktree> {
    appendGitInfoExclude(rootPath, '.worktree/');
    const wtPath = resolveWorktreePath(rootPath, branch);
    await runGit(rootPath, ['worktree', 'add', '-b', branch, wtPath]);
    return { path: wtPath, branch };
  }

  /** Remove a linked worktree (unregisters + deletes on disk). Best-effort: throws on git failure. */
  async function removeLinkedWorktree(rootPath: string, wtPath: string): Promise<void> {
    await runGit(rootPath, ['worktree', 'remove', '--force', wtPath]);
  }

  /** True if a `.git` entry exists at wtPath (linked worktrees have a `.git` file, not dir). */
  function worktreeExists(wtPath: string): boolean {
    return existsSync(join(wtPath, '.git'));
  }

  return { createLinkedWorktree, removeLinkedWorktree, worktreeExists, appendGitInfoExclude, runGit };
}
