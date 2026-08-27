// Pure cron → calendar logic for the 日历与定时任务 page.
//
// Two real data sources are rendered onto the month grid / agenda:
//   - /api/cron-prompts   (定时 prompt 任务, matched to the open project by projectPath)
//   - /api/tasks/schedules (看板 cron 排程, matched by rootId = projectId)
// Matching is day-granularity: minute/hour fields only feed the time label.

import type { CalendarEvent, CalendarEventTone } from './calendarData';

export interface CronPromptTaskView {
  id: string;
  name: string;
  cronExpression: string;
  prompt: string;
  provider: string;
  projectPath: string;
  enabled: boolean;
  lastRunAt: string | null;
  runCount: number;
}

export interface KanbanScheduleView {
  id: string;
  rootId: string;
  taskTemplateId: string;
  cronExpression: string;
  enabled: boolean;
  input: string;
  lastRunAt: string | null;
}

/** One-time calendar events from /api/calendar-events (新建一次性任务). */
export interface CalendarEventView {
  id: string;
  title: string;
  /** Local 'YYYY-MM-DDTHH:mm' — the datetime-local shape, no timezone math. */
  startsAt: string;
  durationMinutes: number;
  remindMinutes: number | null;
  notes: string | null;
}

/** '14:30' from a startsAt value; '—' when the shape is unexpected. */
function eventTimeLabel(startsAt: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startsAt) ? startsAt.slice(11, 16) : '—';
}

/** '90' → '1 小时 30 分钟'; '45' → '45 分钟'. */
export function eventDurationLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours > 0 ? `${hours} 小时` : null, rest > 0 ? `${rest} 分钟` : null].filter(Boolean).join(' ');
}

// --- cron field parsing (supports *, */n, a, a-b, a-b/n, comma lists) ---

function parseField(field: string, min: number, max: number): ((value: number) => boolean) | null {
  const parts = field.split(',');
  const matchers: Array<(value: number) => boolean> = [];
  for (const part of parts) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isFinite(step) || step < 1) return null;
    let start: number;
    let end: number;
    if (rangePart === '*') {
      start = min;
      end = max;
    } else if (rangePart.includes('-')) {
      const [rawStart, rawEnd] = rangePart.split('-');
      start = Number(rawStart);
      end = Number(rawEnd);
    } else {
      start = Number(rangePart);
      end = stepPart ? max : start;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < min || end > max || start > end) {
      return null;
    }
    matchers.push((value) => value >= start && value <= end && (value - start) % step === 0);
  }
  return (value) => matchers.some((match) => match(value));
}

interface ParsedCron {
  minute: (value: number) => boolean;
  hour: (value: number) => boolean;
  dom: (value: number) => boolean;
  month: (value: number) => boolean;
  dow: (value: number) => boolean;
  domRestricted: boolean;
  dowRestricted: boolean;
}

export function parseCronExpression(expression: string): ParsedCron | null {
  // Accept 5-field cron; a 6-field expression with leading seconds drops them.
  const fields = expression.trim().split(/\s+/);
  const parts = fields.length === 6 ? fields.slice(1) : fields;
  if (parts.length !== 5) return null;
  const minute = parseField(parts[0], 0, 59);
  const hour = parseField(parts[1], 0, 23);
  const dom = parseField(parts[2], 1, 31);
  const month = parseField(parts[3], 1, 12);
  // node-cron: 0 and 7 both mean Sunday.
  const dowRaw = parts[4].replace(/(^|,)7(?=,|$)/g, '$10');
  const dow = parseField(dowRaw, 0, 6);
  if (!minute || !hour || !dom || !month || !dow) return null;
  return {
    minute,
    hour,
    dom,
    month,
    dow,
    domRestricted: parts[2] !== '*',
    dowRestricted: parts[4] !== '*',
  };
}

// Day-granularity match with vixie-cron dom/dow semantics: when both dom and
// dow are restricted they OR; when only one is restricted it applies alone.
export function cronMatchesDate(expression: string, date: Date): boolean {
  const cron = parseCronExpression(expression);
  if (!cron) return false;
  if (!cron.month(date.getMonth() + 1)) return false;
  const domOk = cron.dom(date.getDate());
  const dowOk = cron.dow(date.getDay());
  if (cron.domRestricted && cron.dowRestricted) return domOk || dowOk;
  if (cron.domRestricted) return domOk;
  if (cron.dowRestricted) return dowOk;
  return true;
}

