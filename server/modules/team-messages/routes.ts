import { Router } from 'express';

import { broadcastTeamMessage } from '@/utils/kanban-websocket.js';
import { createTeamMessageStore } from './store.js';

// 团队消息 v1: per-project message feed surfaced in the message hub
// (团队消息 category). Local-first — sender is the authenticated user; the
// sync channel can carry these rows later without shape changes.
export function createTeamMessageRouter() {
  const router = Router();
  const store = createTeamMessageStore();

  router.get('/', (req, res) => {
    const rootId = String(req.query.rootId ?? '');
    if (!rootId) return res.status(400).json({ message: 'rootId required' });
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 100) || 100));
    res.json({ messages: store.listMessages(rootId, limit) });
  });

  router.post('/', (req, res) => {
    const { rootId, content, taskId } = req.body ?? {};
    if (!rootId || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ message: 'rootId and non-empty content required' });
    }
    const sender = (req as any)?.user?.username ?? '本地成员';
    const message = store.createMessage({
      rootId: String(rootId),
      sender: String(sender),
      content: content.trim().slice(0, 4000),
      taskId: taskId ? String(taskId) : null,
    });
    broadcastTeamMessage((req.app as any).locals?.wss, message.rootId, message);
    res.status(201).json({ message });
  });

  router.delete('/:id', (req, res) => {
    const rootId = String(req.query.rootId ?? '');
    if (!rootId) return res.status(400).json({ message: 'rootId required' });
    store.deleteMessage(String(req.params.id), rootId);
    res.status(204).end();
  });

  return router;
}
