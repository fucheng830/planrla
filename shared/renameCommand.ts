// Shared rename-command identifiers used by BOTH the frontend (hint builder in
// useRenameCommand) and the backend (history filter in rename-command-filter.ts).
//
// This module lives at the project root /shared boundary so it is compiled
// into both the frontend (tsconfig.json includes "shared") and the backend
// (server/tsconfig.json includes "../shared/**/*"), mirroring the
// shared/networkHosts.js cross-boundary pattern. It must stay free of any
// React/node-only imports.
//
// REQ-030: the silent rename turn (auto-rename) is injected into the provider
// transcript as a synthetic user message whose content starts with
// SILENT_RENAME_HINT_PREFIX. On reload, the backend uses this same prefix to
// detect and drop those turns from fetched history so the user never sees the
// hint, the assistant reasoning, or the set_session_title tool call on reload.

// Stable literal prefix that opens every silent-rename hint user message.
//
// Format on the wire: "[重命名当前会话 (id=SESSION_ID)] ..." where SESSION_ID
// is the live session id at emit time.
//
// The prefix up to and including "(id=" is the stable identifier — the
// sessionId itself varies per session, so the detector only matches the
// literal head. Keep this in lock-step with formatRenameCommandHint in
// src/components/chat/hooks/useRenameCommand.ts.
export const SILENT_RENAME_HINT_PREFIX = '[重命名当前会话 (id=';

// Returns true when a user-facing message content string opens with the
// silent-rename hint prefix. The backend history filter uses this to identify
// the synthetic user message that begins a silent rename turn.
export function isSilentRenameHintContent(content: unknown): content is string {
  return typeof content === 'string' && content.startsWith(SILENT_RENAME_HINT_PREFIX);
}
