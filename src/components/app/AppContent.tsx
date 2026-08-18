import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import Sidebar from '../sidebar/view/Sidebar';
import MainContent from '../main-content/view/MainContent';
import CommandPalette from '../command-palette/CommandPalette';
import { useTerminalTabs } from '../terminal-panel/hooks/useTerminalTabs';
import TerminalPanel from '../terminal-panel/view/TerminalPanel';
import { KanbanProvider } from '../kanban';
import { MarkdownEditorProvider, useMarkdownEditor } from '../markdown-editor/context/MarkdownEditorContext';
import { MarkdownEditorPanel } from '../markdown-editor/view/MarkdownEditorPanel';
import { BackgroundTasksPanel } from '../background-tasks/view/BackgroundTasksPanel';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { PaletteOpsProvider, usePaletteOpsRegister } from '../../contexts/PaletteOpsContext';
import { useDeviceSettings } from '../../hooks/useDeviceSettings';
import { useSessionProtection } from '../../hooks/useSessionProtection';
import { useProjectsState } from '../../hooks/useProjectsState';
import { getAllSessions } from '../sidebar/utils/utils';
import type { PickerCandidateSession } from '../chat/view/subcomponents/SessionReferencePicker';
import { toCandidateSession } from '../chat/utils/candidateSession';
import { api } from '../../utils/api';

type RunningSessionApiItem = {
  sessionId?: unknown;
  startedAt?: unknown;
  statusText?: unknown;
  canInterrupt?: unknown;
};

type RunningSessionsApiPayload = {
  data?: {
    sessions?: RunningSessionApiItem[];
  };
};

const parseStartedAt = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export default function AppContent() {
  return (
    <PaletteOpsProvider>
      <MarkdownEditorProvider>
        <AppContentInner />
      </MarkdownEditorProvider>
    </PaletteOpsProvider>
  );
}

// REQ-047 — 暴露打开 Markdown 编辑器的 callback(给 Sidebar 入口按钮用)。
// 独立组件以使用 useMarkdownEditor(必须在 Provider 内)。
function useOpenMarkdownEditor() {
  const { open } = useMarkdownEditor();
  return (projectId: string | null | undefined, fullPath: string | undefined) => {
    if (!projectId || !fullPath) return;
    open(projectId, fullPath);
  };
}

