// src/components/background-tasks/api.ts
// REQ-046 — REST 调用 /api/background-tasks。镜像 src/components/kanban/api.ts 模式。
import type { BackgroundTask } from './types';

import { api } from '@/utils/api';

export const backgroundTaskApi = {
  async list(): Promise<BackgroundTask[]> {
    const res = await api.get('/background-tasks');
    if (!res.ok) throw new Error(`list failed: ${res.status}`);
    const data = (await res.json()) as { tasks: BackgroundTask[] };
    return data.tasks;
  },

  async stop(taskId: string): Promise<BackgroundTask> {
    const res = await api.post(`/background-tasks/${encodeURIComponent(taskId)}/stop`, {});
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? `stop failed: ${res.status}`);
    }
    const data = (await res.json()) as { task: BackgroundTask };
    return data.task;
  },

  async dismiss(taskId: string): Promise<void> {
    const res = await api.post(`/background-tasks/${encodeURIComponent(taskId)}/dismiss`, {});
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? `dismiss failed: ${res.status}`);
    }
  },
};
