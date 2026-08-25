import { useState } from 'react';

import { CalendarAgenda } from '../../calendar-schedule/CalendarAgenda';
import { CalendarMonthGrid } from '../../calendar-schedule/CalendarMonthGrid';
import { CalendarTaskForms } from '../../calendar-schedule/CalendarTaskForms';

import { PageShell, PageToolbar } from './PageShell';

type SaveState = { tone: 'idle' | 'success' | 'error'; message?: string };

function formatDefaultDate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function SchedulePage({ projectName }: { projectName: string }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState(today.getDate());
  const [saveState, setSaveState] = useState<SaveState>({ tone: 'idle' });

  const changeMonth = (direction: 'previous' | 'next') => {
    const next = new Date(year, month + (direction === 'next' ? 1 : -1), 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
    setSelectedDay(1);
    setSaveState({ tone: 'idle' });
  };

  const saveTask = (message: string) => setSaveState({ tone: 'success', message });

  return (
    <PageShell>
      <PageToolbar
        title="日历与定时任务"
        description={`${projectName} · 会议、提醒、AI 自动任务与交付节点`}
      />
      {saveState.message && (
        <p
          role="status"
          aria-live="polite"
          className={`rounded-md border px-3 py-2 text-sm ${
            saveState.tone === 'success'
              ? 'border-workbench-success/30 bg-workbench-success-soft/40 text-workbench-success'
              : 'border-workbench-danger/30 bg-workbench-danger-soft/40 text-workbench-danger'
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
            onAdd={() => setSaveState({ tone: 'idle' })}
          />
        </div>
        <CalendarTaskForms defaultDate={formatDefaultDate(year, month, selectedDay)} onSaved={saveTask} />
      </div>
    </PageShell>
  );
}
