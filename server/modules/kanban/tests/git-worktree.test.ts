import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorktreeGit, resolveWorktreePath } from '@/modules/kanban/git-worktree.js';

function gitInit(repoPath: string): void {
  spawnSync('git', ['init', '-q'], { cwd: repoPath });
  spawnSync('git', ['config', 'user.email', 't@t.t'], { cwd: repoPath });
  spawnSync('git', ['config', 'user.name', 'tester'], { cwd: repoPath });
  spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repoPath });
}

function makeRepo(): string {
  const p = mkdtempSync(join(tmpdir(), `kanban-gwt-${Date.now()}-`));
  gitInit(p);
  return p;
}

test('resolveWorktreePath puts worktree under <root>/.worktree/<branch>', () => {
  assert.equal(
    resolveWorktreePath('/repo', 'kanban/42-abc12345').replace(/\\/g, '/'),
    '/repo/.worktree/kanban/42-abc12345',
  );
});

test('createLinkedWorktree creates a real linked worktree on a new branch', async () => {
  const repo = makeRepo();
  const git = createWorktreeGit();
  try {
    const created = await git.createLinkedWorktree(repo, 'kanban/1-aaaaaaaa');
    assert.equal(existsSync(join(created.path, '.git')), true);
    const list = spawnSync('git', ['worktree', 'list'], { cwd: repo }).stdout.toString();
    assert.match(list, /kanban\/1-aaaaaaaa/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('createLinkedWorktree appends .worktree/ to .git/info/exclude idempotently', async () => {
  const repo = makeRepo();
  const git = createWorktreeGit();
  try {
    await git.createLinkedWorktree(repo, 'kanban/2-bbbbbbbb');
    const exclude = readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8');
    assert.match(exclude, /\.worktree\//);
    await git.createLinkedWorktree(repo, 'kanban/3-cccccccc');
    const exclude2 = readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8');
    assert.equal((exclude2.match(/\.worktree\//g) || []).length, 1);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('removeLinkedWorktree unregisters and deletes the worktree dir', async () => {
  const repo = makeRepo();
  const git = createWorktreeGit();
  try {
    const created = await git.createLinkedWorktree(repo, 'kanban/4-dddddddd');
    await git.removeLinkedWorktree(repo, created.path);
    assert.equal(existsSync(created.path), false);
    const list = spawnSync('git', ['worktree', 'list'], { cwd: repo }).stdout.toString();
    assert.doesNotMatch(list, /kanban\/4-dddddddd/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('worktreeExists is true for a created worktree, false otherwise', async () => {
  const repo = makeRepo();
  const git = createWorktreeGit();
  try {
    const created = await git.createLinkedWorktree(repo, 'kanban/5-eeeeeeee');
    assert.equal(git.worktreeExists(created.path), true);
    assert.equal(git.worktreeExists(join(repo, '.worktree', 'nope')), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('createLinkedWorktree throws on non-zero git exit', async () => {
  // Use a directory that is NOT a git repo so `git worktree add` genuinely fails.
  const repo = mkdtempSync(join(tmpdir(), `kanban-gwt-bad-${Date.now()}-`));
  const git = createWorktreeGit();
  try {
    await assert.rejects(() => git.createLinkedWorktree(repo, 'kanban/6-ffffffff'));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
