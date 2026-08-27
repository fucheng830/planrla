// Mock 外部渠道网关:向 /api/gateway/messages 推送样本消息,
// 模拟企业微信/Slack webhook 的行为。用法:
//   node debug/mock-gateway-push.mjs [rootId]
import { randomUUID } from 'node:crypto';

const BASE = process.env.SERVER_URL ?? 'http://127.0.0.1:3011';
const rootId = process.argv[2] ?? 'gateway';

async function push(message) {
  const res = await fetch(`${BASE}/api/gateway/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.MESSAGE_GATEWAY_TOKEN ? { 'x-gateway-token': process.env.MESSAGE_GATEWAY_TOKEN } : {}),
    },
    body: JSON.stringify({ rootId, ...message }),
  });
  const body = await res.json().catch(() => ({}));
  console.log(res.status, message.channel, message.sender, '→', body.message?.id ?? JSON.stringify(body));
  return body.message;
}

console.log('pushing mock gateway messages, rootId =', rootId);
const thread = `wecom:wang-${randomUUID().slice(0, 8)}`;
await push({ channel: '企业微信', sender: '王先生', content: '在吗?想确认一下企业版的部署周期', threadKey: thread });
await push({ channel: '企业微信', sender: '王先生', content: '另外报价单能发我一份吗', threadKey: thread });
await push({ channel: 'Slack', sender: 'Johnson', content: 'Integration stuck on OAuth redirect, any idea?' });
console.log('done — 打开消息盒子「客户消息」查看');