function AppContentInner() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const { t } = useTranslation('common');
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { ws, sendMessage, subscribe } = useWebSocket();
  const openMarkdownEditor = useOpenMarkdownEditor();
  // REQ-046 — 后台任务面板 open 状态(受控,Sidebar 入口按钮触发)。
  const [showBackgroundTasks, setShowBackgroundTasks] = useState(false);
  const handleOpenBackgroundTasks = useCallback(() => setShowBackgroundTasks(true), []);

  const {
    processingSessions,
    completedSessions,
    markSessionProcessing,
    markSessionIdle,
    markSessionCompleted,
    clearSessionCompleted,
    syncProcessingSessions,
    clearProcessingSessions,
  } = useSessionProtection();

  const {
    projects,
    selectedProject,
    selectedSession,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    externalMessageUpdate,
    newSessionTrigger,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    openSettings,
    refreshProjectsSilently,
    registerOptimisticSession,
    sidebarSharedProps,
    handleNewSession,
    handleForkAtMessage,
  } = useProjectsState({
    sessionId,
    navigate,
    subscribe,
    isMobile,
    activeSessions: processingSessions,
    completedSessions,
    onCompletedSessionSeen: clearSessionCompleted,
  });

  const {
    terminals,
    activeTerminalId,
    isPanelOpen: isTerminalPanelOpen,
    panelHeight: terminalPanelHeight,
    resizeHandleRef: terminalResizeHandleRef,
    openTerminal,
    switchTerminal,
    closeTerminal,
    togglePanel: toggleTerminalPanel,
    handlePanelResizeStart: handleTerminalPanelResizeStart,
  } = useTerminalTabs({ selectedProject, isMobile });

  // Flatten every project's sessions into a single picker candidate list so the
  // SessionReferencePicker's "search all" mode can surface cross-project results.
  // `getAllSessions` reuses the sidebar's exact flattening + sort + provider
  // normalization, keeping this consistent with the rest of the app.
  const allPickerSessions = useMemo<PickerCandidateSession[]>(
    () => (projects ?? []).flatMap((project) =>
      getAllSessions(project).map((session) => toCandidateSession(session)),
    ),
    [projects],
  );

  // How many consecutive /sessions/running poll failures (5s apart) before the
  // frozen processing snapshot is dropped. Without this, a dead backend leaves
  // "reasoning" elapsed timers climbing forever on runs that died with it.
  const RUNNING_POLL_FAILURES_TO_CLEAR = 3;
  const runningPollFailuresRef = useRef(0);
  const handleRunningPollFailure = useCallback(() => {
    runningPollFailuresRef.current += 1;
    if (runningPollFailuresRef.current >= RUNNING_POLL_FAILURES_TO_CLEAR) {
      // Backend unreachable: drop the stale map. Still-running runs reappear
      // (with their original startedAt) on the next successful poll.
      clearProcessingSessions();
    }
  }, [clearProcessingSessions]);

  const refreshRunningSessions = useCallback(async () => {
    try {
      const response = await api.runningSessions();
      if (!response.ok) {
        handleRunningPollFailure();
        return;
      }
      runningPollFailuresRef.current = 0;

      const payload = (await response.json()) as RunningSessionsApiPayload;
      const sessions = Array.isArray(payload.data?.sessions) ? payload.data.sessions : [];

      syncProcessingSessions(
        sessions
          .map((session) => {
            if (typeof session.sessionId !== 'string' || !session.sessionId) {
              return null;
            }

            return {
              sessionId: session.sessionId,
              startedAt: parseStartedAt(session.startedAt),
              statusText: typeof session.statusText === 'string' ? session.statusText : undefined,
              canInterrupt: typeof session.canInterrupt === 'boolean' ? session.canInterrupt : undefined,
            };
          })
          .filter((session): session is NonNullable<typeof session> => Boolean(session)),
      );
    } catch (error) {
      handleRunningPollFailure();
      console.error('[AppContent] Failed to sync running sessions:', error);
    }
  }, [syncProcessingSessions, handleRunningPollFailure]);

  useEffect(() => {
    void refreshRunningSessions();
  }, [refreshRunningSessions]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshRunningSessions();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [refreshRunningSessions]);

  usePaletteOpsRegister({
    openSettings,
    refreshProjects: refreshProjectsSilently,
  });

  // REQ-047 — Sidebar 入口:打开当前选中项目的 Markdown 编辑器。
  const handleOpenMarkdownEditor = useCallback(() => {
    openMarkdownEditor(selectedProject?.projectId, selectedProject?.fullPath);
  }, [openMarkdownEditor, selectedProject?.projectId, selectedProject?.fullPath]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return undefined;
    }

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!message || message.type !== 'notification:navigate') {
        return;
      }

      if (typeof message.provider === 'string' && message.provider.trim()) {
        localStorage.setItem('selected-provider', message.provider);
      }

      setActiveTab('chat');
      setSidebarOpen(false);
      void refreshProjectsSilently();

      if (typeof message.sessionId === 'string' && message.sessionId) {
        navigate(`/session/${message.sessionId}`);
        return;
      }

      navigate('/');
    };

    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, [navigate, refreshProjectsSilently, setActiveTab, setSidebarOpen]);

  // Pending tool permissions are recovered through the `chat.subscribe` flow:
  // the `chat_subscribed` ack carries them on session open and on reconnect,
  // so no separate permission-recovery message is needed here.

  // Adjust the app container to stay above the virtual keyboard on iOS Safari.
  // On Chrome for Android the layout viewport already shrinks when the keyboard opens,
  // so inset-0 adjusts automatically. On iOS the layout viewport stays full-height and
  // the keyboard overlays it — we use the Visual Viewport API to track keyboard height
  // and apply it as a CSS variable that shifts the container's bottom edge up.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      // Only resize matters — keyboard open/close changes vv.height.
      // Do NOT listen to scroll: on iOS Safari, scrolling content changes
      // vv.offsetTop which would make --keyboard-height fluctuate during
      // normal scrolling, causing the container to bounce up and down.
      const kb = Math.max(0, window.innerHeight - vv.height);
      document.documentElement.style.setProperty('--keyboard-height', `${kb}px`);
    };
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, []);

  return (
    <div
      className={`fixed inset-0 flex bg-background ${typeof window !== 'undefined' && window.electronAPI && window.electronAPI.platform !== 'darwin' ? 'border-t border-border' : ''}`}
      style={{ top: 'env(titlebar-area-height, 0px)', bottom: 'var(--keyboard-height, 0px)' }}
    >
      {!isMobile ? (
        <div className="h-full flex-shrink-0 border-r border-border/50">
          <Sidebar {...sidebarSharedProps} onOpenMarkdownEditor={handleOpenMarkdownEditor} onOpenBackgroundTasks={handleOpenBackgroundTasks} />
        </div>
      ) : (
        <div
          className={`fixed inset-0 z-50 flex transition-all duration-150 ease-out ${sidebarOpen ? 'visible opacity-100' : 'invisible opacity-0'
            }`}
        >
          <button
            className="fixed inset-0 bg-background/60 backdrop-blur-sm transition-opacity duration-150 ease-out"
            onClick={(event) => {
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            onTouchStart={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            aria-label={t('versionUpdate.ariaLabels.closeSidebar')}
          />
          <div
            className={`relative h-full w-[85vw] max-w-sm transform border-r border-border/40 bg-card transition-transform duration-150 ease-out sm:w-80 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
              }`}
            onClick={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
          >
            <Sidebar {...sidebarSharedProps} onOpenMarkdownEditor={handleOpenMarkdownEditor} onOpenBackgroundTasks={handleOpenBackgroundTasks} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <KanbanProvider rootId={selectedProject?.projectId ?? null}>
          <MainContent
            selectedProject={selectedProject}
            selectedSession={selectedSession}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            ws={ws}
            sendMessage={sendMessage}
            isMobile={isMobile}
            onMenuClick={() => setSidebarOpen(true)}
            isLoading={isLoadingProjects}
            onInputFocusChange={setIsInputFocused}
            onSessionProcessing={markSessionProcessing}
            onSessionIdle={markSessionIdle}
            onSessionCompleted={markSessionCompleted}
            processingSessions={processingSessions}
            onNavigateToSession={(targetSessionId: string, options) =>
              navigate(`/session/${targetSessionId}`, { replace: Boolean(options?.replace) })
            }
            onSessionEstablished={(targetSessionId, context) =>
              registerOptimisticSession({ sessionId: targetSessionId, ...context })
            }
            onShowSettings={openSettings}
            externalMessageUpdate={externalMessageUpdate}
            newSessionTrigger={newSessionTrigger}
            allPickerSessions={allPickerSessions}
            onForkAtMessage={handleForkAtMessage}
            onToggleTerminalPanel={toggleTerminalPanel}
          />
        </KanbanProvider>

        {isTerminalPanelOpen && (
          <TerminalPanel
            terminals={terminals}
            activeTerminalId={activeTerminalId}
            panelHeight={terminalPanelHeight}
            resizeHandleRef={terminalResizeHandleRef}
            onResizeStart={handleTerminalPanelResizeStart}
            onSwitch={switchTerminal}
            onClose={closeTerminal}
            onNew={() => openTerminal(selectedProject)}
            onCollapse={toggleTerminalPanel}
          />
        )}
      </div>

      <CommandPalette
        selectedProject={selectedProject}
        onStartNewChat={handleNewSession}
        onOpenSettings={() => openSettings()}
        onShowTab={setActiveTab}
      />

      {/* REQ-047 — Markdown 编辑器面板(portal,自管 open 状态) */}
      <MarkdownEditorPanel />

      {/* REQ-046 — 后台任务面板(受控,Sidebar 入口触发) */}
      <BackgroundTasksPanel
        isOpen={showBackgroundTasks}
        onClose={() => setShowBackgroundTasks(false)}
      />
    </div>
  );
}
