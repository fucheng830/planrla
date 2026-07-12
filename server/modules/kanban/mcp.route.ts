import { Router } from 'express';
import type { KanbanService } from '@/modules/kanban/service.js';
import type { TaskStore } from '@/modules/kanban/store.js';
import { broadcastTaskUpdated } from '@/utils/kanban-websocket.js';

/**
 * In-process HTTP MCP server for the kanban self-drive agent (W4-T4).
 *
 * Why HTTP instead of stdio: the kanban agent runs inside a git worktree with
 * a `.mcp.json` pointing at this endpoint. Hosting the MCP as an HTTP
 * JSON-RPC route on the planrla server itself keeps everything in-process —
 * no external spawn, no asar path to resolve. The route is mounted BEFORE
 * auth middleware (local-only, single-user) and mirrors the shape of
 * `session-query-mcp.route.ts` (protocol `2024-11-05`, initialize/tools/list/
 * tools/call dispatch).
 *
 * The agent only knows its `taskId` (injected into its prompt by the preamble
 * renderer); this route resolves `rootId` from the task itself via
 * `taskStore.getTask(taskId)` before calling `service.next/prev`.
 */
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'planrla-kanban', version: '0.1.0' } as const;

export interface KanbanMcpDeps {
  /** Lazy getter — keeps getKanban() lazy (called only on tools/call). */
  getKanban: () => { service: KanbanService; taskStore: TaskStore; scheduler: { schedule: (rootId: string) => void } };
}

function textResponse(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function jsonRpc(id: unknown, result: unknown) {
  return { jsonrpc: '2.0' as const, id, result };
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0' as const, id, error: { code, message } };
}

const TOOL_DEFS = [
  {
    name: 'task_next',
    description: 'Advance a planrla kanban task to its next stage. Call when the current stage work is complete.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
  },
  {
    name: 'task_prev',
    description: 'Move a planrla kanban task back to its previous stage.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
  },
  {
    name: 'task_status',
    description: 'Get the current status, stage index, and aux flags of a planrla kanban task.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
  },
] as const;

const KNOWN_TOOLS = new Set(['task_next', 'task_prev', 'task_status']);

export function createKanbanMcpRouter(deps: KanbanMcpDeps): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const msg = req.body ?? {};
    const id = (msg && typeof msg === 'object' && 'id' in msg) ? msg.id : null;

    try {
      if (msg.method === 'initialize') {
        return res.json(jsonRpc(id, {
          protocolVersion: PROTOCOL_VERSION,
          serverInfo: SERVER_INFO,
          capabilities: { tools: {} },
        }));
      }

      if (msg.method === 'tools/list') {
        return res.json(jsonRpc(id, { tools: TOOL_DEFS }));
      }

      if (msg.method === 'tools/call') {
        const name = msg.params?.name;
        const taskId = String(msg.params?.arguments?.taskId ?? '');

        if (!taskId) {
          return res.json(jsonRpcError(id, -32602, 'taskId required'));
        }
        if (!KNOWN_TOOLS.has(name)) {
          return res.json(jsonRpcError(id, -32601, `unknown tool: ${name}`));
        }

        const { service, taskStore, scheduler } = deps.getKanban();
        const task = taskStore.getTask(taskId);
        if (!task) {
          return res.json(jsonRpcError(id, -32602, `task not found: ${taskId}`));
        }
        const rootId = task.rootId;

        if (name === 'task_next') service.next(rootId, taskId);
        else if (name === 'task_prev') service.prev(rootId, taskId);
        // task_status: no mutation

        // After a stage transition, admit any newly-runnable agent stage (e.g. the agent
        // called task_next and landed on another agent stage, or jumped back to one).
        if (name === 'task_next' || name === 'task_prev') {
          scheduler.schedule(rootId);
        }

        const after = taskStore.getTask(taskId);
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          broadcastTaskUpdated((req.app.locals as any).wss, rootId, after ?? task);
        } catch {
          // WebSocket broadcast is best-effort; never fail the MCP call.
        }

        return res.json(jsonRpc(id, textResponse(JSON.stringify({
          taskId,
          status: after?.status,
          stageIndex: after?.currentStageIndex,
          auxFlags: after?.auxFlags,
        }, null, 2))));
      }

      // notifications/* and anything else: best-effort ack
      return res.json(jsonRpc(id, {}));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return res.json(jsonRpcError(id, -32603, message));
    }
  });

  return router;
}
