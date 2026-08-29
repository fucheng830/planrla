import type { WebSocket } from 'ws';

import { WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import type { AnyRecord, AuthenticatedWebSocketRequest } from '@/shared/types.js';

/**
 * Shared protocol primitives for the chat websocket message handlers.
 *
 * Extracted from chat-websocket.service.ts (REQ-052) so the per-message
 * handler files can stay under the 500-line hygiene limit while emitting
 * frames that are byte-identical to the original implementations.
 */

/**
 * Extracts the authenticated request user id in the formats currently produced
 * by platform and OSS auth code paths.
 */
export function readRequestUserId(
  request: AuthenticatedWebSocketRequest | undefined
): string | number | null {
  const user = request?.user;
  if (!user) {
    return null;
  }

  if (typeof user.id === 'string' || typeof user.id === 'number') {
    return user.id;
  }

  if (typeof user.userId === 'string' || typeof user.userId === 'number') {
    return user.userId;
  }

  return null;
}

export function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WS_OPEN_STATE) {
    ws.send(JSON.stringify(payload));
  }
}

/**
 * Reports a protocol-level failure to the requesting client.
 *
 * Protocol errors deliberately use their own `kind` (instead of the provider
 * `error` message kind) so the frontend can distinguish "your request was
 * invalid" from "the model run produced an error" without inspecting text.
 *
 * REQ-030 silent-tagging gap (intentional): pre-`startRun` errors emitted
 * here (SESSION_ID_REQUIRED / SESSION_NOT_FOUND / UNSUPPORTED_PROVIDER /
 * RUN_IN_PROGRESS) bypass `decorateAndRecordEvent`, so they are never tagged
 * `silent:true` even when the triggering `chat.send` carried `options.silent`.
 * This is unreachable from `useAutoRename`: it pre-validates every trigger
 * condition before sending (session exists in the local store, provider has
 * a spawn fn, sessionId is always set in `buildSilentRenameFrame`), and the
 * backend's own `handleChatSend` reads `silent` only AFTER these branches
 * return — so a silent send that reaches this fn would have to come from a
 * caller that already violated those preconditions. Document and move on.
 */
export function sendProtocolError(
  ws: WebSocket,
  code: string,
  error: string,
  sessionId?: string
): void {
  sendJson(ws, {
    kind: 'protocol_error',
    code,
    error,
    sessionId: sessionId ?? null,
    timestamp: new Date().toISOString(),
  });
}

export function readRequiredSessionId(data: AnyRecord): string | null {
  const sessionId = typeof data.sessionId === 'string' ? data.sessionId.trim() : '';
  return sessionId.length > 0 ? sessionId : null;
}
