/**
 * Session drag-and-drop (Codex-style "reference another chat by dragging it
 * into the composer").
 *
 * The drag source is a sidebar session row (project tree item or 会话-tab flat
 * row); the drop target is the chat composer, which turns the payload into a
 * session-reference chip. Cross-project references are fine — the backend
 * `query_session` tool reads any session by id.
 *
 * MIME payloads are invisible to `getData()` during dragover (spec: only
 * `types` is readable mid-drag), so drop targets must gate their highlight on
 * `hasSessionDrag`, never on payload contents.
 */

import type { DragEvent } from 'react';

export const SESSION_DRAG_MIME = 'application/x-planrla-session';

export interface SessionDragPayload {
  sessionId: string;
  title: string;
  provider: string;
}

/** Call from the session row's onDragStart. */
export function startSessionDrag(event: DragEvent, payload: SessionDragPayload): void {
  event.dataTransfer.setData(SESSION_DRAG_MIME, JSON.stringify(payload));
  // Plain-text fallback so dropping onto the editor/terminal pastes something
  // meaningful instead of nothing.
  event.dataTransfer.setData('text/plain', payload.title);
  event.dataTransfer.effectAllowed = 'copyLink';
}

/** True while a session drag hovers this element (works mid-drag, unlike getData). */
export function hasSessionDrag(event: DragEvent): boolean {
  return event.dataTransfer.types.includes(SESSION_DRAG_MIME);
}

/** Parse the payload on drop. Returns null for malformed/foreign data. */
export function readSessionDrag(event: DragEvent): SessionDragPayload | null {
  const raw = event.dataTransfer.getData(SESSION_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SessionDragPayload>;
    if (typeof parsed.sessionId !== 'string' || !parsed.sessionId) return null;
    return {
      sessionId: parsed.sessionId,
      title: typeof parsed.title === 'string' && parsed.title ? parsed.title : parsed.sessionId,
      provider: typeof parsed.provider === 'string' ? parsed.provider : '',
    };
  } catch {
    return null;
  }
}
