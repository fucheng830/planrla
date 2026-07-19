// server/modules/a2a/inbound.service.ts
//
// A2A inbound entry point: receives a JSON-RPC `message/send` (A2A 0.2.0)
// from a trusted remote agent (loopback only — the HTTP route in mcp.route.ts
// restricts the listener to 127.0.0.1), and delegates the prompt to a planrla
// session's provider runtime exactly the way the chat websocket path does —
// minus the live websocket fanout.
//
// Flow:
//   1. Validate + sanitize the inbound prompt (inbound.security.ts).
//   2. Resolve the target app session row (sessionsDb.getSessionById) to learn
//      its provider / provider-native id / project path.
//   3. Acquire the session run lock via chatRunRegistry.startRun — this is the
//      SAME lock the chat websocket path takes, so an A2A delegation and a
//      human chat send on the same session can never run concurrently. Busy →
//      return state="working" so the remote agent retries per A2A semantics.
//   4. Drive spawnFns[provider] with an A2AInboundWriter that buffers the
//      assistant reply instead of pushing it to a websocket.
//   5. await writer.waitComplete(timeout) → filter the reply through the
//      outbound redactor (filterOutbound) → record the task in the in-memory
//      task store and return the A2A task envelope.
//   6. Always release the lock (chatRunRegistry.completeRun) in `finally`.
//
// Why startRun needs a fake connection: chatRunRegistry.startRun mints a
// ChatSessionWriter bound to a RealtimeClientConnection and uses it to relay
// events to a websocket client. The A2A inbound path has no websocket — we
// hand the spawnFn our OWN writer (A2AInboundWriter) so registry's writer is
// never actually fed by the runtime. A no-op stub connection satisfies the
// type; any residual send on it (the synthetic complete) is silently dropped.

import { randomUUID } from 'node:crypto';

import { spawnFns } from '../providers/spawn-fns.js';
import { sessionsDb } from '../database/index.js';
import { chatRunRegistry } from '../websocket/services/chat-run-registry.service.js';
import type { RealtimeClientConnection } from '@/shared/types.js';
import { A2AInboundWriter } from './a2a-inbound-writer.js';
import { sanitizeInbound } from './inbound.security.js';
import { filterOutbound } from './a2a-client.service.js';

/** Upper bound on a single inbound run. Mirrors a2a-client DEFAULT_TIMEOUT_MS. */
const RESPONSE_TIMEOUT_MS = 120_000;
/** Permission mode mirrored from kanban runner — inbound runs unattended. */
const PERMISSION_MODE = 'bypassPermissions';

/** A2A task states (subset of the spec's lifecycle we actually emit). */
type TaskState = 'working' | 'completed' | 'failed' | 'canceled';

interface Task {
  id: string;
  state: TaskState;
  text: string;
  error?: string;
  createdAt: number;
}

/** In-memory task store. Sufficient for S2 (single-process loopback). */
const tasks = new Map<string, Task>();

/**
 * No-op websocket stub. chatRunRegistry.startRun requires a
 * RealtimeClientConnection to construct its ChatSessionWriter; the A2A path
 * never feeds that writer (the spawnFn is handed an A2AInboundWriter), so any
 * `send` on this stub is a no-op. readyState mirrors a closed socket so the
 * registry never assumes an active peer.
 */
const STUB_CONNECTION: RealtimeClientConnection = {
  readyState: 3, // CLOSED — there is no live ws peer for inbound.
  send() {
    /* no-op: A2A inbound has no realtime client. */
  },
};

/**
 * Builds the Agent Card advertised at `/.well-known/agent-card.json`
 * (and GET /api/a2a). Capabilities are constrained to what the loopback
 * inbound path actually supports today.
 */
export function buildAgentCard(port: number, version: string) {
  return {
    name: 'planrla',
    description: 'Planrla project AI workbench (A2A inbound, loopback only)',
    url: `http://127.0.0.1:${port}/api/a2a`,
    version,
    protocol: 'a2a',
    protocolVersion: '0.2.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      multiTurn: true,
      structuredMetadata: true,
    },
    skills: [
      {
        id: 'general',
        name: 'General Assistant',
        description: 'Delegate a task to a planrla session agent',
      },
    ],
    authentication: {},
  };
}

export interface SendResult {
  taskId: string;
  state: TaskState;
  text: string;
  error?: string;
}

interface TaskSendParams {
  message?: {
    parts?: Array<{ type: string; text?: string }>;
  };
  metadata?: {
    sessionId?: string;
  };
}

