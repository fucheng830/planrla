import { Router } from 'express';
import type { KanbanService } from '@/modules/kanban/service.js';
import type { TemplateStore } from '@/modules/kanban/template-store.js';
import { broadcastTaskUpdated } from '@/utils/kanban-websocket.js';

export interface KanbanRouterDeps {
  service: KanbanService;
  templateStore: TemplateStore;
  /** Triggered after any task mutation so the scheduler can admit newly-runnable agent stages. */
  scheduler: { schedule: (rootId: string) => void };
}

export function createKanbanRouter(deps: KanbanRouterDeps): Router {
  const router = Router();
  const { service, templateStore, scheduler } = deps;

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

  router.get('/', (req, res) => {
    const rootId = String(req.query.rootId ?? '');
    if (!rootId) return res.status(400).json({ message: 'rootId required' });
    res.json({ tasks: service.listTasks(rootId) });
  });

  router.post('/', (req, res) => {
    const { rootId, taskTemplateId, input } = req.body ?? {};
    if (!rootId || !taskTemplateId) {
      return res.status(400).json({ message: 'rootId and taskTemplateId required' });
    }
    try {
      const task = service.createTask({ rootId, taskTemplateId, input: input ?? '' });
      scheduler.schedule(rootId);
      broadcastTaskUpdated(req.app.locals.wss, rootId, task);
      res.json({ task });
    } catch (e: any) {
      res.status(e.statusCode ?? 500).json({ message: e.message, code: e.code });
    }
  });

  const moves = ['next', 'prev', 'pause', 'resume', 'complete', 'cancel', 'fail'] as const;
  for (const action of moves) {
    router.post(`/:taskId/${action}`, (req, res) => handleMove(req, res, action));
  }
  router.post('/:taskId/jump', (req, res) => handleMove(req, res, 'jump', Number(req.body?.targetIndex)));

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
      res.json({ task });
    } catch (e: any) {
      res.status(e.statusCode ?? 500).json({ message: e.message, code: e.code });
    }
  }

  return router;
}
