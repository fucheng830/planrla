// server/modules/kanban/runner-writer.ts
//
// RunnerWriter implements the minimal writer contract the spawnFns
// (server/claude-sdk.js, server/cursor-cli.js, server/openai-codex.js,
// server/gemini-cli.js, server/opencode-cli.js) expect from their `writer`
// argument:
//   - send(data):           receive a JSON message (string or object)
//   - setSessionId(sid):    provider records its session id on the writer
//   - updateWebSocket():    no-op for runners (runner is not bound to a ws);
//                           chat path calls writer.updateWebSocket(newRawWs)
//                           on reconnect, see claude-sdk.js:880
//   - isWebSocketWriter:    truthy flag the chat orchestrator branches on
//   - userId:               populated by the caller (here just a nullable slot)
//
// Unlike the chat path's WebSocket writer, RunnerWriter does NOT own a ws.
// It fans each `send` out to:
//   1. the AuxBridge (so kanban aux flags reflect provider events), and
//   2. lifecycle hooks (onProviderSessionId / onComplete / onError) the
//      runner wires up to persist session keys and drive state-machine
//      transitions.
//
// Keeping this writer self-contained (no ws, no Express dep) is what lets
// the scheduler/runner execute a stage outside the HTTP request that
// originally admitted it.

import type { AuxBridge } from '@/modules/kanban/aux-bridge.js';

export interface RunnerWriterOptions {
  taskId: string;
  auxBridge: AuxBridge;
  onProviderSessionId?: (sid: string) => void;
  onComplete?: () => void;
  onError?: (msg: any) => void;
}

export class RunnerWriter {
  /** SpawnFn orchestrator branches on this flag (see chat handler usage). */
  isWebSocketWriter = true;
  /** Populated by the runner if/when it binds an owning user; nullable otherwise. */
  userId: string | null = null;
  private providerSessionId: string | null = null;

  constructor(private opts: RunnerWriterOptions) {}

  /**
   * Entry point invoked by spawnFns with each outbound JSON message.
   * Accepts either a pre-parsed object or a JSON string (spawnFns use both
   * conventions depending on the provider).
   */
  send(data: unknown): void {
    let msg: any;
    try {
      msg = typeof data === 'string' ? JSON.parse(data) : data;
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    // 1. Mirror every event into the aux bridge (drives TaskAuxFlags).
    this.opts.auxBridge.handle(this.opts.taskId, msg);

    // 2. Lifecycle hooks keyed on well-known message kinds.
    if (msg.kind === 'session_created' && msg.sessionId) {
      this.providerSessionId = msg.sessionId;
      this.opts.onProviderSessionId?.(msg.sessionId);
    }
    if (msg.kind === 'complete') this.opts.onComplete?.();
    if (msg.kind === 'error') this.opts.onError?.(msg);
  }

  /** Provider records its session id on the writer (see claude-sdk.js:696). */
  setSessionId(sid: string): void {
    this.providerSessionId = sid;
    this.opts.onProviderSessionId?.(sid);
  }

  /** Read-side accessor for the runner to persist the session key. */
  getSessionId(): string | null {
    return this.providerSessionId;
  }

  /**
   * No-op for the runner path. The chat path's writer owns a raw ws and
   * swaps it on reconnect (claude-sdk.js:880); the runner has no ws to
   * swap, so we intentionally do nothing here.
   */
  updateWebSocket(): void {
    // no-op
  }
}
