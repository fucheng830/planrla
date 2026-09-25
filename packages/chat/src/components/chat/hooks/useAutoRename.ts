import { useCallback, useRef } from 'react';

import type { SessionStore } from '../../../stores/useSessionStore';
import type { ProjectSession } from '../../../types/app';

import { formatRenameCommandHint } from './useRenameCommand';

/**
 * REQ-030: assistant turns required before auto-rename fires. Spec §4.1.1
 * set 10 for dev-agent marathons; wanxiang ops chats are typically 1-3 turns,
 * which left every sidebar row stuck on "新会话" forever. 2 turns = the first
 * real answer completed, enough signal for a short title.
 */
export const TITLE_THRESHOLD = 2;

/**
 * Known per-provider default titles. A session is "untitled" (eligible for
 * auto-rename) when its `custom_name` is empty/null or exactly equals one of
 * these placeholders. Each provider's synchronizer falls back to a fixed
 * string when no real title exists:
 *   - claude   → `'Untitled Claude Session'`
 *   - codex    → `'Untitled Codex Session'`
 *   - cursor   → `'Untitled Cursor Session'`
 *   - opencode → `'Untitled OpenCode Session'`
 *   - gemini   → `'New Gemini Chat'`  (NOTE: does NOT start with "Untitled")
 *
 * Spec §4.1.2 ("等于默认占位名") calls for EQUALITY, not prefix-match — a real
 * user title like "Untitled thoughts draft" must NOT trigger auto-rename.
 * Compared case-insensitively to survive provider casing drift.
 */
const UNTITLED_PLACEHOLDERS = new Set([
  'Untitled',
  'Untitled Claude Session',
  'Untitled Codex Session',
  'Untitled Cursor Session',
  'Untitled OpenCode Session',
  'New Gemini Chat',
].map((s) => s.toLowerCase()));

/**
 * Max length of a real (intentional) session title. Provider synchronizers
 * fall back to dumping the FULL first user message into `custom_name` when no
 * real title exists — those are long, low-signal, and must be treated as
 * untitled so REQ-030 auto-rename still fires for them. Real titles (manual
 * /rename, AI-generated per spec §7 = 5-15 字) are short; 40 字 leaves headroom
 * for deliberate longer titles without matching whole-sentence auto-summaries.
 *
 * Spec §1 identifies "4462 条标题 = 首条消息全文(长/重复/无区分)" as the core
 * pain point. The placeholder-only guard missed them because providers don't
 * write "Untitled" — they write the first message verbatim. This length guard
 * closes that gap.
 */
const REAL_TITLE_MAX_LENGTH = 40;

/**
 * Wanxiang ops-session tag. FeedChatPanel stamps every ops conversation with
 * this custom_name prefix at creation (see wanxiang/frontend PlanrlaWorkbench),
 * so a freshly created [WX] session holds a non-empty summary that trips the
 * guards below — auto-rename never fired and the sidebar kept showing bare
 * "新会话" rows. Treat the bare tag (optionally followed by whitespace) as
 * untitled; a real renamed title ("[WX] 北京KFC选题") stays already-titled.
 */
const WX_SESSION_TAG_RE = /^\[WX\]\s*$/;

export function isUntitledSummary(summary: string | null | undefined): boolean {
  if (summary === null || summary === undefined) {
    return true;
  }
  const trimmed = summary.trim();
  if (trimmed === '') {
    return true;
  }
  if (WX_SESSION_TAG_RE.test(trimmed)) {
    return true;
  }
  if (UNTITLED_PLACEHOLDERS.has(trimmed.toLowerCase())) {
    return true;
  }
  // REQ-030 fix: a custom_name longer than a plausible real title is almost
  // certainly the provider's auto-summary (full first user message), not a
  // human/AI title — treat it as untitled so auto-rename fires.
  return trimmed.length > REAL_TITLE_MAX_LENGTH;
}

/**
 * Structural slice of {@link NormalizedMessage} that the auto-rename logic
 * actually inspects. Declared as an alias so unit tests can feed minimal
 * fixtures without fabricating `id`/`sessionId`/`timestamp`/`provider`; the
 * production hook passes a full `NormalizedMessage[]` (structurally compatible).
 *
 * `role` is typed `string` (not the strict union) because tests build fixtures
 * whose inferred element type widens to `string`; the evaluator only ever
 * compares against the literal `'assistant'`, so non-matching values are
 * naturally ignored without a redundant union.
 */
export interface AutoRenameMessage {
  kind: string;
  role?: string;
}

/**
 * Count completed assistant turns in a merged message list.
 *
 * A turn = a persisted message with `kind === 'text'` AND `role === 'assistant'`.
 * Streaming placeholders (id `__streaming_*`) and `stream_delta` kinds are
 * excluded — they represent an in-flight response that hasn't completed yet.
 * Spec §4.2 / plan 前置约定.
 */
export function countAssistantTurns(messages: readonly AutoRenameMessage[]): number {
  return messages.filter((m) => m.kind === 'text' && m.role === 'assistant').length;
}

export interface AutoRenameDecision {
  shouldFire: boolean;
  /**
   * `'fire'` — all guards passed, emit the silent rename request.
   * `'no-session'` — selectedSession missing or id mismatch.
   * `'already-titled'` — summary is a real (non-Untitled) title.
   * `'in-flight'` — a previous silent rename hasn't completed yet.
   * `'below-threshold'` — fewer than TITLE_THRESHOLD assistant turns.
   */
  reason: 'fire' | 'no-session' | 'already-titled' | 'in-flight' | 'below-threshold';
}

