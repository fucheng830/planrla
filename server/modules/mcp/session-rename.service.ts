import { sessionsService } from '@/modules/providers/index.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/index.js';

/**
 * Maximum length of an AI/user-generated session title. Tighter than the
 * 500-char cap on the manual rename REST endpoint — generated titles should
 * be short descriptors, not paragraphs.
 */
export const MAX_SESSION_TITLE_LENGTH = 50;

/**
 * Wanxiang ops-session tag. FeedChatPanel filters its ops rail on this
 * custom_name prefix, so a bare AI-generated title would make the session
 * vanish from the wanxiang UI right after auto-rename renamed it (the
 * "会话总是被清除" symptom). When a session is currently tagged, keep the tag
 * in front of the new title.
 */
const WX_SESSION_TAG = '[WX]';

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
  const current = sessionsService.getSessionCustomName(sessionId);
  const isTagged = typeof current === 'string' && current.trimStart().startsWith(WX_SESSION_TAG);
  // 去掉旧标记再拼新标题，避免 "[WX] [WX] 标题" 叠加。
  const stripped = isTagged && current ? current.replace(/^\s*\[WX\]\s*/, '') : '';
  const finalTitle = isTagged
    ? (trimmed === stripped ? trimmed : `${WX_SESSION_TAG} ${trimmed}`)
    : trimmed;
  sessionsService.renameSessionById(sessionId, finalTitle);
  broadcastSessionRenamed(sessionId, finalTitle);
  return { sessionId, title: finalTitle };
}
