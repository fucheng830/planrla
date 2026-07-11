import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type { ServerEvent } from '../../../contexts/WebSocketContext';
import type { MarkSessionCompleted, MarkSessionIdle, MarkSessionProcessing } from '../../../hooks/useSessionProtection';
import type { PendingPermissionRequest } from '../types/types';
import type { ProjectSession, LLMProvider } from '../../../types/app';
import type { SessionStore } from '../../../stores/useSessionStore';
import { batchBySession, type BatchEntry } from '../utils/batchBySession';
import { applyChatEvent, type ApplyChatEventContext, type SilentRunCompletedHandler } from './applyChatEvent';

interface UseChatRealtimeHandlersArgs {
  subscribe: (listener: (event: ServerEvent) => void) => () => void;
  provider: LLMProvider;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  setTokenBudget: (budget: Record<string, unknown> | null) => void;
  pendingPermissionRequests: PendingPermissionRequest[];
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  streamTimerRef: MutableRefObject<number | null>;
  accumulatedStreamRef: MutableRefObject<string>;
  /**
   * Highest live `seq` observed per session. Essential for reconnect catch-up:
   * `chat.subscribe` sends this value as `lastSeq` so the server replays only
   * the events this client actually missed. Written here on every sequenced
   * frame; read wherever a `chat.subscribe` is sent (session open, reconnect).
   */
  lastSeqRef: MutableRefObject<Map<string, number>>;
  /** When each session's `chat.subscribe` was last sent; guards stale idle acks. */
  statusCheckSentAtRef: MutableRefObject<Map<string, number>>;
  onSessionProcessing?: MarkSessionProcessing;
  onSessionIdle?: MarkSessionIdle;
  onSessionCompleted?: MarkSessionCompleted;
  /**
   * REQ-030: invoked when a silent run completes. Wire `useAutoRename`'s
   * turn-end observer here (Task 4/5) so it can reset its in-flight guard.
   */
  onSilentRunCompleted?: SilentRunCompletedHandler;
  onWebSocketReconnect?: () => void;
  sessionStore: SessionStore;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                              */
/* ------------------------------------------------------------------ */

/**
 * Routes server events into the session store and processing-state map.
 *
 * This is intentionally a thin reducer over the unified `kind`-based
 * protocol: every frame is keyed by the stable app session id, so there is
 * no session-id handoff, no provider branching, and no navigation here.
 * Sidebar events (`session_upserted`, `loading_progress`) are handled by
 * `useProjectsState`, not in this hook.
 */
export function useChatRealtimeHandlers({
  subscribe,
  provider,
  selectedSession,
  currentSessionId,
  setTokenBudget,
  pendingPermissionRequests,
  setPendingPermissionRequests,
  streamTimerRef,
  accumulatedStreamRef,
  lastSeqRef,
  statusCheckSentAtRef,
  onSessionProcessing,
  onSessionIdle,
  onSessionCompleted,
  onSilentRunCompleted,
  onWebSocketReconnect,
  sessionStore,
}: UseChatRealtimeHandlersArgs) {
  // Session switches can send `chat.subscribe` before this effect has a chance
  // to rebind the websocket listener. Read the visible session id from a ref
  // so a fast `chat_subscribed` ack is matched against the current view, not
  // the previous render's closed-over selection.
  const activeViewSessionIdRef = useRef<string | null>(selectedSession?.id || currentSessionId || null);
  activeViewSessionIdRef.current = selectedSession?.id || currentSessionId || null;

  // Keep the latest pending-permission snapshot available to the websocket
  // listener so back-to-back permission events can dedupe and re-arm the
  // notification sound before React finishes a rerender.
  const pendingPermissionRequestsRef = useRef(pendingPermissionRequests);

  // first-token probe: fires only on the FIRST stream_delta of each response.
  // Reset on stream_end/complete so the next response measures again.
  // Avoids ~200 misleading `[perf] first-token` log lines per long reply.
  const firstTokenLoggedRef = useRef(false);

  // 非流 shouldPersist 事件批量：rAF 16ms 窗口累积，flush 时 per-session appendRealtimeBatch，
  // 把 N 次 appendRealtime 合并为 per-session 一次 store set → 降低 re-render 频率。
  // stream_delta 不进（已有 100ms accumulatedStream 合并）；status/permission/complete 不进（shouldPersist=false）。
  const batchQueueRef = useRef<BatchEntry[]>([]);
  const rafIdRef = useRef<number | null>(null);

  const flushBatch = useCallback(() => {
    rafIdRef.current = null;
    const queue = batchQueueRef.current;
    batchQueueRef.current = [];
    if (queue.length === 0) return;
    const grouped = batchBySession(queue);
    for (const [sid, msgs] of grouped) {
      sessionStore.appendRealtimeBatch(sid, msgs);
    }
  }, [sessionStore]);

  const scheduleFlush = useCallback(() => {
    if (rafIdRef.current !== null) return; // 已调度
    rafIdRef.current = requestAnimationFrame(flushBatch);
  }, [flushBatch]);

  useEffect(() => {
    pendingPermissionRequestsRef.current = pendingPermissionRequests;
  }, [pendingPermissionRequests]);

  useEffect(() => {
    // Build the React-aware context once per effect run; `applyChatEvent` is
    // a pure function over this context, extracted so the realtime reducer
    // can be unit-tested without a React tree (no jsdom installed here).
    const ctx: ApplyChatEventContext = {
      provider,
      activeViewSessionId: activeViewSessionIdRef.current,
      accumulatedStream: accumulatedStreamRef,
      streamTimer: streamTimerRef,
      firstTokenLogged: firstTokenLoggedRef,
      batchQueue: batchQueueRef,
      pendingPermissionRequestsRef,
      lastSeqRef,
      statusCheckSentAtRef,
      sessionStore,
      setPendingPermissionRequests,
      setTokenBudget,
      flushBatch,
      flushPendingBatch: () => {
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
        }
        flushBatch();
      },
      scheduleFlush,
      onSessionProcessing,
      onSessionIdle,
      onSessionCompleted,
      onSilentRunCompleted,
      onWebSocketReconnect,
    };

    const handleEvent = (msg: ServerEvent) => {
      // The viewed session id can change between renders; re-read on every
      // frame so a fast `chat_subscribed` ack matches the current view.
      ctx.activeViewSessionId = activeViewSessionIdRef.current;
      applyChatEvent(msg, ctx);
    };

    const unsubscribe = subscribe(handleEvent);
    return () => {
      unsubscribe();
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      flushBatch(); // flush 残留（best-effort）
    };
  }, [
    subscribe,
    provider,
    selectedSession,
    currentSessionId,
    setTokenBudget,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    streamTimerRef,
    accumulatedStreamRef,
    lastSeqRef,
    statusCheckSentAtRef,
    onSessionProcessing,
    onSessionIdle,
    onSessionCompleted,
    onSilentRunCompleted,
    onWebSocketReconnect,
    sessionStore,
    flushBatch,
    scheduleFlush,
  ]);
}
