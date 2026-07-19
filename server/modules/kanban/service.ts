import { randomUUID } from 'node:crypto';

import type { TaskStore } from '@/modules/kanban/store.js';
import type { TemplateStore } from '@/modules/kanban/template-store.js';
import type { Task, TaskPriority, TaskTemplate, TaskStatus, StageStatus } from '@/modules/kanban/types.js';
import { isTaskPriority, isTerminalTaskStatus } from '@/modules/kanban/types.js';
import { AppError } from '@/shared/utils.js';

export interface KanbanServiceDeps {
  taskStore: TaskStore;
  templateStore: TemplateStore;
  /** Invoked when a task reaches a terminal status (success/fail/cancelled). Used by assembly to clean up the worktree. */
  onTerminal?: (task: Task) => void;
}

export function createKanbanService(deps: KanbanServiceDeps) {
  const { taskStore, templateStore, onTerminal } = deps;

  function createTask(input: {
    rootId: string;
    taskTemplateId: string;
    input: string;
    priority?: TaskPriority;
    dependencies?: string[];
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
      event: { id: randomUUID(), taskId, type: 'task_created', createdAt: now },
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
    const nextStatus: TaskStatus = targetStage.role === 'user' ? 'waiting_user' : 'queued';
    taskStore.updateTaskStage(taskId, targetIndex, nextStatus);
    return taskStore.getTask(taskId)!;
  }

  function pause(rootId: string, taskId: string): Task {
    requireNonTerminalTask(taskId, rootId);
    taskStore.updateTaskStatus(taskId, 'paused');
    return taskStore.getTask(taskId)!;
  }

  function resume(rootId: string, taskId: string): Task {
    const task = requireTask(taskId, rootId);
    if (task.status !== 'paused') {
      throw new AppError('只能 resume 处于 paused 状态的任务', { code: 'INVALID_STATUS', statusCode: 400 });
    }
    taskStore.updateTaskStatus(taskId, 'queued');
    return taskStore.getTask(taskId)!;
  }

  function fail(rootId: string, taskId: string): Task {
    requireNonTerminalTask(taskId, rootId);
    clearPendingAskUser(taskId);
    taskStore.updateTaskStatus(taskId, 'fail');
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

  return { createTask, next, prev, jump, pause, resume, complete, cancel, fail, deleteTask, listTasks, getTask };
}

export type KanbanService = ReturnType<typeof createKanbanService>;
