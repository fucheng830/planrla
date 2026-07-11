import { api } from '@/utils/api';
import type {
  Task, TaskTemplate, TaskListResponse, TaskResponse,
  TemplateListResponse, TemplateResponse,
} from './types';

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
  createTask: async (rootId: string, taskTemplateId: string, input: string): Promise<Task> => {
    const res = await api.post('/tasks', { rootId, taskTemplateId, input });
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
};
