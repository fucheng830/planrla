import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type { ServerEvent } from '../../../contexts/WebSocketContext';
import { showCompletionTitleIndicator } from '../../../utils/pageTitleNotification';
import { playChatCompletionSound, playNotificationSound } from '../../../utils/notificationSound';
import type { MarkSessionCompleted, MarkSessionIdle, MarkSessionProcessing } from '../../../hooks/useSessionProtection';
import type { PendingPermissionRequest } from '../types/types';
import type { ProjectSession, LLMProvider } from '../../../types/app';
import type { SessionStore, NormalizedMessage } from '../../../stores/useSessionStore';
import { measure } from '../../../shared/perf/timing';
import { batchBySession, type BatchEntry } from '../utils/batchBySession';

const isActionablePermissionRequest = (request: { toolName?: unknown } | null | undefined): boolean => {
  return request?.toolName !== 'ExitPlanMode' && request?.toolName !== 'exit_plan_mode';
};

const hasActionablePermissionRequests = (requests: Array<{ toolName?: unknown }> | null | undefined): boolean => {
  return Array.isArray(requests) && requests.some((request) => isActionablePermissionRequest(request));
};

/**
 * Callback fired when a silent run completes (REQ-030). Silent runs bypass all
 * UI side-effects (no badge, no bell, no transcript refresh) but Task 4's
 * `useAutoRename` needs to observe "the previous turn finished" so it can
 * reset its in-flight guard and re-arm. This dedicated channel keeps that
 * signal isolated from `MarkSessionCompleted` (which drives the green
 * completion badge and must NOT fire for silent runs).
 */
export type SilentRunCompletedHandler = (
  sessionId: string | null | undefined,
  success: boolean,
) => void;

/**
 * Pure, React-free event reducer. Exported so `useChatRealtimeHandlers.test.ts`
 * can feed it mock events + a mock context without standing up a React tree
 * (no jsdom / testing-library installed in this repo). The hook builds the
 * context object below from its refs/callbacks and forwards every subscribed
 * frame here.
 *
 * Why a dedicated `onSilentRunCompleted` and NOT a reuse of
 * `onSessionCompleted`: the existing `MarkSessionCompleted` writes to the
 * `completedSessions` map (green checkmark badge). Silent runs must never
 * surface that badge — the user never saw the turn start. So silent
 * completion gets its own narrow channel; Task 4 (`useAutoRename`) wires its
 * turn-end observer to this prop.
 */
export interface ApplyChatEventContext {
  provider: LLMProvider;
  /** Session id of the currently viewed conversation. */
  activeViewSessionId: string | null;
  /** Refs owned by the hook or its caller. */
  accumulatedStream: MutableRefObject<string>;
  streamTimer: MutableRefObject<number | null>;
  firstTokenLogged: MutableRefObject<boolean>;
  batchQueue: MutableRefObject<BatchEntry[]>;
  pendingPermissionRequestsRef: MutableRefObject<PendingPermissionRequest[]>;
  lastSeqRef: MutableRefObject<Map<string, number>>;
  statusCheckSentAtRef: MutableRefObject<Map<string, number>>;
  /** Store + state setters. */
  sessionStore: SessionStore;
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  setTokenBudget: (budget: Record<string, unknown> | null) => void;
  /** React-aware plumbing (rAF + store mutation scheduling). */
  flushBatch: () => void;
  /**
   * Cancel any pending rAF flush and run `flushBatch` synchronously. The
   * caller owns the `rafIdRef` (DOM-specific) so the cancel step can't live
   * inside the React-free `applyChatEvent`; the hook wires this wrapper.
   */
  flushPendingBatch: () => void;
  scheduleFlush: () => void;
  /** Processing/completion callbacks. */
  onSessionProcessing?: MarkSessionProcessing;
  onSessionIdle?: MarkSessionIdle;
  onSessionCompleted?: MarkSessionCompleted;
  onWebSocketReconnect?: () => void;
  /** Silent-run completion observer (REQ-030 Task 4 wiring point). */
  onSilentRunCompleted?: SilentRunCompletedHandler;
}

/**
 * Apply one websocket frame to the chat realtime state.
 *
 * Returns nothing; side-effects flow through `ctx`. The three "UI surface"
 * branches (`stream_delta`, `stream_end`, `complete`) check `event.silent`
 * first and bail out — silent runs (REQ-030) must never mutate the session
 * store, render a bubble, ring the bell, refresh the transcript, or flip the
 * completion badge. The sole exception: a silent `complete` still notifies
 * `onSilentRunCompleted` so `useAutoRename` can reset its in-flight guard.
 */
