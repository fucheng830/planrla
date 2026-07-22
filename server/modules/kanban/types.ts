// server/modules/kanban/types.ts

// ===== 状态常量 =====
export type TaskStatus =
  | 'pending' | 'queued' | 'running' | 'waiting_user'
  | 'paused' | 'success' | 'fail' | 'cancelled';

export type StageStatus =
  | 'pending' | 'running' | 'waiting_user'
  | 'success' | 'fail' | 'cancelled' | 'approved' | 'rejected';

export type SessionReusePolicy = 'task_main' | 'same_stage' | 'always_new';

export const SESSION_REUSE_TASK_MAIN: SessionReusePolicy = 'task_main';
export const SESSION_REUSE_SAME_STAGE: SessionReusePolicy = 'same_stage';
export const SESSION_REUSE_ALWAYS_NEW: SessionReusePolicy = 'always_new';

export function isTerminalTaskStatus(s: TaskStatus): boolean {
  return s === 'success' || s === 'fail' || s === 'cancelled';
}

// ===== 实体 =====
export interface StageTemplate {
  id: string;
  name: string;
  role: 'user' | 'agent';
  autoAdvance: boolean;
  agent?: string;
  model?: string;
  mode?: string;
  effort?: string;
  fastService?: string;
  planMode?: boolean;
  sessionReusePolicy?: SessionReusePolicy;
  promptTemplate?: string;
  agentCanControlStage?: boolean;
  /** REQ-043: 有此字段 = goal stage。claude 持续工作直到自判完成并调 task_complete MCP,
   *  Stop hook 阻止提前停。缺失 = 现有单次行为(零回归)。 */
  goalCondition?: string;
  /** REQ-043: goal stage 的 maxTurns 上限,默认 300。耗尽 → spawnFn reject → service.fail。 */
  goalMaxTurns?: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskTemplateStage {
  id: string;
  stageTemplateId?: string;
  position: number;
  snapshot: StageTemplate;
}

export interface TaskTemplate {
  id: string;
  name: string;
  description?: string;
  maxConcurrency: number;
  stages: TaskTemplateStage[];
  createdAt: string;
  updatedAt: string;
}

export interface PendingAskUser {
  requestId: string;
  /** Raw AskUserQuestion payload ({ questions: [...] }). Typed unknown — the
   * shape comes from the provider SDK and is validated/rendered defensively
   * on the frontend. */
  questions: unknown;
  capturedAt: string;
}

export interface TaskAuxFlags {
  askUserWaiting: boolean;
  hasPlan: boolean;
  hasTodos: boolean;
  hasTask: boolean;
  sessionError?: string;
  /** When the agent calls AskUserQuestion, the bridge captures the requestId
   * + questions payload here so the kanban UI can render an inline answer box.
   * Cleared on answer / stage advance / cancel / complete. */
  pendingAskUser?: PendingAskUser | null;
}

export type TaskPriority = 'high' | 'medium' | 'low';

export const TASK_PRIORITIES: readonly TaskPriority[] = ['high', 'medium', 'low'];

export function isTaskPriority(value: unknown): value is TaskPriority {
  return value === 'high' || value === 'medium' || value === 'low';
}

/** Lower rank = scheduled earlier. */
export function taskPriorityRank(priority: TaskPriority | undefined): number {
  if (priority === 'high') return 0;
  if (priority === 'low') return 2;
  return 1;
}

export interface Task {
  id: string;
  taskNumber: number;
  rootId: string;
  taskTemplateId: string;
  taskTemplateName?: string;
  createWorktree: boolean;
  worktreeBranchMode?: string;
  worktreeBranch?: string;
  worktreePath?: string;
  currentStageIndex: number;
  status: TaskStatus;
  schedulerAdmitted: boolean;
  mainSessionKey?: string;
  /** Provider-native session id captured from the runtime (persisted so the
   * runner can resume/review across process restarts). */
  providerSessionId?: string;
  worktreeRootId?: string;
  labels: string[];
  /** Optional for legacy rows and partial fixtures; the store/service always
   * persist a concrete value (default 'medium'). */
  priority?: TaskPriority;
  /** Ids of tasks (same root) that must reach `success` before this task may
   * be admitted by the scheduler. Queued tasks with unmet dependencies stay
   * queued; a failed/cancelled dependency blocks until a human intervenes. */
  dependencies?: string[];
  auxFlags: TaskAuxFlags;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface StageRun {
  id: string;
  taskId: string;
  stageIndex: number;
  stageName: string;
  role: 'user' | 'agent';
  status: StageStatus;
  sessionKey?: string;
  input?: string;
  renderedPrompt?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  stageRunId?: string;
  type: string;
  payloadJson?: string;
  createdAt: string;
}
