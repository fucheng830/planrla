// Wire-compatible redeclaration of server/modules/kanban/types.ts.
// The frontend tsconfig does not include server/, so we cannot import from there.
// Keep field names identical to the JSON returned by /api/tasks endpoints.
//
// Additional fields beyond the original plan snippet were copied from the
// server types to preserve wire-compatibility:
//   - StageTemplate: fastService (server requires createdAt/updatedAt)
//   - TaskTemplateStage: stageTemplateId
//   - TaskTemplate: createdAt/updatedAt are required on the server
//   - Task: worktreeBranchMode, worktreeRootId
//   - StageTemplate: createdAt/updatedAt are required on the server

export type TaskType = 'feature' | 'bug';
export type TaskAttachment = { id: string; taskId: string; filename: string; size: number; createdAt: string };

export type TaskStatus =
  | 'pending' | 'queued' | 'running' | 'waiting_user'
  | 'paused' | 'success' | 'fail' | 'cancelled';

export type StageStatus =
  | 'pending' | 'running' | 'waiting_user'
  | 'success' | 'fail' | 'cancelled' | 'approved' | 'rejected';

export type SessionReusePolicy = 'task_main' | 'same_stage' | 'always_new';

export type TaskPriority = 'high' | 'medium' | 'low';

/** AskUserQuestion option as emitted by the Claude SDK. Shape is provider-defined;
 * label/description are the documented option fields. */
export interface PendingAskUserOption {
  label?: string;
  description?: string;
  [key: string]: unknown;
}

/** A single question captured from a pending AskUserQuestion permission_request. */
export interface PendingAskUserQuestion {
  question?: string;
  header?: string;
  options?: PendingAskUserOption[];
  multiSelect?: boolean;
  [key: string]: unknown;
}

/** Full payload captured when an agent calls AskUserQuestion, persisted on the
 * task so the kanban UI can render an inline answer box (REQ-038). */
export interface PendingAskUser {
  requestId: string;
  /** AskUserQuestion payload: { questions: [...] }. Stored as unknown on the
   * server; typed here for the frontend. */
  questions: { questions?: PendingAskUserQuestion[] } & Record<string, unknown>;
  capturedAt: string;
}

export interface TaskAuxFlags {
  askUserWaiting: boolean;
  hasPlan: boolean;
  hasTodos: boolean;
  hasTask: boolean;
  sessionError?: string;
  pendingAskUser?: PendingAskUser | null;
}

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

export interface Task {
  id: string;
  taskType?: TaskType;
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
  /** Provider-native session id (used to resume/review the same agent session). */
  providerSessionId?: string;
  worktreeRootId?: string;
  labels: string[];
  priority?: TaskPriority;
  /** Ids of tasks (same root) that must succeed before the scheduler admits
   * this task. See server/modules/kanban/types.ts. */
  dependencies?: string[];
  auxFlags: TaskAuxFlags;
  /** Requirement text from the task's first stage run (joined server-side). */
  input?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface TaskDiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'untracked';
  additions: number;
  deletions: number;
}

export interface TaskDiffResult {
  worktreePath: string;
  baseSha: string;
  files: TaskDiffFile[];
  patch: string;
  truncated: boolean;
  mergedIntoRoot?: boolean;
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

export interface TaskListResponse { tasks: Task[] }
export interface TaskResponse { task: Task }
export interface TemplateListResponse { templates: TaskTemplate[] }
export interface TemplateResponse { template: TaskTemplate }

export interface KanbanSchedule {
  id: string;
  rootId: string;
  taskTemplateId: string;
  cronExpression: string;
  enabled: boolean;
  input: string;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}
