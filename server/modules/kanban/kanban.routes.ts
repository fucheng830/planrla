import { Router } from 'express';
import cron from 'node-cron';

import type { KanbanService } from '@/modules/kanban/service.js';
import type { TaskStore } from '@/modules/kanban/store.js';
import type { TemplateStore } from '@/modules/kanban/template-store.js';
import type { ScheduleStore } from '@/modules/kanban/schedule-store.js';
import { broadcastTaskDeleted, broadcastTaskUpdated } from '@/utils/kanban-websocket.js';
import { decomposePrd } from '@/modules/kanban/prd-decompose.js';
import type { Task } from '@/modules/kanban/types.js';
import { notifyUserIfEnabled, createNotificationEvent } from '@/services/notification-orchestrator.js';

export interface KanbanRouterDeps {
  service: KanbanService;
  taskStore: TaskStore;
  templateStore: TemplateStore;
  /** Triggered after any task mutation so the scheduler can admit newly-runnable agent stages. */
  scheduler: { schedule: (rootId: string) => void };
  /** Persistence for cron-driven task schedules (W4-extras). */
  scheduleStore: ScheduleStore;
  /** Reload cron registrations after schedule CRUD. */
  cronDriver: { reload: () => void };
  /** Resolves a root id to its on-disk project path (used as the cwd for
   * PRD decomposition runs). */
  resolveRootPath: (rootId: string) => string | null;
  /** Resolves a pending Claude SDK tool approval (AskUserQuestion). The kanban
   * answer route forwards the user's selected answers here as updatedInput. */
  resolveToolApproval: (requestId: string, decision: { allow: boolean; updatedInput?: unknown; message?: string }) => void;
}

