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
   * REQ-030: invoked when a NORMAL (user-visible) run completes successfully.
   * Wire `useAutoRename`'s turn trigger here — it fires the silent rename
   * request when the viewed session crosses the 10-turn threshold. Only
   * called for non-silent runs; carries the run's success flag so the
   * trigger can ignore failed/aborted completions.
   */
  onNormalRunCompleted?: (sessionId: string | null | undefined, success: boolean) => void;
  /**
   * REQ-030: invoked when a silent run completes (server tags every frame
   * of a silent run with `silent: true`). Wire `useAutoRename`'s in-flight
   * reset here. Silent runs bypass ALL UI side-effects (no badge, no bell,
   * no transcript refresh) — this narrow channel is the only signal they
   * surface to the frontend.
   */
  onSilentRunCompleted?: (sessionId: string | null | undefined, success: boolean) => void;
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
  onNormalRunCompleted,
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
    const handleEvent = (msg: ServerEvent) => {
      if (!msg.kind) {
        return;
      }

      const activeViewSessionId = activeViewSessionIdRef.current;
      const sid = (typeof msg.sessionId === 'string' && msg.sessionId) || activeViewSessionId;

      // Record replay progress for every sequenced live event.
      if (sid && typeof msg.seq === 'number') {
        const known = lastSeqRef.current.get(sid) ?? 0;
        if (msg.seq > known) {
          lastSeqRef.current.set(sid, msg.seq);
        }
      }

      switch (msg.kind) {
        case 'websocket_reconnected':
          onWebSocketReconnect?.();
          return;

        case 'chat_subscribed': {
          // Ack for chat.subscribe: authoritative processing state plus any
          // pending tool-permission prompts for the run.
          if (!sid) return;

          if (msg.isProcessing) {
            onSessionProcessing?.(sid);
          } else {
            // Idle ack: ignore it if a newer request started after the
            // subscribe was sent — the ack describes the older state.
            onSessionIdle?.(sid, {
              ifStartedBefore: statusCheckSentAtRef.current.get(sid),
            });
          }

          const isViewedSession = sid === activeViewSessionId;
          if (isViewedSession && Array.isArray(msg.pendingPermissions)) {
            const nextPendingPermissionRequests = msg.pendingPermissions as PendingPermissionRequest[];
            const hadActionablePermissionRequests = hasActionablePermissionRequests(pendingPermissionRequestsRef.current);
            const hasPendingActionablePermissionRequests = hasActionablePermissionRequests(nextPendingPermissionRequests);

            pendingPermissionRequestsRef.current = nextPendingPermissionRequests;
            setPendingPermissionRequests(nextPendingPermissionRequests);

            if (hasPendingActionablePermissionRequests && !hadActionablePermissionRequests) {
              void playNotificationSound();
            }
          }
          return;
        }

        case 'protocol_error': {
          console.error('[Chat] Protocol error:', msg.code, msg.error);
          if (sid) {
            // Surface the failure in the conversation and stop the spinner —
            // the run never started (or was rejected), so no `complete` follows.
            onSessionIdle?.(sid);
            sessionStore.appendRealtime(sid, {
              id: `protocol_error_${Date.now()}`,
              sessionId: sid,
              timestamp: new Date().toISOString(),
              provider,
              kind: 'error',
              content: String(msg.error || 'Request failed'),
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
      if (msg.kind === 'stream_delta') {
        // REQ-030: silent runs (server tags every frame with silent:true) must
        // never touch the UI — drop before buffering so the background rename
        // agent's tokens don't bleed into the user's conversation view.
        if (msg.silent) return;
        const text = (msg.content as string) || '';
        if (!text) return;
        // 性能测点 first-token:仅在每个响应的「首条 stream_delta」触发一次,
        // 对应 spec「send → first stream token」间隔。后续 delta 走原逻辑但不
        // 包裹 measure,避免长回复产生 ~200 条误导性 `[perf] first-token` 日志。
        // 两条分支的处理逻辑完全一致(累加 + buffer timer 注册 + store 路由),
        // 仅差异是否用 measure 包裹;抽出 processDelta 保证逻辑体一致。
        const processDelta = () => {
          accumulatedStreamRef.current += text;
          if (!streamTimerRef.current) {
            streamTimerRef.current = window.setTimeout(() => {
              streamTimerRef.current = null;
              if (sid) {
                sessionStore.updateStreaming(sid, accumulatedStreamRef.current, provider);
              }
            }, 100);
          }
          // Also route to store for non-active sessions
          if (sid && sid !== activeViewSessionId) {
            sessionStore.appendRealtime(sid, msg as unknown as NormalizedMessage);
          }
        };
        if (!firstTokenLoggedRef.current) {
          firstTokenLoggedRef.current = true;
          measure('first-token', processDelta);
        } else {
          processDelta();
        }
        return;
      }

      if (msg.kind === 'stream_end') {
        // REQ-030: silent runs never finalize a visible stream.
        if (msg.silent) return;
        if (streamTimerRef.current) {
          clearTimeout(streamTimerRef.current);
          streamTimerRef.current = null;
        }
        if (sid) {
          if (accumulatedStreamRef.current) {
            sessionStore.updateStreaming(sid, accumulatedStreamRef.current, provider);
          }
          sessionStore.finalizeStreaming(sid);
        }
        // finalize 后立即 flush 批量（避免批量 tool_use 滞后于 stream finalize）
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          flushBatch();
        }
        accumulatedStreamRef.current = '';
        // Re-arm first-token probe so the next response's first delta is measured.
        firstTokenLoggedRef.current = false;
        return;
      }

      // --- All other messages: route to store ---
      const shouldPersist =
        msg.kind !== 'complete'
        && msg.kind !== 'status'
        && msg.kind !== 'permission_request'
        && msg.kind !== 'permission_cancelled';

      if (sid && shouldPersist) {
        // 批量：累积到 rAF 队列，flush 时 appendRealtimeBatch（一次 set per session）
        batchQueueRef.current.push({ sessionId: sid, msg: msg as unknown as NormalizedMessage });
        scheduleFlush();
      }

      // --- UI side effects for specific kinds ---
      switch (msg.kind) {
        case 'complete': {
          // REQ-030: silent completion. Fire the narrow silent-observer
          // callback (ChatInterface wires useAutoRename here so it can reset
          // its in-flight guard), then bail — no badge, no bell, no idle
          // transition, no transcript refresh. The user never saw this turn,
          // so none of those may fire. Non-silent runs fall through to the
          // existing complete handling unchanged below.
          if (msg.silent) {
            onSilentRunCompleted?.(sid, msg.success !== false);
            break;
          }

          // Flush any remaining streaming state
          if (streamTimerRef.current) {
            clearTimeout(streamTimerRef.current);
            streamTimerRef.current = null;
          }
          if (sid && accumulatedStreamRef.current) {
            sessionStore.updateStreaming(sid, accumulatedStreamRef.current, provider);
            sessionStore.finalizeStreaming(sid);
          }
          // finalize 后立即 flush 批量（complete 终态，避免批量消息滞后）
          if (rafIdRef.current !== null) {
            cancelAnimationFrame(rafIdRef.current);
            flushBatch();
          }
          accumulatedStreamRef.current = '';

          // `complete` is the unified terminal event — every provider run ends
          // with exactly one, regardless of success, failure, or abort. The
          // indicator derives from the processing map, so deleting the entry
          // hides it immediately and atomically.
          onSessionIdle?.(sid);
          if (sid === activeViewSessionId) {
            pendingPermissionRequestsRef.current = [];
            setPendingPermissionRequests([]);
          }

          if (msg.aborted) {
            // Abort was requested — the complete event confirms it. No
            // further UI action is needed beyond clearing the entry above.
            break;
          }

          const terminalStatus = msg.success === false ? 'failed' : 'completed';
          onSessionCompleted?.(sid, terminalStatus);

          // REQ-030: normal-run completion also arms the auto-rename trigger
          // (fires a silent rename request only when the viewed session
          // crosses the 10-turn threshold and is still untitled). The badge
          // above already flipped on `onSessionCompleted`; this is an
          // additional, narrower signal that must NOT fire for silent runs.
          onNormalRunCompleted?.(sid, terminalStatus === 'completed');

          // REQ-042: 任务完成系统通知（仅失焦时打扰）
          if (sid && terminalStatus === 'completed'
            && typeof document !== 'undefined'
            && (!document.hasFocus() || document.hidden)) {
            (window as any).systemNotify?.show({
              type: 'task-complete',
              title: '任务完成',
              body: '',
              sessionId: sid,
            });
          }

          // Celebrate only successful runs.
          if (terminalStatus === 'completed') {
            showCompletionTitleIndicator();
            void playChatCompletionSound();
          }

          // The session id is stable for the whole conversation (allocated
          // before the first send), so the only follow-up is syncing the
          // viewed conversation with the now-persisted transcript.
          if (sid && sid === activeViewSessionId) {
            void sessionStore.refreshFromServer(sid);
          }

          break;
        }

        // 'error' is an informational message row, not a terminal event —
        // providers emit it for mid-run stderr output too. Run teardown is
        // always signalled by the unified 'complete' that follows.

        case 'permission_request': {
          if (!msg.requestId) break;
          if (isActionablePermissionRequest({ toolName: msg.toolName })) {
            void playNotificationSound();

            // REQ-042: 权限请求系统通知（仅失焦时打扰，且通知带 reply/action 回调）
            if (typeof document !== 'undefined'
              && (!document.hasFocus() || document.hidden)
              && sid && msg.requestId) {
              (window as any).systemNotify?.show({
                type: 'permission',
                title: '需要确认',
                body: (msg.toolName as string) || '工具请求权限',
                requestId: msg.requestId as string,
                sessionId: sid,
              });
            }
          }

          if (sid === activeViewSessionId) {
            const previousPendingPermissionRequests = pendingPermissionRequestsRef.current;
            if (!previousPendingPermissionRequests.some((request) => request.requestId === msg.requestId)) {
              const nextPendingPermissionRequests = [...previousPendingPermissionRequests, {
                requestId: msg.requestId as string,
                toolName: (msg.toolName as string) || 'UnknownTool',
                input: msg.input,
                context: msg.context,
                sessionId: sid || null,
                receivedAt: new Date(),
              }];

              pendingPermissionRequestsRef.current = nextPendingPermissionRequests;
              setPendingPermissionRequests(nextPendingPermissionRequests);
            }
          }
          if (sid) {
            onSessionProcessing?.(sid, {
              taskStatus: 'waiting_for_input',
              statusText: 'Waiting for permission',
              canInterrupt: true,
            });
          }
          break;
        }

        case 'permission_cancelled': {
          if (msg.requestId && sid === activeViewSessionId) {
            const nextPendingPermissionRequests = pendingPermissionRequestsRef.current.filter(
              (request: PendingPermissionRequest) => request.requestId !== msg.requestId,
            );

            pendingPermissionRequestsRef.current = nextPendingPermissionRequests;
            setPendingPermissionRequests(nextPendingPermissionRequests);

            // Server cancelled the prompt (timeout / abort / superseded).
            // When no prompts remain the run resumes — usually via auto-deny
            // on timeout — so flip the badge out of "Needs input" back to
            // "Running". Without this it stays stuck until the next provider
            // `status`/`complete` event, which the timeout-deny path may not
            // emit before the turn ends.
            if (sid && nextPendingPermissionRequests.length === 0) {
              onSessionProcessing?.(sid, {
                taskStatus: 'running',
                statusText: null,
                canInterrupt: true,
              });
            }
          }
          break;
        }

        case 'status': {
          if (msg.text === 'token_budget' && msg.tokenBudget) {
            setTokenBudget(msg.tokenBudget as Record<string, unknown>);
          } else if (msg.text && sid) {
            onSessionProcessing?.(sid, {
              taskStatus: 'running',
              statusText: msg.text as string,
              canInterrupt: msg.canInterrupt !== false,
            });
          }
          break;
        }

        // text, tool_use, tool_result, thinking, interactive_prompt, task_notification
        // → already routed to store above, no UI side effects needed
        default:
          break;
      }
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
    onNormalRunCompleted,
    onSilentRunCompleted,
    onWebSocketReconnect,
    sessionStore,
    flushBatch,
    scheduleFlush,
  ]);
}
