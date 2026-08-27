import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

import type { TaskStore } from '@/modules/kanban/store.js';
import type { Task } from '@/modules/kanban/types.js';
import { AppError } from '@/shared/utils.js';

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
        reject(new Error(`git ${args.join(' ')} failed (${code}): ${stderr.trim().slice(0, 300)}`));
      }
    });
  });
}

export interface AcceptanceDeps {
  taskStore: TaskStore;
  resolveRootPath: (rootId: string) => string | null;
}

/**
 * 验收通过:把任务 worktree 分支合并进主仓当前分支(--no-ff 保留任务边界)。
 *
 * 守卫顺序:任务存在 → 已交付(success)→ 主仓可解析 → 分支存在 → 主仓工作区
 * 干净(有未提交改动时拒绝,避免把用户进行中的工作卷进合并提交)→ 幂等(分支
 * 已是 HEAD 祖先时直接返回 alreadyMerged)→ 执行合并。合并冲突时自动
 * `git merge --abort` 恢复干净工作区,转人工处理。
 */
export async function acceptDeliverable(
  deps: AcceptanceDeps,
  rootId: string,
  taskId: string,
): Promise<{ task: Task; commit?: string; targetBranch?: string; alreadyMerged?: boolean }> {
  const { taskStore, resolveRootPath } = deps;
  const task = taskStore.getTask(taskId);
  if (!task || task.rootId !== rootId) {
    throw new AppError('task not found', { code: 'TASK_NOT_FOUND', statusCode: 404 });
  }
  if (task.status !== 'success') {
    throw new AppError('只有已交付(success)的任务才能验收合并', { code: 'INVALID_STATUS', statusCode: 409 });
  }
  const rootPath = resolveRootPath(rootId);
  if (!rootPath) {
    throw new AppError('找不到任务所属项目的主仓路径', { code: 'ROOT_NOT_FOUND', statusCode: 404 });
  }
  const branch = task.worktreeBranch;
  if (!branch) {
    throw new AppError('任务没有 worktree 分支,无法合并', { code: 'NO_BRANCH', statusCode: 409 });
  }
  const branchSha = (await runGit(['rev-parse', '--verify', `${branch}^{commit}`], rootPath)).trim();
  const targetBranch = (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], rootPath)).trim();
  if (targetBranch === branch) {
    throw new AppError(`主仓当前就在任务分支 ${branch} 上,无法自合并`, { code: 'SAME_BRANCH', statusCode: 409 });
  }
  // 只拦「已跟踪文件」的未提交改动:未跟踪文件(debug 产物等)不挡验收,
  // 万一与合并路径相撞,git 自身会拒绝并在下方失败分支里自动 abort。
  const dirty = (await runGit(['status', '--porcelain'], rootPath))
    .split('\n')
    .some((line) => line.trim() && !line.startsWith('??'));
  if (dirty) {
    throw new AppError('主仓有未提交的已跟踪文件改动,请先 commit/stash 再验收合并', { code: 'REPO_DIRTY', statusCode: 409 });
  }

  let ancestorExit = 0;
  try {
    await runGit(['merge-base', '--is-ancestor', branchSha, 'HEAD'], rootPath);
  } catch {
    ancestorExit = 1;
  }
  if (ancestorExit === 0) {
    return { task, alreadyMerged: true };
  }

  const reqLabel = `REQ-${String(task.taskNumber).padStart(3, '0')}`;
  try {
    await runGit(['merge', '--no-ff', branch, '-m', `Merge ${reqLabel}(kanban 验收): ${task.input?.slice(0, 80) ?? task.taskTemplateName ?? branch}`], rootPath);
  } catch (e) {
    // 冲突/失败必须把主仓恢复干净,由人工决定怎么解。
    try { await runGit(['merge', '--abort'], rootPath); } catch { /* already clean or no MERGE_HEAD */ }
    throw new AppError(`合并失败,已恢复主仓原状(需人工处理):${e instanceof Error ? e.message : String(e)}`, { code: 'MERGE_FAILED', statusCode: 409 });
  }
  const commit = (await runGit(['rev-parse', '--short', 'HEAD'], rootPath)).trim();
  taskStore.insertTaskEvent({
    id: randomUUID(), taskId, type: 'task_accepted',
    payloadJson: JSON.stringify({ branch, targetBranch }), createdAt: new Date().toISOString(),
  });
  taskStore.insertTaskEvent({
    id: randomUUID(), taskId, type: 'task_merged',
    payloadJson: JSON.stringify({ commit, branch, targetBranch }), createdAt: new Date().toISOString(),
  });
  return { task: taskStore.getTask(taskId)!, commit, targetBranch };
}
