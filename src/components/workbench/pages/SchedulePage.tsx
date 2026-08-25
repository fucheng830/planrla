import { useMemo, useState } from 'react';

import { CalendarAgenda } from '../../calendar-schedule/CalendarAgenda';
import { CalendarMonthGrid } from '../../calendar-schedule/CalendarMonthGrid';
import { CalendarTaskForms, type CalendarFormResult } from '../../calendar-schedule/CalendarTaskForms';
import { buildAgendaItems, buildMonthEvents } from '../../calendar-schedule/cronCalendar';
import { useScheduleSources } from '../../calendar-schedule/useScheduleSources';

import { PageShell, PageToolbar } from './PageShell';

type SaveState = { tone: 'idle' | 'success' | 'error'; message?: string };

function formatDefaultDate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function SchedulePage({
  projectName,
  projectId,
  projectPath,
}: {
  projectName: string;
  projectId: string | null;
  projectPath: string;
}) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState(today.getDate());
  const [saveState, setSaveState] = useState<SaveState>({ tone: 'idle' });

  const { cronTasks, schedules, loading, error, reload } = useScheduleSources(projectId);

  const projectCronCount = useMemo(
    () =>
      cronTasks.filter(
        (task) => task.projectPath.replace(/\\/g, '/').toLowerCase() === projectPath.replace(/\\/g, '/').toLowerCase(),
      ).length,
    [cronTasks, projectPath],
  );

  const monthEvents = useMemo(
    () => buildMonthEvents({ year, month, cronTasks, schedules, projectPath }),
    [year, month, cronTasks, schedules, projectPath],
  );

  const agendaItems = useMemo(
    () => buildAgendaItems({ year, month, day: selectedDay, cronTasks, schedules, projectPath }),
    [year, month, selectedDay, cronTasks, schedules, projectPath],
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

  return (
    <PageShell>
      <PageToolbar
        title="日历与定时任务"
        description={`${projectName} · 定时任务 ${projectCronCount} · 看板排程 ${schedules.length}`}
      />
      {loading && (
        <p role="status" className="rounded-md border border-workbench-border bg-workbench-muted px-3 py-2 text-sm text-workbench-subtle">
          正在加载定时任务与看板排程…
        </p>
      )}
      {!loading && error && (
        <p role="alert" className="rounded-md border border-workbench-danger/30 bg-workbench-danger/10 px-3 py-2 text-sm text-workbench-danger">
          加载失败：{error}
        </p>
      )}
      {saveState.message && (
        <p
          role="status"
          aria-live="polite"
          className={`rounded-md border px-3 py-2 text-sm ${
            saveState.tone === 'success'
              ? 'border-workbench-success/30 bg-workbench-success/10 text-workbench-success'
              : 'border-workbench-danger/30 bg-workbench-danger/10 text-workbench-danger'
          }`}
        >
          {saveState.message}
        </p>
      )}
      <div className="calendar-content-grid calendar-workbench-grid">
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
            onAdd={() => setSaveState({ tone: 'idle' })}
          />
        </div>
        <CalendarTaskForms
          defaultDate={formatDefaultDate(year, month, selectedDay)}
          projectPath={projectPath}
          onResult={handleFormResult}
        />
      </div>
    </PageShell>
  );
}
