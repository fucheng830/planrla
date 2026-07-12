import type { Database as DB } from 'better-sqlite3';
import type { Task, StageRun, TaskEvent, TaskAuxFlags, TaskStatus, StageStatus } from '@/modules/kanban/types.js';
import { isTerminalTaskStatus } from '@/modules/kanban/types.js';

export interface TaskStoreDeps {
  db: DB;
}

export interface CreateTaskInput {
  task: Task;
  initialStageRun: StageRun;
  event: TaskEvent;
}

export function createTaskStore(deps: TaskStoreDeps) {
  const { db } = deps;
  db.exec(SCHEMA_SQL);

  const createTask = db.transaction((input: CreateTaskInput): Task => {
    const t = input.task;
    db.prepare(`INSERT INTO tasks
      (id, task_number, root_id, task_template_id, task_template_name,
       create_worktree, worktree_branch_mode, worktree_branch, worktree_path,
       current_stage_index, status, scheduler_admitted, main_session_key,
       worktree_root_id, labels_json,
       aux_ask_user_waiting, aux_has_plan, aux_has_todos, aux_has_task, aux_session_error,
       created_at, updated_at, completed_at)
      VALUES (@id,@taskNumber,@rootId,@taskTemplateId,@taskTemplateName,
        @createWorktree,@worktreeBranchMode,@worktreeBranch,@worktreePath,
        @currentStageIndex,@status,@schedulerAdmitted,@mainSessionKey,
        @worktreeRootId,@labelsJson,
        @askUserWaiting,@hasPlan,@hasTodos,@hasTask,@sessionError,
        @createdAt,@updatedAt,@completedAt)`)
      .run({
        ...t,
        createWorktree: t.createWorktree ? 1 : 0,
        schedulerAdmitted: t.schedulerAdmitted ? 1 : 0,
        taskTemplateName: t.taskTemplateName ?? null,
        worktreeBranchMode: t.worktreeBranchMode ?? null,
        worktreeBranch: t.worktreeBranch ?? null,
        worktreePath: t.worktreePath ?? null,
        mainSessionKey: t.mainSessionKey ?? null,
        worktreeRootId: t.worktreeRootId ?? null,
        labelsJson: JSON.stringify(t.labels ?? []),
        askUserWaiting: t.auxFlags.askUserWaiting ? 1 : 0,
        hasPlan: t.auxFlags.hasPlan ? 1 : 0,
        hasTodos: t.auxFlags.hasTodos ? 1 : 0,
        hasTask: t.auxFlags.hasTask ? 1 : 0,
        sessionError: t.auxFlags.sessionError ?? null,
        completedAt: t.completedAt ?? null,
      });

    insertStageRun(input.initialStageRun);
    insertTaskEvent(input.event);
    return t;
  });

  function insertStageRun(r: StageRun): void {
    db.prepare(`INSERT INTO stage_runs
      (id, task_id, stage_index, stage_name, role, status, session_key,
       input, rendered_prompt, started_at, finished_at, created_at, updated_at)
      VALUES (@id,@taskId,@stageIndex,@stageName,@role,@status,@sessionKey,
        @input,@renderedPrompt,@startedAt,@finishedAt,@createdAt,@updatedAt)`)
      .run({
        ...r,
        sessionKey: r.sessionKey ?? null,
        input: r.input ?? null,
        renderedPrompt: r.renderedPrompt ?? null,
        startedAt: r.startedAt ?? null,
        finishedAt: r.finishedAt ?? null,
      });
  }

  function insertTaskEvent(e: TaskEvent): void {
    db.prepare(`INSERT INTO task_events (id, task_id, stage_run_id, type, payload_json, created_at)
      VALUES (@id,@taskId,@stageRunId,@type,@payloadJson,@createdAt)`)
      .run({
        ...e,
        stageRunId: e.stageRunId ?? null,
        payloadJson: e.payloadJson ?? null,
      });
  }

  function getTask(id: string): Task | null {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    if (!row) return null;
    return rowToTask(row);
  }

  function listQueuedTasks(rootId: string): Task[] {
    const rows = db.prepare('SELECT * FROM tasks WHERE root_id = ? AND status = ? ORDER BY created_at ASC')
      .all(rootId, 'queued') as TaskRow[];
    return rows.map(rowToTask);
  }

  function listTasks(rootId: string): Task[] {
    const rows = db.prepare('SELECT * FROM tasks WHERE root_id = ? ORDER BY updated_at DESC, created_at DESC')
      .all(rootId) as TaskRow[];
    return rows.map(rowToTask);
  }

  function updateTaskStatus(id: string, status: TaskStatus): void {
    const now = new Date().toISOString();
    const terminal = isTerminalTaskStatus(status);
    if (terminal) {
      db.prepare(`UPDATE tasks SET status = ?, scheduler_admitted = 0, completed_at = ?, updated_at = ? WHERE id = ?`)
        .run(status, now, now, id);
    } else {
      db.prepare(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`)
        .run(status, now, id);
    }
  }

  function updateTaskStage(taskId: string, stageIndex: number, status: TaskStatus): void {
    const now = new Date().toISOString();
    db.prepare(`UPDATE tasks SET current_stage_index = ?, status = ?, scheduler_admitted = 0, updated_at = ? WHERE id = ?`)
      .run(stageIndex, status, now, taskId);
  }

  function nextTaskNumber(rootId: string): number {
    const row = db.prepare('SELECT COALESCE(MAX(task_number), 0) + 1 AS next FROM tasks WHERE root_id = ?')
      .get(rootId) as { next: number };
    return row.next;
  }

  function latestStageRun(taskId: string, stageIndex: number): StageRun | null {
    const row = db.prepare('SELECT * FROM stage_runs WHERE task_id = ? AND stage_index = ? ORDER BY created_at DESC LIMIT 1')
      .get(taskId, stageIndex) as StageRunRow | undefined;
    return row ? rowToStageRun(row) : null;
  }

  function updateTaskAuxFlags(taskId: string, flags: Partial<TaskAuxFlags>): void {
    const sets: string[] = [];
    const params: Record<string, unknown> = { taskId, updatedAt: new Date().toISOString() };
    if (flags.askUserWaiting !== undefined) { sets.push('aux_ask_user_waiting = @askUserWaiting'); params.askUserWaiting = flags.askUserWaiting ? 1 : 0; }
    if (flags.hasPlan !== undefined) { sets.push('aux_has_plan = @hasPlan'); params.hasPlan = flags.hasPlan ? 1 : 0; }
    if (flags.hasTodos !== undefined) { sets.push('aux_has_todos = @hasTodos'); params.hasTodos = flags.hasTodos ? 1 : 0; }
    if (flags.hasTask !== undefined) { sets.push('aux_has_task = @hasTask'); params.hasTask = flags.hasTask ? 1 : 0; }
    if (flags.sessionError !== undefined) { sets.push('aux_session_error = @sessionError'); params.sessionError = flags.sessionError; }
    if (sets.length === 0) return;
    sets.push('updated_at = @updatedAt');
    db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = @taskId`).run(params);
  }

  function updateTaskWorktree(
    taskId: string,
    fields: { worktreePath?: string | null; worktreeBranch?: string | null },
  ): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (fields.worktreePath !== undefined) {
      sets.push('worktree_path = ?');
      params.push(fields.worktreePath);
    }
    if (fields.worktreeBranch !== undefined) {
      sets.push('worktree_branch = ?');
      params.push(fields.worktreeBranch);
    }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(taskId);
    db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  function setSchedulerAdmitted(taskId: string, value: boolean): void {
    db.prepare('UPDATE tasks SET scheduler_admitted = ?, updated_at = ? WHERE id = ?')
      .run(value ? 1 : 0, new Date().toISOString(), taskId);
  }

  return { createTask, getTask, listQueuedTasks, listTasks, updateTaskStatus, updateTaskStage, latestStageRun, updateTaskAuxFlags, updateTaskWorktree, setSchedulerAdmitted, insertStageRun, insertTaskEvent, nextTaskNumber };
}

export type TaskStore = ReturnType<typeof createTaskStore>;

interface TaskRow {
  id: string; task_number: number; root_id: string;
  task_template_id: string; task_template_name: string | null;
  create_worktree: number; worktree_branch_mode: string | null;
  worktree_branch: string | null; worktree_path: string | null;
  current_stage_index: number; status: string; scheduler_admitted: number;
  main_session_key: string | null; worktree_root_id: string | null;
  labels_json: string;
  aux_ask_user_waiting: number; aux_has_plan: number;
  aux_has_todos: number; aux_has_task: number; aux_session_error: string | null;
  created_at: string; updated_at: string; completed_at: string | null;
}

function parseLabels(labelsJson: string | null | undefined): string[] {
  let labels: string[] = [];
  try {
    labels = JSON.parse(labelsJson ?? '[]');
  } catch {
    labels = [];
  }
  return labels;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id, taskNumber: row.task_number, rootId: row.root_id,
    taskTemplateId: row.task_template_id,
    taskTemplateName: row.task_template_name ?? undefined,
    createWorktree: Boolean(row.create_worktree),
    worktreeBranchMode: row.worktree_branch_mode ?? undefined,
    worktreeBranch: row.worktree_branch ?? undefined,
    worktreePath: row.worktree_path ?? undefined,
    currentStageIndex: row.current_stage_index,
    status: row.status as TaskStatus,
    schedulerAdmitted: Boolean(row.scheduler_admitted),
    mainSessionKey: row.main_session_key ?? undefined,
    worktreeRootId: row.worktree_root_id ?? undefined,
    labels: parseLabels(row.labels_json),
    auxFlags: {
      askUserWaiting: Boolean(row.aux_ask_user_waiting),
      hasPlan: Boolean(row.aux_has_plan),
      hasTodos: Boolean(row.aux_has_todos),
      hasTask: Boolean(row.aux_has_task),
      sessionError: row.aux_session_error ?? undefined,
    },
    createdAt: row.created_at, updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
  };
}