/** 'HH:mm' when the expression pins a single time, otherwise null. */
export function cronTimeLabel(expression: string): string | null {
  const fields = expression.trim().split(/\s+/);
  const parts = fields.length === 6 ? fields.slice(1) : fields;
  if (parts.length !== 5) return null;
  if (!/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) return null;
  const minute = Number(parts[0]);
  const hour = Number(parts[1]);
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// --- month grid / agenda expansion ---

// 定时任务全局可见——任务不再归属于某个项目;projectPath 只是发起时给
// agent 的可选工作目录。
function activeCronTasks(tasks: CronPromptTaskView[]): CronPromptTaskView[] {
  return tasks.filter((task) => task.enabled);
}

export function buildMonthEvents(options: {
  year: number;
  month: number;
  cronTasks: CronPromptTaskView[];
  schedules: KanbanScheduleView[];
  events?: CalendarEventView[];
  projectPath: string;
}): CalendarEvent[] {
  const { year, month, cronTasks, schedules, events = [], projectPath } = options;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  const sources: Array<{ id: string; expression: string; title: string; tone: CalendarEventTone }> = [
    ...activeCronTasks(cronTasks).map((task) => ({
      id: `cron-${task.id}`,
      expression: task.cronExpression,
      title: task.name,
      tone: 'cyan' as const,
    })),
    ...schedules
      .filter((schedule) => schedule.enabled)
      .map((schedule) => ({
        id: `schedule-${schedule.id}`,
        expression: schedule.cronExpression,
        title: schedule.input ? schedule.input : '看板定时任务',
        tone: 'green' as const,
      })),
  ];

  const result: CalendarEvent[] = [];
  for (const source of sources) {
    for (let day = 1; day <= daysInMonth; day++) {
      if (!cronMatchesDate(source.expression, new Date(year, month, day))) continue;
      result.push({
        id: `${source.id}-${day}`,
        day,
        title: source.title,
        time: cronTimeLabel(source.expression) ?? '按计划',
        tone: source.tone,
      });
    }
  }
  for (const event of events) {
    if (!event.startsAt.startsWith(monthPrefix)) continue;
    result.push({
      id: `event-${event.id}`,
      day: Number(event.startsAt.slice(8, 10)),
      title: event.title,
      time: eventTimeLabel(event.startsAt),
      tone: 'blue',
    });
  }
  return result.sort((a, b) => a.day - b.day || a.time.localeCompare(b.time));
}

export interface CalendarAgendaSourceItem {
  id: string;
  time: string;
  duration: string;
  title: string;
  meta: string;
  tone: CalendarEventTone;
  /** Real calendar_events id — present only on one-time events (deletable). */
  eventId?: string;
}

export function buildAgendaItems(options: {
  year: number;
  month: number;
  day: number;
  cronTasks: CronPromptTaskView[];
  schedules: KanbanScheduleView[];
  events?: CalendarEventView[];
  projectPath: string;
}): CalendarAgendaSourceItem[] {
  const { year, month, day, cronTasks, schedules, events = [], projectPath } = options;
  const date = new Date(year, month, day);
  const dayPrefix = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const items: CalendarAgendaSourceItem[] = [];

  for (const task of activeCronTasks(cronTasks)) {
    if (!cronMatchesDate(task.cronExpression, date)) continue;
    items.push({
      id: `cron-${task.id}`,
      time: cronTimeLabel(task.cronExpression) ?? '按计划',
      duration: '定时',
      title: task.name,
      meta: task.runCount > 0 ? `${task.provider} · 已执行 ${task.runCount} 次` : `${task.provider} · 尚未执行`,
      tone: 'cyan',
    });
  }

  for (const schedule of schedules) {
    if (!schedule.enabled || !cronMatchesDate(schedule.cronExpression, date)) continue;
    items.push({
      id: `schedule-${schedule.id}`,
      time: cronTimeLabel(schedule.cronExpression) ?? '按计划',
      duration: '看板',
      title: schedule.input ? schedule.input : '看板定时任务',
      meta: `看板排程 · ${schedule.cronExpression}`,
      tone: 'green',
    });
  }

  for (const event of events) {
    if (!event.startsAt.startsWith(dayPrefix)) continue;
    const remind = event.remindMinutes !== null && event.remindMinutes > 0 ? ` · 提前 ${event.remindMinutes} 分钟提醒` : '';
    items.push({
      id: `event-${event.id}`,
      eventId: event.id,
      time: eventTimeLabel(event.startsAt),
      duration: eventDurationLabel(event.durationMinutes),
      title: event.title,
      meta: `${event.notes ? `${event.notes} · ` : ''}一次性日程${remind}`,
      tone: 'blue',
    });
  }

  return items.sort((a, b) => a.time.localeCompare(b.time));
}

// --- recurring form → cron expression ---

export type RecurringRepeat = 'daily' | 'weekly' | 'monthly';

/** Mirrors the server-side node-cron validation for the shapes this form emits. */
export function buildCronExpression(options: {
  repeat: RecurringRepeat;
  time: string;
  startDate: string;
}): string | null {
  const [hourRaw, minuteRaw] = options.time.split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  const date = new Date(`${options.startDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  if (options.repeat === 'weekly') {
    return `${minute} ${hour} * * ${date.getDay()}`;
  }
  if (options.repeat === 'monthly') {
    return `${minute} ${hour} ${date.getDate()} * *`;
  }
  return `${minute} ${hour} * * *`;
}