/**
 * Arguments for the pure trigger evaluator. Extracted as an interface so the
 * evaluator is unit-testable without React (no `@testing-library/react` /
 * `renderHook` in this repo).
 */
export interface EvaluateAutoRenameArgs {
  selectedSession: { id: string; summary?: string | null } | null;
  /**
   * Merged messages for the session (`useSessionStore.getMessages(sid)`).
   * Typed as the structural slice {@link AutoRenameMessage} so tests can pass
   * minimal fixtures; full `NormalizedMessage[]` is structurally compatible.
   */
  messages: readonly AutoRenameMessage[];
  /** Whether a silent rename is currently in flight. */
  inFlight: boolean;
}

/**
 * Pure trigger evaluator for REQ-030 auto-rename. Decides whether the 10th-turn
 * silent rename should fire, given the current session state and in-flight
 * guard. Returns a decision object; callers (the hook) own the side-effect
 * (sending the silent chat.send frame) and the in-flight mutation.
 *
 * Guards (spec §4.1 — all must hold):
 *  1. selectedSession present and id matches.
 *  2. summary is untitled (empty / null / `Untitled*` placeholder).
 *  3. not already in-flight.
 *  4. assistant turn count >= TITLE_THRESHOLD.
 */
export function evaluateAutoRename({
  selectedSession,
  messages,
  inFlight,
}: EvaluateAutoRenameArgs): AutoRenameDecision {
  if (!selectedSession) {
    return { shouldFire: false, reason: 'no-session' };
  }
  if (!isUntitledSummary(selectedSession.summary)) {
    return { shouldFire: false, reason: 'already-titled' };
  }
  if (inFlight) {
    return { shouldFire: false, reason: 'in-flight' };
  }
  if (countAssistantTurns(messages) < TITLE_THRESHOLD) {
    return { shouldFire: false, reason: 'below-threshold' };
  }
  return { shouldFire: true, reason: 'fire' };
}

/**
 * Frame shape emitted by `useAutoRename` when firing the silent rename. Mirrors
 * the `chat.send` payload used in `useChatComposerState` with the
 * `silent: true` flag REQ-030 Task 1 recognizes.
 */
export interface SilentRenameSendFrame {
  type: 'chat.send';
  sessionId: string;
  content: string;
  options: { silent: true; permissionMode: 'bypassPermissions' };
}

/**
 * Build the silent rename send frame. Pure helper so tests can verify the
 * exact payload without standing up React state.
 *
 * permissionMode=bypassPermissions: silent runs have no UI to surface
 * permission cards, and the agent's set_session_title MCP call would otherwise
 * stall forever on a permission_request nobody can approve (2026-09-15 e2e).
 */
export function buildSilentRenameFrame(sessionId: string): SilentRenameSendFrame {
  return {
    type: 'chat.send',
    sessionId,
    content: formatRenameCommandHint(sessionId),
    options: { silent: true, permissionMode: 'bypassPermissions' },
  };
}

export interface UseAutoRenameArgs {
  selectedSession: ProjectSession | null;
  sessionStore: Pick<SessionStore, 'getMessages'>;
  sendMessage: (frame: SilentRenameSendFrame) => void;
}

/**
 * REQ-030 auto-rename hook. Exposes TWO entry points (Task 3 split silent-run
 * completion from the badge-driving `onSessionCompleted` to keep the green
 * completion badge from firing on silent runs):
 *
 * - `onNormalRunCompleted(sessionId, success)` — wire to a NORMAL (user-visible)
 *   run's completion (the `onSessionCompleted` callback chain in
 *   `useChatRealtimeHandlers`). This is the TRIGGER: on success, if the viewed
 *   session has >= 10 assistant turns, is still untitled, and no rename is in
 *   flight, emit a silent `chat.send` with the rename hint and arm in-flight.
 *
 * - `onSilentRunCompleted(sessionId, success)` — wire to the dedicated
 *   `onSilentRunCompleted` channel Task 3 added. Just resets the in-flight
 *   guard so a future turn can re-arm (the `already-titled` guard also blocks
 *   re-firing once the title lands, but in-flight covers the window between the
 *   silent send and its terminal `complete` event).
 *
 * Wiring both into `ChatInterface` → `useChatRealtimeHandlers` is Task 5.
 */
export function useAutoRename({ selectedSession, sessionStore, sendMessage }: UseAutoRenameArgs) {
  const inFlightRef = useRef(false);

  const onNormalRunCompleted = useCallback(
    (sessionId: string | null | undefined, success: boolean) => {
      if (!success) return;
      if (!sessionId) return;
      if (!selectedSession || selectedSession.id !== sessionId) return;

      const decision = evaluateAutoRename({
        selectedSession,
        messages: sessionStore.getMessages(sessionId),
        inFlight: inFlightRef.current,
      });
      if (!decision.shouldFire) return;

      inFlightRef.current = true;
      sendMessage(buildSilentRenameFrame(sessionId));
    },
    [selectedSession, sessionStore, sendMessage],
  );

  const onSilentRunCompleted = useCallback((_sessionId: string | null | undefined, _success: boolean) => {
    // Silent run finished (success or not). Re-arm so a future turn can retry
    // if the agent didn't actually write a title. The `already-titled` guard
    // in evaluateAutoRename prevents re-firing once custom_name lands.
    inFlightRef.current = false;
  }, []);

  return { onNormalRunCompleted, onSilentRunCompleted };
}
