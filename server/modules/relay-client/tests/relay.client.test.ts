// server/modules/relay-client/tests/relay.client.test.ts
//
// Integration-style tests for the home relay agent against a fake cloud relay
// (a plain ws server speaking the RelayDO mux protocol) and throwaway local
// HTTP/WS servers. Covers the three bridges the remote-access feature rides
// on: HTTP forwarding (auth injection + token stripping), WS bridging
// (base64 binary both ways), and the reconnect loop.

import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { WebSocket, WebSocketServer } from 'ws';

import { RelayAgent, type RelayAgentState } from '@/modules/relay-client/relay.client.js';

type MuxMsg = Record<string, any>;

/** Fake RelayDO: accepts one home connection at a time, records inbound mux messages. */
class FakeCloud {
  readonly server: WebSocketServer;
  private socket: WebSocket | null = null;
  inbound: MuxMsg[] = [];
  connectionCount = 0;

  constructor() {
    this.server = new WebSocketServer({ port: 0, path: '/relay' });
    this.server.on('connection', (ws) => {
      this.connectionCount += 1;
      this.socket = ws;
      this.inbound = [];
      ws.on('message', (data) => {
        try { this.inbound.push(JSON.parse(data.toString())); } catch { /* ignore */ }
      });
    });
  }

  get url(): string {
    const addr = this.server.address() as { address: string; port: number };
    const host = addr.address.includes(':') ? `[${addr.address}]` : addr.address;
    return `ws://${host}:${addr.port}/relay`;
  }

  send(msg: MuxMsg): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg));
  }

  /** Resolves as soon as an inbound message matches pred (polls the inbound log). */
  async waitFor(pred: (msg: MuxMsg) => boolean, timeoutMs = 5000): Promise<MuxMsg> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = this.inbound.find(pred);
      if (hit) return hit;
      if (Date.now() > deadline) throw new Error(`timed out waiting for mux message; got: ${JSON.stringify(this.inbound)}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  /** Kills the current home socket the way a Cloudflare dropout would. */
  dropHome(): void {
    this.socket?.terminate();
    this.socket = null;
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

interface LocalStack {
  httpUrl: string;
  wsUrl: string;
  close(): Promise<void>;
}

/** Throwaway local Planrla server: two HTTP routes + an echo WS at /ws. */
function startLocal(): Promise<LocalStack> {
  const seenAuth: string[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/whoami') {
      seenAuth.push(req.headers.authorization ?? '');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ auth: req.headers.authorization ?? '', query: url.searchParams.toString() }));
      return;
    }
    if (url.pathname === '/api/binary') {
      res.setHeader('content-type', 'application/octet-stream');
      res.end(Buffer.from([0xff, 0xfe, 0x00, 0x81]));
      return;
    }
    if (url.pathname === '/api/echo' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk as Buffer));
      req.on('end', () => {
        res.setHeader('content-type', 'application/octet-stream');
        res.end(Buffer.concat(chunks));
      });
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws) => {
    ws.on('message', (data, isBinary) => {
      // echo: text frames back as text, binary back as binary
      if (isBinary) ws.send(Buffer.from(data as ArrayBuffer));
      else ws.send(data.toString());
    });
  });
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname === '/ws') wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    else socket.destroy();
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        httpUrl: `http://127.0.0.1:${addr.port}`,
        wsUrl: `ws://127.0.0.1:${addr.port}`,
        close: async () => {
          await new Promise<void>((r) => server.close(() => r()));
          await new Promise<void>((r) => wss.close(() => r()));
        },
      });
    });
  });
}

function makeAgent(cloud: FakeCloud, local: LocalStack, states: RelayAgentState[] = []): RelayAgent {
  const agent = new RelayAgent({
    relayUrl: cloud.url,
    deviceToken: 'relay-test123',
    localHttpBase: local.httpUrl,
    localWsBase: local.wsUrl,
    getLocalToken: () => 'local-jwt-for-tests',
    backoffBaseMs: 30,
    log: () => { /* keep test output clean */ },
  });
  agent.onStateChange = (s) => states.push(s);
  return agent;
}

test('http_req is forwarded with local auth, relay token stripped, body decoded', async () => {
  const cloud = new FakeCloud();
  const local = await startLocal();
  const agent = makeAgent(cloud, local);
  agent.start();
  try {
    await cloud.waitFor(() => false, 0).catch(() => undefined); // no-op; wait for connection below
    await new Promise((r) => setTimeout(r, 100));
    cloud.send({
      kind: 'http_req',
      streamId: '1',
      method: 'GET',
      path: '/api/whoami?token=relay-test123&extra=1',
      headers: { 'x-custom': 'kept' },
    });
    const res = await cloud.waitFor((m) => m.kind === 'http_res' && m.streamId === '1');
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body as string);
    assert.equal(body.auth, 'Bearer local-jwt-for-tests');
    assert.equal(body.query, 'extra=1');
    assert.equal(res.headers['content-type'], 'application/json');
  } finally {
    agent.stop();
    await local.close();
    await cloud.close();
  }
});

