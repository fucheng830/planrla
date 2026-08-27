import { useMemo, useState } from 'react';

import { CalendarAgenda } from '../../calendar-schedule/CalendarAgenda';
import { CalendarMonthGrid } from '../../calendar-schedule/CalendarMonthGrid';
import { CalendarTaskForms, type CalendarFormResult } from '../../calendar-schedule/CalendarTaskForms';
import { buildAgendaItems, buildMonthEvents } from '../../calendar-schedule/cronCalendar';
import { useScheduleSources } from '../../calendar-schedule/useScheduleSources';
import type { AgendaItem } from '../../calendar-schedule/calendarData';
import type { CronPromptTaskView } from '../../calendar-schedule/cronCalendar';

type SaveState = { tone: 'idle' | 'success' | 'error'; message?: string };

function formatDefaultDate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function SchedulePage({
  projectId,
  projectPath,
}: {
  projectId: string | null;
  projectPath: string;
}) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState(today.getDate());
  const [saveState, setSaveState] = useState<SaveState>({ tone: 'idle' });
  const [editingCronTask, setEditingCronTask] = useState<CronPromptTaskView | null>(null);

  const { cronTasks, schedules, calendarEvents, loading, error, reload, deleteEvent, deleteCron } =
    useScheduleSources(projectId, projectPath);

  const monthEvents = useMemo(
    () => buildMonthEvents({ year, month, cronTasks, schedules, events: calendarEvents, projectPath }),
    [year, month, cronTasks, schedules, calendarEvents, projectPath],
  );

  const agendaItems = useMemo(
    () => buildAgendaItems({ year, month, day: selectedDay, cronTasks, schedules, events: calendarEvents, projectPath }),
    [year, month, selectedDay, cronTasks, schedules, calendarEvents, projectPath],
  );

  const changeMonth = (direction: 'previous' | 'next') => {
    const next = new Date(year, month + (direction === 'next' ? 1 : -1), 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
    setSelectedDay(1);
    setSaveState({ tone: 'idle' });
  };

  const handleFormResult = (result: CalendarFormResult) => {
    setSaveState({ tone: result.tone, message: result.message });
    if (result.reload) reload();
  };

  const handleSelectAgendaItem = (item: AgendaItem) => {
    if (!item.cronId) return;
    const task = cronTasks.find((entry) => entry.id === item.cronId) ?? null;
    setEditingCronTask(task);
    if (task) setSaveState({ tone: 'idle' });
  };

  const handleDeleteCron = async (cronId: string) => {
    // 正在编辑同一任务时删除,先退出编辑态。
    if (editingCronTask?.id === cronId) setEditingCronTask(null);
    const ok = await deleteCron(cronId);
    setSaveState(
      ok
        ? { tone: 'success', message: '定时任务已删除' }
        : { tone: 'error', message: '删除定时任务失败，请重试' },
    );
    if (ok) reload();
  };

  const handleDeleteEvent = async (eventId: string) => {
    const ok = await deleteEvent(eventId);
    setSaveState(
      ok
        ? { tone: 'idle' }
        : { tone: 'error', message: '删除日程失败，请重试' },
    );
  };

  return (
    <main className="calendar-schedule-page calendar-content-only">
      <div className="calendar-content-shell">
        {loading && (
          <p role="status" className="px-4 pt-3 text-xs" style={{ color: 'var(--cal-muted)' }}>
            正在加载定时任务与看板排程…
          </p>
        )}
        {!loading && error && (
          <p role="alert" className="mx-4 mt-3 rounded-md border px-3 py-2 text-xs" style={{ borderColor: 'var(--cal-red)', background: 'var(--cal-red-soft)', color: 'var(--cal-red)' }}>
            加载失败：{error}
          </p>
        )}
        {saveState.message && (
          <p
            role="status"
            aria-live="polite"
            className="mx-4 mt-3 rounded-md border px-3 py-2 text-xs"
            style={
              saveState.tone === 'success'
                ? { borderColor: 'var(--cal-green)', background: 'var(--cal-green-soft)', color: 'var(--cal-green)' }
                : { borderColor: 'var(--cal-red)', background: 'var(--cal-red-soft)', color: 'var(--cal-red)' }
            }
          >
            {saveState.message}
          </p>
        )}
        <div className="calendar-content-grid">
          <div className="calendar-main-column">
            <CalendarMonthGrid
              year={year}
              month={month}
              selectedDay={selectedDay}
              events={monthEvents}
              todayDay={today.getFullYear() === year && today.getMonth() === month ? today.getDate() : undefined}
              onSelectDay={(day) => {
                setSelectedDay(day);
                setSaveState({ tone: 'idle' });
              }}
              onMonthChange={changeMonth}
            />
            <CalendarAgenda
              year={year}
              month={month}
              selectedDay={selectedDay}
              items={agendaItems}
              onAdd={() => {
                setEditingCronTask(null);
                setSaveState({ tone: 'idle' });
              }}
              onSelect={handleSelectAgendaItem}
              onDeleteEvent={(eventId) => void handleDeleteEvent(eventId)}
              onDeleteCron={(cronId) => void handleDeleteCron(cronId)}
            />
          </div>
          <CalendarTaskForms
            defaultDate={formatDefaultDate(year, month, selectedDay)}
            projectPath={projectPath}
            editingTask={editingCronTask}
            onDoneEdit={() => setEditingCronTask(null)}
            onResult={handleFormResult}
          />
        </div>
      </div>
    </main>
  );
}
