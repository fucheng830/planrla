export interface KanbanSchedule {
  id: string;
  rootId: string;
  taskTemplateId: string;
  cronExpression: string; // e.g. "0 9 * * *"
  enabled: boolean;
  input: string;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleRow {
  id: string;
  root_id: string;
  task_template_id: string;
  cron_expression: string;
  enabled: number; // 0/1
  input: string;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export function rowToSchedule(r: ScheduleRow): KanbanSchedule {
  return {
    id: r.id,
    rootId: r.root_id,
    taskTemplateId: r.task_template_id,
    cronExpression: r.cron_expression,
    enabled: !!r.enabled,
    input: r.input,
    lastRunAt: r.last_run_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
