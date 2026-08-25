// Fetches the two real schedule sources behind the 日历与定时任务 page:
// cron prompt tasks (global, filtered client-side by project path) and
// kanban cron schedules (already scoped by rootId = projectId).

import { useCallback, useEffect, useState } from 'react';

import { api } from '../../utils/api';
import { kanbanApi } from '../kanban/api';

import type { CronPromptTaskView, KanbanScheduleView } from './cronCalendar';

export interface ScheduleSourcesState {
  cronTasks: CronPromptTaskView[];
  schedules: KanbanScheduleView[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useScheduleSources(projectId: string | null): ScheduleSourcesState {
  const [cronTasks, setCronTasks] = useState<CronPromptTaskView[]>([]);
  const [schedules, setSchedules] = useState<KanbanScheduleView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    if (!projectId) {
      setCronTasks([]);
      setSchedules([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api.get('/cron-prompts').then(async (res) => {
        if (!res.ok) throw new Error(`cron-prompts failed: ${res.status}`);
        const data = (await res.json()) as { data?: CronPromptTaskView[] };
        return data.data ?? [];
      }),
      kanbanApi.listSchedules(projectId),
    ])
      .then(([tasks, kanbanSchedules]) => {
        if (cancelled) return;
        setCronTasks(tasks);
        setSchedules(kanbanSchedules);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadToken]);

  return { cronTasks, schedules, loading, error, reload };
}
