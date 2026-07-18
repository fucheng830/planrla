// server/modules/a2a/a2a-inbound-writer.ts
//
// A2AInboundWriter implements the minimal writer contract every provider
// spawnFn (server/claude-sdk.js, server/cursor-cli.js, server/openai-codex.js,
// server/gemini-cli.js, server/opencode-cli.js, server/kimi-cli.js) expects
// from its `writer` argument. It mirrors the subset kanban's RunnerWriter
// exposes (server/modules/kanban/runner-writer.ts):
//   - send(msg):           receive a JSON message (object or JSON string)
//   - setSessionId(sid):   provider records its session id on the writer
//   - updateWebSocket():   no-op (inbound runs outside any ws)
//   - isWebSocketWriter:   flag the spawnFn orchestrator branches on
//   - userId:              owning user slot (loopback inbound has no user)
//
// Unlike RunnerWriter (which fans events into an AuxBridge + lifecycle hooks),
// A2AInboundWriter's only job is to BUFFER the assistant's textual reply and
// resolve a promise on completion so inbound.service can return the text to
// the remote A2A caller.
//
// Confirmed emit contract (server/claude-sdk.js + claude-sessions.provider.ts
// normalizeMessage + shared/utils.ts createCompleteMessage):
//   - stream_delta : { kind: 'stream_delta', content: string }   (incremental)
//   - text         : { kind: 'text', role: 'assistant', content: string }
//   - error        : { kind: 'error', content: string }
//   - complete     : { kind: 'complete', exitCode: number, success: boolean, aborted?: boolean }
// Provider runtimes always emit `kind` (never `type`); the final frame is
// exactly one `complete` (success unless abort-session already emitted one).

/** Outcome of a single inbound A2A run, handed back to inbound.service. */
export interface A2aInboundResult {
  text: string;
  error?: string;
}

export class A2AInboundWriter {
  /** SpawnFn orchestrator branches on this flag (kept truthy to match RunnerWriter). */
  readonly isWebSocketWriter = true;
  /** Loopback inbound has no owning user; provider runtimes only read it for telemetry. */
  readonly userId: string | number = 0;

  private chunks: string[] = [];
  private resolveDone?: (r: A2aInboundResult) => void;
  private timer?: NodeJS.Timeout;
  private done = false;

  /**
   * Entry point invoked by spawnFns with each outbound normalized message.
   * Accepts a pre-parsed object or a JSON string (spawnFns use both).
   */
  send(data: unknown): void {
    if (this.done) return;

    let msg: Record<string, any>;
    try {
      msg = typeof data === 'string' ? JSON.parse(data) : (data as Record<string, any>);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    const kind = msg.kind;

    // Assistant text. Both streaming deltas and finalized text blocks carry
    // the payload in `content`. We accumulate assistant-authored text only;
    // user/text echoes (role === 'user') are the inbound prompt bouncing back
    // and must not contaminate the reply.
    if (kind === 'stream_delta' && typeof msg.content === 'string') {
      this.chunks.push(msg.content);
      return;
    }
    if (
      kind === 'text' &&
      typeof msg.content === 'string' &&
      msg.role !== 'user'
    ) {
      this.chunks.push(msg.content);
      return;
    }

    if (kind === 'error') {
      this.finish({
        text: this.chunks.join('').trim(),
        error: String(msg.content ?? msg.error ?? msg.message ?? 'provider error'),
      });
      return;
    }

    if (kind === 'complete') {
      // aborted runs surface via aborted:true; treat as a non-fatal short reply.
      const aborted = msg.aborted === true;
      this.finish({
        text: this.chunks.join('').trim(),
        error: aborted ? 'aborted' : undefined,
      });
    }
  }

  /** Provider records its session id here (see claude-sdk.js:700). */
  setSessionId(_sid: string): void {
    // Session persistence for inbound is owned by sessionsDb, not this writer.
  }

  /** No-op for the inbound path (no raw ws to swap, unlike the chat path). */
  updateWebSocket(): void {
    // no-op
  }

  /**
   * Resolves when the provider emits `complete`/`error`, or when `timeoutMs`
   * elapses — whichever is first. Caller (inbound.service) awaits this to
   * harvest the reply text.
   */
  waitComplete(timeoutMs: number): Promise<A2aInboundResult> {
    return new Promise<A2aInboundResult>((resolve) => {
      this.resolveDone = resolve;
      this.timer = setTimeout(() => {
        if (!this.done) {
          this.finish({
            text: this.chunks.join('').trim(),
            error: 'timeout',
          });
        }
      }, timeoutMs);
    });
  }

  private finish(r: A2aInboundResult): void {
    if (this.done) return;
    this.done = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.resolveDone?.(r);
  }
}
