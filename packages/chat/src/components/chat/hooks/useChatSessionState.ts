import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import type { MarkSessionIdle, SessionActivityMap } from '../../../hooks/useSessionProtection';
import type { Project, ProjectSession, LLMProvider } from '../../../types/app';
import type { SessionStore, NormalizedMessage, CompactionInfo } from '../../../stores/useSessionStore';
import type { ChatMessage } from '../types/types';
import { createCachedDiffCalculator, type DiffCalculator } from '../utils/messageTransforms';

import { normalizedToChatMessages } from './useChatMessages';
import { measureAsync } from '../../../shared/perf/timing';
import type { VListHandle } from 'virtua';

const MESSAGES_PER_PAGE = 20;
const INITIAL_VISIBLE_MESSAGES = 100;

interface UseChatSessionStateArgs {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  /** REQ-052: mapped from the backend capability matrix for the active provider. */
  supportsCompact?: boolean;
  autoScrollToBottom?: boolean;
  externalMessageUpdate?: number;
  newSessionTrigger?: number;
  processingSessions?: SessionActivityMap;
  onSessionIdle?: MarkSessionIdle;
  resetStreamingState: () => void;
  /** When each session's `chat.subscribe` was last sent; guards stale idle acks. */
  statusCheckSentAtRef: MutableRefObject<Map<string, number>>;
  /** Highest live seq observed per session; sent as `lastSeq` on subscribe. */
  lastSeqRef: MutableRefObject<Map<string, number>>;
  sessionStore: SessionStore;
}

interface ScrollRestoreState {
  height: number;
  top: number;
}

/* ------------------------------------------------------------------ */
/*  Helper: Convert a ChatMessage to a NormalizedMessage for the store */
/* ------------------------------------------------------------------ */

