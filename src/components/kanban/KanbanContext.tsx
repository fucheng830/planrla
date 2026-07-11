import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { kanbanApi } from './api';
import type { Task, TaskTemplate } from './types';

interface KanbanContextValue {
  tasks: Task[];
  templates: TaskTemplate[];
  templatesById: Map<string, TaskTemplate>;
  loading: boolean;
  error: string | null;
  rootId: string | null;
  refresh: () => Promise<void>;
  createTask: (taskTemplateId: string, input: string) => Promise<void>;
  moveTask: (taskId: string, action: string) => Promise<void>;
  jumpTask: (taskId: string, targetIndex: number) => Promise<void>;
  reloadTemplates: () => Promise<void>;
  saveTemplate: (tpl: TaskTemplate) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
}

const KanbanContext = createContext<KanbanContextValue | null>(null);

export function useKanban(): KanbanContextValue {
  const ctx = useContext(KanbanContext);
  if (!ctx) throw new Error('useKanban must be used within KanbanProvider');
  return ctx;
}

export function KanbanProvider({ children, rootId }: { children: ReactNode; rootId: string | null }) {
  const { subscribe } = useWebSocket();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rebuild the lookup map on every templates change. Small arrays; fine to
  // recompute rather than memoize (avoids an extra useMemo dep bookkeeping).
  const templatesById = new Map(templates.map((t) => [t.id, t]));

  const refresh = useCallback(async () => {
    if (!rootId) {
      setTasks([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [t, tpl] = await Promise.all([kanbanApi.listTasks(rootId), kanbanApi.listTemplates()]);
      setTasks(t);
      setTemplates(tpl);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'failed to load kanban');
    } finally {
      setLoading(false);
    }
  }, [rootId]);

  const reloadTemplates = useCallback(async () => {
    try {
      setTemplates(await kanbanApi.listTemplates());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'templates load failed');
    }
  }, []);

  // Initial load + refetch when the project root changes.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // WebSocket subscription: upsert tasks on `kanban-task-updated`, refetch the
  // whole board on synthetic `websocket_reconnected` (so we don't miss deltas
  // dropped while the socket was down). Filters by rootId so multiple projects
  // mounted in the same app don't cross-pollute.
  useEffect(() => {
    if (!rootId) return;
    const off = subscribe((event) => {
      if (event.kind === 'websocket_reconnected') {
        void refresh();
        return;
      }
      if (event.type !== 'kanban-task-updated') return;
      if (event.rootId !== rootId) return;
      const task = event.task as Task | undefined;
      if (!task) return;
      setTasks((prev) => {
        const i = prev.findIndex((t) => t.id === task.id);
        if (i === -1) return [...prev, task];
        const next = prev.slice();
        next[i] = task;
        return next;
      });
    });
    return off;
  }, [subscribe, rootId, refresh]);

  const createTask = useCallback(
    async (taskTemplateId: string, input: string) => {
      if (!rootId) return;
      try {
        const t = await kanbanApi.createTask(rootId, taskTemplateId, input);
        setTasks((prev) => (prev.some((x) => x.id === t.id) ? prev : [...prev, t]));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'createTask failed');
      }
    },
    [rootId],
  );

  const moveTask = useCallback(
    async (taskId: string, action: string) => {
      if (!rootId) return;
      try {
        const t = await kanbanApi.move(taskId, rootId, action);
        setTasks((prev) => prev.map((x) => (x.id === t.id ? t : x)));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : `${action} failed`);
        // Optimistic state may now diverge from the server; resync.
        void refresh();
      }
    },
    [rootId, refresh],
  );

  const jumpTask = useCallback(
    async (taskId: string, targetIndex: number) => {
      if (!rootId) return;
      try {
        const t = await kanbanApi.jump(taskId, rootId, targetIndex);
        setTasks((prev) => prev.map((x) => (x.id === t.id ? t : x)));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'jump failed');
        void refresh();
      }
    },
    [rootId, refresh],
  );

  const saveTemplate = useCallback(async (tpl: TaskTemplate) => {
    try {
      const saved = await kanbanApi.saveTemplate(tpl);
      setTemplates((prev) => {
        const i = prev.findIndex((t) => t.id === saved.id);
        return i === -1 ? [...prev, saved] : prev.map((t) => (t.id === saved.id ? saved : t));
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'saveTemplate failed');
    }
  }, []);

  const deleteTemplate = useCallback(async (id: string) => {
    try {
      await kanbanApi.deleteTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'deleteTemplate failed');
    }
  }, []);

  const value: KanbanContextValue = {
    tasks,
    templates,
    templatesById,
    loading,
    error,
    rootId,
    refresh,
    createTask,
    moveTask,
    jumpTask,
    reloadTemplates,
    saveTemplate,
    deleteTemplate,
  };

  return <KanbanContext.Provider value={value}>{children}</KanbanContext.Provider>;
}
