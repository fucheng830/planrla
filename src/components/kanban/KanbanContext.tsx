import { createContext, useContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { kanbanApi } from './api';
import type { Task, TaskPriority, TaskTemplate, KanbanSchedule } from './types';

import { useWebSocket } from '@/contexts/WebSocketContext';

interface KanbanContextValue {
  tasks: Task[];
  tasksById: Map<string, Task>;
  /** TaskMaster-style "next task": highest-priority runnable task whose
   * dependencies have all succeeded (mirrors service.getNextTask). */
  nextTask: Task | null;
  templates: TaskTemplate[];
  templatesById: Map<string, TaskTemplate>;
  schedules: KanbanSchedule[];
  loading: boolean;
  error: string | null;
  rootId: string | null;
  refresh: () => Promise<void>;
  createTask: (
    taskTemplateId: string,
    input: string,
    options?: { priority?: TaskPriority; dependencies?: string[] },
  ) => Promise<void>;
  moveTask: (taskId: string, action: string) => Promise<void>;
  jumpTask: (taskId: string, targetIndex: number) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  reloadTemplates: () => Promise<void>;
  saveTemplate: (tpl: TaskTemplate) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  reloadSchedules: () => Promise<void>;
  saveSchedule: (sch: KanbanSchedule) => Promise<void>;
  deleteSchedule: (id: string) => Promise<void>;
}

const KanbanContext = createContext<KanbanContextValue | null>(null);

// Mirrors server taskPriorityRank (high < medium < low by rank value).
const priorityRank = (p?: TaskPriority) => (p === 'high' ? 0 : p === 'low' ? 2 : 1);

export function useKanban(): KanbanContextValue {
  const ctx = useContext(KanbanContext);
  if (!ctx) throw new Error('useKanban must be used within KanbanProvider');
  return ctx;
}

export function KanbanProvider({ children, rootId }: { children: ReactNode; rootId: string | null }) {
  const { subscribe } = useWebSocket();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [schedules, setSchedules] = useState<KanbanSchedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rebuild the lookup map only when templates change. Memoized so the Map
  // identity is stable across renders — prevents infinite loops if a consumer
  // adds it to a useMemo/useEffect dependency array.
  const templatesById = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);
  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  // Derived from the WS-synced board, so the banner is always live. A task is
  // runnable when queued (agent stage) or waiting_user (human stage) and not
  // already admitted by the scheduler.
  const nextTask = useMemo(() => {
    const eligible = tasks
      .filter((t) => (t.status === 'queued' || t.status === 'waiting_user') && !t.schedulerAdmitted)
      .filter((t) => (t.dependencies ?? []).every((d) => tasksById.get(d)?.status === 'success'))
      .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.createdAt.localeCompare(b.createdAt));
    return eligible[0] ?? null;
  }, [tasks, tasksById]);

  const refresh = useCallback(async () => {
    if (!rootId) {
      setTasks([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [t, tpl, sch] = await Promise.all([
        kanbanApi.listTasks(rootId),
        kanbanApi.listTemplates(),
        kanbanApi.listSchedules(rootId),
      ]);
      setTasks(t);
      setTemplates(tpl);
      setSchedules(sch);
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
      if (event.type !== 'kanban-task-updated' && event.type !== 'kanban-task-deleted') return;
      if (event.rootId !== rootId) return;
      if (event.type === 'kanban-task-deleted') {
        const taskId = event.taskId as string | undefined;
        if (!taskId) return;
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
        return;
      }
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
    async (
      taskTemplateId: string,
      input: string,
      options?: { priority?: TaskPriority; dependencies?: string[] },
    ) => {
      if (!rootId) return;
      try {
        const t = await kanbanApi.createTask(rootId, taskTemplateId, input, options);
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

  const deleteTask = useCallback(
    async (taskId: string) => {
      if (!rootId) return;
      try {
        await kanbanApi.deleteTask(taskId, rootId);
        setTasks((prev) => prev.filter((x) => x.id !== taskId));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'deleteTask failed');
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

  const reloadSchedules = useCallback(async () => {
    if (!rootId) return;
    try {
      setSchedules(await kanbanApi.listSchedules(rootId));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'schedules load failed');
    }
  }, [rootId]);

  const saveSchedule = useCallback(
    async (sch: KanbanSchedule) => {
      if (!rootId) return;
      try {
        // Force the current project root so a stale payload can't cross-pollute.
        const saved = await kanbanApi.saveSchedule({ ...sch, rootId });
        setSchedules((prev) => {
          const i = prev.findIndex((s) => s.id === saved.id);
          return i === -1 ? [...prev, saved] : prev.map((s) => (s.id === saved.id ? saved : s));
        });
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'saveSchedule failed');
      }
    },
    [rootId],
  );

  const deleteSchedule = useCallback(async (id: string) => {
    try {
      await kanbanApi.deleteSchedule(id);
      setSchedules((prev) => prev.filter((s) => s.id !== id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'deleteSchedule failed');
    }
  }, []);

  const value: KanbanContextValue = {
    tasks,
    tasksById,
    nextTask,
    templates,
    templatesById,
    schedules,
    loading,
    error,
    rootId,
    refresh,
    createTask,
    moveTask,
    jumpTask,
    deleteTask,
    reloadTemplates,
    saveTemplate,
    deleteTemplate,
    reloadSchedules,
    saveSchedule,
    deleteSchedule,
  };

  return <KanbanContext.Provider value={value}>{children}</KanbanContext.Provider>;
}
