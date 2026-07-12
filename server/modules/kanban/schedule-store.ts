import type { Database } from 'better-sqlite3';
import type { KanbanSchedule, ScheduleRow } from './schedule-types.js';
import { rowToSchedule } from './schedule-types.js';

export interface ScheduleStoreDeps {
  db: Database;
}

export interface ScheduleStore {
  listSchedules(rootId: string): KanbanSchedule[];
  listAllEnabledSchedules(): KanbanSchedule[];
  getSchedule(id: string): KanbanSchedule | null;
  saveSchedule(s: KanbanSchedule): KanbanSchedule;
  deleteSchedule(id: string): void;
  updateLastRun(id: string, at: string): void;
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS kanban_schedules (
  id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL,
  task_template_id TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  input TEXT NOT NULL DEFAULT '',
  last_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedules_root ON kanban_schedules(root_id);
CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON kanban_schedules(enabled);`;

export function createScheduleStore(deps: ScheduleStoreDeps): ScheduleStore {
  const { db } = deps;
  db.exec(SCHEMA);

  function listSchedules(rootId: string): KanbanSchedule[] {
    return (
      db
        .prepare('SELECT * FROM kanban_schedules WHERE root_id = ? ORDER BY created_at ASC')
        .all(rootId) as ScheduleRow[]
    ).map(rowToSchedule);
  }

  function listAllEnabledSchedules(): KanbanSchedule[] {
    return (
      db.prepare('SELECT * FROM kanban_schedules WHERE enabled = 1').all() as ScheduleRow[]
    ).map(rowToSchedule);
  }

  function getSchedule(id: string): KanbanSchedule | null {
    const r = db.prepare('SELECT * FROM kanban_schedules WHERE id = ?').get(id) as
      | ScheduleRow
      | undefined;
    return r ? rowToSchedule(r) : null;
  }

  function saveSchedule(s: KanbanSchedule): KanbanSchedule {
    const exists = !!db.prepare('SELECT 1 FROM kanban_schedules WHERE id = ?').get(s.id);
    if (exists) {
      db.prepare(
        `UPDATE kanban_schedules SET root_id=@rootId, task_template_id=@taskTemplateId, cron_expression=@cronExpression, enabled=@enabled, input=@input, updated_at=@updatedAt WHERE id=@id`,
      ).run({
        id: s.id,
        rootId: s.rootId,
        taskTemplateId: s.taskTemplateId,
        cronExpression: s.cronExpression,
        enabled: s.enabled ? 1 : 0,
        input: s.input,
        updatedAt: new Date().toISOString(),
      });
    } else {
      db.prepare(
        `INSERT INTO kanban_schedules (id, root_id, task_template_id, cron_expression, enabled, input, last_run_at, created_at, updated_at) VALUES (@id,@rootId,@taskTemplateId,@cronExpression,@enabled,@input,@lastRunAt,@createdAt,@updatedAt)`,
      ).run({
        id: s.id,
        rootId: s.rootId,
        taskTemplateId: s.taskTemplateId,
        cronExpression: s.cronExpression,
        enabled: s.enabled ? 1 : 0,
        input: s.input,
        lastRunAt: s.lastRunAt,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      });
    }
    return getSchedule(s.id)!;
  }

  function deleteSchedule(id: string): void {
    db.prepare('DELETE FROM kanban_schedules WHERE id = ?').run(id);
  }

  function updateLastRun(id: string, at: string): void {
    db.prepare('UPDATE kanban_schedules SET last_run_at = ?, updated_at = ? WHERE id = ?').run(
      at,
      at,
      id,
    );
  }

  return {
    listSchedules,
    listAllEnabledSchedules,
    getSchedule,
    saveSchedule,
    deleteSchedule,
    updateLastRun,
  };
}
