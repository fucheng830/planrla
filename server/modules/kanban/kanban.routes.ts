import { Router } from 'express';
import type { KanbanService } from '@/modules/kanban/service.js';
import { broadcastTaskUpdated } from '@/utils/kanban-websocket.js';

export interface KanbanRouterDeps {
  service: KanbanService;
}

export function createKanbanRouter(deps: KanbanRouterDeps): Router {
  const router = Router();
  const { service } = deps;

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
      broadcastTaskUpdated(req.app.locals.wss, rootId, task);
      res.json(task);
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
      broadcastTaskUpdated(req.app.locals.wss, rootId, task);
      res.json(task);
    } catch (e: any) {
      res.status(e.statusCode ?? 500).json({ message: e.message, code: e.code });
    }
  }

  return router;
}