export function createKanbanRouter(deps: KanbanRouterDeps): Router {
  const router = Router();
  const { service, taskStore, templateStore, scheduler, scheduleStore, cronDriver, resolveRootPath, resolveToolApproval } = deps;

  // --- templates (W4) ---
  router.get('/templates', (_req, res) => {
    res.json({ templates: templateStore.listTaskTemplates() });
  });

  router.get('/templates/:id', (req, res) => {
    const tpl = templateStore.getTaskTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ message: 'template not found', code: 'TEMPLATE_NOT_FOUND' });
    res.json({ template: tpl });
  });

  router.post('/templates', (req, res) => {
    try {
      const tpl = templateStore.saveTaskTemplate(req.body);
      res.json({ template: tpl });
    } catch (e: any) {
      const statusCode = e?.statusCode ?? 500;
      res.status(statusCode).json({
        message: e?.message ?? 'failed to save template',
        code: e?.code ?? 'TEMPLATE_SAVE_FAILED',
      });
    }
  });

  router.delete('/templates/:id', (req, res) => {
    templateStore.deleteTaskTemplate(req.params.id);
    res.json({ ok: true });
  });

  // --- schedules (W4-extras: cron-driven task creation) ---
  // NOTE: must come BEFORE /:taskId routes to avoid path collision.
  router.get('/schedules', (req, res) => {
    const rootId = String(req.query.rootId ?? '');
    if (!rootId) return res.status(400).json({ message: 'rootId required' });
    res.json({ schedules: scheduleStore.listSchedules(rootId) });
  });

  router.post('/schedules', (req, res) => {
    const body = req.body ?? {};
    if (!cron.validate(String(body.cronExpression ?? ''))) {
      return res.status(400).json({ message: 'invalid cronExpression', code: 'SCHEDULE_INVALID_CRON' });
    }
    try {
      const sch = scheduleStore.saveSchedule(body);
      cronDriver.reload();
      res.json({ schedule: sch });
    } catch (e: any) {
      res.status(400).json({ message: e?.message ?? 'invalid schedule', code: 'SCHEDULE_INVALID' });
    }
  });

  router.delete('/schedules/:id', (req, res) => {
    scheduleStore.deleteSchedule(req.params.id);
    cronDriver.reload();
    res.json({ ok: true });
  });

  router.get('/', (req, res) => {
    const rootId = String(req.query.rootId ?? '');
    if (!rootId) return res.status(400).json({ message: 'rootId required' });
    res.json({ tasks: service.listTasks(rootId) });
  });

  router.post('/', (req, res) => {
    const { rootId, taskTemplateId, input, priority, dependencies } = req.body ?? {};
    if (!rootId || !taskTemplateId) {
      return res.status(400).json({ message: 'rootId and taskTemplateId required' });
    }
    try {
      const task = service.createTask({ rootId, taskTemplateId, input: input ?? '', priority, dependencies });
      scheduler.schedule(rootId);
      broadcastTaskUpdated(req.app.locals.wss, rootId, task);
      try {
        const userId = (req as any)?.user?.userId ?? null;
        notifyUserIfEnabled({
          userId,
          event: createNotificationEvent({
            provider: 'kanban',
            sessionId: task.id as any,
            kind: 'task_created',
            code: 'kanban.task.created',
            meta: { taskNumber: task.taskNumber, rootId },
            severity: 'info',
          }),
        });
      } catch {
        /* best-effort notification — never break the route */
      }
      res.json({ task });
    } catch (e: any) {
      res.status(e.statusCode ?? 500).json({ message: e.message, code: e.code });
    }
  });

  // PRD -> tasks: decompose a PRD with a provider runtime, then create the
  // resulting tasks with dependencies wired to the freshly created ids.
  router.post('/parse-prd', async (req, res) => {
    const { rootId, taskTemplateId, prd, provider } = req.body ?? {};
    if (!rootId || !taskTemplateId) {
      return res.status(400).json({ message: 'rootId and taskTemplateId required' });
    }
    if (typeof prd !== 'string' || !prd.trim()) {
      return res.status(400).json({ message: 'prd required' });
    }
    try {
      const items = await decomposePrd({
        prd,
        provider: typeof provider === 'string' && provider ? provider : 'claude',
        cwd: resolveRootPath(rootId) ?? undefined,
      });
      const createdIds: string[] = [];
      const createdTasks: Task[] = [];
      for (const item of items) {
        const task = service.createTask({
          rootId,
          taskTemplateId,
          input: item.input,
          priority: item.priority,
          dependencies: item.dependsOn.map((i) => createdIds[i]).filter(Boolean),
        });
        createdIds.push(task.id);
        createdTasks.push(task);
      }
      scheduler.schedule(rootId);
      for (const task of createdTasks) {
        broadcastTaskUpdated(req.app.locals.wss, rootId, task);
      }
      res.json({ tasks: createdTasks, count: createdTasks.length });
    } catch (e: any) {
      res.status(e.statusCode ?? 500).json({ message: e.message, code: e.code });
    }
  });

  const moves = ['next', 'prev', 'pause', 'resume', 'complete', 'cancel', 'fail'] as const;
  for (const action of moves) {
    router.post(`/:taskId/${action}`, (req, res) => handleMove(req, res, action));
  }
  router.post('/:taskId/jump', (req, res) => handleMove(req, res, 'jump', Number(req.body?.targetIndex)));

  // Delete one task with its stage runs/events. Non-terminal tasks are
  // cancelled first (service) so terminal side effects fire before removal.
  router.delete('/:taskId', (req, res) => {
    const rootId = String(req.body?.rootId ?? req.query.rootId ?? '');
    const taskId = req.params.taskId;
    if (!rootId) return res.status(400).json({ message: 'rootId required' });
    try {
      service.deleteTask(rootId, taskId);
      // A cancelled-then-deleted running task freed its scheduler slot.
      scheduler.schedule(rootId);
      broadcastTaskDeleted(req.app.locals.wss, rootId, taskId);
      res.json({ deleted: true, taskId });
    } catch (e: any) {
      res.status(e.statusCode ?? 500).json({ message: e.message, code: e.code });
    }
  });

  // REQ-038: answer a pending AskUserQuestion inline from the kanban board.
  // Resolves the agent's pending tool approval with the user's selected
  // answers as updatedInput, then clears the pending flag so the modal stops
  // showing the question.
  router.post('/:taskId/answer', (req, res) => {
    const taskId = req.params.taskId;
    const rootId = String(req.body?.rootId ?? '');
    if (!rootId) return res.status(400).json({ message: 'rootId required' });
    const task = taskStore.getTask(taskId);
    if (!task || task.rootId !== rootId) {
      return res.status(404).json({ message: 'task not found', code: 'TASK_NOT_FOUND' });
    }
    const pending = task.auxFlags.pendingAskUser;
    if (!pending || !pending.requestId) {
      return res.status(400).json({ message: 'no pending question', code: 'NO_PENDING_QUESTION' });
    }
    try {
      resolveToolApproval(pending.requestId, {
        allow: true,
        updatedInput: req.body?.answers,
      });
      taskStore.updateTaskAuxFlags(taskId, { askUserWaiting: false, pendingAskUser: null });
      const updated = taskStore.getTask(taskId)!;
      broadcastTaskUpdated(req.app.locals.wss, rootId, updated);
      res.json({ task: updated });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? 'answer failed', code: e?.code ?? 'ANSWER_FAILED' });
    }
  });

  function handleMove(req: any, res: any, action: string, targetIndex?: number) {
    const rootId = String(req.body?.rootId ?? '');
    const taskId = req.params.taskId;
    if (!rootId) return res.status(400).json({ message: 'rootId required' });
    try {
      const task = targetIndex !== undefined
        ? (service as any)[action](rootId, taskId, targetIndex)
        : (service as any)[action](rootId, taskId);
      scheduler.schedule(rootId);
      broadcastTaskUpdated(req.app.locals.wss, rootId, task);

      // Notify on terminal / transitional task events (best-effort).
      const notifyActions = ['complete', 'cancel', 'fail', 'next'];
      if (notifyActions.includes(action)) {
        const kind =
          action === 'complete' ? 'task_completed' :
          action === 'cancel' ? 'task_cancelled' :
          action === 'fail' ? 'task_failed' :
          'task_advanced';
        try {
          const userId = (req as any)?.user?.userId ?? null;
          notifyUserIfEnabled({
            userId,
            event: createNotificationEvent({
              provider: 'kanban',
              sessionId: task.id as any,
              kind,
              code: `kanban.task.${kind}`,
              meta: {
                taskNumber: task.taskNumber,
                rootId,
                status: task.status,
                stageIndex: task.currentStageIndex,
              },
              severity: action === 'fail' ? 'error' : 'info',
            }),
          });
        } catch {
          /* best-effort notification — never break the route */
        }
      }

      res.json({ task });
    } catch (e: any) {
      res.status(e.statusCode ?? 500).json({ message: e.message, code: e.code });
    }
  }

  return router;
}
