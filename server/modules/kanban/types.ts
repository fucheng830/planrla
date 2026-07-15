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
  worktreeRootId?: string;
  labels: string[];
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
