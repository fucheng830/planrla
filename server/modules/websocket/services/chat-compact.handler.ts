import type { WebSocket } from 'ws';

import { sessionsDb } from '@/modules/database/index.js';
import { providerCapabilitiesService } from '@/modules/providers/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import type { AnyRecord, LLMProvider } from '@/shared/types.js';
import { readRequiredSessionId, sendProtocolError } from '@/modules/websocket/services/chat-protocol.utils.js';
import type { ChatWebSocketDependencies } from '@/modules/websocket/services/chat-websocket.types.js';

/**
 * Handles `chat.compact` (REQ-052): compresses a session's context by running
 * the provider runtime's built-in `/compact` slash command through the exact
 * same per-turn query infrastructure as `chat.send` (run registry mutex,
 * terminal `complete` frame, `token_budget` pushes, transcript persistence).
 *
 * The CLI summarizes the conversation history and replaces it with the
 * summary, shrinking the context window for subsequent turns — verified by
 * debug/verify-compact-sdk.mjs (compact_boundary pre_tokens 51k → post 2.4k).
 * Compaction is a provider capability: only runtimes that process `/compact`
 * headlessly pass the `supportsCompact` check.
 *
 * Lives in its own file to keep chat-websocket.service.ts under the 500-line
 * hygiene limit (spec REQ-052 §4.3 R5 fallback).
 */
export async function handleChatCompact(
  ws: WebSocket,
  userId: string | number | null,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies
): Promise<void> {
  const sessionId = readRequiredSessionId(data);
  if (!sessionId) {
    sendProtocolError(ws, 'SESSION_ID_REQUIRED', 'chat.compact requires a sessionId.');
    return;
  }

  const session = sessionsDb.getSessionById(sessionId);
  if (!session) {
    sendProtocolError(
      ws,
      'SESSION_NOT_FOUND',
      `Session "${sessionId}" was not found.`,
      sessionId
    );
    return;
  }

  const provider = session.provider as LLMProvider;
  const spawnFn = dependencies.spawnFns[provider];
  if (!spawnFn) {
    sendProtocolError(ws, 'UNSUPPORTED_PROVIDER', `Provider "${provider}" is not available.`, sessionId);
    return;
  }

  // Capability gate first: a forged chat.compact for a provider whose runtime
  // does not process /compact must never reach a spawn (double safety with the
  // frontend's supportsCompact-driven UI).
  if (!providerCapabilitiesService.getProviderCapabilities(provider).supportsCompact) {
    sendProtocolError(
      ws,
      'COMPACT_UNSUPPORTED',
      `Provider "${provider}" does not support context compaction.`,
      sessionId
    );
    return;
  }

  // A brand-new session has no provider conversation yet — there is nothing
  // to summarize, and resuming an empty provider id would start a fresh chat.
  if (!session.provider_session_id) {
    sendProtocolError(
      ws,
      'COMPACT_EMPTY_SESSION',
      `Session "${sessionId}" has no provider conversation to compact yet.`,
      sessionId
    );
    return;
  }

  // Compact runs occupy the normal per-session mutex: a compact and a chat
  // send can never interleave on the same provider conversation.
  const run = chatRunRegistry.startRun({
    appSessionId: sessionId,
    provider,
    providerSessionId: session.provider_session_id,
    connection: ws,
    userId,
    silent: false,
  });

  if (!run) {
    sendProtocolError(
      ws,
      'RUN_IN_PROGRESS',
      `Session "${sessionId}" already has a run in progress.`,
      sessionId
    );
    return;
  }

  // The compaction turn itself runs on the model the client is currently
  // using (options.model), falling back to the runtime's default otherwise.
  const clientOptions = (data.options ?? {}) as AnyRecord;

  try {
    await spawnFn('/compact', {
      model: typeof clientOptions.model === 'string' ? clientOptions.model : undefined,
      sessionId: session.provider_session_id,
      resume: true,
      cwd: session.project_path ?? undefined,
      projectPath: session.project_path ?? undefined,
    }, run.writer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Chat] Compact runtime "${provider}" failed`, { sessionId, error: message });
  } finally {
    // Safety net: same contract as chat.send — never leave the session stuck
    // in "processing" if a runtime dies without its terminal `complete`.
    chatRunRegistry.completeRun(sessionId, { exitCode: 1, silent: false });
  }
}
