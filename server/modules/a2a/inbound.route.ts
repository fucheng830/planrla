// server/modules/a2a/inbound.route.ts
//
// A2A inbound HTTP router (REQ-020 S2, Task 4).
//
// Receives A2A 0.2.0 JSON-RPC calls from a *trusted remote agent* over the
// loopback-only listener and dispatches them to the inbound service. This is
// the counterpart to S1's `mcp.route.ts` (which exposes planrla's A2A *out*
// tools to our own provider CLI agent). Where S1 was about planrla calling
// other agents, this route is about other agents calling planrla.
//
// Security posture (mirrors S1 mcp.route.ts):
//   - Loopback-only guard: 127.0.0.1 / ::1 / ::ffff:127.0.0.1. Anything else
//     gets a 403 before any handler runs.
//   - Per-IP rate limit via the shared RateLimiter (default 20 / 60s). Over
//     the limit gets a 429.
//   - This route is mounted BEFORE auth (remote agents carry no planrla JWT);
//     the loopback guard is the trust boundary, exactly like /api/mcp/a2a.
//
// JSON-RPC dispatch (hermes-a2a server.py shape):
//   - GET  /.well-known/agent.json  → Agent Card (buildAgentCard).
//   - POST /  with method:
//       tasks/send    → handleTaskSend → envelope { id, status.state, artifacts }
//       tasks/get     → getTask        → same envelope, or -32602 if unknown.
//       tasks/cancel  → cancelTask     → { id, status.state: canceled }.
//       anything else → -32601 unknown method.
//
// Body parsing: the global express.json() mounted in server/index.js (before
// this router) parses the JSON-RPC request body — same pattern as the kanban
// and a2a MCP routes.

import { Router } from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildAgentCard, handleTaskSend, getTask, cancelTask } from './inbound.service.js';
import { RateLimiter } from './inbound.security.js';

const limiter = new RateLimiter(20, 60_000);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the planrla package version from package.json.
 *
 * Reads up the tree from this module until a package.json with a `version`
 * field is found. This is robust to both layouts: source (`server/modules/a2a/`)
 * and compiled (`dist-server/server/modules/a2a/`) — the latter sits one level
 * deeper relative to the project root, so a fixed `../../../package.json` would
 * point at `dist-server/package.json` and miss.
 */
function resolvePackageVersion(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    try {
      const pkgPath = path.join(dir, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (typeof pkg?.version === 'string') return pkg.version;
    } catch {
      // not found / unparseable at this level — keep walking up.
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}

const PKG_VERSION = resolvePackageVersion();

/** Loopback addresses we accept traffic from (IPv4 + IPv4-mapped IPv6 + IPv6). */
const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Builds the A2A task-artifact envelope returned for send / get / cancel. */
function taskEnvelope(taskId: string, state: string, text: string) {
  return {
    id: taskId,
    status: { state },
    artifacts: text ? [{ parts: [{ type: 'text' as const, text }] }] : [],
  };
}

export function createA2aInboundRouter(port: number, getUserId: () => number): Router {
  const router = Router();

  // Loopback guard + per-IP rate limit. Mounted before any handler so a
  // non-local caller or a flood never reaches the service layer.
  router.use((req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || '';
    if (!LOOPBACK_IPS.has(ip)) {
      return res.status(403).json({ error: 'loopback only' });
    }
    if (!limiter.allow(ip)) {
      return res.status(429).json({ error: 'rate limit' });
    }
    next();
  });

  // Agent Card discovery endpoint (A2A spec: /.well-known/agent.json).
  router.get('/.well-known/agent.json', (_req, res) => {
    res.json(buildAgentCard(port, PKG_VERSION));
  });

  router.post('/', async (req, res) => {
    const msg = req.body || {};
    const id = msg.id;

    // tasks/send — delegate the prompt to a planrla session agent.
    if (msg.method === 'tasks/send') {
      const r = await handleTaskSend(msg.params || {}, getUserId());
      const rpcResult: any = taskEnvelope(r.taskId, r.state, r.text);
      if (r.error) rpcResult.error = { code: -32000, message: r.error };
      return res.json({ jsonrpc: '2.0', id, result: rpcResult });
    }

    // tasks/get — poll a task's state (remote agent retry loop).
    if (msg.method === 'tasks/get') {
      const t = getTask(msg.params?.id);
      if (!t) {
        return res.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'task not found' },
        });
      }
      return res.json({ jsonrpc: '2.0', id, result: taskEnvelope(t.id, t.state, t.text) });
    }

    // tasks/cancel — mark a task canceled (S2 does not abort the run).
    if (msg.method === 'tasks/cancel') {
      cancelTask(msg.params?.id);
      return res.json({
        jsonrpc: '2.0',
        id,
        result: { id: msg.params?.id, status: { state: 'canceled' } },
      });
    }

    // Unknown method.
    res.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `unknown method: ${msg.method}` },
    });
  });

  return router;
}