/**
 * Handle a `message/send`: sanitize → resolve session → acquire lock → spawn
 * provider runtime → await completion → redact → persist task → release lock.
 *
 * @param params  A2A `message/send` params (text parts + metadata.sessionId).
 * @param userId  Authenticated user id (reserved for future per-user scoping).
 */
export async function handleTaskSend(
  params: TaskSendParams,
  userId: number,
): Promise<SendResult> {
  void userId; // reserved: inbound currently binds the session, not the caller.

  const rawText = (params.message?.parts ?? [])
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('\n')
    .trim();
  if (!rawText) {
    return { taskId: '', state: 'failed', text: '', error: 'empty message' };
  }
  const sanitized = sanitizeInbound(rawText);

  const sessionId = params.metadata?.sessionId;
  if (!sessionId) {
    return { taskId: '', state: 'failed', text: '', error: 'metadata.sessionId required' };
  }

  const session = sessionsDb.getSessionById(sessionId);
  if (!session) {
    return { taskId: '', state: 'failed', text: '', error: 'session not found' };
  }
  // S3 whitelist: only sessions explicitly marked a2a_exposed may receive
  // inbound delegations. Gate before acquiring the run lock so a rejected
  // request never blocks the chat websocket path.
  if (!session.a2a_exposed) {
    return { taskId: '', state: 'failed', text: '', error: 'session not exposed for A2A delegation' };
  }

  // Acquire the shared chat-run lock. Returns null if a run (chat or A2A) is
  // already in flight on this session — surface as A2A state=working so the
  // remote agent polls tasks/get until the slot frees.
  const run = chatRunRegistry.startRun({
    appSessionId: sessionId,
    provider: session.provider as any,
    providerSessionId: session.provider_session_id,
    connection: STUB_CONNECTION,
    userId: null,
  });
  if (!run) {
    return {
      taskId: '',
      state: 'working',
      text: '',
      error: 'Agent busy (session has an active run)',
    };
  }

  const taskId = randomUUID();
  const task: Task = { id: taskId, state: 'working', text: '', createdAt: Date.now() };
  tasks.set(taskId, task);

  const writer = new A2AInboundWriter();
  try {
    const spawnFn = spawnFns[session.provider];
    if (!spawnFn) {
      throw new Error(`provider "${session.provider}" not supported`);
    }

    // Mirror kanban runner's spawnFn call shape (server/modules/kanban/runner.ts
    // L155-163): sessionId = provider-native id, cwd/projectPath = project_path.
    spawnFn(
      sanitized,
      {
        sessionId: session.provider_session_id ?? undefined,
        cwd: session.project_path ?? undefined,
        projectPath: session.project_path ?? undefined,
        permissionMode: PERMISSION_MODE,
      },
      writer,
    ).catch((e: unknown) => {
      // Provider rejected synchronously after start — surface as an error
      // frame so waitComplete resolves with error rather than hanging to timeout.
      const message = e instanceof Error ? e.message : String(e);
      writer.send({ kind: 'error', content: message });
    });

    const result = await writer.waitComplete(RESPONSE_TIMEOUT_MS);

    if (result.error === 'timeout') {
      task.state = 'working'; // remote agent should keep polling.
      task.text = filterOutbound(result.text);
    } else if (result.error) {
      task.state = 'failed';
      task.text = filterOutbound(result.text);
      task.error = result.error;
    } else {
      task.state = 'completed';
      task.text = filterOutbound(result.text);
    }
  } catch (e: unknown) {
    task.state = 'failed';
    task.error = e instanceof Error ? e.message : String(e);
  } finally {
    // Release the shared lock. completeRun flips status to completed and emits
    // a synthetic terminal `complete` on the run's writer (dropped by our stub
    // connection). After this the session is eligible for another run.
    chatRunRegistry.completeRun(sessionId, { exitCode: task.state === 'failed' ? 1 : 0 });
  }

  return { taskId, state: task.state, text: task.text, error: task.error };
}

/** Returns the current task envelope, or undefined if unknown / evicted. */
export function getTask(taskId: string): Task | undefined {
  return tasks.get(taskId);
}

/** Marks a task canceled. The provider run itself is not aborted (S2 scope). */
export function cancelTask(taskId: string): boolean {
  const t = tasks.get(taskId);
  if (!t) return false;
  t.state = 'canceled';
  return true;
}
