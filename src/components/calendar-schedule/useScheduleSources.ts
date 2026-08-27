// Fetches the three real schedule sources behind the 日历与定时任务 page:
// cron prompt tasks (global, filtered client-side by project path), kanban
// cron schedules (already scoped by rootId = projectId) and one-time
// calendar events (scoped server-side by project path).

import { useCallback, useEffect, useState } from 'react';

import { api } from '../../utils/api';
import { kanbanApi } from '../kanban/api';

import type { CalendarEventView, CronPromptTaskView, KanbanScheduleView } from './cronCalendar';

export interface ScheduleSourcesState {
  cronTasks: CronPromptTaskView[];
  schedules: KanbanScheduleView[];
  calendarEvents: CalendarEventView[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** DELETE a one-time event and refresh (returns ok even when offline). */
  deleteEvent: (eventId: string) => Promise<boolean>;
  /** DELETE a cron prompt task (定时任务) and refresh the local list. */
  deleteCron: (cronId: string) => Promise<boolean>;
}

export function useScheduleSources(projectId: string | null, projectPath?: string): ScheduleSourcesState {
  const [cronTasks, setCronTasks] = useState<CronPromptTaskView[]>([]);
  const [schedules, setSchedules] = useState<KanbanScheduleView[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEventView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    if (!projectId) {
      setCronTasks([]);
      setSchedules([]);
      setCalendarEvents([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const eventsQuery = projectPath ? `?projectPath=${encodeURIComponent(projectPath)}` : '';
    Promise.all([
      api.get('/cron-prompts').then(async (res) => {
        if (!res.ok) throw new Error(`cron-prompts failed: ${res.status}`);
        const data = (await res.json()) as { data?: CronPromptTaskView[] };
        return data.data ?? [];
      }),
      kanbanApi.listSchedules(projectId),
      api.get(`/calendar-events${eventsQuery}`).then(async (res) => {
        if (!res.ok) throw new Error(`calendar-events failed: ${res.status}`);
        const data = (await res.json()) as { data?: CalendarEventView[] };
        return data.data ?? [];
      }),
    ])
      .then(([tasks, kanbanSchedules, events]) => {
        if (cancelled) return;
        setCronTasks(tasks);
        setSchedules(kanbanSchedules);
        setCalendarEvents(events);
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
  }, [projectId, projectPath, reloadToken]);

  const deleteEvent = useCallback(
    async (eventId: string) => {
      try {
        const res = await api.delete(`/calendar-events/${eventId}`);
        if (!res.ok) return false;
        setCalendarEvents((events) => events.filter((event) => event.id !== eventId));
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  const deleteCron = useCallback(async (cronId: string) => {
    try {
      const res = await api.delete(`/cron-prompts/${cronId}`);
      if (!res.ok) return false;
      setCronTasks((tasks) => tasks.filter((task) => task.id !== cronId));
      return true;
    } catch {
      return false;
    }
  }, []);

  return { cronTasks, schedules, calendarEvents, loading, error, reload, deleteEvent, deleteCron };
}
