import { randomUUID } from 'node:crypto';

import type { TaskStore } from '@/modules/kanban/store.js';
import type { TemplateStore } from '@/modules/kanban/template-store.js';
import type { Task, TaskPriority, TaskTemplate, TaskStatus, StageStatus } from '@/modules/kanban/types.js';
import { isTaskPriority, isTaskType, isTerminalTaskStatus, taskPriorityRank, type TaskType } from '@/modules/kanban/types.js';
import { AppError } from '@/shared/utils.js';

export interface KanbanServiceDeps {
  taskStore: TaskStore;
  templateStore: TemplateStore;
  /** Invoked when a task reaches a terminal status (success/fail/cancelled). Used by assembly to clean up the worktree. */
  onTerminal?: (task: Task) => void;
  /** Invoked when a task is hard-deleted, so sync can record a tombstone. */
  onDeleteTask?: (taskId: string, rootId: string) => void;
}

export function createKanbanService(deps: KanbanServiceDeps) {
  const { taskStore, templateStore, onTerminal, onDeleteTask } = deps;

  /** Append an audit event to task_events (best-effort — a logging failure
   * must never break a state transition). Powers the detail modal timeline. */
  function recordEvent(taskId: string, type: string, payload?: Record<string, unknown>): void {
    try {
      taskStore.insertTaskEvent({
        id: randomUUID(), taskId, type,
        payloadJson: payload ? JSON.stringify(payload) : undefined,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error('[kanban-events] insert failed:', e);
    }
  }

  function createTask(input: {
    rootId: string;
    taskTemplateId: string;
    input: string;
    priority?: TaskPriority;
    dependencies?: string[];
    taskType?: TaskType;
  }): Task {
    const tpl = requireTemplate(input.taskTemplateId);
    const firstStage = tpl.stages[0]?.snapshot;
    if (!firstStage) throw new AppError('template has no stages', { code: 'INVALID_TEMPLATE', statusCode: 400 });
    if (firstStage.role !== 'user') throw new AppError('first stage must be user role', { code: 'INVALID_TEMPLATE', statusCode: 400 });

    const priority = input.priority ?? 'medium';
    if (!isTaskPriority(priority)) {
      throw new AppError(`invalid priority "${input.priority}"`, { code: 'INVALID_PRIORITY', statusCode: 400 });
    }
    const dependencies = normalizeDependencies(input.dependencies);
    if (dependencies.length > 0) {
      const known = new Set(taskStore.listTasks(input.rootId).map((task) => task.id));
      for (const depId of dependencies) {
        if (!known.has(depId)) {
          throw new AppError(`dependency task ${depId} not found in this root`, { code: 'DEPENDENCY_NOT_FOUND', statusCode: 400 });
        }
      }
    }

    const now = new Date().toISOString();
    const taskId = randomUUID();
    const taskNumber = taskStore.nextTaskNumber(input.rootId);
    const autoAdvance = firstStage.autoAdvance;
    const firstStatus: TaskStatus = autoAdvance ? 'queued' : 'waiting_user';
    const firstRunStatus: StageStatus = autoAdvance ? 'approved' : 'pending';

    const task: Task = {
      id: taskId, taskNumber, rootId: input.rootId,
      taskTemplateId: tpl.id, taskTemplateName: tpl.name,
      createWorktree: true, currentStageIndex: 0,
      status: firstStatus, schedulerAdmitted: false,
      taskType: isTaskType(input.taskType) ? input.taskType : 'feature',
      labels: [], priority, dependencies,
      auxFlags: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false, pendingAskUser: null },
      createdAt: now, updatedAt: now,
    };
    taskStore.createTask({
      task,
      initialStageRun: {
        id: randomUUID(), taskId, stageIndex: 0, stageName: firstStage.name,
        role: 'user', status: firstRunStatus, input: input.input,
        createdAt: now, updatedAt: now,
      },
      event: { id: randomUUID(), taskId, type: 'task_created',
        payloadJson: JSON.stringify({ input: input.input, priority, dependencies }), createdAt: now },
    });
    return taskStore.getTask(taskId)!;
  }

  /** Clear a pending AskUserQuestion so its stale question stops rendering in
   * the kanban modal. Called on stage advance / cancel / complete / fail (the
   * approval resolver is dropped — the agent run for that stage is gone). */
  function clearPendingAskUser(taskId: string): void {
    taskStore.updateTaskAuxFlags(taskId, { askUserWaiting: false, pendingAskUser: null });
  }

  function next(rootId: string, taskId: string): Task {
    const task = requireNonTerminalTask(taskId, rootId);
    const tpl = requireTemplate(task.taskTemplateId);
    const now = new Date().toISOString();

    const currentRun = taskStore.latestStageRun(taskId, task.currentStageIndex);
    if (currentRun) {
      taskStore.insertStageRun({ ...currentRun, id: randomUUID(), status: 'approved', finishedAt: now, updatedAt: now });
    }
    // Stage advance invalidates any pending AskUserQuestion — clear it so a
    // stale question doesn't keep rendering in the kanban modal (REQ-038).
    clearPendingAskUser(taskId);

    const nextIndex = task.currentStageIndex + 1;
    if (nextIndex >= tpl.stages.length) {
      return completeInternal(task, tpl);
    }
    const nextStage = tpl.stages[nextIndex].snapshot;
    taskStore.insertStageRun({
      id: randomUUID(), taskId, stageIndex: nextIndex, stageName: nextStage.name,
      role: nextStage.role, status: 'pending', startedAt: now, createdAt: now, updatedAt: now,
    });
    recordEvent(taskId, 'stage_advanced', { fromStage: task.currentStageIndex, toStage: nextIndex, stageName: nextStage.name });
    const nextStatus: TaskStatus = nextStage.role === 'user' ? 'waiting_user' : 'queued';
    taskStore.updateTaskStage(taskId, nextIndex, nextStatus);
    return taskStore.getTask(taskId)!;
  }

  function completeInternal(task: Task, tpl: TaskTemplate): Task {
    const now = new Date().toISOString();
    const currentRun = taskStore.latestStageRun(task.id, task.currentStageIndex);
    if (currentRun) {
      taskStore.insertStageRun({ ...currentRun, id: randomUUID(), status: 'approved', finishedAt: now, updatedAt: now });
    }
    clearPendingAskUser(task.id);
    taskStore.updateTaskStatus(task.id, 'success');
    recordEvent(task.id, 'task_completed');
    const updated = taskStore.getTask(task.id)!;
    onTerminal?.(updated);
    return updated;
  }

  function complete(rootId: string, taskId: string): Task {
    const task = requireNonTerminalTask(taskId, rootId);
    const tpl = requireTemplate(task.taskTemplateId);
    if (task.currentStageIndex < tpl.stages.length - 1) {
      throw new AppError('can only complete on last stage', { code: 'INVALID_STAGE', statusCode: 400 });
    }
    return completeInternal(task, tpl);
  }

  function cancel(rootId: string, taskId: string): Task {
    requireTask(taskId, rootId);
    clearPendingAskUser(taskId);
    taskStore.updateTaskStatus(taskId, 'cancelled');
    recordEvent(taskId, 'task_cancelled');
    const updated = taskStore.getTask(taskId)!;
    onTerminal?.(updated);
    return updated;
  }

  /**
   * Deletes one task with its stage runs and events. Non-terminal tasks go
   * through the cancel path first so terminal side effects (worktree cleanup,
   * pending-question clearing, scheduler slot release) fire before the rows
   * disappear.
   */
  function deleteTask(rootId: string, taskId: string): void {
    const task = requireTask(taskId, rootId);
    if (!isTerminalTaskStatus(task.status)) {
      cancel(rootId, taskId);
    }
    taskStore.deleteTask(taskId);
    onDeleteTask?.(taskId, rootId);
  }

  function prev(rootId: string, taskId: string): Task {
    const task = requireNonTerminalTask(taskId, rootId);
    if (task.currentStageIndex <= 0) {
      throw new AppError('cannot prev on first stage', { code: 'INVALID_STAGE', statusCode: 400 });
    }
    const prevIndex = task.currentStageIndex - 1;
    const tpl = requireTemplate(task.taskTemplateId);
    const prevStage = tpl.stages[prevIndex].snapshot;
    const now = new Date().toISOString();
    clearPendingAskUser(taskId);
    taskStore.insertStageRun({
      id: randomUUID(), taskId, stageIndex: prevIndex, stageName: prevStage.name,
      role: prevStage.role, status: 'pending', createdAt: now, updatedAt: now,
    });
    recordEvent(taskId, 'stage_returned', { fromStage: task.currentStageIndex, toStage: prevIndex, stageName: prevStage.name });
    const nextStatus: TaskStatus = prevStage.role === 'user' ? 'waiting_user' : 'queued';
    taskStore.updateTaskStage(taskId, prevIndex, nextStatus);
    return taskStore.getTask(taskId)!;
  }

  function jump(rootId: string, taskId: string, targetIndex: number): Task {
    const task = requireNonTerminalTask(taskId, rootId);
    const tpl = requireTemplate(task.taskTemplateId);
    if (targetIndex < 0 || targetIndex >= tpl.stages.length) {
      throw new AppError('目标阶段超出范围', { code: 'INVALID_STAGE', statusCode: 400 });
    }
    const now = new Date().toISOString();
    const targetStage = tpl.stages[targetIndex].snapshot;
    clearPendingAskUser(taskId);
    taskStore.insertStageRun({
      id: randomUUID(), taskId, stageIndex: targetIndex, stageName: targetStage.name,
      role: targetStage.role, status: 'pending', createdAt: now, updatedAt: now,
    });
    recordEvent(taskId, 'stage_jumped', { fromStage: task.currentStageIndex, toStage: targetIndex, stageName: targetStage.name });
    const nextStatus: TaskStatus = targetStage.role === 'user' ? 'waiting_user' : 'queued';
    taskStore.updateTaskStage(taskId, targetIndex, nextStatus);
    return taskStore.getTask(taskId)!;
  }

  function pause(rootId: string, taskId: string): Task {
    requireNonTerminalTask(taskId, rootId);
    taskStore.updateTaskStatus(taskId, 'paused');
    recordEvent(taskId, 'task_paused');
    return taskStore.getTask(taskId)!;
  }

  function resume(rootId: string, taskId: string): Task {
    const task = requireTask(taskId, rootId);
    if (task.status !== 'paused') {
      throw new AppError('只能 resume 处于 paused 状态的任务', { code: 'INVALID_STATUS', statusCode: 400 });
    }
    taskStore.updateTaskStatus(taskId, 'queued');
    recordEvent(taskId, 'task_resumed');
    return taskStore.getTask(taskId)!;
  }

  /** Retry a failed task from its failed stage: fail → queued, the scheduler
     respawns the agent for the current stage. Retry count is audited. */
  function retry(rootId: string, taskId: string): Task {
    const task = requireTask(taskId, rootId);
    if (task.status !== 'fail') {
      throw new AppError('只能 retry 处于 fail 状态的任务', { code: 'INVALID_STATUS', statusCode: 400 });
    }
    const retriedCount = taskStore.listTaskEvents(taskId).filter((e) => e.type === 'task_retried').length;
    taskStore.updateTaskAuxFlags(taskId, { sessionError: undefined });
    taskStore.clearProviderSessionId(taskId);
    taskStore.updateTaskStatus(taskId, 'queued');
    recordEvent(taskId, 'task_retried', { attempt: retriedCount + 1 });
    return taskStore.getTask(taskId)!;
  }

  /** 验收返工:用户拒收已交付(success)的任务。与 retry 的区别:不清
     provider 会话(agent 延续原会话上下文返工)、worktree 保留,反馈持久化
     到 rework_feedback,由 runner 在下一次 spawn 时消费为返工指令。 */
  function rework(rootId: string, taskId: string, feedback: string): Task {
    const task = requireTask(taskId, rootId);
    if (task.status !== 'success') {
      throw new AppError('只有已交付(success)的任务才能发起返工', { code: 'INVALID_STATUS', statusCode: 409 });
    }
    const trimmed = feedback.trim();
    if (!trimmed) {
      throw new AppError('返工必须附上验收反馈', { code: 'FEEDBACK_REQUIRED', statusCode: 400 });
    }
    taskStore.updateTaskAuxFlags(taskId, { sessionError: undefined });
    taskStore.setReworkFeedback(taskId, trimmed);
    taskStore.updateTaskStatus(taskId, 'queued');
    recordEvent(taskId, 'task_reworked', { feedback: trimmed.slice(0, 500) });
    return taskStore.getTask(taskId)!;
  }
  function fail(rootId: string, taskId: string): Task {
    requireNonTerminalTask(taskId, rootId);
    clearPendingAskUser(taskId);
    taskStore.updateTaskStatus(taskId, 'fail');
    recordEvent(taskId, 'task_failed');
    const updated = taskStore.getTask(taskId)!;
    onTerminal?.(updated);
    return updated;
  }

  function listTasks(rootId: string): Task[] {
    return taskStore.listTasks(rootId);
  }

  function getTask(rootId: string, taskId: string): Task | null {
    return requireTask(taskId, rootId);
  }

  /** TaskMaster-style "what should I work on next": the highest-priority
   * runnable task whose dependencies have all succeeded. Runnable = queued
   * (agent stage awaiting a slot) or waiting_user (a human stage awaiting
   * input); already-admitted tasks are someone else's work in flight. */
  function getNextTask(rootId: string): Task | null {
    const all = taskStore.listTasks(rootId);
    const byId = new Map(all.map((t) => [t.id, t]));
    const eligible = all
      .filter((t) => (t.status === 'queued' || t.status === 'waiting_user') && !t.schedulerAdmitted)
      .filter((t) => (t.dependencies ?? []).every((d) => byId.get(d)?.status === 'success'))
      .sort((a, b) => taskPriorityRank(a.priority) - taskPriorityRank(b.priority) || a.createdAt.localeCompare(b.createdAt));
    return eligible[0] ?? null;
  }

  /** TaskMaster expand_task analogue: replace one task with a set of
   * follow-up tasks. `items` come from the caller (PRD/task decomposition);
   * each new task depends on the entries its `dependsOn` indices point to.
   * The original is cancelled so its work is not duplicated — the expansion
   * replaces it — and both sides get audit events linking them. */
  function expandTask(
    rootId: string,
    taskId: string,
    items: Array<{ input: string; priority?: TaskPriority; dependsOn?: number[] }>,
  ): { created: Task[]; cancelled: Task } {
    const task = requireNonTerminalTask(taskId, rootId);
    if (!Array.isArray(items) || items.length === 0) {
      throw new AppError('expand produced no tasks', { code: 'EXPAND_EMPTY', statusCode: 400 });
    }
    const created: Task[] = [];
    for (const [index, item] of items.entries()) {
      const deps = (item.dependsOn ?? [])
        .map((i) => created[i]?.id)
        .filter((v): v is string => Boolean(v));
      created.push(createTask({
        rootId,
        taskTemplateId: task.taskTemplateId,
        input: item.input,
        priority: item.priority,
        dependencies: deps,
      }));
    }
    recordEvent(taskId, 'task_expanded', { into: created.map((t) => ({ id: t.id, taskNumber: t.taskNumber })) });
    for (const c of created) {
      recordEvent(c.id, 'task_expanded_from', { fromTaskNumber: task.taskNumber, fromTaskId: task.id });
    }
    const cancelled = cancel(rootId, taskId);
    return { created, cancelled };
  }

  function requireTask(taskId: string, rootId: string): Task {
    const task = taskStore.getTask(taskId);
    if (!task) throw new AppError('task not found', { code: 'TASK_NOT_FOUND', statusCode: 404 });
    if (task.rootId !== rootId) {
      throw new AppError('task 不属于该 root', { code: 'TASK_ROOT_MISMATCH', statusCode: 403 });
    }
    return task;
  }

  function requireNonTerminalTask(taskId: string, rootId: string): Task {
    const task = requireTask(taskId, rootId);
    if (isTerminalTaskStatus(task.status)) {
      throw new AppError(`task ${taskId} is in terminal status ${task.status}`, { code: 'TASK_TERMINAL', statusCode: 400 });
    }
    return task;
  }

  /** Dedupes and validates dependency ids shape; existence is checked by callers. */
  function normalizeDependencies(raw: string[] | undefined): string[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    for (const value of raw) {
      if (typeof value !== 'string' || !value.trim()) {
        throw new AppError('dependencies must be non-empty task id strings', { code: 'INVALID_DEPENDENCIES', statusCode: 400 });
      }
      seen.add(value.trim());
    }
    return [...seen];
  }

  function requireTemplate(id: string) {
    const tpl = templateStore.getTaskTemplate(id);
    if (!tpl) throw new AppError(`template ${id} not found`, { code: 'TASK_TEMPLATE_NOT_FOUND', statusCode: 404 });
    return tpl;
  }

  return { createTask, next, prev, jump, pause, resume, complete, cancel, fail, retry, rework, deleteTask, listTasks, getTask, getNextTask, expandTask };
}

export type KanbanService = ReturnType<typeof createKanbanService>;