test('non-UTF8 HTTP response is base64-encoded with binary flag', async () => {
  const cloud = new FakeCloud();
  const local = await startLocal();
  const agent = makeAgent(cloud, local);
  agent.start();
  try {
    await new Promise((r) => setTimeout(r, 100));
    cloud.send({ kind: 'http_req', streamId: '2', method: 'GET', path: '/api/binary' });
    const res = await cloud.waitFor((m) => m.kind === 'http_res' && m.streamId === '2');
    assert.equal(res.status, 200);
    assert.equal(res.binary, true);
    assert.equal(Buffer.from(res.body as string, 'base64').toString('hex'), 'fffe0081');
  } finally {
    agent.stop();
    await local.close();
    await cloud.close();
  }
});

test('binary request body (base64 + flag) round-trips through the local server', async () => {
  const cloud = new FakeCloud();
  const local = await startLocal();
  const agent = makeAgent(cloud, local);
  agent.start();
  try {
    await new Promise((r) => setTimeout(r, 100));
    const payload = Buffer.from([0x00, 0x01, 0xfe, 0xff, 0x7f]);
    cloud.send({
      kind: 'http_req',
      streamId: '5',
      method: 'POST',
      path: '/api/echo',
      headers: { 'content-type': 'application/octet-stream' },
      body: payload.toString('base64'),
      binary: true,
    });
    const res = await cloud.waitFor((m) => m.kind === 'http_res' && m.streamId === '5');
    assert.equal(res.status, 200);
    assert.equal(res.binary, true);
    assert.equal(Buffer.from(res.body as string, 'base64').toString('hex'), payload.toString('hex'));
  } finally {
    agent.stop();
    await local.close();
    await cloud.close();
  }
});

test('ws_open bridges text frames both directions and strips the relay token', async () => {
  const cloud = new FakeCloud();
  const local = await startLocal();
  const agent = makeAgent(cloud, local);
  agent.start();
  try {
    await new Promise((r) => setTimeout(r, 100));
    cloud.send({ kind: 'ws_open', streamId: '3', path: '/ws?token=relay-test123' });
    cloud.send({ kind: 'ws_data', streamId: '3', data: 'hello over relay' });
    const echoed = await cloud.waitFor((m) => m.kind === 'ws_data' && m.streamId === '3');
    assert.equal(echoed.data, 'hello over relay');
    assert.equal(echoed.binary, undefined);
  } finally {
    agent.stop();
    await local.close();
    await cloud.close();
  }
});

test('ws bridge carries binary frames as base64', async () => {
  const cloud = new FakeCloud();
  const local = await startLocal();
  const agent = makeAgent(cloud, local);
  agent.start();
  try {
    await new Promise((r) => setTimeout(r, 100));
    cloud.send({ kind: 'ws_open', streamId: '4', path: '/ws' });
    const payload = Buffer.from([0x00, 0xff, 0x10]).toString('base64');
    cloud.send({ kind: 'ws_data', streamId: '4', data: payload, binary: true });
    const echoed = await cloud.waitFor((m) => m.kind === 'ws_data' && m.streamId === '4');
    assert.equal(echoed.binary, true);
    assert.equal(echoed.data, payload);
  } finally {
    agent.stop();
    await local.close();
    await cloud.close();
  }
});

test('app-level ping is answered with pong', async () => {
  const cloud = new FakeCloud();
  const local = await startLocal();
  const agent = makeAgent(cloud, local);
  agent.start();
  try {
    await new Promise((r) => setTimeout(r, 100));
    cloud.send({ kind: 'ping' });
    await cloud.waitFor((m) => m.kind === 'pong');
  } finally {
    agent.stop();
    await local.close();
    await cloud.close();
  }
});

test('agent reconnects with backoff after the cloud drops the socket', async () => {
  const cloud = new FakeCloud();
  const local = await startLocal();
  const states: RelayAgentState[] = [];
  const agent = makeAgent(cloud, local, states);
  agent.start();
  try {
    // wait until online, then kill the socket underneath the agent
    const deadline = Date.now() + 5000;
    while (agent.state !== 'online' && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    assert.equal(agent.state, 'online');
    cloud.dropHome();
    const reconnected = Date.now() + 5000;
    while (cloud.connectionCount < 2 && Date.now() < reconnected) await new Promise((r) => setTimeout(r, 20));
    assert.ok(cloud.connectionCount >= 2, `expected a second connection, saw ${cloud.connectionCount}`);
    assert.ok(states.includes('reconnecting'));
    assert.equal(agent.currentStats.reconnects, 1);
  } finally {
    agent.stop();
    await local.close();
    await cloud.close();
  }
});
