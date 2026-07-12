import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test from 'node:test';

import { sendWebhook } from '@/services/notification-orchestrator.js';

type CapturedRequest = {
  method?: string;
  url?: string;
  body?: string;
  headers: Record<string, string | string[] | undefined>;
};

async function startCaptureServer(
  onRequest: (req: CapturedRequest) => void,
  status = 200
): Promise<{ server: Server; port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        onRequest({
          method: req.method,
          url: req.url,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: req.headers,
        });
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        server,
        port,
        close: () =>
          new Promise<void>((resolveClose) => server.close(() => resolveClose())),
      });
    });
  });
}

test('sendWebhook POSTs the event JSON to the configured URL', async () => {
  const captured: CapturedRequest[] = [];
  const { port, close } = await startCaptureServer((req) => captured.push(req));

  try {
    const event = {
      provider: 'kanban',
      sessionId: 'task-1',
      kind: 'task_completed',
      code: 'kanban.task.task_completed',
      meta: { taskNumber: 42 },
      severity: 'info',
    };

    await sendWebhook(`http://127.0.0.1:${port}/hook`, event);

    assert.equal(captured.length, 1);
    const req = captured[0];
    assert.equal(req?.method, 'POST');
    assert.equal(req?.url, '/hook');
    assert.equal(req?.headers['content-type'], 'application/json');

    const parsed = JSON.parse(req?.body ?? '{}');
    assert.deepEqual(parsed.event, event);
    assert.equal(typeof parsed.timestamp, 'string');
    // ISO 8601 timestamp
    assert.match(parsed.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await close();
  }
});

test('sendWebhook is best-effort and never throws on an unreachable URL', async () => {
  // Port 1 is reserved/blocked on every OS — connection will fail.
  // The call must resolve (not reject) because webhook delivery is best-effort.
  const event = { provider: 'kanban', kind: 'info', code: 'x', severity: 'info' };
  await assert.doesNotReject(() => sendWebhook('http://127.0.0.1:1/nope', event));
});

test('sendWebhook does not throw when the endpoint returns a non-2xx status', async () => {
  const { port, close } = await startCaptureServer(() => {}, 500);
  try {
    const event = { provider: 'kanban', kind: 'info', code: 'x', severity: 'info' };
    await assert.doesNotReject(() => sendWebhook(`http://127.0.0.1:${port}/hook`, event));
  } finally {
    await close();
  }
});
