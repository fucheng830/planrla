// server/modules/background-tasks/registry.service.ts
//
// REQ-046 — 统一后台任务 registry。聚合 kanban / a2a / chat / agent Bash 四类
// 后台任务为统一 BackgroundTask 模型,供前端面板实时显示 + 控制(stop)。
//
// 设计(见 spec §3 / §13):
// - 单例 const 对象 + module Map(镜像 chat-run-registry 模式)。
// - 四类 producer 各自调 upsert/remove;bash 走 apply(op)(消费 bash-parser 的纯函数产物)。
// - TTL sweeper 定时:running task 5min 无活动 → idle;10min 无活动 → failed(挂死);
//   terminal task 30min 后清;LRU 上限 100。
// - 广播:每次变更调 broadcaster(由 index.js 注入,见 kanban broadcastTaskUpdated 模式)。
// - kill:stopBashTask 调 claude-sdk.js 的 SDK stopTask(方案 C 精简版,§13 ③)。
//
// 文件卫生:本文件聚焦 registry 状态机 + 聚合。kill 调度 delegate 到
// `bash-kill.ts`(SDK stopTask 调用,独立可测)。若本文件超 500 行,把 TTL
// sweeper 拆到 `ttl-sweeper.ts`。

import type { BackgroundTask, BackgroundTaskStatus } from './types.js';
import {
  buildBackgroundTaskId,
  isStoppable,
  isTerminalStatus,
} from './types.js';
import type { TaskAuxFlags, TaskStatus } from '@/modules/kanban/index.js';
import type { LLMProvider } from '@/shared/types.js';
import type { BashRegistryOp } from './bash-parser.js';
import { runSweep, startSweeper as startSweeperImpl } from './ttl-sweeper.js';

// ===== 可配阈值(spec §7)— 详细逻辑在 ttl-sweeper.ts,这里只留 LRU 上限 =====
const MAX_TASKS = 100; // LRU 上限

/** 广播器:(taskId, task | null) → 推 WS。null = 删除。index.js 注入。 */
export type BackgroundTaskBroadcaster = (
  task: BackgroundTask | null,
  taskId: string,
) => void;

/** bash kill 调度器:返回 stopTask 是否成功(失败时 registry 兜底 force-mark)。 */
export type BashKillDispatcher = (
  appSessionId: string,
  bashTaskId: string,
) => Promise<{ killed: boolean; error?: string }>;

export interface RegistryDeps {
  /** WS 广播(可空 = 测试/未注入时不广播)。 */
  broadcast?: BackgroundTaskBroadcaster;
  /** bash kill 调度(可空 = 无法 kill,registry 直接 force-mark)。 */
  killBash?: BashKillDispatcher;
  /** now() 注入(测试用)。 */
  now?: () => number;
}

const tasks = new Map<string, BackgroundTask>();

let deps: RegistryDeps = {};

function nowMs(): number {
  return deps.now?.() ?? Date.now();
}

function setDeps(next: RegistryDeps): void {
  deps = next;
}

function emit(task: BackgroundTask | null, id: string): void {
  try {
    deps.broadcast?.(task, id);
  } catch {
    /* 广播失败不影响 registry 状态 */
  }
}

/** 内部:upsert 一条 task(状态转换守卫在 applyStatusTransition)。 */
function upsert(task: BackgroundTask): void {
  const prev = tasks.get(task.id);
  tasks.set(task.id, task);
  // LRU:超上限时丢最老的(按 startedAt)
  if (tasks.size > MAX_TASKS) {
    let oldestId: string | null = null;
    let oldestTs = Infinity;
    for (const [id, t] of tasks) {
      if (t.startedAt < oldestTs) {
        oldestTs = t.startedAt;
        oldestId = id;
      }
    }
    if (oldestId && oldestId !== task.id) {
      const dropped = tasks.get(oldestId);
      tasks.delete(oldestId);
      if (dropped) emit(null, oldestId);
    }
  }
  emit(task, task.id);
  void prev; // 仅避免 lint 未用
}

/** 状态转换守卫:终态不可回退(避免 terminal 后又被 update 拉回 running)。 */
function canTransition(from: BackgroundTaskStatus | undefined, to: BackgroundTaskStatus): boolean {
  if (from === undefined) return true;
  if (isTerminalStatus(from)) return false; // 终态锁
  return true;
}

