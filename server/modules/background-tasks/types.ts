// server/modules/background-tasks/types.ts
//
// REQ-046 — 统一后台任务模型。四类后台任务(kanban / a2a / chat / agent Bash)
// 在 registry 里归一化为 BackgroundTask,供前端面板聚合显示。
//
// 卡片永远在(running / idle / 明确完成),完成态只在 SDK 明确给时转,
// 不猜完成(见 spec §13 ①)。

import type { LLMProvider } from '@/shared/types.js';
import type { TaskAuxFlags } from '@/modules/kanban/index.js';

/** 四类后台任务来源。 */
export type BackgroundTaskType = 'kanban' | 'a2a' | 'chat' | 'bash';

/**
 * 统一状态机(见 spec §4 / §13 ①):
 * - running: 正在跑
 * - idle: 5min 无新 output(bash)—— 橙色"无活动"提示,**不是完成**
 * - completed: 明确完成(SDK task_updated.completed / a2a completed / kanban 全 stage done / bash exit 0)
 * - failed: 失败(SDK failed / a2a failed / aux.sessionError / bash exit≠0 / 挂死超时)
 * - killed: 用户 stop / SDK stopped / KillBash
 *
 * 注:原 spec §4 的 `stale` 已重命名为 `idle`(语义"无活动",非"完成"),
 * 避免 stale 灰勾误导用户以为完成(见 §13 ①)。stale 挂死超时(10min)→ failed。
 */
export type BackgroundTaskStatus =
  | 'running'
  | 'idle'
  | 'completed'
  | 'failed'
  | 'killed';

/** 每类任务的特有详情(discriminated union by type)。 */
export type BackgroundTaskDetail =
  | {
      type: 'kanban';
      taskId: string;
      rootId: string;
      title: string;
      stage?: number;
      stageTotal?: number;
      aux: TaskAuxFlags;
    }
  | {
      type: 'a2a';
      taskId: string;
      state: 'working' | 'completed' | 'failed' | 'canceled';
      provider?: LLMProvider;
      text: string;
      /** S4 spawn 成功后,后续执行归 chat task 的那个 session(见 §13 ④)。 */
      spawnedAppSessionId?: string;
    }
  | {
      type: 'chat';
      appSessionId: string;
      provider?: LLMProvider;
      /** 完成通知预览:助手回复首行,兜底最后用户提问(手机推送/REST 补跑用)。 */
      preview?: string;
    }
  | {
      type: 'bash';
      appSessionId: string;
      /** SDK 给的真 task_id;乐观 start 期间 = tool_use_id(占位),reconcile 后替换。 */
      bashTaskId: string;
      cmd: string;
      outputTail: string[];
      exitCode?: number;
      /** kill 时若 stopTask 抛错,标 force-marked(session 可能已结束)。 */
      forceMarked?: boolean;
    };

/** 统一后台任务卡片。 */
export interface BackgroundTask {
  /** 各类型原 id 加前缀:`kanban:<taskId>` / `a2a:<taskId>` / `chat:<appSessionId>` / `bash:<appSessionId>:<bashTaskId>`。 */
  id: string;
  type: BackgroundTaskType;
  status: BackgroundTaskStatus;
  /** 卡片标题(REQ-045 sidebar a11y / kimi UI 分析 / 91bb1e17 / npm build)。 */
  title: string;
  /** 0-100 进度(kanban stage 比;其他类型可空)。 */
  progress?: number;
  startedAt: number;
  /** 最近一次活动时间(stale/挂死检测 + idle 判定基准)。 */
  lastActivityAt: number;
  /** 终态时间(completed/failed/killed)。 */
  finishedAt?: number;
  /** 用户可读的副信息(显示在卡片副行)。 */
  subtitle?: string;
  /** 最后一次错误信息(failed 时)。 */
  error?: string;
  detail: BackgroundTaskDetail;
}

/** 判定状态是否终态(终态后 TTL 倒计时清理)。 */
export function isTerminalStatus(status: BackgroundTaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'killed';
}

/** 判定状态是否可停止(只有 running/idle 可 stop)。 */
export function isStoppable(status: BackgroundTaskStatus): boolean {
  return status === 'running' || status === 'idle';
}

/** 构造带类型前缀的统一 id。 */
export function buildBackgroundTaskId(
  type: BackgroundTaskType,
  parts: string[],
): string {
  return `${type}:${parts.join(':')}`;
}

/** 解析统一 id 回类型 + 原始部分。 */
export function parseBackgroundTaskId(id: string): {
  type: BackgroundTaskType;
  parts: string[];
} | null {
  const idx = id.indexOf(':');
  if (idx < 0) return null;
  const type = id.slice(0, idx) as BackgroundTaskType;
  if (!['kanban', 'a2a', 'chat', 'bash'].includes(type)) return null;
  return { type, parts: id.slice(idx + 1).split(':') };
}
