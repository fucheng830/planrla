import type {
  Task, TaskPriority, TaskTemplate, TaskListResponse, TaskResponse,
  TemplateListResponse, TemplateResponse,
  KanbanSchedule,
} from './types';

import { api } from '@/utils/api';

// The generic api methods (api.get/post/delete) prepend `/api` themselves and
// return the raw fetch Response. Each method below throws on non-ok responses
// and unwraps the typed payload.
export const kanbanApi = {
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
    if (!res.ok) throw new Error(`createTask failed: ${res.status}`);
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
  deleteTask: async (taskId: string, rootId: string): Promise<void> => {
    const res = await api.delete(`/tasks/${encodeURIComponent(taskId)}?rootId=${encodeURIComponent(rootId)}`);
    if (!res.ok) throw new Error(`deleteTask failed: ${res.status}`);
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
