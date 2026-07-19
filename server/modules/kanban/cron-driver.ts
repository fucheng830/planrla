import * as realCron from 'node-cron';

import type { ScheduleStore } from '@/modules/kanban/schedule-store.js';
import type { KanbanService } from '@/modules/kanban/service.js';

/** The slice of node-cron the driver uses — injectable for tests. */
export interface CronModule {
  schedule: (expr: string, cb: () => void) => { stop: () => void };
  validate: (expr: string) => boolean;
}

export interface CronDriverDeps {
  scheduleStore: ScheduleStore;
  service: KanbanService;
  /**
   * Scheduler used to admit newly created tasks immediately. Without it,
   * cron-created tasks would sit queued until some unrelated schedule() call.
   */
  scheduler?: { schedule: (rootId: string) => void };
  /** Injectable for tests; defaults to the real node-cron. */
  cron?: CronModule;
  log?: (msg: string) => void;
}

export interface KanbanCronDriver {
  /** Load all enabled schedules + register with node-cron. Call once on startup. */
  start(): void;
  /** Destroy all registered tasks + re-register from the store. Call after schedule CRUD. */
  reload(): void;
  /** Stop all scheduled tasks. */
  stop(): void;
}

export function createKanbanCron(deps: CronDriverDeps): KanbanCronDriver {
  const { scheduleStore, service, scheduler, cron = realCron, log = () => {} } = deps;
  const tasks = new Map<string, { stop: () => void }>();

  function trigger(
    scheduleId: string,
    rootId: string,
    taskTemplateId: string,
    input: string,
  ): void {
    try {
      service.createTask({ rootId, taskTemplateId, input });
      scheduleStore.updateLastRun(scheduleId, new Date().toISOString());
      // Admit the fresh task right away; otherwise it would wait for the next
      // unrelated schedule() tick (route, MCP tool, or another cron fire).
      scheduler?.schedule(rootId);
      log(`[kanban-cron] triggered schedule=${scheduleId}`);
    } catch (e: any) {
      log(`[kanban-cron] trigger failed schedule=${scheduleId}: ${e?.message ?? e}`);
    }
  }

  function registerOne(s: {
    id: string;
    rootId: string;
    taskTemplateId: string;
    cronExpression: string;
    input: string;
  }): boolean {
    if (!cron.validate(s.cronExpression)) {
      log(`[kanban-cron] skip invalid expr schedule=${s.id} expr=${s.cronExpression}`);
      return false;
    }
    const task = cron.schedule(s.cronExpression, () =>
      trigger(s.id, s.rootId, s.taskTemplateId, s.input),
    );
    tasks.set(s.id, task);
    log(`[kanban-cron] registered schedule=${s.id} expr=${s.cronExpression}`);
    return true;
  }

  function start(): void {
    for (const s of scheduleStore.listAllEnabledSchedules()) {
      registerOne(s);
    }
  }

  function reload(): void {
    for (const t of tasks.values()) t.stop();
    tasks.clear();
    start();
  }

  function stop(): void {
    for (const t of tasks.values()) t.stop();
    tasks.clear();
  }

  return { start, reload, stop };
}
