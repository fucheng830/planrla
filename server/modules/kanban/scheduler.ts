import type { TaskStore } from '@/modules/kanban/store.js';
import type { TemplateStore } from '@/modules/kanban/template-store.js';
import type { Task, TaskStatus } from '@/modules/kanban/types.js';
import { taskPriorityRank } from '@/modules/kanban/types.js';

export interface SchedulerDeps {
  taskStore: TaskStore;
  templateStore: TemplateStore;
  onAdmit: (taskId: string) => void;  // RunTask hook(W3 接 runner)
}

export function createScheduler(deps: SchedulerDeps) {
  const { taskStore, templateStore, onAdmit } = deps;
  const running = new Set<string>();
  const pending = new Set<string>();

  function schedule(rootId: string): void {
    if (running.has(rootId)) {
      pending.add(rootId);
      return;
    }
    running.add(rootId);
    try {
      run(rootId);
      while (pending.has(rootId)) {
        pending.delete(rootId);
        run(rootId);
      }
    } finally {
      running.delete(rootId);
    }
  }

  function run(rootId: string): void {
    // Loop until a full pass admits nothing new. An onAdmit hook may advance a
    // user/autoAdvance stage (service.next resets schedulerAdmitted and moves
    // the task to the next stage at status='queued'), which makes that task
    // eligible for admission again on the very next pass. Re-querying each pass
    // is what lets the scheduler admit the resulting agent stage in the same
    // schedule() call without a re-trigger from the caller. The loop is bounded
    // by the number of stages across all queued tasks (each pass either admits
    // at least one task or terminates).
    let admittedSomething = true;
    while (admittedSomething) {
      admittedSomething = false;
      // Dependency readiness is evaluated once per pass; status changes from
      // this pass's admits are picked up by the next pass's re-query.
      const byId = new Map(taskStore.listTasks(rootId).map((t) => [t.id, t]));
      // Priority first (high > medium > low), then FIFO by creation time.
      const queued = taskStore.listQueuedTasks(rootId)
        .filter((task) => dependenciesMet(task, byId))
        .sort((a, b) =>
          taskPriorityRank(a.priority) - taskPriorityRank(b.priority)
          || a.createdAt.localeCompare(b.createdAt));
      for (const task of queued) {
        if (task.schedulerAdmitted) continue;
        if (isTerminalStatus(task.status)) continue;
        const tpl = templateStore.getTaskTemplate(task.taskTemplateId);
        if (!tpl) continue;
        const all = taskStore.listTasks(rootId);
        if (!hasSlot(task, tpl.maxConcurrency, all)) continue;
        admit(task);
        admittedSomething = true;
        onAdmit(task.id);
      }
    }
  }

  /** A queued task may only be admitted once every dependency reached success. */
  function dependenciesMet(task: Task, byId: Map<string, Task>): boolean {
    for (const depId of task.dependencies ?? []) {
      const dep = byId.get(depId);
      if (!dep || dep.status !== 'success') return false;
    }
    return true;
  }

  function hasSlot(candidate: Task, maxConcurrency: number, all: Task[]): boolean {
    const limit = maxConcurrency > 0 ? maxConcurrency : 1;
    let used = 0;
    for (const t of all) {
      if (t.id === candidate.id) continue;
      if (!t.schedulerAdmitted) continue;
      if (isTerminalStatus(t.status)) continue;
      used++;
    }
    return used < limit;
  }

  function admit(task: Task): void {
    taskStore.updateTaskStage(task.id, task.currentStageIndex, 'running' as TaskStatus);
    taskStore.setSchedulerAdmitted(task.id, true);
  }

  return { schedule };
}

function isTerminalStatus(s: string): boolean {
  return s === 'success' || s === 'fail' || s === 'cancelled';
}
