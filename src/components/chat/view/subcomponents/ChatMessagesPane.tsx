import { useTranslation } from 'react-i18next';
import { useCallback, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { VList, type VListHandle } from 'virtua';

import type { ChatMessage } from '../../types/types';
import type {
  Project,
  ProjectSession,
  LLMProvider,
  ProviderModelsDefinition,
} from '../../../../types/app';
import { getIntrinsicMessageKey } from '../../utils/messageKeys';

import MessageComponent from './MessageComponent';
import ProviderSelectionEmptyState from './ProviderSelectionEmptyState';

/**
 * Providers whose transcript format supports message-level fork truncation
 * (NDJSON with a per-line timestamp). cursor (SQLite blob DAG) and opencode
 * (shared SQLite, no jsonl_path) are excluded — their fork buttons stay hidden.
 */
const MESSAGE_FORKABLE_PROVIDERS: ReadonlySet<LLMProvider> = new Set([
  'claude', 'codex', 'gemini', 'kimi', 'zcode',
]);

interface ChatMessagesPaneProps {
  scrollContainerRef: RefObject<HTMLDivElement>;
  virtuaRef: RefObject<VListHandle>;
  onWheel: () => void;
  onTouchMove: () => void;
  isLoadingSessionMessages: boolean;
  /** True while the viewed session has an active provider run in flight. */
  isProcessing?: boolean;
  chatMessages: ChatMessage[];
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: LLMProvider;
  setProvider: (provider: LLMProvider) => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
  claudeModel: string;
  setClaudeModel: (model: string) => void;
  cursorModel: string;
  setCursorModel: (model: string) => void;
  codexModel: string;
  setCodexModel: (model: string) => void;
  geminiModel: string;
  setGeminiModel: (model: string) => void;
  opencodeModel: string;
  setOpenCodeModel: (model: string) => void;
  kimiModel: string;
  setKimiModel: (model: string) => void;
  providerModelCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>;
  providerModelsLoading: boolean;
  isLoadingMoreMessages: boolean;
  hasMoreMessages: boolean;
  totalMessages: number;
  sessionMessagesCount: number;
  visibleMessageCount: number;
  visibleMessages: ChatMessage[];
  loadEarlierMessages: () => void;
  loadAllMessages: () => void;
  allMessagesLoaded: boolean;
  isLoadingAllMessages: boolean;
  loadAllJustFinished: boolean;
  showLoadAllOverlay: boolean;
  createDiff: any;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onOpenSession?: (sessionId: string) => void;
  onShowSettings?: () => void;
  onGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  autoExpandTools?: boolean;
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject: Project;
  onForkAtMessage?: (sessionId: string, upToTimestamp: string | number) => void;
}

export default function ChatMessagesPane({
  scrollContainerRef,
  virtuaRef,
  onWheel,
  onTouchMove,
  isLoadingSessionMessages,
  isProcessing = false,
  chatMessages,
  selectedSession,
  currentSessionId,
  provider,
  setProvider,
  textareaRef,
  claudeModel,
  setClaudeModel,
  cursorModel,
  setCursorModel,
  codexModel,
  setCodexModel,
  geminiModel,
  setGeminiModel,
  opencodeModel,
  setOpenCodeModel,
  kimiModel,
  setKimiModel,
  providerModelCatalog,
  providerModelsLoading,
  isLoadingMoreMessages,
  hasMoreMessages,
  totalMessages,
  sessionMessagesCount,
  visibleMessageCount,
  visibleMessages,
  loadEarlierMessages,
  loadAllMessages,
  allMessagesLoaded,
  isLoadingAllMessages,
  loadAllJustFinished,
  showLoadAllOverlay,
  createDiff,
  onFileOpen,
  onOpenSession,
  onShowSettings,
  onGrantToolPermission,
  autoExpandTools,
  showRawParameters,
  showThinking,
  selectedProject,
  onForkAtMessage,
}: ChatMessagesPaneProps) {
  const { t } = useTranslation('chat');
  const messageKeyMapRef = useRef<WeakMap<ChatMessage, string>>(new WeakMap());
  const allocatedKeysRef = useRef<Set<string>>(new Set());
  const generatedMessageKeyCounterRef = useRef(0);

  // Keep keys stable across prepends so existing MessageComponent instances retain local state.
  const getMessageKey = useCallback((message: ChatMessage) => {
    const existingKey = messageKeyMapRef.current.get(message);
    if (existingKey) {
      return existingKey;
    }

    const intrinsicKey = getIntrinsicMessageKey(message);
    let candidateKey = intrinsicKey;

    if (!candidateKey || allocatedKeysRef.current.has(candidateKey)) {
      do {
        generatedMessageKeyCounterRef.current += 1;
        candidateKey = intrinsicKey
          ? `${intrinsicKey}-${generatedMessageKeyCounterRef.current}`
          : `message-generated-${generatedMessageKeyCounterRef.current}`;
      } while (allocatedKeysRef.current.has(candidateKey));
    }

    allocatedKeysRef.current.add(candidateKey);
    messageKeyMapRef.current.set(message, candidateKey);
    return candidateKey;
  }, []);

  // REQ-041: 流式生成中的最后一条 keepMounted,防虚拟列表回收导致 markdown 动画重放
  const streamingIndices = useMemo(() => {
    if (!isProcessing || visibleMessages.length === 0) return [];
    return [visibleMessages.length - 1];
  }, [isProcessing, visibleMessages.length]);

  return (
    <div
      ref={scrollContainerRef}
      onWheel={onWheel}
      onTouchMove={onTouchMove}
      className="relative flex flex-1 flex-col overflow-hidden bg-workbench-canvas px-0 py-3 sm:p-4"
    >
      {(isLoadingSessionMessages || isProcessing) && chatMessages.length === 0 ? (
        <div className="mt-8 text-center text-workbench-subtle">
          <div className="flex items-center justify-center space-x-2">
            <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-workbench-border border-t-workbench-accent" />
            <p>{t('session.loading.sessionMessages')}</p>
          </div>
        </div>
      ) : chatMessages.length === 0 ? (
        <ProviderSelectionEmptyState
          selectedSession={selectedSession}
          currentSessionId={currentSessionId}
          provider={provider}
          setProvider={setProvider}
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
        />
      ) : (
        <>
          {/* Loading indicator for older messages (hide when load-all is active) */}
          {isLoadingMoreMessages && !isLoadingAllMessages && !allMessagesLoaded && (
            <div className="py-3 text-center text-workbench-subtle">
              <div className="flex items-center justify-center space-x-2">
                <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-gray-400" />
                <p className="text-sm">{t('session.loading.olderMessages')}</p>
              </div>
            </div>
          )}

          {/* REQ-041: 删"显示 X/Y 向上滚动以加载更多"indicator(virtua 翻页靠 onScroll 触发,不依赖提示) */}

          {/* Floating "Load all messages" overlay */}
          {(showLoadAllOverlay || isLoadingAllMessages || loadAllJustFinished) && (
            <div className="pointer-events-none sticky top-2 z-20 flex justify-center">
              {loadAllJustFinished ? (
                <div className="ds-status ds-status-complete shadow-sm">
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>{t('session.messages.allLoaded')}</span>
                </div>
              ) : (
                <button
                  className="ds-focus-ring pointer-events-auto flex items-center space-x-2 rounded-md bg-workbench-accent px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:opacity-90 disabled:cursor-wait disabled:opacity-75"
                  onClick={loadAllMessages}
                  disabled={isLoadingAllMessages}
                >
                  {isLoadingAllMessages && (
                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  )}
                  <span>
                    {isLoadingAllMessages
                      ? t('session.messages.loadingAll')
                      : <>{t('session.messages.loadAll')} {totalMessages > 0 && `(${totalMessages})`}</>
                    }
                  </span>
                </button>
              )}
            </div>
          )}

          {/* Legacy message count indicator (for non-paginated view) */}
          {!hasMoreMessages && chatMessages.length > visibleMessageCount && (
            <div className="border-b border-workbench-border py-2 text-center text-sm text-workbench-subtle">
              {t('session.messages.showingLast', { count: visibleMessageCount, total: chatMessages.length })} |
              <button className="ml-1 text-workbench-accent underline hover:opacity-80" onClick={loadEarlierMessages}>
                {t('session.messages.loadEarlier')}
              </button>
              {' | '}
              <button
                className="text-workbench-accent underline hover:opacity-80"
                onClick={loadAllMessages}
              >
                {t('session.messages.loadAll')}
              </button>
            </div>
          )}

          {/* REQ-041: virtua VList(flow 布局 + delta 同帧补偿)替代 @tanstack/react-virtual。
              virtua 在 item 高度从 estimate 收敛到真实时把 delta 同帧应用到 scroll offset,
              消除"涌入虚高 + measure 回落"两次 commit 的中间态抖动。 */}
          <VList ref={virtuaRef} data={visibleMessages} keepMounted={streamingIndices} onScroll={onWheel} style={{ flex: 1, overflowAnchor: 'none' }}>
            {(message: ChatMessage, index: number) => {
              const prevMessage = index > 0 ? visibleMessages[index - 1] : null;
              const nextMessage = index < visibleMessages.length - 1 ? visibleMessages[index + 1] : null;
              return (
                <div key={getMessageKey(message)} style={{ paddingBottom: '0.75rem' }}>
                  <MessageComponent
                    message={message}
                    prevMessage={prevMessage}
                    nextMessage={nextMessage}
                    createDiff={createDiff}
                    onFileOpen={onFileOpen}
                    onOpenSession={onOpenSession}
                    onShowSettings={onShowSettings}
                    onGrantToolPermission={onGrantToolPermission}
                    autoExpandTools={autoExpandTools}
                    showRawParameters={showRawParameters}
                    showThinking={showThinking}
                    selectedProject={selectedProject}
                    provider={provider}
                    canForkAtMessage={Boolean(onForkAtMessage && currentSessionId && MESSAGE_FORKABLE_PROVIDERS.has(provider))}
                    onForkAtMessage={onForkAtMessage && currentSessionId ? () => onForkAtMessage(currentSessionId, message.timestamp instanceof Date ? message.timestamp.getTime() : message.timestamp) : undefined}
                  />
                </div>
              );
            }}
          </VList>
        </>
      )}
    </div>
  );
}
