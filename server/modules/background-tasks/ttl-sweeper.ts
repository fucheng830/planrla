// server/modules/background-tasks/ttl-sweeper.ts
//
// REQ-046 §6 / §13 ⑤ — TTL sweeper。从 registry.service 拆出,保文件卫生 ≤500 行。
//
// 职责:定时扫所有 task,做两件事:
// 1. 非终态 idle/stuck 检测(5min 无活动 → idle;10min → failed stuck)。
//    时间引起的转换**不重置 lastActivityAt**(否则会掩盖 stuck 时长)。
// 2. 终态 TTL(30min 后清)。
//
// 通过 deps 注入 tasks Map + emit,保持 registry.service 可独立单测。

import type { BackgroundTask, BackgroundTaskStatus } from './types.js';
import { isTerminalStatus } from './types.js';

export const IDLE_THRESHOLD_MS = 5 * 60 * 1000;
export const STUCK_TIMEOUT_MS = 10 * 60 * 1000;
export const TERMINAL_TTL_MS = 30 * 60 * 1000;
export const SWEEP_INTERVAL_MS = 30 * 1000;

export interface SweeperTasks {
  forEach: (cb: (task: BackgroundTask, id: string) => void) => void;
  set: (id: string, task: BackgroundTask) => void;
  delete: (id: string) => void;
}

export interface SweeperDeps {
  tasks: SweeperTasks;
  emit: (task: BackgroundTask | null, id: string) => void;
  now: () => number;
}

/** 跑一次 sweep(测试直接调;生产由 setInterval 驱动)。 */
export function runSweep(deps: SweeperDeps): void {
  const t = deps.now();
  deps.tasks.forEach((task, id) => {
    const idleFor = t - task.lastActivityAt;
    if (isTerminalStatus(task.status)) {
      const finishedAt = task.finishedAt ?? task.lastActivityAt;
      if (t - finishedAt > TERMINAL_TTL_MS) {
        deps.tasks.delete(id);
        deps.emit(null, id);
      }
      return;
    }
    if (idleFor > STUCK_TIMEOUT_MS) {
      // 10min 无活动 → failed(stuck),无论之前 running/idle。不重置 lastActivityAt。
      const failed: BackgroundTask = {
        ...task,
        status: 'failed' as BackgroundTaskStatus,
        error: 'stuck: no activity for 10min',
        finishedAt: task.finishedAt ?? t,
      };
      deps.tasks.set(id, failed);
      deps.emit(failed, id);
      return;
    }
    if (idleFor > IDLE_THRESHOLD_MS && task.status === 'running') {
      // 5min 无活动 + running → idle(橙色"无活动")。不重置 lastActivityAt。
      const idled: BackgroundTask = { ...task, status: 'idle' as BackgroundTaskStatus };
      deps.tasks.set(id, idled);
      deps.emit(idled, id);
    }
  });
}

/** 启动定时 sweeper。返回 stop 函数。 */
export function startSweeper(deps: SweeperDeps): () => void {
  const timer = setInterval(() => runSweep(deps), SWEEP_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