function patchStatus(task: BackgroundTask, status: BackgroundTaskStatus, error?: string): BackgroundTask {
  const next: BackgroundTask = { ...task };
  if (canTransition(task.status, status)) {
    next.status = status;
    if (isTerminalStatus(status) && !next.finishedAt) {
      next.finishedAt = nowMs();
    }
  }
  if (error !== undefined) next.error = error;
  next.lastActivityAt = nowMs();
  return next;
}

// ===== 公共 API:四类 producer =====

/** kanban:每次 stage event / aux flag 变更调。 */
function upsertKanban(input: {
  taskId: string;
  rootId: string;
  title: string;
  status?: TaskStatus;
  stage?: number;
  stageTotal?: number;
  aux: TaskAuxFlags;
}): BackgroundTask {
  const id = buildBackgroundTaskId('kanban', [input.taskId]);
  const existing = tasks.get(id);
  const startedAt = existing?.startedAt ?? nowMs();
  const lastActivityAt = nowMs();

  // kanban TaskStatus → BackgroundTaskStatus
  let status: BackgroundTaskStatus = 'running';
  let error: string | undefined;
  if (input.status === 'success') status = 'completed';
  else if (input.status === 'fail') {
    status = 'failed';
    error = input.aux.sessionError;
  } else if (input.status === 'cancelled') status = 'killed';
  else if (input.aux.sessionError) {
    // 非终态但有 sessionError → failed(REQ-034:错误实时反映)
    status = 'failed';
    error = input.aux.sessionError;
  }

  const progress =
    input.stageTotal && input.stageTotal > 0
      ? Math.min(100, Math.round(((input.stage ?? 0) / input.stageTotal) * 100))
      : undefined;

  const task: BackgroundTask = {
    id,
    type: 'kanban',
    status,
    title: input.title,
    progress,
    startedAt,
    lastActivityAt,
    finishedAt: isTerminalStatus(status) ? nowMs() : existing?.finishedAt,
    subtitle: input.stageTotal ? `stage ${input.stage ?? 0}/${input.stageTotal}` : undefined,
    error,
    detail: {
      type: 'kanban',
      taskId: input.taskId,
      rootId: input.rootId,
      title: input.title,
      stage: input.stage,
      stageTotal: input.stageTotal,
      aux: input.aux,
    },
  };
  upsert(task);
  return task;
}

/** a2a:每次 inbound task state 变更调。S4 spawn 成功后调 remove(归 chat)。 */
function upsertA2A(input: {
  taskId: string;
  state: 'working' | 'completed' | 'failed' | 'canceled';
  provider?: LLMProvider;
  text: string;
  spawnedAppSessionId?: string;
}): BackgroundTask | null {
  const id = buildBackgroundTaskId('a2a', [input.taskId]);
  const existing = tasks.get(id);
  const startedAt = existing?.startedAt ?? nowMs();

  let status: BackgroundTaskStatus;
  if (input.state === 'completed') status = 'completed';
  else if (input.state === 'failed') status = 'failed';
  else if (input.state === 'canceled') status = 'killed';
  else status = 'running';

  // S4 spawn 成功 → completed(spawnedAppSessionId 给出后续 chat task 的 session)
  if (input.spawnedAppSessionId) status = 'completed';

  const task: BackgroundTask = {
    id,
    type: 'a2a',
    status,
    title: input.text.slice(0, 80) || 'a2a task',
    startedAt,
    lastActivityAt: nowMs(),
    finishedAt: isTerminalStatus(status) ? nowMs() : existing?.finishedAt,
    subtitle: input.provider ? `a2a · ${input.provider}` : 'a2a',
    detail: {
      type: 'a2a',
      taskId: input.taskId,
      state: input.state,
      provider: input.provider,
      text: input.text,
      spawnedAppSessionId: input.spawnedAppSessionId,
    },
  };
  upsert(task);
  return task;
}

