import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWebSocket } from '../../../contexts/WebSocketContext';
import PermissionContext from '../../../contexts/PermissionContext';
import { ComposerProvider } from '../../../contexts/ComposerContext';
import { QuickSettingsPanel } from '../../quick-settings-panel';
import type { ChatInterfaceProps, Provider  } from '../types/types';
import { useChatProviderState } from '../hooks/useChatProviderState';
import { useChatSessionState } from '../hooks/useChatSessionState';
import { useChatRealtimeHandlers } from '../hooks/useChatRealtimeHandlers';
import { useChatComposerState } from '../hooks/useChatComposerState';
import { useAutoRename } from '../hooks/useAutoRename';
import { useSessionStore } from '../../../stores/useSessionStore';
import { isPermissionAcked, setPermissionAcked } from '../../../shared/defaults/permissionDefaults';
import {
  Confirmation,
  ConfirmationTitle,
  ConfirmationActions,
  ConfirmationAction,
  Dialog,
  DialogContent,
  DialogTitle,
} from '../../../shared/view/ui';

import ChatMessagesPane from './subcomponents/ChatMessagesPane';
import ChatComposer from './subcomponents/ChatComposer';
import CommandResultModal from './subcomponents/CommandResultModal';
import { toCandidateSession } from '../utils/candidateSession';


