import assert from 'node:assert/strict';
import test from 'node:test';

import { attributeSessionProjectPath } from '@/shared/utils.js';

test('attributes kanban worktree cwds to the real project root (windows + posix separators)', () => {
  assert.equal(
    attributeSessionProjectPath('C:\\workspace\\项目\\deepseek-harness\\.worktree\\kanban\\1-d295bf21'),
    'C:\\workspace\\项目\\deepseek-harness',
  );
  assert.equal(
    attributeSessionProjectPath('/home/dev/wanxiang/.worktree/kanban/2-80984b32'),
    '/home/dev/wanxiang',
  );
});

test('collapses nested worktree-in-worktree paths to the real root (first marker wins)', () => {
  assert.equal(
    attributeSessionProjectPath(
      'C:\\ws\\wanxiang\\.worktree\\kanban\\1-a\\.worktree\\kanban\\1-b\\.worktree\\kanban\\1-c',
    ),
    'C:\\ws\\wanxiang',
  );
});

test('leaves plain project paths and non-kanban worktrees untouched', () => {
  assert.equal(attributeSessionProjectPath('C:\\workspace\\项目\\planrla'), 'C:\\workspace\\项目\\planrla');
  assert.equal(
    attributeSessionProjectPath('D:\\p\\.claude\\worktrees\\req043\\.tmp\\spike-goal-e2e'),
    'D:\\p\\.claude\\worktrees\\req043\\.tmp\\spike-goal-e2e',
  );
  // A path that is nothing but the marker tail has no root to keep — as-is.
  assert.equal(attributeSessionProjectPath('.worktree/kanban/1-abc'), '.worktree/kanban/1-abc');
});
