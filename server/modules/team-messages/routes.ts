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
    const kindParam = req.query.kind === 'customer' || req.query.kind === 'team' ? req.query.kind : undefined;
    res.json({ messages: store.listMessages(rootId, limit, kindParam as 'team' | 'customer' | undefined) });
  });

  router.post('/', (req, res) => {
    const { rootId, content, taskId, kind, channel, threadId, sender, asMember } = req.body ?? {};
    if (!rootId || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ message: 'rootId and non-empty content required' });
    }
    // 团队消息/asMember 的发送人固定为登录用户;客户消息允许登记外部联系人。
    const isCustomer = kind === 'customer';
    const effectiveSender = (!isCustomer || asMember)
      ? ((req as any)?.user?.username ?? '本地成员')
      : String(sender ?? '').trim().slice(0, 60) || '';
    if (isCustomer && !effectiveSender) {
      return res.status(400).json({ message: 'customer messages require a contact name (sender)' });
    }
    const message = store.createMessage({
      rootId: String(rootId),
      kind: isCustomer ? 'customer' : 'team',
      channel: channel ? String(channel).slice(0, 30) : null,
      threadId: threadId ? String(threadId) : null,
      sender: effectiveSender,
      content: content.trim().slice(0, 4000),
      taskId: taskId ? String(taskId) : null,
    });
    broadcastTeamMessage((req.app as any).locals?.wss, message.rootId, message);
    // 出站转发:客户消息的我方回复推给网关(真实渠道下发由网关适配)。best-effort。
    if (isCustomer && asMember && process.env.MESSAGE_GATEWAY_OUTBOUND_URL) {
      void fetch(process.env.MESSAGE_GATEWAY_OUTBOUND_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.MESSAGE_GATEWAY_TOKEN ? { 'x-gateway-token': process.env.MESSAGE_GATEWAY_TOKEN } : {}),
        },
        body: JSON.stringify({
          event: 'message.outbound',
          rootId: message.rootId,
          channel: message.channel,
          threadKey: message.threadId,
          sender: message.sender,
          content: message.content,
        }),
      }).catch(() => { /* gateway may be absent in dev */ });
    }
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
