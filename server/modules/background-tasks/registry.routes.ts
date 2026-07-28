// server/modules/background-tasks/registry.routes.ts
//
// REQ-046 — REST 路由:`GET /api/background-tasks` + `POST /:id/{stop|dismiss}`。
//
// mount:server/index.js `app.use('/api/background-tasks', authenticateToken, bgTaskRoutes)`。
// 广播走 registry 内部(producer 调 upsert 时已 broadcast),路由只做查询 + 控制。

import { Router } from 'express';
import { backgroundTaskRegistry } from './registry.service.js';
import { parseBackgroundTaskId } from './types.js';

export function createBackgroundTaskRouter(): Router {
  const router = Router();

  /** GET /api/background-tasks — 全量列表(按 lastActivityAt desc)。 */
  router.get('/', (_req, res) => {
    const tasks = backgroundTaskRegistry.list();
    res.json({ tasks });
  });

  /** POST /api/background-tasks/:id/stop — 停止(running/idle 可停;bash 走 SDK stopTask)。 */
  router.post('/:id/stop', async (req, res) => {
    const id = String(req.params.id ?? '');
    const parsed = parseBackgroundTaskId(id);
    if (!parsed) {
      res.status(400).json({ message: 'invalid task id' });
      return;
    }
    const before = backgroundTaskRegistry.get(id);
    if (!before) {
      res.status(404).json({ message: 'task not found' });
      return;
    }
    const { task, error } = await backgroundTaskRegistry.stopTask(id);
    if (error && !task) {
      res.status(400).json({ message: error });
      return;
    }
    res.json({ task });
  });

  /** POST /api/background-tasks/:id/dismiss — 前端主动从面板移除(仅终态)。 */
  router.post('/:id/dismiss', (req, res) => {
    const id = String(req.params.id ?? '');
    const task = backgroundTaskRegistry.get(id);
    if (!task) {
      res.status(404).json({ message: 'task not found' });
      return;
    }
    // 仅终态可 dismiss(running 先 stop)
    if (task.status === 'running' || task.status === 'idle') {
      res.status(400).json({ message: 'task is still running; stop it first' });
      return;
    }
    backgroundTaskRegistry.remove(id);
    res.json({ ok: true });
  });

  return router;
}

export const backgroundTaskRoutes = createBackgroundTaskRouter();
