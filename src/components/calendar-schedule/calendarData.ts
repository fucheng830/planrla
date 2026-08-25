// Shared view types for the 日历与定时任务 content area. Real occurrences
// are computed in cronCalendar.ts from cron prompts + kanban schedules.

export type CalendarEventTone = 'blue' | 'green' | 'red' | 'cyan';

export type CalendarEvent = {
  id: string;
  day: number;
  title: string;
  time: string;
  tone: CalendarEventTone;
};

export type AgendaItem = {
  id: string;
  time: string;
  duration: string;
  title: string;
  meta: string;
  tone: CalendarEventTone;
};