interface StageRunRow {
  id: string; task_id: string;
  stage_index: number; stage_name: string; role: string; status: string;
  session_key: string | null; input: string | null; rendered_prompt: string | null;
  started_at: string | null; finished_at: string | null;
  created_at: string; updated_at: string;
}

function rowToStageRun(row: StageRunRow): StageRun {
  return {
    id: row.id, taskId: row.task_id, stageIndex: row.stage_index,
    stageName: row.stage_name, role: row.role as 'user' | 'agent',
    status: row.status as StageStatus,
    sessionKey: row.session_key ?? undefined,
    input: row.input ?? undefined,
    renderedPrompt: row.rendered_prompt ?? undefined,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  task_number INTEGER NOT NULL,
  root_id TEXT NOT NULL,
  task_template_id TEXT NOT NULL,
  task_template_name TEXT,
  create_worktree INTEGER NOT NULL DEFAULT 1,
  worktree_branch_mode TEXT,
  worktree_branch TEXT,
  worktree_path TEXT,
  current_stage_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  scheduler_admitted INTEGER NOT NULL DEFAULT 0,
  main_session_key TEXT,
  worktree_root_id TEXT,
  labels_json TEXT NOT NULL DEFAULT '[]',
  aux_ask_user_waiting INTEGER NOT NULL DEFAULT 0,
  aux_has_plan INTEGER NOT NULL DEFAULT 0,
  aux_has_todos INTEGER NOT NULL DEFAULT 0,
  aux_has_task INTEGER NOT NULL DEFAULT 0,
  aux_session_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_root ON tasks(root_id);

CREATE TABLE IF NOT EXISTS stage_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  stage_index INTEGER NOT NULL,
  stage_name TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  session_key TEXT,
  input TEXT,
  rendered_prompt TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stage_runs_task_stage ON stage_runs(task_id, stage_index, created_at);

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  stage_run_id TEXT,
  type TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_events_task_created ON task_events(task_id, created_at);
`;
