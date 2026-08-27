import { Router } from 'express';

import { broadcastTeamMessage } from '@/utils/kanban-websocket.js';
import { createTeamMessageStore } from './store.js';

// 消息网关接入(模拟外部渠道 webhook):外部系统 POST 消息进来 → 落库 →
// WS 广播进消息盒子。鉴权用 x-gateway-token 对比 MESSAGE_GATEWAY_TOKEN;
// 未配置 token 时放行(默认只绑 127.0.0.1,开发态),生产必须配置。

export function verifyGatewayToken(req: any): boolean {
  const expected = process.env.MESSAGE_GATEWAY_TOKEN;
  if (!expected) return true; // dev: local-only binding
  return req?.headers?.['x-gateway-token'] === expected;
}

/** Stable thread key so the same contact+channel groups into one conversation. */
export function normalizeThreadKey(channel: string, sender: string, threadKey?: unknown): string {
  const explicit = typeof threadKey === 'string' && threadKey.trim();
  return explicit ? `gw:${explicit.trim().slice(0, 120)}` : `gw:${channel}:${sender}`;
}

export function createGatewayIngestRouter(deps: { store: ReturnType<typeof createTeamMessageStore> }) {
  const router = Router();

  router.post('/messages', (req, res) => {
    if (!verifyGatewayToken(req)) {
      return res.status(401).json({ message: 'invalid gateway token' });
    }
    const { rootId, channel, sender, content, threadKey, taskId } = req.body ?? {};
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ message: 'content required' });
    }
    const effectiveChannel = String(channel ?? '其他').slice(0, 30);
    const effectiveSender = String(sender ?? '客户').trim().slice(0, 60) || '客户';
    const message = deps.store.createMessage({
      rootId: String(rootId ?? 'gateway'),
      kind: 'customer',
      channel: effectiveChannel,
      threadId: normalizeThreadKey(effectiveChannel, effectiveSender, threadKey),
      sender: effectiveSender,
      content: content.trim().slice(0, 4000),
      taskId: taskId ? String(taskId) : null,
    });
    broadcastTeamMessage((req.app as any).locals?.wss, message.rootId, message);
    res.status(201).json({ message });
  });

  return router;
}
