import type {
  Task, TaskPriority, TaskTemplate, TaskListResponse, TaskResponse,
  TemplateListResponse, TemplateResponse,
  KanbanSchedule, TaskDiffResult, StageRun, TaskEvent, TaskAttachment,
} from './types';

/**
 * @planrla/kanban API 层 — 独立包内自带的认证请求工具。
 *
 * 与 @planrla/chat 相同的注入模式:宿主通过 configureKanbanApi 改写 baseUrl;
 * 未配置时与宿主同源(开发态走 Vite 代理)。
 */

let API_BASE = '';

export function configureKanbanApi(cfg: { baseUrl?: string } = {}) {
  API_BASE = (cfg.baseUrl || '').replace(/\/+$/, '');
}

function withBase(url: string) {
  return API_BASE && url.startsWith('/') ? API_BASE + url : url;
}

function readToken(): string | null {
  try {
    return localStorage.getItem('auth-token');
  } catch {
    return null;
  }
}

function storeRefreshedToken(response: Response) {
  const refreshed = response.headers.get('X-Refreshed-Token');
  if (refreshed) {
    try {
      localStorage.setItem('auth-token', refreshed);
    } catch {
      /* ignore */
    }
  }
}

export const authenticatedFetch = (url: string, options: RequestInit = {}): Promise<Response> => {
  const token = readToken();
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(withBase(url), { ...options, headers }).then((response) => {
    storeRefreshedToken(response);
    return response;
  });
};

const api = {
  get: (endpoint: string) => authenticatedFetch(`/api${endpoint}`),
  post: (endpoint: string, body?: unknown) =>
    authenticatedFetch(`/api${endpoint}`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: (endpoint: string, body?: unknown) =>
    authenticatedFetch(`/api${endpoint}`, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  patch: (endpoint: string, body?: unknown) =>
    authenticatedFetch(`/api${endpoint}`, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  delete: (endpoint: string) => authenticatedFetch(`/api${endpoint}`, { method: 'DELETE' }),
};

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
    options?: { priority?: TaskPriority; dependencies?: string[]; taskType?: 'feature' | 'bug' },
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
  /** 上传任务附件(base64 JSON,免 multipart 依赖)。 */
  uploadAttachment: async (taskId: string, filename: string, file: File): Promise<TaskAttachment> => {
    const dataB64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(file);
    });
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/attachments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename, dataB64 }),
    });
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
    return ((await res.json()) as { attachment: TaskAttachment }).attachment;
  },

  listAttachments: async (taskId: string): Promise<TaskAttachment[]> => {
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/attachments`);
    if (!res.ok) throw new Error(`list failed: ${res.status}`);
    return ((await res.json()) as { attachments: TaskAttachment[] }).attachments ?? [];
  },

  attachmentDownloadUrl: (taskId: string, attachmentId: string): string =>
    `/api/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}/download`,

  deleteAttachment: async (taskId: string, attachmentId: string): Promise<void> => {
    const rootIdHint = '';
    void rootIdHint;
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`delete failed: ${res.status}`);
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
  /** 交付阶段写入的 DELIVERY.md(worktree 根)。 */
  getDeliveryDoc: async (taskId: string, rootId: string): Promise<string | null> => {
    const res = await api.get(`/tasks/${encodeURIComponent(taskId)}/delivery-doc?rootId=${encodeURIComponent(rootId)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: string | null };
    return data.content ?? null;
  },
  /** 交付说明:任务最后一次 agent 会话的收尾总结文本(交付报告本体)。 */
  getDeliverySummary: async (taskId: string, rootId: string): Promise<string | null> => {
    const res = await api.get(`/tasks/${encodeURIComponent(taskId)}/delivery-summary?rootId=${encodeURIComponent(rootId)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: string | null };
    return data.content ?? null;
  },
  /** 任务 → agent 对话:解析 app 会话 id(看板卡「查看对话」跳转用)。 */
  getTaskSession: async (taskId: string, rootId: string): Promise<{ appSessionId: string; provider: string } | null> => {
    const res = await api.get(`/tasks/${encodeURIComponent(taskId)}/session?rootId=${encodeURIComponent(rootId)}`);
    if (!res.ok) return null;
    return (await res.json()) as { appSessionId: string; provider: string };
  },
  /** Retry a failed task from its failed stage (fail → queued). */
  retryTask: async (taskId: string, rootId: string): Promise<Task> => {
    const res = await api.post(`/tasks/${encodeURIComponent(taskId)}/retry`, { rootId });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? `retry failed: ${res.status}`);
    }
    const data = (await res.json()) as TaskResponse;
    return data.task;
  },
  /** 验收通过:把任务分支合并进主仓(--no-ff)。alreadyMerged=true 表示分支早已并入。 */
  acceptDelivery: async (taskId: string, rootId: string): Promise<{ task: Task; commit?: string; alreadyMerged?: boolean }> => {
    const res = await api.post(`/tasks/${encodeURIComponent(taskId)}/merge`, { rootId });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? `merge failed: ${res.status}`);
    }
    return (await res.json()) as { task: Task; commit?: string; alreadyMerged?: boolean };
  },
  /** 验收不通过:带反馈重新排队返工(agent 延续原会话按反馈修改)。 */
  reworkDelivery: async (taskId: string, rootId: string, feedback: string): Promise<Task> => {
    const res = await api.post(`/tasks/${encodeURIComponent(taskId)}/rework`, { rootId, feedback });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? `rework failed: ${res.status}`);
    }
    const data = (await res.json()) as TaskResponse;
    return data.task;
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
