import { sessionsService } from '@/modules/providers/index.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/index.js';

/**
 * Maximum length of an AI/user-generated session title. Tighter than the
 * 500-char cap on the manual rename REST endpoint — generated titles should
 * be short descriptors, not paragraphs.
 */
export const MAX_SESSION_TITLE_LENGTH = 50;

export type SessionRenameResult = { sessionId: string; title: string };

/**
 * Broadcast a `session_renamed` realtime event so the sidebar updates the
 * title in place without a full refresh. Mirrors the `session_upserted`
 * broadcast shape (kind + sessionId + timestamp) the chat run registry uses.
 */
export function broadcastSessionRenamed(sessionId: string, title: string): void {
  const payload = JSON.stringify({
    kind: 'session_renamed',
    sessionId,
    summary: title,
    timestamp: new Date().toISOString(),
  });
  connectedClients.forEach((client) => {
    if (client.readyState === WS_OPEN_STATE) {
      try {
        client.send(payload);
      } catch (error) {
        console.error('[session-rename] broadcast failed:', error);
      }
    }
  });
}

/**
 * Apply a rename: validate → persist via the same service the manual rename
 * REST endpoint uses (`renameSessionById` throws SESSION_NOT_FOUND if the row
 * is missing) → broadcast. Throws on empty / too-long titles.
 */
export function setSessionTitle(sessionId: string, title: string): SessionRenameResult {
  const trimmed = (title ?? '').trim();
  if (!trimmed) {
    throw new Error('title is required.');
  }
  if (trimmed.length > MAX_SESSION_TITLE_LENGTH) {
    throw new Error(`title must not exceed ${MAX_SESSION_TITLE_LENGTH} characters.`);
  }
  sessionsService.renameSessionById(sessionId, trimmed);
  broadcastSessionRenamed(sessionId, trimmed);
  return { sessionId, title: trimmed };
}
