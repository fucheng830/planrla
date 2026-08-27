import type {
  Task, TaskPriority, TaskTemplate, TaskListResponse, TaskResponse,
  TemplateListResponse, TemplateResponse,
  KanbanSchedule, TaskDiffResult, StageRun, TaskEvent,
} from './types';

import { api } from '@/utils/api';

// The generic api methods (api.get/post/delete) prepend `/api` themselves and
// return the raw fetch Response. Each method below throws on non-ok responses
// and unwraps the typed payload.
export const kanbanApi = {
  /** 全局看板:跨项目聚合(rootId=all)。 */
  listAllTasks: async (): Promise<Task[]> => {
    const res = await api.get('/tasks?rootId=all');
    if (!res.ok) throw new Error(`listAllTasks failed: ${res.status}`);
    const data = (await res.json()) as TaskListResponse;
    return data.tasks;
  },
  listTasks: async (rootId: string): Promise<Task[]> => {
    const res = await api.get(`/tasks?rootId=${encodeURIComponent(rootId)}`);
    if (!res.ok) throw new Error(`listTasks failed: ${res.status}`);
    const data = (await res.json()) as TaskListResponse;
    return data.tasks;
  },
  createTask: async (
    rootId: string,
    taskTemplateId: string,
    input: string,
    options?: { priority?: TaskPriority; dependencies?: string[] },
  ): Promise<Task> => {
    const res = await api.post('/tasks', { rootId, taskTemplateId, input, ...options });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? `createTask failed: ${res.status}`);
    }
    const data = (await res.json()) as TaskResponse;
    return data.task;
  },
  move: async (taskId: string, rootId: string, action: string): Promise<Task> => {
    const res = await api.post(`/tasks/${encodeURIComponent(taskId)}/${encodeURIComponent(action)}`, { rootId });
    if (!res.ok) throw new Error(`move ${action} failed: ${res.status}`);
    const data = (await res.json()) as TaskResponse;
    return data.task;
  },
  jump: async (taskId: string, rootId: string, targetIndex: number): Promise<Task> => {
    const res = await api.post(`/tasks/${encodeURIComponent(taskId)}/jump`, { rootId, targetIndex });
    if (!res.ok) throw new Error(`jump failed: ${res.status}`);
    const data = (await res.json()) as TaskResponse;
    return data.task;
  },
  parsePrd: async (
    rootId: string,
    taskTemplateId: string,
    prd: string,
    provider: string,
  ): Promise<Task[]> => {
    const res = await api.post('/tasks/parse-prd', { rootId, taskTemplateId, prd, provider });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? `parsePrd failed: ${res.status}`);
    }
    const data = (await res.json()) as { tasks: Task[] };
    return data.tasks;
  },
  getTaskTimeline: async (taskId: string, rootId: string): Promise<{ runs: StageRun[]; events: TaskEvent[] }> => {
    const res = await api.get(`/tasks/${encodeURIComponent(taskId)}/timeline?rootId=${encodeURIComponent(rootId)}`);
    if (!res.ok) throw new Error(`getTaskTimeline failed: ${res.status}`);
    return (await res.json()) as { runs: StageRun[]; events: TaskEvent[] };
  },
  getTaskDiff: async (taskId: string, rootId: string): Promise<TaskDiffResult> => {
    const res = await api.get(`/tasks/${encodeURIComponent(taskId)}/diff?rootId=${encodeURIComponent(rootId)}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? `getTaskDiff failed: ${res.status}`);
    }
    return (await res.json()) as TaskDiffResult;
  },
  submitReview: async (taskId: string, rootId: string, comment: string): Promise<Task> => {
    const res = await api.post(`/tasks/${encodeURIComponent(taskId)}/review`, { rootId, comment });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? `submitReview failed: ${res.status}`);
    }
    const data = (await res.json()) as TaskResponse;
    return data.task;
  },
  deleteTask: async (taskId: string, rootId: string): Promise<void> => {
    const res = await api.delete(`/tasks/${encodeURIComponent(taskId)}?rootId=${encodeURIComponent(rootId)}`);
    if (!res.ok) throw new Error(`deleteTask failed: ${res.status}`);
  },
  // TaskMaster expand_task analogue: decompose one task into follow-up tasks
  // that replace it (the original is cancelled). Decomposition runs server-side.
  expandTask: async (taskId: string, rootId: string, provider?: string): Promise<{ created: Task[]; cancelled: Task }> => {
    const res = await api.post(`/tasks/${encodeURIComponent(taskId)}/expand`, { rootId, provider });
    if (!res.ok) throw new Error(`expand failed: ${res.status}`);
    return (await res.json()) as { created: Task[]; cancelled: Task };
  },
  // REQ-038: answer a pending AskUserQuestion inline. `answers` is forwarded as
  // updatedInput to resolveToolApproval on the server.
  answerTask: async (taskId: string, rootId: string, answers: unknown): Promise<Task> => {
    const res = await api.post(`/tasks/${encodeURIComponent(taskId)}/answer`, { rootId, answers });
    if (!res.ok) throw new Error(`answer failed: ${res.status}`);
    const data = (await res.json()) as TaskResponse;
    return data.task;
  },
  listTemplates: async (): Promise<TaskTemplate[]> => {
    const res = await api.get('/tasks/templates');
    if (!res.ok) throw new Error(`listTemplates failed: ${res.status}`);
    const data = (await res.json()) as TemplateListResponse;
    return data.templates;
  },
  getTemplate: async (id: string): Promise<TaskTemplate> => {
    const res = await api.get(`/tasks/templates/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`getTemplate failed: ${res.status}`);
    const data = (await res.json()) as TemplateResponse;
    return data.template;
  },
  saveTemplate: async (tpl: TaskTemplate): Promise<TaskTemplate> => {
    const res = await api.post('/tasks/templates', tpl);
    if (!res.ok) throw new Error(`saveTemplate failed: ${res.status}`);
    const data = (await res.json()) as TemplateResponse;
    return data.template;
  },
  deleteTemplate: async (id: string): Promise<void> => {
    const res = await api.delete(`/tasks/templates/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`deleteTemplate failed: ${res.status}`);
  },
  listSchedules: async (rootId: string): Promise<KanbanSchedule[]> => {
    const res = await api.get(`/tasks/schedules?rootId=${encodeURIComponent(rootId)}`);
    if (!res.ok) throw new Error(`listSchedules failed: ${res.status}`);
    const data = await res.json();
    return data.schedules;
  },
  saveSchedule: async (sch: KanbanSchedule): Promise<KanbanSchedule> => {
    const res = await api.post('/tasks/schedules', sch);
    if (!res.ok) throw new Error(`saveSchedule failed: ${res.status}`);
    const data = await res.json();
    return data.schedule;
  },
  deleteSchedule: async (id: string): Promise<void> => {
    const res = await api.delete(`/tasks/schedules/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`deleteSchedule failed: ${res.status}`);
  },
};
