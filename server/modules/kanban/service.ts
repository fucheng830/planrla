import { randomUUID } from 'node:crypto';
import type { TaskStore } from '@/modules/kanban/store.js';
import type { TemplateStore } from '@/modules/kanban/template-store.js';
import type { Task, TaskStatus, StageStatus } from '@/modules/kanban/types.js';
import { isTerminalTaskStatus } from '@/modules/kanban/types.js';
import { AppError } from '@/shared/utils.js';

export interface KanbanServiceDeps {
  taskStore: TaskStore;
  templateStore: TemplateStore;
}

export function createKanbanService(deps: KanbanServiceDeps) {
  const { taskStore, templateStore } = deps;

  function createTask(input: { rootId: string; taskTemplateId: string; input: string }): Task {
    const tpl = requireTemplate(input.taskTemplateId);
    const firstStage = tpl.stages[0]?.snapshot;
    if (!firstStage) throw new AppError('template has no stages', { code: 'INVALID_TEMPLATE', statusCode: 400 });
    if (firstStage.role !== 'user') throw new AppError('first stage must be user role', { code: 'INVALID_TEMPLATE', statusCode: 400 });

    const now = new Date().toISOString();
    const taskId = randomUUID();
    const taskNumber = nextTaskNumber(input.rootId);
    const autoAdvance = firstStage.autoAdvance;
    const firstStatus: TaskStatus = autoAdvance ? 'queued' : 'waiting_user';
    const firstRunStatus: StageStatus = autoAdvance ? 'approved' : 'pending';

    const task: Task = {
      id: taskId, taskNumber, rootId: input.rootId,
      taskTemplateId: tpl.id, taskTemplateName: tpl.name,
      createWorktree: true, currentStageIndex: 0,
      status: firstStatus, schedulerAdmitted: false,
      labels: [], auxFlags: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false },
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

  function next(rootId: string, taskId: string): Task {
    const task = requireNonTerminalTask(taskId);
    const tpl = requireTemplate(task.taskTemplateId);
    const now = new Date().toISOString();

    const currentRun = taskStore.latestStageRun(taskId, task.currentStageIndex);
    if (currentRun) {
      taskStore.insertStageRun({ ...currentRun, id: randomUUID(), status: 'approved', finishedAt: now, updatedAt: now });
    }

    const nextIndex = task.currentStageIndex + 1;
    if (nextIndex >= tpl.stages.length) {
      return complete(rootId, taskId);
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

  function complete(rootId: string, taskId: string): Task {
    const task = requireNonTerminalTask(taskId);
    const tpl = requireTemplate(task.taskTemplateId);
    if (task.currentStageIndex < tpl.stages.length - 1) {
      throw new AppError('can only complete on last stage', { code: 'INVALID_STAGE', statusCode: 400 });
    }
    const now = new Date().toISOString();
    const currentRun = taskStore.latestStageRun(taskId, task.currentStageIndex);
    if (currentRun) {
      taskStore.insertStageRun({ ...currentRun, id: randomUUID(), status: 'approved', finishedAt: now, updatedAt: now });
    }
    taskStore.updateTaskStatus(taskId, 'success');
    return taskStore.getTask(taskId)!;
  }

  function cancel(rootId: string, taskId: string): Task {
    requireTask(taskId);
    taskStore.updateTaskStatus(taskId, 'cancelled');
    return taskStore.getTask(taskId)!;
  }

  function requireTask(taskId: string): Task {
    const task = taskStore.getTask(taskId);
    if (!task) throw new AppError(`task ${taskId} not found`, { code: 'TASK_NOT_FOUND', statusCode: 404 });
    return task;
  }

  function requireNonTerminalTask(taskId: string): Task {
    const task = requireTask(taskId);
    if (isTerminalTaskStatus(task.status)) {
      throw new AppError(`task ${taskId} is in terminal status ${task.status}`, { code: 'TASK_TERMINAL', statusCode: 400 });
    }
    return task;
  }

  function requireTemplate(id: string) {
    const tpl = templateStore.getTaskTemplate(id);
    if (!tpl) throw new AppError(`template ${id} not found`, { code: 'TASK_TEMPLATE_NOT_FOUND', statusCode: 404 });
    return tpl;
  }

  function nextTaskNumber(rootId: string): number {
    const tasks = taskStore.listTasks(rootId);
    return tasks.reduce((max, t) => Math.max(max, t.taskNumber), 0) + 1;
  }

  return { createTask, next, complete, cancel };
}

export type KanbanService = ReturnType<typeof createKanbanService>;