function chatMessageToNormalized(
  msg: ChatMessage,
  sessionId: string,
  provider: LLMProvider,
): NormalizedMessage | null {
  const id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ts = msg.timestamp instanceof Date
    ? msg.timestamp.toISOString()
    : typeof msg.timestamp === 'number'
      ? new Date(msg.timestamp).toISOString()
      : String(msg.timestamp);
  const base = { id, sessionId, timestamp: ts, provider };

  if (msg.isToolUse) {
    return {
      ...base,
      kind: 'tool_use',
      toolName: msg.toolName,
      toolInput: msg.toolInput,
      toolId: msg.toolId || id,
    } as NormalizedMessage;
  }
  if (msg.isThinking) {
    return { ...base, kind: 'thinking', content: msg.content || '' } as NormalizedMessage;
  }
  if (msg.isInteractivePrompt) {
    return { ...base, kind: 'interactive_prompt', content: msg.content || '' } as NormalizedMessage;
  }
  if ((msg as any).isTaskNotification) {
    return {
      ...base,
      kind: 'task_notification',
      status: (msg as any).taskStatus || 'completed',
      summary: msg.content || '',
    } as NormalizedMessage;
  }
  if (msg.type === 'error') {
    return { ...base, kind: 'error', content: msg.content || '' } as NormalizedMessage;
  }
  return {
    ...base,
    kind: 'text',
    role: msg.type === 'user' ? 'user' : 'assistant',
    content: msg.content || '',
    images: msg.images,
  } as NormalizedMessage;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                              */
/* ------------------------------------------------------------------ */

export function useChatSessionState({
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  supportsCompact = false,
  autoScrollToBottom,
  externalMessageUpdate,
  newSessionTrigger,
  processingSessions,
  onSessionIdle,
  resetStreamingState,
  statusCheckSentAtRef,
  lastSeqRef,
  sessionStore,
}: UseChatSessionStateArgs) {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(selectedSession?.id || null);
  const [isLoadingSessionMessages, setIsLoadingSessionMessages] = useState(false);
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [totalMessages, setTotalMessages] = useState(0);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [tokenBudget, setTokenBudget] = useState<Record<string, unknown> | null>(null);
  const [visibleMessageCount, setVisibleMessageCount] = useState(INITIAL_VISIBLE_MESSAGES);
  const [allMessagesLoaded, setAllMessagesLoaded] = useState(false);
  const [isLoadingAllMessages, setIsLoadingAllMessages] = useState(false);
  const [loadAllJustFinished, setLoadAllJustFinished] = useState(false);
  const [showLoadAllOverlay, setShowLoadAllOverlay] = useState(false);
  const [viewHiddenCount, setViewHiddenCount] = useState(0);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const virtuaRef = useRef<VListHandle>(null);
  const visibleMessagesLengthRef = useRef(0);
  const [searchTarget, setSearchTarget] = useState<{ timestamp?: string; uuid?: string; snippet?: string } | null>(null);
  const searchScrollActiveRef = useRef(false);
  const isLoadingSessionRef = useRef(false);
  const isLoadingMoreRef = useRef(false);
  const allMessagesLoadedRef = useRef(false);
  const topLoadLockRef = useRef(false);
  const pendingScrollRestoreRef = useRef<ScrollRestoreState | null>(null);
  const pendingInitialScrollRef = useRef(true);
  const messagesOffsetRef = useRef(0);
  const scrollPositionRef = useRef({ height: 0, top: 0 });
  const loadAllFinishedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadAllOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLoadedSessionKeyRef = useRef<string | null>(null);
  /**
   * Tracks the last processed value from `useProjectsState.newSessionTrigger`.
   *
   * The trigger itself is intentionally increment-only and routed via:
   * useProjectsState -> AppContent -> MainContent -> ChatInterface -> this hook.
   * We compare values to ensure each explicit New Session click runs exactly one
   * reset pass in this local chat state domain.
   */
  const previousNewSessionTriggerRef = useRef(newSessionTrigger ?? 0);

  const createDiff = useMemo<DiffCalculator>(() => createCachedDiffCalculator(), []);

  // 防会话切换首帧闪现「服务商选择空状态」：selectedSession.id 变化时消息区立刻按新 id
  // 读 store（无缓存 → []），而 isLoadingSessionMessages 的置位在下方 useEffect（绘制后），
  // 中间那帧满足 "messages===0 && !loading"，空状态分支被画出后又立刻被 spinner/消息替换。
  // React 官方 "adjust state when props change" 模式：render 阶段同步置位，首帧直接落 spinner。
  const prevSelectedSessionIdRef = useRef<string | null>(null);
  const nextSelectedSessionId = selectedSession?.id ?? null;
  if (nextSelectedSessionId !== prevSelectedSessionIdRef.current) {
    prevSelectedSessionIdRef.current = nextSelectedSessionId;
    // 仅无缓存的会话需要 spinner 兜底；有缓存消息时首帧直接渲染消息，不闪 loading。
    if (nextSelectedSessionId && sessionStore.getMessages(nextSelectedSessionId).length === 0) {
      setIsLoadingSessionMessages(true);
    }
  }

  useEffect(() => {
    const trigger = newSessionTrigger ?? 0;
    if (trigger === previousNewSessionTriggerRef.current) {
      return;
    }
    previousNewSessionTriggerRef.current = trigger;

    /**
     * Consumer-side reset for explicit New Session intent.
     *
     * Why this is essential:
     * - Chat keeps local state that is not fully derived from `selectedSession`:
     *   `currentSessionId`, `pendingUserMessage`, streaming/status flags, message
     *   pagination/scroll bookkeeping, and provider-specific sessionStorage keys.
     * - If the user clicks New Session while already on the same route with no
     *   selected session, parent state updates can be idempotent and this local
     *   state would otherwise persist, making the click appear to "do nothing".
     *
     * What this reset guarantees:
     * - A deterministic clean draft state on every New Session click.
     * - No dependence on route/tab/session-object identity changes.
     * - No coupling to unrelated external update signals.
     */
    resetStreamingState();
    setCurrentSessionId(null);
    setPendingUserMessage(null);
    messagesOffsetRef.current = 0;
    setHasMoreMessages(false);
    setTotalMessages(0);
    
    setTokenBudget(null);
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    setAllMessagesLoaded(false);
    allMessagesLoadedRef.current = false;
    setIsLoadingAllMessages(false);
    setLoadAllJustFinished(false);
    setShowLoadAllOverlay(false);
    setViewHiddenCount(0);
    setSearchTarget(null);
    searchScrollActiveRef.current = false;
    topLoadLockRef.current = false;
    pendingScrollRestoreRef.current = null;
    pendingInitialScrollRef.current = true;
    lastLoadedSessionKeyRef.current = null;

    if (loadAllOverlayTimerRef.current) {
      clearTimeout(loadAllOverlayTimerRef.current);
      loadAllOverlayTimerRef.current = null;
    }
    if (loadAllFinishedTimerRef.current) {
      clearTimeout(loadAllFinishedTimerRef.current);
      loadAllFinishedTimerRef.current = null;
    }
  }, [newSessionTrigger, onSessionIdle, resetStreamingState]);

  /* ---------------------------------------------------------------- */
  /*  Derive processing state for the viewed session                  */
  /* ---------------------------------------------------------------- */

  const activeSessionId = selectedSession?.id || currentSessionId || null;

  // The activity indicator always reflects the latest status of the session
  // being viewed — never stale local UI state from the last time it was
  // open. Session ids are concrete before any send, so no pending
  // placeholder entry exists anymore.
  const sessionActivity = (activeSessionId && processingSessions?.get(activeSessionId)) || null;
  const isProcessing = sessionActivity !== null;
  const canAbortSession = isProcessing && sessionActivity.canInterrupt;

  // Ref mirror so effects can read the latest map without re-running on
  // every activity transition.
  const processingSessionsRef = useRef(processingSessions);
  processingSessionsRef.current = processingSessions;

  /* ---------------------------------------------------------------- */
  /*  REQ-052: context compaction (chat.compact)                      */
  /* ---------------------------------------------------------------- */

  // The compacting session id, mirrored to a ref for the realtime handler
  // (which routes `complete`/`protocol_error` frames synchronously and must
  // not depend on React state timing). `isCompacting` is derived per-viewed
  // session so switching away never shows a foreign session's spinner.
  const [compactingSessionId, setCompactingSessionId] = useState<string | null>(null);
  const compactingSessionRef = useRef<string | null>(null);
  const isCompacting = compactingSessionId !== null && compactingSessionId === activeSessionId;

  const startCompactTracking = useCallback((sessionId: string) => {
    compactingSessionRef.current = sessionId;
    setCompactingSessionId(sessionId);
  }, []);

  const stopCompactTracking = useCallback((sessionId: string | null | undefined) => {
    if (!sessionId || compactingSessionRef.current !== sessionId) {
      return;
    }
    compactingSessionRef.current = null;
    setCompactingSessionId(null);
  }, []);

  /**
   * Terminal frame of a compact run (success, failure, or abort). The generic
   * `complete` branch already refreshes the transcript from the server (the
   * compact summary lands as a message); this adds the R2 mitigation — a
   * direct token-usage fetch so the button reads the post-compact context
   * size even when the compact run pushed no usage frame of its own.
   */
  const finishCompactSession = useCallback((sessionId: string | null | undefined) => {
    if (!sessionId || compactingSessionRef.current !== sessionId) {
      return;
    }
    stopCompactTracking(sessionId);

    if (!selectedProject) {
      return;
    }
    const url = `/api/projects/${selectedProject.projectId}/sessions/${sessionId}/token-usage`;
    authenticatedFetch(url)
      .then(async (response) => {
        setTokenBudget(response.ok ? await response.json() : null);
      })
      .catch((error) => {
        console.error('Failed to refresh token usage after compact:', error);
      });
  }, [selectedProject, stopCompactTracking]);

  /**
   * A compact request that was rejected before any run started
   * (protocol_error — COMPACT_UNSUPPORTED / COMPACT_EMPTY_SESSION /
   * RUN_IN_PROGRESS). No `complete` follows, so reset the button here; the
   * generic branch already surfaces the error message in the conversation.
   */
  const cancelCompactSession = useCallback((sessionId: string | null | undefined) => {
    stopCompactTracking(sessionId);
  }, [stopCompactTracking]);

  /** Click handler for the token-usage button: compact the viewed session. */
  const handleCompactSession = useCallback((model?: string) => {
    if (!activeSessionId || !supportsCompact) {
      return;
    }
    if (isCompacting || isProcessing) {
      // Compact occupies the same per-session run mutex as a chat send.
      return;
    }
    // Brand-new sessions have no provider conversation to summarize — the
    // server would reject with COMPACT_EMPTY_SESSION; skip the round trip.
    if (totalMessages === 0) {
      return;
    }

    startCompactTracking(activeSessionId);
    sendMessage({
      type: 'chat.compact',
      sessionId: activeSessionId,
      options: model ? { model } : undefined,
    });
  }, [activeSessionId, isCompacting, isProcessing, startCompactTracking, supportsCompact, sendMessage, totalMessages]);

  /* ---------------------------------------------------------------- */
  /*  Derive chatMessages from the store                              */
  /* ---------------------------------------------------------------- */
  const [pendingUserMessage, setPendingUserMessage] = useState<ChatMessage | null>(null);
  const flushedPendingUserMessageRef = useRef<ChatMessage | null>(null);

  // Tell the store which session we're viewing so it only re-renders for this one
  const prevActiveForStoreRef = useRef<string | null>(null);
  if (activeSessionId !== prevActiveForStoreRef.current) {
    prevActiveForStoreRef.current = activeSessionId;
    sessionStore.setActiveSession(activeSessionId);
  }

  useEffect(() => {
    if (!pendingUserMessage) {
      flushedPendingUserMessageRef.current = null;
      return;
    }

    if (!activeSessionId) {
      return;
    }

    if (flushedPendingUserMessageRef.current === pendingUserMessage) {
      return;
    }

    const prov = (localStorage.getItem('selected-provider') as LLMProvider) || 'claude';
    const normalized = chatMessageToNormalized(pendingUserMessage, activeSessionId, prov);
    if (normalized) {
      sessionStore.appendRealtime(activeSessionId, normalized);
    }

    flushedPendingUserMessageRef.current = pendingUserMessage;
    setPendingUserMessage(null);
  }, [activeSessionId, pendingUserMessage, sessionStore]);

  const storeMessages = activeSessionId ? sessionStore.getMessages(activeSessionId) : [];

  // REQ-052: compaction/archive metadata of the viewed session. Read from the
  // slot during render so every store fetch/refresh (including the live
  // compact_boundary re-fetch) refreshes it without extra state plumbing.
  // Providers without compaction support leave these unset — degrade to none.
  const sessionSlot = activeSessionId ? sessionStore.getSessionSlot(activeSessionId) : undefined;
  const hasArchivedMessages = Boolean(sessionSlot?.hasArchived);
  const compactionInfo: CompactionInfo | null = sessionSlot?.compaction ?? null;

  // Reset viewHiddenCount when store messages change
  const prevStoreLenRef = useRef(0);
  if (storeMessages.length !== prevStoreLenRef.current) {
    prevStoreLenRef.current = storeMessages.length;
    if (viewHiddenCount > 0) setViewHiddenCount(0);
  }

  const chatMessages = useMemo(() => {
    const all = normalizedToChatMessages(storeMessages);
    // Show pending user message when no session data exists yet (new session, pre-backend-response)
    if (pendingUserMessage && all.length === 0) {
      return [pendingUserMessage];
    }
    if (viewHiddenCount > 0 && viewHiddenCount < all.length) return all.slice(0, -viewHiddenCount);
    return all;
  }, [storeMessages, viewHiddenCount, pendingUserMessage]);

  /* ---------------------------------------------------------------- */
  /*  addMessage / clearMessages / rewindMessages                     */
  /* ---------------------------------------------------------------- */

  const addMessage = useCallback((msg: ChatMessage) => {
    if (!activeSessionId) {
      // No session yet — show as pending until the backend creates one
      setPendingUserMessage(msg);
      return;
    }
    const prov = (localStorage.getItem('selected-provider') as LLMProvider) || 'claude';
    const normalized = chatMessageToNormalized(msg, activeSessionId, prov);
    if (normalized) {
      sessionStore.appendRealtime(activeSessionId, normalized);
    }
  }, [activeSessionId, sessionStore]);

  const clearMessages = useCallback(() => {
    if (!activeSessionId) return;
    sessionStore.clearRealtime(activeSessionId);
  }, [activeSessionId, sessionStore]);

  const rewindMessages = useCallback((count: number) => setViewHiddenCount(count), []);

  const scrollToBottom = useCallback(() => {
    const last = visibleMessagesLengthRef.current - 1;
    if (last >= 0) virtuaRef.current?.scrollToIndex(last, { align: 'end' });
  }, []);

  const scrollToBottomAndReset = useCallback(() => {
    scrollToBottom();
    if (allMessagesLoaded) {
      setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
      setAllMessagesLoaded(false);
      allMessagesLoadedRef.current = false;
    }
  }, [allMessagesLoaded, scrollToBottom]);

  const isNearBottom = useCallback(() => {
    const ref = virtuaRef.current;
    if (!ref) return false;
    return ref.scrollSize - ref.scrollOffset - ref.viewportSize < 50;
  }, []);

  const loadOlderMessages = useCallback(
    async () => {
      if (isLoadingMoreRef.current || isLoadingMoreMessages) return false;
      if (allMessagesLoadedRef.current) return false;
      if (!hasMoreMessages || !selectedSession || !selectedProject) return false;

      isLoadingMoreRef.current = true;

      try {
        const slot = await sessionStore.fetchMore(selectedSession.id, {
          limit: MESSAGES_PER_PAGE,
          view: 'active',
        });
        if (!slot || slot.serverMessages.length === 0) return false;

        // REQ-041: 翻页锚定由 virtua delta 同帧补偿接管,不再设 pendingScrollRestore。
        setHasMoreMessages(slot.hasMore);
        setTotalMessages(slot.total);
        setVisibleMessageCount((prev) => prev + MESSAGES_PER_PAGE);
        return true;
      } finally {
        isLoadingMoreRef.current = false;
      }
    },
    [hasMoreMessages, isLoadingMoreMessages, selectedProject, selectedSession, sessionStore],
  );

  const handleScroll = useCallback(async () => {
    const ref = virtuaRef.current;
    if (!ref) return;

    const nearBottom = isNearBottom();
    setIsUserScrolledUp(!nearBottom);

    // REQ-041: 删 topLoadLock。它原是 react-virtual 时代防 applyOffset 推 scrollTop 反复触发
    // loadMore 的(virtua delta 补偿不改 scrollOffset,翻页时 offset 一直小,lock 的"offset>20 解锁"
    // 永不成立 → 只加载一次)。virtua 下不会反复触发,loadOlderMessages 内 isLoadingMoreRef 已防重入。
    if (!allMessagesLoadedRef.current && ref.scrollOffset < 100) {
      await loadOlderMessages();
    }
  }, [isNearBottom, loadOlderMessages]);

  // REQ-041: 翻页锚定由 virtua 的 delta 同帧补偿接管(原 RAF restore useLayoutEffect 已删)。


  // Reset scroll/pagination state on session change
  useEffect(() => {
    if (!searchScrollActiveRef.current) {
      pendingInitialScrollRef.current = true;
      setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    }
    topLoadLockRef.current = false;
    pendingScrollRestoreRef.current = null;
    setIsUserScrolledUp(false);
  }, [selectedProject?.projectId, selectedSession?.id]);

  // REQ-032 F1a: useLayoutEffect(非 useEffect)+ 首帧绘制前同步锚定 scrollTop,
  // 使首帧即位于底部,消除"顶部→底部"可见冲底。RAF 循环保留,职责退化为
  // 回流校正(markdown/代码/图片落位),因用户已在底部,读作"贴住"而非"下冲"。
  // 同文件 ~L380 的"加载更多滚位恢复"已用同款 useLayoutEffect+RAF 模式,此处对齐。
  useLayoutEffect(() => {
    if (!pendingInitialScrollRef.current || !virtuaRef.current || isLoadingSessionMessages) return;
    if (chatMessages.length === 0) { pendingInitialScrollRef.current = false; return; }
    if (searchScrollActiveRef.current) { pendingInitialScrollRef.current = false; return; }
    // REQ-041: virtua scrollToIndex 钉到底,virtua 内部处理高度收敛的 delta 补偿。
    const last = visibleMessagesLengthRef.current - 1;
    if (last >= 0) virtuaRef.current.scrollToIndex(last, { align: 'end' });
    pendingInitialScrollRef.current = false;
  }, [chatMessages.length, isLoadingSessionMessages]);

  // Main session loading effect — store-based
  useEffect(() => {
    if (!selectedSession || !selectedProject) {
      // A freshly created session can be mid-run before the router has a
      // canonical selectedSession (the URL effect synthesizes one on the
      // next render). Keep the active view intact instead of wiping it.
      if (currentSessionId && processingSessionsRef.current?.has(currentSessionId)) {
        return;
      }

      resetStreamingState();
      setCurrentSessionId(null);
      messagesOffsetRef.current = 0;
      setHasMoreMessages(false);
      setTotalMessages(0);
      setTokenBudget(null);
      lastLoadedSessionKeyRef.current = null;
      return;
    }

    const selectedSessionId = selectedSession.id;
    const sessionKey = `${selectedSessionId}:${selectedProject.projectId}`;

    const subscribeToSelectedSession = () => {
      if (!ws) {
        return;
      }

      statusCheckSentAtRef.current.set(selectedSessionId, Date.now());
      sendMessage({
        type: 'chat.subscribe',
        sessions: [{
          sessionId: selectedSessionId,
          lastSeq: lastSeqRef.current.get(selectedSessionId) ?? 0,
        }],
      });
    };

    // Skip if already loaded and fresh
    if (lastLoadedSessionKeyRef.current === sessionKey && sessionStore.has(selectedSessionId) && !sessionStore.isStale(selectedSessionId)) {
    // 缓存命中路径也要复位 render 阶段的预置位，否则缓存消息 + true 会一直转圈。
    // 同样清掉上一次中断加载留下的 true（否则 composer 整体缺失直到下次完整加载）。
      setIsLoadingSessionMessages(false);
      subscribeToSelectedSession();
      return;
    }

    // 性能测点 session-switch:包"会话切换触发的 messages 加载"——
    // 边界 = 状态重置 + subscribe + fetchFromServer（实际工作负载，不含缓存命中早退）。
    void measureAsync('session-switch', async () => {
      const sessionChanged = currentSessionId !== null && currentSessionId !== selectedSessionId;
      if (sessionChanged) {
        resetStreamingState();
      }

      // Reset pagination/scroll state
      messagesOffsetRef.current = 0;
      setHasMoreMessages(false);
      setTotalMessages(0);
      setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
      setAllMessagesLoaded(false);
      allMessagesLoadedRef.current = false;
      setIsLoadingAllMessages(false);
      setLoadAllJustFinished(false);
      setShowLoadAllOverlay(false);
      setViewHiddenCount(0);
      if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
      if (loadAllFinishedTimerRef.current) clearTimeout(loadAllFinishedTimerRef.current);

      if (sessionChanged) {
        setTokenBudget(null);
      }

      setCurrentSessionId(selectedSessionId);

      // Subscribe to the session's live run (if any): the ack reconciles the
      // processing indicator, re-attaches a mid-flight stream to this socket,
      // and replays any live events missed since `lastSeq`. Recording the send
      // time lets the ack handler discard idle acks that a newer request has
      // since outdated.
      subscribeToSelectedSession();

      lastLoadedSessionKeyRef.current = sessionKey;

      // Fetch from server → store updates → chatMessages re-derives automatically
      setIsLoadingSessionMessages(true);
      try {
        const slot = await sessionStore.fetchFromServer(selectedSessionId, {
          limit: MESSAGES_PER_PAGE,
          offset: 0,
          // REQ-052: main viewport renders only the latest compaction epoch;
          // pre-boundary history is browsed via the archive panel.
          view: 'active',
        });
        if (slot) {
          setHasMoreMessages(slot.hasMore);
          setTotalMessages(slot.total);
          if (slot.tokenUsage) setTokenBudget(slot.tokenUsage as Record<string, unknown>);
        }
      } finally {
        setIsLoadingSessionMessages(false);
      }
    }).catch(() => {
      setIsLoadingSessionMessages(false);
    });
  }, [
    resetStreamingState,
    selectedProject,
    selectedSession?.id,
    sendMessage,
    statusCheckSentAtRef,
    lastSeqRef,
    ws,
    sessionStore,
  ]);

  // External message update (e.g. WebSocket reconnect, background refresh)
  useEffect(() => {
    if (!externalMessageUpdate || !selectedSession || !selectedProject) return;

    const reloadExternalMessages = async () => {
      try {
        // Skip store refresh during active streaming
        if (!isProcessing) {
          await sessionStore.refreshFromServer(selectedSession.id);

          if (Boolean(autoScrollToBottom) && isNearBottom()) {
            setTimeout(() => scrollToBottom(), 200);
          }
        }
      } catch (error) {
        console.error('Error reloading messages from external update:', error);
      }
    };

    reloadExternalMessages();
  }, [
    autoScrollToBottom,
    externalMessageUpdate,
    isNearBottom,
    scrollToBottom,
    selectedProject,
    selectedSession,
    sessionStore,
    isProcessing,
  ]);

  // Search navigation target
  useEffect(() => {
    const session = selectedSession as Record<string, unknown> | null;
    const targetSnippet = session?.__searchTargetSnippet;
    const targetTimestamp = session?.__searchTargetTimestamp;
    if (typeof targetSnippet === 'string' && targetSnippet) {
      searchScrollActiveRef.current = true;
      setSearchTarget({
        snippet: targetSnippet,
        timestamp: typeof targetTimestamp === 'string' ? targetTimestamp : undefined,
      });
    }
  }, [selectedSession]);

  // Scroll to search target
  useEffect(() => {
    if (!searchTarget || chatMessages.length === 0 || isLoadingSessionMessages) return;

    const target = searchTarget;
    setSearchTarget(null);

    const scrollToTarget = async () => {
      if (!allMessagesLoadedRef.current && selectedSession && selectedProject) {
          try {
            // Load all messages into the store for search navigation
            const slot = await sessionStore.fetchFromServer(selectedSession.id, {
              limit: null,
              offset: 0,
              view: 'active',
            });
            if (slot) {
              setHasMoreMessages(false);
              setTotalMessages(slot.total);
              messagesOffsetRef.current = slot.total;
              setVisibleMessageCount(Infinity);
              setAllMessagesLoaded(true);
              allMessagesLoadedRef.current = true;
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          } catch {
            // Fall through and scroll in current messages
          }
      }
      setVisibleMessageCount(Infinity);

      const findAndScroll = (retriesLeft: number) => {
        // REQ-041: virtua 虚拟列表只渲染可见 item,target 可能未挂载 DOM,scrollIntoView 无效。
        // 改在 visibleMessages 数据里按 timestamp 找 index,virtuaRef.scrollToIndex 滚过去(virtua 会渲染该 item)。
        let targetIndex = -1;
        if (target.timestamp) {
          const targetDate = new Date(target.timestamp).getTime();
          let closestDiff = Infinity;
          visibleMessages.forEach((m, i) => {
            if (!m.timestamp) return;
            const diff = Math.abs(new Date(m.timestamp).getTime() - targetDate);
            if (diff < closestDiff) { closestDiff = diff; targetIndex = i; }
          });
        }

        if (targetIndex >= 0) {
          virtuaRef.current?.scrollToIndex(targetIndex, { align: 'center' });
          // virtua 滚动后该 item 才渲染,延迟加高亮 flash
          setTimeout(() => {
            const el = target.timestamp
              ? document.querySelector(`[data-message-timestamp="${target.timestamp}"]`)
              : null;
            el?.classList.add('search-highlight-flash');
            setTimeout(() => el?.classList.remove('search-highlight-flash'), 4000);
          }, 350);
          searchScrollActiveRef.current = false;
        } else if (retriesLeft > 0) {
          setTimeout(() => findAndScroll(retriesLeft - 1), 200);
        } else {
          searchScrollActiveRef.current = false;
        }
      };

      setTimeout(() => findAndScroll(15), 150);
    };

    scrollToTarget();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMessages.length, isLoadingSessionMessages, searchTarget]);

  // Initial token usage fetch for providers with file-backed usage data.
  useEffect(() => {
    if (!selectedProject || !selectedSession?.id) {
      setTokenBudget(null);
      return;
    }
    const fetchInitialTokenUsage = async () => {
      try {
        // The backend resolves the provider from the indexed session row.
        const url = `/api/projects/${selectedProject.projectId}/sessions/${selectedSession.id}/token-usage`;
        const response = await authenticatedFetch(url);
        if (response.ok) {
          setTokenBudget(await response.json());
        } else {
          setTokenBudget(null);
        }
      } catch (error) {
        console.error('Failed to fetch initial token usage:', error);
      }
    };
    fetchInitialTokenUsage();
  }, [selectedProject, selectedSession?.id]);

  const visibleMessages = useMemo(() => {
    if (chatMessages.length <= visibleMessageCount) return chatMessages;
    return chatMessages.slice(-visibleMessageCount);
  }, [chatMessages, visibleMessageCount]);
  // REQ-041: scrollToBottom/初始滚底 在 visibleMessages 声明前调用,用 ref 桥接长度。
  visibleMessagesLengthRef.current = visibleMessages.length;

  useEffect(() => {
    if (!autoScrollToBottom && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      scrollPositionRef.current = { height: container.scrollHeight, top: container.scrollTop };
    }
  });

  useEffect(() => {
    // REQ-032 F1b: 初始锚定窗口(pendingInitialScrollRef=true)由 F1a 的
    // useLayoutEffect + RAF 独占定位;此 effect 跳过,避免初始加载时冗余的
    // 50ms scrollToBottom 二次拽底、再造冲底。pending 置 false(RAF 收尾)后,
    // 此 effect 恢复本职:管"初始稳定后新追加消息"的自动贴底(流式/工具结果)。
    if (pendingInitialScrollRef.current) return;
    if (!scrollContainerRef.current || chatMessages.length === 0) return;
    if (isLoadingMoreRef.current || isLoadingMoreMessages || pendingScrollRestoreRef.current) return;
    if (searchScrollActiveRef.current) return;

    if (autoScrollToBottom) {
      if (!isUserScrolledUp) setTimeout(() => scrollToBottom(), 50);
      return;
    }

    const container = scrollContainerRef.current;
    const prevHeight = scrollPositionRef.current.height;
    const prevTop = scrollPositionRef.current.top;
    const newHeight = container.scrollHeight;
    const heightDiff = newHeight - prevHeight;
    if (heightDiff > 0 && prevTop > 0) container.scrollTop = prevTop + heightDiff;
  }, [autoScrollToBottom, chatMessages.length, isLoadingMoreMessages, isUserScrolledUp, scrollToBottom]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // "Load all" overlay
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = isLoadingMoreMessages;

    if (wasLoading && !isLoadingMoreMessages && hasMoreMessages) {
      if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
      setShowLoadAllOverlay(true);
      loadAllOverlayTimerRef.current = setTimeout(() => setShowLoadAllOverlay(false), 2000);
    }
    if (!hasMoreMessages && !isLoadingMoreMessages) {
      if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
      setShowLoadAllOverlay(false);
    }
    return () => { if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current); };
  }, [isLoadingMoreMessages, hasMoreMessages]);

  const loadAllMessages = useCallback(async () => {
    if (!selectedSession || !selectedProject) return;
    if (isLoadingAllMessages) return;
    const requestSessionId = selectedSession.id;
    allMessagesLoadedRef.current = true;
    isLoadingMoreRef.current = true;
    setIsLoadingAllMessages(true);
    setShowLoadAllOverlay(true);

    const container = scrollContainerRef.current;
    const previousScrollHeight = container ? container.scrollHeight : 0;
    const previousScrollTop = container ? container.scrollTop : 0;

    try {
      const slot = await sessionStore.fetchFromServer(requestSessionId, {
        limit: null,
        offset: 0,
        view: 'active',
      });

      if (currentSessionId !== requestSessionId) return;

      if (slot) {
        if (container) {
          pendingScrollRestoreRef.current = { height: previousScrollHeight, top: previousScrollTop };
        }

        setHasMoreMessages(false);
        setTotalMessages(slot.total);
        messagesOffsetRef.current = slot.total;
        setVisibleMessageCount(Infinity);
        setAllMessagesLoaded(true);

        setLoadAllJustFinished(true);
        if (loadAllFinishedTimerRef.current) clearTimeout(loadAllFinishedTimerRef.current);
        loadAllFinishedTimerRef.current = setTimeout(() => { setLoadAllJustFinished(false); setShowLoadAllOverlay(false); }, 1000);
      } else {
        allMessagesLoadedRef.current = false;
        setShowLoadAllOverlay(false);
      }
    } catch (error) {
      console.error('Error loading all messages:', error);
      allMessagesLoadedRef.current = false;
      setShowLoadAllOverlay(false);
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingAllMessages(false);
    }
  }, [selectedSession, selectedProject, isLoadingAllMessages, currentSessionId, sessionStore]);

  const loadEarlierMessages = useCallback(() => {
    // Legacy manual "load earlier" path (non-paginated view). Same measureElement
    // async-height drift applies, so capture an anchor for the shared RAF restore
    // (the restore effect above keys on visibleMessageCount too).
    const container = scrollContainerRef.current;
    if (container) {
      pendingScrollRestoreRef.current = { height: container.scrollHeight, top: container.scrollTop };
    }
    setVisibleMessageCount((prev) => prev + 100);
  }, []);

  return {
    chatMessages,
    addMessage,
    clearMessages,
    rewindMessages,
    sessionActivity,
    isProcessing,
    canAbortSession,
    currentSessionId,
    setCurrentSessionId,
    isLoadingSessionMessages,
    isLoadingMoreMessages,
    hasMoreMessages,
    totalMessages,
    isUserScrolledUp,
    setIsUserScrolledUp,
    tokenBudget,
    setTokenBudget,
    isCompacting,
    compactingSessionRef,
    handleCompactSession,
    finishCompactSession,
    cancelCompactSession,
    visibleMessageCount,
    visibleMessages,
    loadEarlierMessages,
    loadAllMessages,
    allMessagesLoaded,
    isLoadingAllMessages,
    loadAllJustFinished,
    showLoadAllOverlay,
    hasArchivedMessages,
    compactionInfo,
    createDiff,
    scrollContainerRef,
    virtuaRef,
    scrollToBottom,
    scrollToBottomAndReset,
    isNearBottom,
    handleScroll,
  };
}
