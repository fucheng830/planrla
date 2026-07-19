import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getTaskDiff } from '@/modules/kanban/review.js';

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kanban-review-'));
  const git = (args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' }).toString();
  git(['init']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  await writeFile(path.join(dir, 'a.txt'), 'v1\n');
  git(['add', '.']);
  git(['commit', '-m', 'base']);
  return dir;
}

function stubTaskStore(task: unknown) {
  return { getTask: () => task } as any;
}

test('getTaskDiff covers tracked edits and untracked new files', async () => {
  const dir = await initRepo();
  try {
    await writeFile(path.join(dir, 'a.txt'), 'v1\nv2\n');
    await writeFile(path.join(dir, 'b.txt'), 'brand\nnew\n');

    const task = { id: 't1', rootId: 'r1', worktreePath: dir };
    const result = await getTaskDiff({
      taskStore: stubTaskStore(task),
      resolveRootPath: () => dir,
      rootId: 'r1',
      taskId: 't1',
    });

    assert.equal(result.truncated, false);
    const aFile = result.files.find((f) => f.path === 'a.txt');
    assert.equal(aFile?.status, 'modified');
    assert.equal(aFile?.additions, 1);
    const bFile = result.files.find((f) => f.path === 'b.txt');
    assert.equal(bFile?.status, 'untracked');
    assert.equal(bFile?.additions, 2);
    assert.match(result.patch, /\+v2/);
    assert.match(result.patch, /\+\+\+ b\/b\.txt/);
    assert.match(result.patch, /\+brand/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getTaskDiff rejects tasks without a worktree', async () => {
  await assert.rejects(
    getTaskDiff({
      taskStore: stubTaskStore({ id: 't1', rootId: 'r1' }),
      resolveRootPath: () => null,
      rootId: 'r1',
      taskId: 't1',
    }),
    /no worktree/,
  );
});

test('getTaskDiff rejects tasks from another root', async () => {
  await assert.rejects(
    getTaskDiff({
      taskStore: stubTaskStore({ id: 't1', rootId: 'other', worktreePath: '/x' }),
      resolveRootPath: () => null,
      rootId: 'r1',
      taskId: 't1',
    }),
    /not found/,
  );
});
