// server/modules/calendar-events/calendar-events.store.ts
//
// 日历一次性事件(新建一次性任务表单的真实持久化层)。starts_at 存本地
// 时间字符串 'YYYY-MM-DDTHH:mm',与 <input type="datetime-local"> 的值
// 一致,渲染端不做时区换算。

import { randomUUID } from 'node:crypto';

import { getConnection } from '@/modules/database/index.js';

export interface CalendarEventRecord {
  id: string;
  title: string;
  startsAt: string;
  durationMinutes: number;
  remindMinutes: number | null;
  assignees: string[];
  notes: string | null;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
}

interface CalendarEventRow {
  id: string;
  title: string;
  starts_at: string;
  duration_minutes: number;
  remind_minutes: number | null;
  assignees: string | null;
  notes: string | null;
  project_path: string;
  created_at: string;
  updated_at: string;
}

const rowToRecord = (row: CalendarEventRow): CalendarEventRecord => ({
  id: row.id,
  title: row.title,
  startsAt: row.starts_at,
  durationMinutes: Number(row.duration_minutes ?? 60),
  remindMinutes: row.remind_minutes === null ? null : Number(row.remind_minutes),
  assignees: parseAssignees(row.assignees),
  notes: row.notes,
  projectPath: row.project_path,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

function parseAssignees(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

const normalizePath = (path: string): string =>
  path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export const calendarEventsStore = {
  list(projectPath?: string): CalendarEventRecord[] {
    const db = getConnection();
    const rows = db
      .prepare('SELECT * FROM calendar_events ORDER BY starts_at ASC')
      .all() as unknown as CalendarEventRow[];
    const records = rows.map(rowToRecord);
    if (typeof projectPath !== 'string' || !projectPath.trim()) return records;
    const normalized = normalizePath(projectPath);
    return records.filter((record) => normalizePath(record.projectPath) === normalized);
  },

  getById(id: string): CalendarEventRecord | null {
    const db = getConnection();
    const row = db
      .prepare('SELECT * FROM calendar_events WHERE id = ?')
      .get(id) as unknown as CalendarEventRow | undefined;
    return row ? rowToRecord(row) : null;
  },

  create(input: {
    title: string;
    startsAt: string;
    durationMinutes?: number;
    remindMinutes?: number | null;
    assignees?: string[];
    notes?: string | null;
    projectPath: string;
  }): CalendarEventRecord {
    const db = getConnection();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO calendar_events
         (id, title, starts_at, duration_minutes, remind_minutes, assignees, notes, project_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.title,
      input.startsAt,
      input.durationMinutes ?? 60,
      input.remindMinutes ?? null,
      input.assignees && input.assignees.length > 0 ? JSON.stringify(input.assignees) : null,
      input.notes ?? null,
      input.projectPath,
    );
    return this.getById(id)!;
  },

  delete(id: string): boolean {
    const db = getConnection();
    const result = db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
    return result.changes > 0;
  },
};