/** chat:run-registry status 变更调。chat 用 proxy(引用 run-registry,不重造 lock)。 */
function upsertChat(input: {
  appSessionId: string;
  provider?: LLMProvider;
  running: boolean;
}): BackgroundTask | null {
  const id = buildBackgroundTaskId('chat', [input.appSessionId]);
  const existing = tasks.get(id);
  const startedAt = existing?.startedAt ?? nowMs();
  const status: BackgroundTaskStatus = input.running ? 'running' : 'idle';
  const task: BackgroundTask = {
    id,
    type: 'chat',
    status,
    title: input.appSessionId.slice(0, 8),
    startedAt,
    lastActivityAt: nowMs(),
    finishedAt: existing?.finishedAt,
    subtitle: input.provider ? `chat · ${input.provider}` : 'chat',
    detail: { type: 'chat', appSessionId: input.appSessionId, provider: input.provider },
  };
  upsert(task);
  return task;
}

// ===== bash:消费 bash-parser 的纯函数 op =====
//
// apply 是状态机入口;claude-sdk.js 调 parseBashTaskEvent → apply(op)。
// 注意 start 用占位 id(tool_use_id),reconcile 时替换为 SDK 真 task_id。
// 维护 toolUseId → bashTaskId 的反向映射(reconcile 用)。

const placeholderToReal = new Map<string, string>(); // toolUseId → realTaskId

function bashId(appSessionId: string, bashTaskId: string): string {
  return buildBackgroundTaskId('bash', [appSessionId, bashTaskId]);
}

function apply(op: BashRegistryOp): void {
  try {
    switch (op.kind) {
      case 'noop':
        return;
      case 'start': {
        const id = bashId(op.appSessionId, op.bashTaskId);
        if (tasks.has(id)) return; // 已存在(重复 event)
        const task: BackgroundTask = {
          id,
          type: 'bash',
          status: 'running',
          title: op.cmd.slice(0, 60) || 'bash',
          startedAt: nowMs(),
          lastActivityAt: nowMs(),
          subtitle: op.appSessionId.slice(0, 8),
          detail: {
            type: 'bash',
            appSessionId: op.appSessionId,
            bashTaskId: op.bashTaskId,
            cmd: op.cmd,
            outputTail: op.initialOutput.slice(-50),
          },
        };
        upsert(task);
        return;
      }
      case 'reconcile': {
        // 占位 id → 真 task_id。迁移 task + 反向映射。
        const oldId = bashId(op.appSessionId, op.placeholderBashTaskId);
        const newId = bashId(op.appSessionId, op.realBashTaskId);
        const existing = tasks.get(oldId);
        if (!existing) return;
        const migrated: BackgroundTask = {
          ...existing,
          id: newId,
          detail: { ...(existing.detail as any), bashTaskId: op.realBashTaskId },
        };
        tasks.delete(oldId);
        tasks.set(newId, migrated);
        placeholderToReal.set(op.placeholderBashTaskId, op.realBashTaskId);
        emit(null, oldId);
        emit(migrated, newId);
        return;
      }
      case 'update': {
        const realId = placeholderToReal.get(op.bashTaskId) ?? op.bashTaskId;
        const id = bashId(op.appSessionId, realId);
        const existing = tasks.get(id);
        if (!existing) return;
        if (existing.detail.type !== 'bash') return;
        const detail = existing.detail;
        const mergedTail = [...detail.outputTail, ...op.outputTail].slice(-50);
        const updated: BackgroundTask = {
          ...existing,
          // idle 可回 running(有新活动);终态不动(canTransition 守卫)
          status: existing.status === 'idle' ? 'running' : existing.status,
          lastActivityAt: nowMs(),
          detail: { ...detail, outputTail: mergedTail },
        };
        // 不用 patchStatus(避免把 idle 回 running 当转换走 finishedAt 清理逻辑)
        tasks.set(id, updated);
        emit(updated, id);
        return;
      }
      case 'complete': {
        const realId = placeholderToReal.get(op.bashTaskId) ?? op.bashTaskId;
        const id = bashId(op.appSessionId, realId);
        const existing = tasks.get(id);
        if (!existing) return;
        if (existing.detail.type !== 'bash') return;
        const detail = existing.detail;
        const patched = patchStatus(existing, op.status, op.error);
        const finalTask: BackgroundTask = {
          ...patched,
          detail: op.exitCode !== undefined ? { ...detail, exitCode: op.exitCode } : patched.detail,
        };
        tasks.set(id, finalTask);
        emit(finalTask, id);
        return;
      }
    }
  } catch (err) {
    // 单坏 op 不崩 registry
    console.warn('[bg-task-registry] apply failed:', (err as Error)?.message);
  }
}