function ChatInterface({
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  onFileOpen,
  onInputFocusChange,
  onSessionProcessing,
  onSessionIdle,
  onSessionCompleted,
  processingSessions,
  onNavigateToSession,
  onSessionEstablished,
  onShowSettings,
  autoExpandTools,
  showRawParameters,
  showThinking,
  autoScrollToBottom,
  sendByCtrlEnter,
  externalMessageUpdate,
  newSessionTrigger,
  allPickerSessions,
  onForkAtMessage,
}: ChatInterfaceProps) {
  const { subscribe } = useWebSocket();
  const { t } = useTranslation('chat');

  const sessionStore = useSessionStore();
  const streamTimerRef = useRef<number | null>(null);
  const accumulatedStreamRef = useRef('');
  // When each session's `chat.subscribe` was last sent; idle acks older than
  // a later local request are discarded as stale.
  const statusCheckSentAtRef = useRef(new Map<string, number>());
  // Highest live `seq` observed per session. Written by the realtime handler
  // on every sequenced frame, read whenever a `chat.subscribe` is sent so the
  // server replays only the events this client actually missed.
  const lastSeqRef = useRef(new Map<string, number>());

  const resetStreamingState = useCallback(() => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    accumulatedStreamRef.current = '';
  }, []);

  const {
    provider,
    setProvider,
    cursorModel,
    setCursorModel,
    claudeModel,
    setClaudeModel,
    codexModel,
    setCodexModel,
    geminiModel,
    setGeminiModel,
    opencodeModel,
    setOpenCodeModel,
    kimiModel,
    setKimiModel,
    permissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
    providerModelCatalog,
    providerModelCacheCatalog,
    providerModelsLoading,
    providerModelsRefreshing,
    hardRefreshProviderModels,
    selectProviderModel,
  } = useChatProviderState({
    selectedSession,
    selectedProject,
  });

  const {
    chatMessages,
    addMessage,
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
    visibleMessageCount,
    visibleMessages,
    loadEarlierMessages,
    loadAllMessages,
    allMessagesLoaded,
    isLoadingAllMessages,
    loadAllJustFinished,
    showLoadAllOverlay,
    createDiff,
    scrollContainerRef,
    virtuaRef,
    scrollToBottom,
    scrollToBottomAndReset,
    handleScroll,
  } = useChatSessionState({
    selectedProject,
    selectedSession,
    ws,
    sendMessage,
    autoScrollToBottom,
    externalMessageUpdate,
    newSessionTrigger,
    processingSessions,
    onSessionIdle,
    resetStreamingState,
    statusCheckSentAtRef,
    lastSeqRef,
    sessionStore,
  });

  // Brand-new conversation: the composer allocated a stable session id via
  // the session gateway before the first send. Record it locally and put it
  // in the URL — this id never changes again, so there is no later handoff.
  const handleSessionEstablished = useCallback<NonNullable<ChatInterfaceProps['onSessionEstablished']>>((sessionId, context) => {
    setCurrentSessionId(sessionId);
    onSessionEstablished?.(sessionId, context);
    onNavigateToSession?.(sessionId);
  }, [setCurrentSessionId, onSessionEstablished, onNavigateToSession]);

  const {
    input,
    setInput,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    attachedImages,
    setAttachedImages,
    uploadingImages,
    imageErrors,
    getRootProps,
    getInputProps,
    isDragActive,
    openImagePicker,
    handleSubmit,
    handleVoiceTranscript,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleClearInput,
    handleAbortSession,
    handlePermissionDecision,
    handleGrantToolPermission,
    handleInputFocusChange,
    isInputFocused: _isInputFocused,
    commandModalPayload,
    closeCommandModal,
    showCostModal,
    references,
    formattedHints,
    isReferencePickerOpen,
    openReferencePicker,
    closeReferencePicker,
    handleConfirmReference,
    removeReference,
  } = useChatComposerState({
    selectedProject,
    selectedSession,
    currentSessionId,
    provider,
    permissionMode,
    cyclePermissionMode,
    cursorModel,
    claudeModel,
    codexModel,
    geminiModel,
    opencodeModel,
    kimiModel,
    isLoading: isProcessing,
    canAbortSession,
    tokenBudget,
    sendMessage,
    sendByCtrlEnter,
    onSessionProcessing,
    onSessionEstablished: handleSessionEstablished,
    onInputFocusChange,
    onFileOpen,
    onShowSettings,
    scrollToBottom,
    addMessage,
    setIsUserScrolledUp,
    pendingPermissionRequests,
    setPendingPermissionRequests,
  });

  // REQ-027 ④: composer 注入路径 —— 供 diff 行级评论「复制为消息」等使用
  const insertTextToComposer = useCallback(
    (text: string) => {
      setInput((prev: string) => (prev && prev.trim() ? `${prev}\n${text}` : text));
    },
    [setInput],
  );

  // On WebSocket reconnect, re-fetch the current session's messages from the
  // server so missed streaming events are shown, then re-subscribe — the
  // `chat_subscribed` ack restores or clears the activity indicator, replays
  // missed live events, and re-attaches a still-running stream to this socket.
  const handleWebSocketReconnect = useCallback(async () => {
    if (!selectedProject || !selectedSession) return;
    await sessionStore.refreshFromServer(selectedSession.id);
    statusCheckSentAtRef.current.set(selectedSession.id, Date.now());
    sendMessage({
      type: 'chat.subscribe',
      sessions: [{
        sessionId: selectedSession.id,
        lastSeq: lastSeqRef.current.get(selectedSession.id) ?? 0,
      }],
    });
  }, [selectedProject, selectedSession, sendMessage, sessionStore]);

  // REQ-030: auto-rename at the 10th assistant turn. `useAutoRename` exposes
  // two entry points: `onNormalRunCompleted` (the trigger — fires the silent
  // rename request when a NORMAL run completes and the viewed session crosses
  // the turn threshold) and `onSilentRunCompleted` (resets the in-flight guard
  // when the silent rename run itself finishes). Both wire into
  // `useChatRealtimeHandlers` below.
  // `sendMessage: (message: unknown) => void` is structurally assignable to
  // `useAutoRename`'s narrowed `(frame: SilentRenameSendFrame) => void`
  // (parameter contravariance — a sink accepting `unknown` accepts any frame).
  const { onNormalRunCompleted, onSilentRunCompleted } = useAutoRename({
    selectedSession,
    sessionStore,
    sendMessage,
  });

  useChatRealtimeHandlers({
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
    onWebSocketReconnect: handleWebSocketReconnect,
    sessionStore,
  });

  useEffect(() => {
    if (!canAbortSession) {
      return;
    }

    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      handleAbortSession();
    };

    document.addEventListener('keydown', handleGlobalEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleGlobalEscape, { capture: true });
    };
  }, [canAbortSession, handleAbortSession]);

  useEffect(() => {
    return () => {
      resetStreamingState();
    };
  }, [resetStreamingState]);

  // REQ-042: 系统通知回调 —— 点击切 session / reply+action 回灌 permission 决策
  useEffect(() => {
    const cleanup = (window as any).onNotificationCallback?.((data: any) => {
      if (!data) return;

      if (data.type === 'click' && data.sessionId) {
        onNavigateToSession?.(data.sessionId);
        return;
      }

      if ((data.type === 'reply' || data.type === 'action') && data.requestId) {
        // reply 默认批准并把用户回复作为 message；action 按 data.action 映射 allow/deny
        const allow = data.type === 'reply' ? true : data.action !== 'deny';
        handlePermissionDecision(data.requestId as string, {
          allow,
          message: typeof data.reply === 'string' ? data.reply : undefined,
        });
      }
    });
    return cleanup;
  }, [onNavigateToSession, handlePermissionDecision]);

  const permissionContextValue = useMemo(() => ({
    pendingPermissionRequests,
    handlePermissionDecision,
  }), [pendingPermissionRequests, handlePermissionDecision]);

  // 首次启用"默认不限权限"时的一次性风险确认（确认前拦截发送）
  // 未用 plan 的 useEffect 自动弹窗——会在会话加载时无意义弹出；改为拦截提交路径，仅在实际发送时触发
  const [showPermissionAck, setShowPermissionAck] = useState(false);
  const needsPermissionAck = !isPermissionAcked() && permissionMode !== 'default';
  // 危险模式确认：拦截遮罩点击触发的关闭。Dialog 的 onPointerDownOutside 在 onOpenChange(false)
  // 之前同步触发——置标志位，onOpenChange 读后即焚，从而屏蔽遮罩点击（仍允许 Escape / 取消按钮）。
  const suppressOutsideCloseRef = useRef(false);
  const handleAckOpenChange = useCallback((next: boolean) => {
    if (!next && suppressOutsideCloseRef.current) {
      suppressOutsideCloseRef.current = false;
      return;
    }
    setShowPermissionAck(next);
  }, []);
  const handleAckPointerDownOutside = useCallback(() => {
    suppressOutsideCloseRef.current = true;
  }, []);

  // 确认后不自动发送本次消息——需用户再次点击发送（设计预期，见 spec）
  const guardedSubmit = useCallback(
    (event: Parameters<typeof handleSubmit>[0]) => {
      event.preventDefault(); // 阻止 form 原生提交(否则页面 reload)
      if (needsPermissionAck) {
        setShowPermissionAck(true);
        return;
      }
      handleSubmit(event);
    },
    [handleSubmit, needsPermissionAck],
  );

  const handleAckConfirm = useCallback(() => {
    setPermissionAcked();
    setShowPermissionAck(false);
  }, []);

  const handleAckCancel = useCallback(() => {
    setShowPermissionAck(false);
  }, []);

  // Build picker candidate sessions from the current project's sessions.
  // `pickerAllSessions` (cross-project) comes from AppContent, which has the
  // full projects array; both lists share `toCandidateSession` so the same
  // session renders identically in either pool.
  const pickerDefaultSessions = useMemo(() => {
    const sessions = selectedProject?.sessions ?? [];
    return sessions.map((s) => toCandidateSession(s, provider));
  }, [selectedProject?.sessions, provider]);

  if (!selectedProject) {
    const selectedProviderLabel =
      provider === 'cursor'
        ? t('messageTypes.cursor')
        : provider === 'codex'
          ? t('messageTypes.codex')
          : provider === 'gemini'
            ? t('messageTypes.gemini')
            : provider === 'opencode'
              ? t('messageTypes.opencode', { defaultValue: 'OpenCode' })
              : provider === 'kimi'
                ? t('messageTypes.kimi', { defaultValue: 'Kimi Code' })
                : t('messageTypes.claude');

    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <p className="text-sm">
            {t('projectSelection.startChatWithProvider', {
              provider: selectedProviderLabel,
              defaultValue: 'Select a project to start chatting with {{provider}}',
            })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <ComposerProvider value={{ insertText: insertTextToComposer }}>
      <PermissionContext.Provider value={permissionContextValue}>
        <div className="flex h-full flex-col">
        <ChatMessagesPane
          scrollContainerRef={scrollContainerRef}
          virtuaRef={virtuaRef}
          onWheel={handleScroll}
          onTouchMove={handleScroll}
          isLoadingSessionMessages={isLoadingSessionMessages}
          isProcessing={isProcessing}
          chatMessages={chatMessages}
          selectedSession={selectedSession}
          currentSessionId={currentSessionId}
          provider={provider}
          setProvider={(nextProvider) => setProvider(nextProvider as Provider)}
          textareaRef={textareaRef}
          claudeModel={claudeModel}
          setClaudeModel={setClaudeModel}
          cursorModel={cursorModel}
          setCursorModel={setCursorModel}
          codexModel={codexModel}
          setCodexModel={setCodexModel}
          geminiModel={geminiModel}
          setGeminiModel={setGeminiModel}
          opencodeModel={opencodeModel}
          setOpenCodeModel={setOpenCodeModel}
          kimiModel={kimiModel}
          setKimiModel={setKimiModel}
          providerModelCatalog={providerModelCatalog}
          providerModelsLoading={providerModelsLoading}
          isLoadingMoreMessages={isLoadingMoreMessages}
          hasMoreMessages={hasMoreMessages}
          totalMessages={totalMessages}
          sessionMessagesCount={chatMessages.length}
          visibleMessageCount={visibleMessageCount}
          visibleMessages={visibleMessages}
          loadEarlierMessages={loadEarlierMessages}
          loadAllMessages={loadAllMessages}
          allMessagesLoaded={allMessagesLoaded}
          isLoadingAllMessages={isLoadingAllMessages}
          loadAllJustFinished={loadAllJustFinished}
          showLoadAllOverlay={showLoadAllOverlay}
          createDiff={createDiff}
          onFileOpen={onFileOpen}
          onOpenSession={onNavigateToSession ? (sessionId: string) => onNavigateToSession(sessionId) : undefined}
          onShowSettings={onShowSettings}
          onGrantToolPermission={handleGrantToolPermission}
          autoExpandTools={autoExpandTools}
          showRawParameters={showRawParameters}
          showThinking={showThinking}
          selectedProject={selectedProject}
          onForkAtMessage={onForkAtMessage}
        />

        <ChatComposer
          pendingPermissionRequests={pendingPermissionRequests}
          handlePermissionDecision={handlePermissionDecision}
          handleGrantToolPermission={handleGrantToolPermission}
          activity={sessionActivity}
          isLoading={isProcessing}
          onAbortSession={handleAbortSession}
          permissionMode={permissionMode}
          onModeSwitch={cyclePermissionMode}
          tokenBudget={tokenBudget}
          onShowTokenUsage={showCostModal}
          slashCommandsCount={slashCommandsCount}
          onToggleCommandMenu={handleToggleCommandMenu}
          hasInput={Boolean(input.trim())}
          onClearInput={handleClearInput}
          isUserScrolledUp={isUserScrolledUp}
          hasMessages={chatMessages.length > 0}
          onScrollToBottom={scrollToBottomAndReset}
          onSubmit={guardedSubmit}
          isDragActive={isDragActive}
          attachedImages={attachedImages}
          onRemoveImage={(index) =>
            setAttachedImages((previous) =>
              previous.filter((_, currentIndex) => currentIndex !== index),
            )
          }
          uploadingImages={uploadingImages}
          imageErrors={imageErrors}
          showFileDropdown={showFileDropdown}
          filteredFiles={filteredFiles}
          selectedFileIndex={selectedFileIndex}
          onSelectFile={selectFile}
          filteredCommands={filteredCommands}
          selectedCommandIndex={selectedCommandIndex}
          onCommandSelect={handleCommandSelect}
          onCloseCommandMenu={resetCommandMenuState}
          isCommandMenuOpen={showCommandMenu}
          frequentCommands={commandQuery ? [] : frequentCommands}
          getRootProps={getRootProps as (...args: unknown[]) => Record<string, unknown>}
          getInputProps={getInputProps as (...args: unknown[]) => Record<string, unknown>}
          openImagePicker={openImagePicker}
          inputHighlightRef={inputHighlightRef}
          renderInputWithMentions={renderInputWithMentions}
          textareaRef={textareaRef}
          input={input}
          onVoiceTranscript={handleVoiceTranscript}
          onInputChange={handleInputChange}
          onTextareaClick={handleTextareaClick}
          onTextareaKeyDown={handleKeyDown}
          onTextareaPaste={handlePaste}
          onTextareaScrollSync={syncInputOverlayScroll}
          onTextareaInput={handleTextareaInput}
          onInputFocusChange={handleInputFocusChange}
          placeholder={t('input.placeholder', {
            provider:
              provider === 'cursor'
                ? t('messageTypes.cursor')
                : provider === 'codex'
                  ? t('messageTypes.codex')
                  : provider === 'gemini'
                    ? t('messageTypes.gemini')
                    : provider === 'opencode'
                      ? t('messageTypes.opencode', { defaultValue: 'OpenCode' })
                      : provider === 'kimi'
                        ? t('messageTypes.kimi', { defaultValue: 'Kimi Code' })
                        : t('messageTypes.claude'),
          })}
          isTextareaExpanded={isTextareaExpanded}
          sendByCtrlEnter={sendByCtrlEnter}
          references={references}
          onOpenReferencePicker={openReferencePicker}
          onRemoveReference={removeReference}
          isReferencePickerOpen={isReferencePickerOpen}
          onCloseReferencePicker={closeReferencePicker}
          onConfirmReference={handleConfirmReference}
          pickerDefaultSessions={pickerDefaultSessions}
          pickerAllSessions={allPickerSessions}
        />
      </div>

      <QuickSettingsPanel />

      <CommandResultModal
        payload={commandModalPayload}
        onClose={closeCommandModal}
        providerModelCatalog={providerModelCatalog}
        providerModelCacheCatalog={providerModelCacheCatalog}
        providerModelsRefreshing={providerModelsRefreshing}
        onHardRefreshProviderModels={hardRefreshProviderModels}
        currentSessionId={currentSessionId || selectedSession?.id || null}
        onSelectProviderModel={selectProviderModel}
      />

      <Dialog open={showPermissionAck} onOpenChange={handleAckOpenChange}>
        <DialogContent
          className="max-w-md rounded-2xl border-border/80 bg-popover p-5 shadow-2xl"
          // 危险模式确认：点击遮罩不关闭（避免隐式取消）；Escape 仍可显式取消
          onPointerDownOutside={handleAckPointerDownOutside}
        >
          <DialogTitle>{t('defaults.permission.ackTitleAccessible')}</DialogTitle>
          <Confirmation className="border-0 px-0 py-0">
            <ConfirmationTitle className="text-base font-semibold text-foreground">
              {t('defaults.permission.ackTitle')}
            </ConfirmationTitle>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t('defaults.permission.ackMessage')}
            </p>
            <ConfirmationActions className="mt-4">
              <ConfirmationAction variant="outline" onClick={handleAckCancel}>
                {t('defaults.permission.ackCancel')}
              </ConfirmationAction>
              <ConfirmationAction onClick={handleAckConfirm}>
                {t('defaults.permission.ackConfirm')}
              </ConfirmationAction>
            </ConfirmationActions>
          </Confirmation>
        </DialogContent>
      </Dialog>
    </PermissionContext.Provider>
    </ComposerProvider>
  );
}

export default React.memo(ChatInterface);
