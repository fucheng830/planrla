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

export type TaskStatus =
  | 'pending' | 'queued' | 'running' | 'waiting_user'
  | 'paused' | 'success' | 'fail' | 'cancelled';

export type StageStatus =
  | 'pending' | 'running' | 'waiting_user'
  | 'success' | 'fail' | 'cancelled' | 'approved' | 'rejected';

export type SessionReusePolicy = 'task_main' | 'same_stage' | 'always_new';

export interface TaskAuxFlags {
  askUserWaiting: boolean;
  hasPlan: boolean;
  hasTodos: boolean;
  hasTask: boolean;
  sessionError?: string;
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

export interface TaskListResponse { tasks: Task[] }
export interface TaskResponse { task: Task }
export interface TemplateListResponse { templates: TaskTemplate[] }
export interface TemplateResponse { template: TaskTemplate }
