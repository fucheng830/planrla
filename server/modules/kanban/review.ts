import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { TaskStore } from '@/modules/kanban/store.js';
import { AppError } from '@/shared/utils.js';

export interface TaskDiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'untracked';
  additions: number;
  deletions: number;
}

export interface TaskDiffResult {
  worktreePath: string;
  baseSha: string;
  files: TaskDiffFile[];
  patch: string;
  truncated: boolean;
}

const MAX_PATCH_BYTES = 280_000;
const MAX_UNTRACKED_FILE_BYTES = 20_000;
/** Directories that should never appear in a review diff. */
const IGNORED_UNTRACKED_PREFIXES = ['node_modules/', '.git/'];

function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`git ${args.join(' ')} failed (${code}): ${stderr.trim().slice(0, 200)}`));
      }
    });
  });
}

async function tryGit(args: string[], cwd: string): Promise<string | null> {
  try {
    return await runGit(args, cwd);
  } catch {
    return null;
  }
}

function parseNumstat(raw: string): Map<string, { additions: number; deletions: number }> {
  const stats = new Map<string, { additions: number; deletions: number }>();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [add, del, ...rest] = trimmed.split('\t');
    stats.set(rest.join('\t'), {
      additions: add === '-' ? 0 : Number(add) || 0,
      deletions: del === '-' ? 0 : Number(del) || 0,
    });
  }
  return stats;
}

function parseNameStatus(raw: string): Map<string, TaskDiffFile['status']> {
  const statuses = new Map<string, TaskDiffFile['status']>();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [code, ...rest] = trimmed.split('\t');
    const filePath = rest.join('\t');
    if (code.startsWith('A')) statuses.set(filePath, 'added');
    else if (code.startsWith('D')) statuses.set(filePath, 'deleted');
    else statuses.set(filePath, 'modified');
  }
  return statuses;
}

function listUntracked(raw: string): string[] {
  return raw
    .split('\n')
    .filter((line) => line.startsWith('?? '))
    .map((line) => line.slice(3).trim())
    .filter((p) => p && !IGNORED_UNTRACKED_PREFIXES.some((prefix) => p.startsWith(prefix)));
}

/** Builds a unified-diff-looking block for one untracked file (all additions). */
async function buildUntrackedPatch(worktreePath: string, relPath: string): Promise<{ patch: string; lines: number }> {
  try {
    const absolute = path.join(worktreePath, relPath);
    const stats = await fs.stat(absolute);
    if (!stats.isFile()) {
      return { patch: `--- /dev/null\n+++ b/${relPath}\n(directory)\n`, lines: 0 };
    }
    // One trailing newline is a line terminator, not an extra line.
    let content = (await fs.readFile(absolute, 'utf-8')).replace(new RegExp('\n$'), '');
    let truncatedNote = '';
    if (content.length > MAX_UNTRACKED_FILE_BYTES) {
      content = content.slice(0, MAX_UNTRACKED_FILE_BYTES);
      truncatedNote = `\n... (file truncated at ${MAX_UNTRACKED_FILE_BYTES} bytes)`;
    }
    const lines = content.split('\n');
    const body = lines.map((line) => `+${line}`).join('\n');
    return {
      patch: `--- /dev/null\n+++ b/${relPath}\n@@ -0,0 +1,${lines.length} @@\n${body}${truncatedNote}\n`,
      lines: lines.length,
    };
  } catch {
    return { patch: '', lines: 0 };
  }
}

/**
 * Computes the review diff for a kanban task: everything the task's worktree
 * changed relative to where it branched off (merge-base with the root repo's
 * current HEAD), covering committed-ahead work, uncommitted edits, and
 * untracked new files.
 */
export async function getTaskDiff(options: {
  taskStore: TaskStore;
  resolveRootPath: (rootId: string) => string | null;
  rootId: string;
  taskId: string;
}): Promise<TaskDiffResult> {
  const { taskStore, resolveRootPath, rootId, taskId } = options;
  const task = taskStore.getTask(taskId);
  if (!task || task.rootId !== rootId) {
    throw new AppError('task not found', { code: 'TASK_NOT_FOUND', statusCode: 404 });
  }
  if (!task.worktreePath) {
    throw new AppError('task has no worktree yet', { code: 'NO_WORKTREE', statusCode: 404 });
  }

  const worktreePath = task.worktreePath;
  const rootPath = resolveRootPath(rootId);

  // Base = merge-base with the root repo's HEAD (the point the worktree
  // branched off). Fall back to plain HEAD (uncommitted-only diff) when the
  // root repo or the merge-base is unavailable.
  let baseSha: string | null = null;
  if (rootPath) {
    const rootHead = (await tryGit(['rev-parse', 'HEAD'], rootPath))?.trim();
    if (rootHead) {
      baseSha = (await tryGit(['merge-base', 'HEAD', rootHead], worktreePath))?.trim() || null;
    }
  }
  if (!baseSha) {
    baseSha = (await tryGit(['rev-parse', 'HEAD'], worktreePath))?.trim() || null;
  }
  if (!baseSha) {
    throw new AppError('unable to resolve diff base', { code: 'DIFF_BASE_FAILED', statusCode: 500 });
  }

  const [numstatRaw, nameStatusRaw, patchRaw, statusRaw] = await Promise.all([
    tryGit(['diff', '--numstat', baseSha], worktreePath),
    tryGit(['diff', '--name-status', baseSha], worktreePath),
    tryGit(['diff', baseSha], worktreePath),
    tryGit(['status', '--porcelain'], worktreePath),
  ]);

  const stats = parseNumstat(numstatRaw ?? '');
  const statuses = parseNameStatus(nameStatusRaw ?? '');
  const files: TaskDiffFile[] = [];
  for (const [filePath, stat] of stats) {
    files.push({
      path: filePath,
      status: statuses.get(filePath) ?? 'modified',
      additions: stat.additions,
      deletions: stat.deletions,
    });
  }

  // Untracked new files are invisible to `git diff` — synthesize their patches.
  let patch = patchRaw ?? '';
  for (const relPath of listUntracked(statusRaw ?? '')) {
    const { patch: untrackedPatch, lines } = await buildUntrackedPatch(worktreePath, relPath);
    files.push({ path: relPath, status: 'untracked', additions: lines, deletions: 0 });
    patch += patch ? `\n${untrackedPatch}` : untrackedPatch;
  }

  let truncated = false;
  if (patch.length > MAX_PATCH_BYTES) {
    patch = `${patch.slice(0, MAX_PATCH_BYTES)}\n\n… (patch truncated at ${MAX_PATCH_BYTES} bytes)`;
    truncated = true;
  }

  return { worktreePath, baseSha, files, patch, truncated };
}