/** 提供 priorTaskIds 给 parser(reconcile 判定用)。按 appSessionId 过滤占位 + 真 id。 */
function bashTaskIdsForSession(appSessionId: string): Set<string> {
  const set = new Set<string>();
  for (const task of tasks.values()) {
    if (task.type !== 'bash') continue;
    const d = task.detail as { type: 'bash'; appSessionId: string; bashTaskId: string };
    if (d.appSessionId === appSessionId) set.add(d.bashTaskId);
  }
  return set;
}

// ===== stop API(方案 C 精简版) =====

async function stopTask(taskId: string): Promise<{ task: BackgroundTask | null; error?: string }> {
  const task = tasks.get(taskId);
  if (!task) return { task: null, error: 'task not found' };
  if (!isStoppable(task.status)) {
    return { task, error: `task is ${task.status} (not stoppable)` };
  }

  if (task.type === 'bash') {
    if (task.detail.type !== 'bash') return { task };
    const d = task.detail;
    if (deps.killBash) {
      try {
        const res = await deps.killBash(d.appSessionId, d.bashTaskId);
        if (!res.killed) {
          // SDK stopTask 失败 → force-mark killed(session 可能已结束)
          const forceMarked = patchStatus(task, 'killed');
          const finalTask: BackgroundTask = {
            ...forceMarked,
            error: `force-marked: ${res.error ?? 'stopTask failed'}`,
            detail: { ...d, forceMarked: true },
          };
          tasks.set(taskId, finalTask);
          emit(finalTask, taskId);
          return { task: finalTask };
        }
        return { task: tasks.get(taskId) ?? task };
      } catch (err) {
        const forceMarked = patchStatus(task, 'killed');
        const finalTask: BackgroundTask = {
          ...forceMarked,
          error: `force-marked: ${(err as Error).message}`,
          detail: { ...d, forceMarked: true },
        };
        tasks.set(taskId, finalTask);
        emit(finalTask, taskId);
        return { task: finalTask };
      }
    }
    // 无 killBash 调度器 → 直接 force-mark
    const forceMarked = patchStatus(task, 'killed');
    const finalTask: BackgroundTask = {
      ...forceMarked,
      error: 'force-marked: no kill dispatcher',
      detail: { ...d, forceMarked: true },
    };
    tasks.set(taskId, finalTask);
    emit(finalTask, taskId);
    return { task: finalTask };
  }

  // 非 bash 类型:转发到对应 producer 的 cancel(kanban service.cancel / a2a cancelTask)
  // 这里只做状态标记;真 cancel 由 kanban/a2a 的 stop handler 处理(见 registry.routes.ts)。
  const killed = patchStatus(task, 'killed');
  tasks.set(taskId, killed);
  emit(killed, taskId);
  return { task: killed };
}

// ===== TTL sweeper(spec §6 / §13 ⑤)— 逻辑在 ttl-sweeper.ts,这里只驱动 =====

let sweepStopper: (() => void) | null = null;

function sweep(): void {
  runSweep({ tasks, emit, now: nowMs });
}

function startSweeper(): void {
  if (sweepStopper) return;
  sweepStopper = startSweeperImpl({ tasks, emit, now: nowMs });
}

function stopSweeper(): void {
  if (sweepStopper) {
    sweepStopper();
    sweepStopper = null;
  }
}

// ===== 查询 =====

function list(): BackgroundTask[] {
  return Array.from(tasks.values()).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

function get(taskId: string): BackgroundTask | undefined {
  return tasks.get(taskId);
}

function remove(taskId: string): void {
  if (tasks.delete(taskId)) emit(null, taskId);
}

function clearAll(): void {
  tasks.clear();
  placeholderToReal.clear();
}

export const backgroundTaskRegistry = {
  setDeps,
  upsertKanban,
  upsertA2A,
  upsertChat,
  apply,
  bashTaskIdsForSession,
  stopTask,
  list,
  get,
  remove,
  clearAll,
  startSweeper,
  stopSweeper,
  // 测试用内部入口
  _sweep: sweep,
  _size: () => tasks.size,
};