export function applyChatEvent(event: ServerEvent, ctx: ApplyChatEventContext): void {
  if (!event.kind) {
    return;
  }

  const activeViewSessionId = ctx.activeViewSessionId;
  const sid = (typeof event.sessionId === 'string' && event.sessionId) || activeViewSessionId;

  // Record replay progress for every sequenced live event.
  if (sid && typeof event.seq === 'number') {
    const known = ctx.lastSeqRef.current.get(sid) ?? 0;
    if (event.seq > known) {
      ctx.lastSeqRef.current.set(sid, event.seq);
    }
  }

  switch (event.kind) {
    case 'websocket_reconnected':
      ctx.onWebSocketReconnect?.();
      return;

    case 'chat_subscribed': {
      // Ack for chat.subscribe: authoritative processing state plus any
      // pending tool-permission prompts for the run.
      if (!sid) return;

      if (event.isProcessing) {
        ctx.onSessionProcessing?.(sid);
      } else {
        // Idle ack: ignore it if a newer request started after the
        // subscribe was sent — the ack describes the older state.
        ctx.onSessionIdle?.(sid, {
          ifStartedBefore: ctx.statusCheckSentAtRef.current.get(sid),
        });
      }

      const isViewedSession = sid === activeViewSessionId;
      if (isViewedSession && Array.isArray(event.pendingPermissions)) {
        const nextPendingPermissionRequests = event.pendingPermissions as PendingPermissionRequest[];
        const hadActionablePermissionRequests = hasActionablePermissionRequests(ctx.pendingPermissionRequestsRef.current);
        const hasPendingActionablePermissionRequests = hasActionablePermissionRequests(nextPendingPermissionRequests);

        ctx.pendingPermissionRequestsRef.current = nextPendingPermissionRequests;
        ctx.setPendingPermissionRequests(nextPendingPermissionRequests);

        if (hasPendingActionablePermissionRequests && !hadActionablePermissionRequests) {
          void playNotificationSound();
        }
      }
      return;
    }

    case 'protocol_error': {
      console.error('[Chat] Protocol error:', event.code, event.error);
      if (sid) {
        // Surface the failure in the conversation and stop the spinner —
        // the run never started (or was rejected), so no `complete` follows.
        ctx.onSessionIdle?.(sid);
        ctx.sessionStore.appendRealtime(sid, {
          id: `protocol_error_${Date.now()}`,
          sessionId: sid,
          timestamp: new Date().toISOString(),
          provider: ctx.provider,
          kind: 'error',
          content: String(event.error || 'Request failed'),
        } as NormalizedMessage);
      }
      return;
    }

    // Sidebar/global events — owned by useProjectsState.
    case 'session_upserted':
    case 'loading_progress':
      return;

    default:
      break;
  }

  /* -------------------------------------------------------------- */
  /*  Provider NormalizedMessage handling                            */
  /* -------------------------------------------------------------- */

  // --- Streaming: buffer for performance ---
  if (event.kind === 'stream_delta') {
    // REQ-030: silent runs never touch the UI — drop before buffering.
    if (event.silent) return;
    const text = (event.content as string) || '';
    if (!text) return;
    // 性能测点 first-token:仅在每个响应的「首条 stream_delta」触发一次,
    // 对应 spec「send → first stream token」间隔。后续 delta 走原逻辑但不
    // 包裹 measure,避免长回复产生 ~200 条误导性 `[perf] first-token` 日志。
    // 两条分支的处理逻辑完全一致(累加 + buffer timer 注册 + store 路由),
    // 仅差异是否用 measure 包裹;抽出 processDelta 保证逻辑体一致。
    const processDelta = () => {
      ctx.accumulatedStream.current += text;
      if (!ctx.streamTimer.current) {
        ctx.streamTimer.current = window.setTimeout(() => {
          ctx.streamTimer.current = null;
          if (sid) {
            ctx.sessionStore.updateStreaming(sid, ctx.accumulatedStream.current, ctx.provider);
          }
        }, 100);
      }
      // Also route to store for non-active sessions
      if (sid && sid !== activeViewSessionId) {
        ctx.sessionStore.appendRealtime(sid, event as unknown as NormalizedMessage);
      }
    };
    if (!ctx.firstTokenLogged.current) {
      ctx.firstTokenLogged.current = true;
      measure('first-token', processDelta);
    } else {
      processDelta();
    }
    return;
  }

  if (event.kind === 'stream_end') {
    // REQ-030: silent runs never finalize a visible stream.
    if (event.silent) return;
    if (ctx.streamTimer.current) {
      clearTimeout(ctx.streamTimer.current);
      ctx.streamTimer.current = null;
    }
    if (sid) {
      if (ctx.accumulatedStream.current) {
        ctx.sessionStore.updateStreaming(sid, ctx.accumulatedStream.current, ctx.provider);
      }
      ctx.sessionStore.finalizeStreaming(sid);
    }
    // finalize 后立即 flush 批量（避免批量 tool_use 滞后于 stream finalize）
    ctx.flushPendingBatch();
    ctx.accumulatedStream.current = '';
    // Re-arm first-token probe so the next response's first delta is measured.
    ctx.firstTokenLogged.current = false;
    return;
  }

  // --- All other messages: route to store ---
  const shouldPersist =
    event.kind !== 'complete'
    && event.kind !== 'status'
    && event.kind !== 'permission_request'
    && event.kind !== 'permission_cancelled';

  if (sid && shouldPersist) {
    // 批量：累积到 rAF 队列，flush 时 appendRealtimeBatch（一次 set per session）
    ctx.batchQueue.current.push({ sessionId: sid, msg: event as unknown as NormalizedMessage });
    ctx.scheduleFlush();
  }

  // --- UI side effects for specific kinds ---
  switch (event.kind) {
    case 'complete': {
      // REQ-030: silent completion. Fire the narrow silent-observer callback
      // (Task 4 wires useAutoRename here so it can reset its in-flight guard),
      // then bail — no badge, no bell, no idle transition, no transcript
      // refresh. The user never saw this turn, so none of those may fire.
      if (event.silent) {
        ctx.onSilentRunCompleted?.(sid, event.success !== false);
        return;
      }

      // Flush any remaining streaming state
      if (ctx.streamTimer.current) {
        clearTimeout(ctx.streamTimer.current);
        ctx.streamTimer.current = null;
      }
      if (sid && ctx.accumulatedStream.current) {
        ctx.sessionStore.updateStreaming(sid, ctx.accumulatedStream.current, ctx.provider);
        ctx.sessionStore.finalizeStreaming(sid);
      }
      // finalize 后立即 flush 批量（complete 终态，避免批量消息滞后）
      ctx.flushPendingBatch();
      ctx.accumulatedStream.current = '';

      // `complete` is the unified terminal event — every provider run ends
      // with exactly one, regardless of success, failure, or abort. The
      // indicator derives from the processing map, so deleting the entry
      // hides it immediately and atomically.
      ctx.onSessionIdle?.(sid);
      if (sid === activeViewSessionId) {
        ctx.pendingPermissionRequestsRef.current = [];
        ctx.setPendingPermissionRequests([]);
      }

      if (event.aborted) {
        // Abort was requested — the complete event confirms it. No
        // further UI action is needed beyond clearing the entry above.
        break;
      }

      const terminalStatus = event.success === false ? 'failed' : 'completed';
      ctx.onSessionCompleted?.(sid, terminalStatus);

      // Celebrate only successful runs.
      if (terminalStatus === 'completed') {
        showCompletionTitleIndicator();
        void playChatCompletionSound();
      }

      // The session id is stable for the whole conversation (allocated
      // before the first send), so the only follow-up is syncing the
      // viewed conversation with the now-persisted transcript.
      if (sid && sid === activeViewSessionId) {
        void ctx.sessionStore.refreshFromServer(sid);
      }

      break;
    }

    // 'error' is an informational message row, not a terminal event —
    // providers emit it for mid-run stderr output too. Run teardown is
    // always signalled by the unified 'complete' that follows.

    case 'permission_request': {
      if (!event.requestId) break;
      if (isActionablePermissionRequest({ toolName: event.toolName })) {
        void playNotificationSound();
      }

      if (sid === activeViewSessionId) {
        const previousPendingPermissionRequests = ctx.pendingPermissionRequestsRef.current;
        if (!previousPendingPermissionRequests.some((request) => request.requestId === event.requestId)) {
          const nextPendingPermissionRequests = [...previousPendingPermissionRequests, {
            requestId: event.requestId as string,
            toolName: (event.toolName as string) || 'UnknownTool',
            input: event.input,
            context: event.context,
            sessionId: sid || null,
            receivedAt: new Date(),
          }];

          ctx.pendingPermissionRequestsRef.current = nextPendingPermissionRequests;
          ctx.setPendingPermissionRequests(nextPendingPermissionRequests);
        }
      }
      if (sid) {
        ctx.onSessionProcessing?.(sid, {
          taskStatus: 'waiting_for_input',
          statusText: 'Waiting for permission',
          canInterrupt: true,
        });
      }
      break;
    }

    case 'permission_cancelled': {
      if (event.requestId && sid === activeViewSessionId) {
        const nextPendingPermissionRequests = ctx.pendingPermissionRequestsRef.current.filter(
          (request: PendingPermissionRequest) => request.requestId !== event.requestId,
        );

        ctx.pendingPermissionRequestsRef.current = nextPendingPermissionRequests;
        ctx.setPendingPermissionRequests(nextPendingPermissionRequests);

        // Server cancelled the prompt (timeout / abort / superseded).
        // When no prompts remain the run resumes — usually via auto-deny
        // on timeout — so flip the badge out of "Needs input" back to
        // "Running". Without this it stays stuck until the next provider
        // `status`/`complete` event, which the timeout-deny path may not
        // emit before the turn ends.
        if (sid && nextPendingPermissionRequests.length === 0) {
          ctx.onSessionProcessing?.(sid, {
            taskStatus: 'running',
            statusText: null,
            canInterrupt: true,
          });
        }
      }
      break;
    }

    case 'status': {
      if (event.text === 'token_budget' && event.tokenBudget) {
        ctx.setTokenBudget(event.tokenBudget as Record<string, unknown>);
      } else if (event.text && sid) {
        ctx.onSessionProcessing?.(sid, {
          taskStatus: 'running',
          statusText: event.text as string,
          canInterrupt: event.canInterrupt !== false,
        });
      }
      break;
    }

    // text, tool_use, tool_result, thinking, interactive_prompt, task_notification
    // → already routed to store above, no UI side effects needed
    default:
      break;
  }
}

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
