// src/components/background-tasks/hooks/useBackgroundTasks.ts
// REQ-046 — 后台任务面板的 state + WS 订阅。镜像 KanbanContext 模式。
import { useCallback, useEffect, useState } from 'react';

import { backgroundTaskApi } from '../api';
import type { BackgroundTask } from '../types';

import { useWebSocket } from '@/contexts/WebSocketContext';

export interface UseBackgroundTasksResult {
  tasks: BackgroundTask[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  stopTask: (taskId: string) => Promise<void>;
  dismissTask: (taskId: string) => Promise<void>;
}

export function useBackgroundTasks(): UseBackgroundTasksResult {
  const { subscribe } = useWebSocket();
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await backgroundTaskApi.list();
      setTasks(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = subscribe((event) => {
      // 重连后 REST 重拉(补漏掉的 delta)
      if (event.kind === 'websocket_reconnected') {
        void refresh();
        return;
      }
      if (event.type === 'background-task-updated') {
        const task = event.task as BackgroundTask | undefined;
        if (!task) return;
        setTasks((prev) => {
          const idx = prev.findIndex((t) => t.id === task.id);
          if (idx < 0) return [...prev, task];
          const next = [...prev];
          next[idx] = task;
          return next;
        });
        return;
      }
      if (event.type === 'background-task-deleted') {
        const taskId = event.taskId as string | undefined;
        if (!taskId) return;
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
        return;
      }
    });
    return off;
  }, [subscribe, refresh]);

  const stopTask = useCallback(async (taskId: string) => {
    await backgroundTaskApi.stop(taskId);
    // 服务端会推 background-task-updated;乐观不本地改
  }, []);

  const dismissTask = useCallback(async (taskId: string) => {
    await backgroundTaskApi.dismiss(taskId);
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  }, []);

  return { tasks, loading, error, refresh, stopTask, dismissTask };
}
