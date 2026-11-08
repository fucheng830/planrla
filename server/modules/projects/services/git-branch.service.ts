import { spawn } from 'node:child_process';

type BranchCacheEntry = {
  branch: string | null;
  expiresAt: number;
};

const BRANCH_CACHE_TTL_MS = 60_000;
const branchCache = new Map<string, BranchCacheEntry>();

function readGitBranch(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('git', ['branch', '--show-current'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      const branch = code === 0 ? stdout.trim() : '';
      resolve(branch || null);
    });
  });
}

/**
 * 读取目录当前 git 分支(带 60s 内存缓存)。非 git 目录 / git 缺失返回 null。
 * 侧栏悬浮卡按项目展示分支,同一项目的多次会话查询共享一份解析结果。
 */
export async function getProjectBranch(fullPath: string): Promise<string | null> {
  const cached = branchCache.get(fullPath);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.branch;
  }

  const branch = await readGitBranch(fullPath);
  branchCache.set(fullPath, { branch, expiresAt: Date.now() + BRANCH_CACHE_TTL_MS });
  return branch;
}
