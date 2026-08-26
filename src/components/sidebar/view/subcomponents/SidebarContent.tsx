import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Archive, ChevronLeft, Copy, Edit2, Folder, FolderOpen, FolderTree, MessageSquare, Network, Pin, PinOff, RefreshCw, RotateCcw, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import { FixedSizeList as List, type ListChildComponentProps } from 'react-window';
import type { TFunction } from 'i18next';

import { Button, Dialog, DialogContent, DialogTitle, ScrollArea } from '../../../../shared/view/ui';
import ContextMenu, { type ContextMenuAction } from '../../../../shared/view/ContextMenu';
import { startSessionDrag } from '../../../../shared/view/sessionDrag';
import { api } from '../../../../utils/api';
import { copyTextToClipboard } from '../../../../utils/clipboard';
import { useA2aDelegate } from '../../contexts/A2aDelegateContext';
import { usePaletteOps } from '../../../../contexts/PaletteOpsContext';
import type { AppTab, LLMProvider, Project } from '../../../../types/app';
import type { CompletedSessionNotificationMap } from '../../../../hooks/useSessionProtection';
import type { SessionTaskStatus } from '../../../../shared/taskStatus';
import SessionTaskStatusBadge from '../../../../shared/SessionTaskStatusBadge';
import type { ReleaseInfo } from '../../../../types/sharedTypes';
import type { ConversationSearchResults, SearchProgress } from '../../hooks/useSidebarController';
import type { ArchivedProjectListItem, ArchivedSessionListItem, SidebarSearchMode } from '../../types/types';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import { getAllSessions, getSessionDate, getSessionName } from '../../utils/utils';
import FileTree from '../../../file-tree/view/FileTree';
import { WorkbenchRail } from '../../../workbench';

import { getSidebarRailFooterItems, getSidebarRailItems, isWorkbenchTab } from './sidebarRailItems';
import SidebarFooter from './SidebarFooter';
import SidebarHeader from './SidebarHeader';
import SidebarProjectList, { type SidebarProjectListProps } from './SidebarProjectList';

function HighlightedSnippet({ snippet, highlights }: { snippet: string; highlights: { start: number; end: number }[] }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const h of highlights) {
    if (h.start > cursor) {
      parts.push(snippet.slice(cursor, h.start));
    }
    parts.push(
      <mark key={h.start} className="rounded-sm bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-800">
        {snippet.slice(h.start, h.end)}
      </mark>
    );
    cursor = h.end;
  }
  if (cursor < snippet.length) {
    parts.push(snippet.slice(cursor));
  }
  return (
    <span className="text-xs leading-relaxed text-muted-foreground">
      {parts}
    </span>
  );
}

type ArchivedSessionGroup = {
  key: string;
  projectId: string | null;
  projectDisplayName: string;
  projectPath: string | null;
  isProjectArchived: boolean;
  sessions: ArchivedSessionListItem[];
  latestActivity: string | null;
};

type ConversationListItem = {
  project: Project;
  session: ReturnType<typeof getAllSessions>[number];
  lastActivityTime: number;
};

/**
 * Groups archived sessions by project metadata so the archive view preserves
 * the same mental model as the active sidebar: projects first, then sessions.
 */
function groupArchivedSessionsByProject(sessions: ArchivedSessionListItem[]): ArchivedSessionGroup[] {
  const groups = new Map<string, ArchivedSessionGroup>();

  for (const session of sessions) {
    const key = session.projectId ?? session.projectPath ?? `session:${session.sessionId}`;
    const existingGroup = groups.get(key);

    if (existingGroup) {
      existingGroup.sessions.push(session);
      if (!existingGroup.latestActivity || (session.lastActivity && session.lastActivity > existingGroup.latestActivity)) {
        existingGroup.latestActivity = session.lastActivity;
      }
      continue;
    }

    groups.set(key, {
      key,
      projectId: session.projectId,
      projectDisplayName: session.projectDisplayName,
      projectPath: session.projectPath,
      isProjectArchived: session.isProjectArchived,
      sessions: [session],
      latestActivity: session.lastActivity,
    });
  }

  return [...groups.values()].sort((groupA, groupB) => {
    const a = groupA.latestActivity ?? '';
    const b = groupB.latestActivity ?? '';
    return b.localeCompare(a);
  });
}

function formatCompactArchivedAge(dateString: string | null): string {
  if (!dateString) {
    return '';
  }

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const diffInMinutes = Math.floor(Math.max(0, Date.now() - date.getTime()) / (1000 * 60));
  if (diffInMinutes < 1) {
    return '<1m';
  }
  if (diffInMinutes < 60) {
    return `${diffInMinutes}m`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours}hr`;
  }

  return `${Math.floor(diffInHours / 24)}d`;
}

type FlatSessionRowProps = {
  project: Project;
  session: ReturnType<typeof getAllSessions>[number];
  sessionTitle: string;
  age: string;
  status: SessionTaskStatus;
  isSelected: boolean;
  onClick: () => void;
  onDeleteSession: (projectId: string, sessionId: string, title: string, provider: LLMProvider) => void;
  onSaveEditingSession: (projectId: string, sessionId: string, name: string, provider: LLMProvider) => void;
  onRefresh: () => void;
  t: TFunction;
};

/**
 * 会话标签页(sessions-first 视图)的会话行 —— 与项目树里的 SidebarSessionItem
 * 使用同一 ContextMenu 组件与同一组菜单项,保证两个视图的右键交互一致。
 */
function FlatSessionRow({
  project,
  session,
  sessionTitle,
  age,
  status,
  isSelected,
  onClick,
  onDeleteSession,
  onSaveEditingSession,
  onRefresh,
  t,
}: FlatSessionRowProps) {
  const provider = session.__provider;
  const a2aDelegate = useA2aDelegate();
  const serverA2aExposed = Boolean((session as { a2a_exposed?: unknown }).a2a_exposed);
  const a2aExposed = a2aDelegate.isExposed(session.id, serverA2aExposed);
  const a2aPending = a2aDelegate.isPending(session.id);

  const { openSettings } = usePaletteOps();
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const isPinned = Boolean((session as { isPinned?: unknown }).isPinned);
  const jsonlPath = ((session as { jsonlPath?: unknown }).jsonlPath as string | null | undefined) ?? null;
  const isDesktop = typeof window !== 'undefined' && Boolean(window.electronAPI);

  const flashCopied = (label: string) => {
    setCopiedLabel(label);
    window.setTimeout(() => setCopiedLabel((current) => (current === label ? null : current)), 1200);
  };

  const handleCopy = async (text: string | null | undefined, label: string) => {
    if (!text) return;
    if (await copyTextToClipboard(text)) flashCopied(label);
  };

  const actions: ContextMenuAction[] = [
    {
      key: 'a2a',
      icon: Network,
      label: a2aExposed ? t('tooltips.a2aDelegateEnabled') : t('tooltips.a2aDelegate'),
      onSelect: () => void a2aDelegate.toggle(session.id, !a2aExposed),
      isDisabled: a2aPending,
    },
    {
      key: 'rename',
      icon: Edit2,
      label: t('tooltips.editSessionName'),
      onSelect: () => {
        setRenameValue(sessionTitle);
        setRenameOpen(true);
      },
    },
    {
      key: 'pin',
      icon: isPinned ? PinOff : Pin,
      label: isPinned ? t('contextMenu.unpinSession', 'Unpin') : t('contextMenu.pinSession', 'Pin'),
      onSelect: () => {
        void api.toggleSessionPin(session.id).then(() => onRefresh());
      },
      showDividerBefore: true,
    },
    {
      key: 'archive',
      icon: Archive,
      label: t('contextMenu.archiveSession', 'Archive'),
      onSelect: () => onDeleteSession(project.projectId, session.id, sessionTitle, provider),
      isDanger: true,
      showDividerBefore: true,
    },
    {
      key: 'copyId',
      icon: Copy,
      label: copiedLabel === 'id' ? t('contextMenu.copied', 'Copied!') : t('contextMenu.copySessionId', 'Copy session ID'),
      onSelect: () => void handleCopy(session.id, 'id'),
      showDividerBefore: true,
    },
    {
      key: 'copyPath',
      icon: Copy,
      label: copiedLabel === 'path' ? t('contextMenu.copied', 'Copied!') : t('contextMenu.copyPath', 'Copy path'),
      onSelect: () => void handleCopy(project.fullPath, 'path'),
    },
    ...(jsonlPath
      ? [{
          key: 'copyLog',
          icon: Copy,
          label: copiedLabel === 'log' ? t('contextMenu.copied', 'Copied!') : t('contextMenu.copyLogPath', 'Copy log path'),
          onSelect: () => void handleCopy(jsonlPath, 'log'),
        } satisfies ContextMenuAction]
      : []),
    ...(isDesktop
      ? [{
          key: 'explorer',
          icon: FolderOpen,
          label: t('contextMenu.openInExplorer', 'Open in file explorer'),
          onSelect: () => void window.electronAPI?.openPath?.(project.fullPath),
        } satisfies ContextMenuAction]
      : []),
    {
      key: 'config',
      icon: SlidersHorizontal,
      label: t('contextMenu.goToConfig', 'Go to configuration'),
      onSelect: () => openSettings('agents', provider),
      showDividerBefore: true,
    },
  ];

  return (
    <>
      <ContextMenu actions={actions} menuLabel={t('contextMenu.sessionMenuLabel', 'Session context menu')}>
        <button
          className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
            isSelected
              ? 'border-primary/25 bg-primary/5'
              : 'border-transparent hover:border-border/60 hover:bg-accent/45'
          }`}
          onClick={onClick}
          draggable
          onDragStart={(event) =>
            startSessionDrag(event, {
              sessionId: session.id,
              title: sessionTitle,
              provider,
            })
          }
        >
          <div className="flex min-w-0 items-center gap-2">
            <SessionProviderLogo provider={provider} className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
              {sessionTitle}
            </span>
            <SessionTaskStatusBadge status={status} className="flex-shrink-0" />
            {age && (
              <span className="flex-shrink-0 text-[11px] text-muted-foreground">
                {age}
              </span>
            )}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2 pl-5">
            <span className="truncate text-[11px] text-muted-foreground">
              {project.displayName}
            </span>
          </div>
        </button>
      </ContextMenu>

      <Dialog
        open={renameOpen}
        onOpenChange={(next) => {
          if (!next) setRenameValue('');
          setRenameOpen(next);
        }}
      >
        <DialogContent className="max-w-md rounded-2xl border-border/80 bg-popover p-5 shadow-2xl">
          <DialogTitle className="text-base font-semibold text-foreground">
            {t('renameDialog.title', { defaultValue: 'Rename conversation' })}
          </DialogTitle>
          <input
            type="text"
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && renameValue.trim()) {
                onSaveEditingSession(project.projectId, session.id, renameValue.trim(), provider);
                setRenameOpen(false);
              }
            }}
            className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            autoFocus
            onFocus={(e) => e.target.select()}
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setRenameOpen(false)}>
              {t('renameDialog.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              size="sm"
              disabled={!renameValue.trim()}
              onClick={() => {
                onSaveEditingSession(project.projectId, session.id, renameValue.trim(), provider);
                setRenameOpen(false);
              }}
            >
              {t('renameDialog.save', { defaultValue: 'Save' })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

type SidebarContentProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  projects: Project[];
  runningSessionsCount: number;
  completedSessionsCount: number;
  archivedProjects: ArchivedProjectListItem[];
  archivedSessions: ArchivedSessionListItem[];
  archivedSessionsCount: number;
  isArchivedSessionsLoading: boolean;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  searchMode: SidebarSearchMode;
  onSearchModeChange: (mode: SidebarSearchMode) => void;
  onOpenFile: (filePath: string) => void;
  conversationResults: ConversationSearchResults | null;
  isSearching: boolean;
  searchProgress: SearchProgress | null;
  onRestoreArchivedProject: (projectId: string) => void;
  onArchivedSessionClick: (session: ArchivedSessionListItem) => void;
  onRestoreArchivedSession: (sessionId: string) => void;
  onDeleteArchivedSession: (session: ArchivedSessionListItem) => void;
  // Conversation result clicks pass back the DB projectId (or null when the
  // server couldn't resolve it). Consumers must handle the null case.
  onConversationResultClick: (projectId: string | null, sessionId: string, provider: string, messageTimestamp?: string | null, messageSnippet?: string | null) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  updateAvailable: boolean;
  restartRequired: boolean;
  releaseInfo: ReleaseInfo | null;
  latestVersion: string | null;
  currentVersion: string;
  onShowVersionModal: () => void;
  onShowSettings: () => void;
  // REQ-047 — 打开 Markdown 编辑器入口(可选,无则不渲染按钮)。
  onOpenMarkdownEditor?: () => void;
  // REQ-046 — 打开后台任务面板入口(可选,无则不渲染按钮)。
  onOpenBackgroundTasks?: () => void;
  activeTab?: AppTab;
  onOpenWorkbenchTab?: (tab: 'overview' | 'inbox' | 'workflow' | 'schedule' | 'chat') => void;
  projectListProps: SidebarProjectListProps;
  completedSessions: CompletedSessionNotificationMap;
  t: TFunction;
};

export default function SidebarContent({
  isPWA,
  isMobile,
  isLoading,
  projects,
  runningSessionsCount,
  completedSessionsCount,
  archivedProjects,
  archivedSessions,
  archivedSessionsCount,
  isArchivedSessionsLoading,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  searchMode,
  onSearchModeChange,
  onOpenFile,
  conversationResults,
  isSearching,
  searchProgress,
  onRestoreArchivedProject,
  onArchivedSessionClick,
  onRestoreArchivedSession,
  onDeleteArchivedSession,
  onConversationResultClick,
  onRefresh,
  isRefreshing,
  onCreateProject,
  onCollapseSidebar,
  updateAvailable,
  restartRequired,
  releaseInfo,
  latestVersion,
  currentVersion,
  onShowVersionModal,
  onShowSettings,
  onOpenMarkdownEditor,
  onOpenBackgroundTasks,
  activeTab,
  onOpenWorkbenchTab,
  projectListProps,
  completedSessions,
  t,
}: SidebarContentProps) {
  const showConversationSearch = searchMode === 'sessions' && searchFilter.trim().length >= 2;
  const hasPartialResults = conversationResults && conversationResults.results.length > 0;
  const groupedArchivedSessions = groupArchivedSessionsByProject(archivedSessions);
  const railItems = getSidebarRailItems(t, completedSessionsCount);
  const railFooterItems = getSidebarRailFooterItems(t);
  const activeRailId = activeTab === 'overview' || activeTab === 'inbox' || activeTab === 'workflow' || activeTab === 'schedule' ? activeTab : searchMode;
  const showProjectWorkspace = !isWorkbenchTab(activeTab);
  const activeSessions = projectListProps.activeSessions;
  const conversationListItems: ConversationListItem[] = projects
    .flatMap((project) =>
      getAllSessions(project).map((session) => ({
        project,
        session,
        lastActivityTime: getSessionDate(session).getTime(),
      })),
    )
    .sort((itemA, itemB) => {
      const aRunning = activeSessions.has(itemA.session.id);
      const bRunning = activeSessions.has(itemB.session.id);
      if (aRunning && bRunning) {
        // Both running: most-recently-started first (latest launch on top)
        const aStarted = activeSessions.get(itemA.session.id)?.startedAt ?? 0;
        const bStarted = activeSessions.get(itemB.session.id)?.startedAt ?? 0;
        return bStarted - aStarted;
      }
      if (aRunning) return -1;
      if (bRunning) return 1;
      return itemB.lastActivityTime - itemA.lastActivityTime;
    });

  // Flat session list virtualization (react-window needs a px height).
  // Rows measured uniform at 55px + 4px gap in the old space-y-1 layout.
  const SESSION_ROW_STRIDE = 55 + 4;
  const sessionListRef = useRef<HTMLDivElement | null>(null);
  const [sessionListHeight, setSessionListHeight] = useState(0);
  const hasFlatSessions = searchMode === 'sessions' && conversationListItems.length > 0;
  useEffect(() => {
    if (!hasFlatSessions) return;
    const el = sessionListRef.current;
    if (!el) return;
    const update = () => setSessionListHeight(el.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasFlatSessions]);

  // Drag-to-resize the expanded sidebar. Width persists in localStorage;
  // collapsed rail mode ignores it.
  const SIDEBAR_WIDTH_KEY = 'ui.sidebar-width';
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(() => {
    try {
      const raw = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
      return Number.isFinite(raw) && raw >= 200 && raw <= 520 ? raw : null;
    } catch {
      return null;
    }
  });
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDragging = dragStateRef.current !== null;

  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragStateRef.current = { startX: event.clientX, startWidth: sidebarWidth ?? (containerRef.current?.offsetWidth || 288) };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    // Force re-render for the cursor/drag state.
    setSidebarWidth((w) => w);
  };

  const handleResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag) return;
    const next = Math.min(520, Math.max(200, drag.startWidth + (event.clientX - drag.startX)));
    setSidebarWidth(next);
  };

  const handleResizeEnd = () => {
    if (!dragStateRef.current) return;
    dragStateRef.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    setSidebarWidth((current) => {
      try {
        if (current !== null) localStorage.setItem(SIDEBAR_WIDTH_KEY, String(current));
      } catch { /* storage unavailable */ }
      return current;
    });
  };

  return (
    <div
      ref={containerRef}
      className={`relative flex h-full flex-col bg-workbench-surface md:select-none ${showProjectWorkspace ? (sidebarWidth ? '' : 'md:w-72') : 'md:w-12'}`}
      style={showProjectWorkspace && sidebarWidth ? { width: `${sidebarWidth}px` } : undefined}
    >
      {showProjectWorkspace && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="拖拽调整侧边栏宽度"
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
          onDoubleClick={() => {
            setSidebarWidth(null);
            try { localStorage.removeItem(SIDEBAR_WIDTH_KEY); } catch { /* ignore */ }
          }}
          title="拖拽调整宽度,双击还原"
          className={`absolute right-0 top-0 z-20 h-full w-1 cursor-col-resize touch-none transition-colors hover:bg-workbench-accent/40 ${isDragging ? 'bg-workbench-accent/60' : 'bg-transparent'}`}
        />
      )}
      <div className="flex min-h-0 flex-1">
        <WorkbenchRail
          className="hidden shrink-0 border-r border-workbench-border md:flex"
          items={railItems}
          footerItems={railFooterItems}
          activeId={activeRailId}
          onSelect={(id) => {
            if (id === 'settings') {
              onShowSettings();
              return;
            }
            if (id === 'overview' || id === 'inbox' || id === 'workflow' || id === 'schedule') {
              onOpenWorkbenchTab?.(id);
              return;
            }
            if (id === 'sessions') {
              onOpenWorkbenchTab?.('chat');
            }
            onSearchModeChange(id as SidebarSearchMode);
          }}
        />
        <div className={showProjectWorkspace ? 'flex min-w-0 flex-1 flex-col' : 'hidden'}>
        <SidebarHeader
        isPWA={isPWA}
        isMobile={isMobile}
        isLoading={isLoading}
        projectsCount={projects.length}
        runningSessionsCount={runningSessionsCount}
        completedSessionsCount={completedSessionsCount}
        archivedSessionsCount={archivedSessionsCount}
        isArchivedSessionsLoading={isArchivedSessionsLoading}
        searchFilter={searchFilter}
        onSearchFilterChange={onSearchFilterChange}
        onClearSearchFilter={onClearSearchFilter}
        searchMode={searchMode}
        onSearchModeChange={onSearchModeChange}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        onCreateProject={onCreateProject}
        onCollapseSidebar={onCollapseSidebar}
        onOpenMarkdownEditor={onOpenMarkdownEditor}
        onOpenBackgroundTasks={onOpenBackgroundTasks}
        t={t}
      />

      <ContextMenu
        actions={[
          {
            key: 'refresh-list',
            label: t('contextMenu.refreshList'),
            icon: RefreshCw,
            onSelect: onRefresh,
            isDisabled: isRefreshing,
          },
        ]}
        menuLabel={t('contextMenu.refreshList')}
      >
        <ScrollArea className="flex-1 overflow-y-auto overscroll-contain md:px-2 md:py-2">
        {searchMode === 'files' ? (
          <div className="flex h-full flex-col">
            <div className="min-h-0 flex-1">
              {projectListProps.selectedProject ? (
                <FileTree
                  selectedProject={projectListProps.selectedProject}
                  onFileOpen={onOpenFile}
                  compact
                  headerPrefix={
                    <>
                      <button
                        type="button"
                        onClick={() => onSearchModeChange('projects')}
                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        aria-label={t('files.backToProjects', { defaultValue: 'Back to projects' })}
                        title={t('files.backToProjects', { defaultValue: 'Back to projects' })}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <span className="mx-1 truncate text-sm font-medium text-foreground">
                        {projectListProps.selectedProject.displayName}
                      </span>
                      <div className="mx-1 h-4 w-px flex-shrink-0 bg-border" />
                    </>
                  }
                />
              ) : (
                <div className="px-4 py-12 text-center md:py-8">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
                    <FolderTree className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <h3 className="mb-2 text-base font-medium text-foreground md:mb-1">
                    {t('files.noProjectSelected', { defaultValue: 'Select a project' })}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t('files.noProjectSelectedHint', { defaultValue: 'Choose a project to browse its files.' })}
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : showConversationSearch ? (
          isSearching && !hasPartialResults ? (
            <div className="px-4 py-12 text-center md:py-8">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
              </div>
              <p className="text-sm text-muted-foreground">{t('search.searching')}</p>
              {searchProgress && (
                <p className="mt-1 text-xs text-muted-foreground/60">
                  {t('search.projectsScanned', { count: searchProgress.scannedProjects })}/{searchProgress.totalProjects}
                </p>
              )}
            </div>
          ) : !isSearching && conversationResults && conversationResults.results.length === 0 ? (
            <div className="px-4 py-12 text-center md:py-8">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
                <Search className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="mb-2 text-base font-medium text-foreground md:mb-1">{t('search.noResults')}</h3>
              <p className="text-sm text-muted-foreground">{t('search.tryDifferentQuery')}</p>
            </div>
          ) : hasPartialResults ? (
            <div className="space-y-3 px-2">
              <div className="flex items-center justify-between px-1">
                <p className="text-xs text-muted-foreground">
                  {t('search.matches', { count: conversationResults.totalMatches })}
                </p>
                {isSearching && searchProgress && (
                  <div className="flex items-center gap-1.5">
                    <div className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-muted-foreground/40 border-t-primary" />
                    <p className="text-[10px] text-muted-foreground/60">
                      {searchProgress.scannedProjects}/{searchProgress.totalProjects}
                    </p>
                  </div>
                )}
              </div>
              {isSearching && searchProgress && (
                <div className="mx-1 h-0.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/60 transition-all duration-300"
                    style={{ width: `${Math.round((searchProgress.scannedProjects / searchProgress.totalProjects) * 100)}%` }}
                  />
                </div>
              )}
              {conversationResults.results.map((projectResult) => (
                <div key={projectResult.projectName} className="space-y-1">
                  <div className="flex items-center gap-1.5 px-1 py-1">
                    <Folder className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                    <span className="truncate text-xs font-medium text-foreground">
                      {projectResult.projectDisplayName}
                    </span>
                  </div>
                  {projectResult.sessions.map((session) => (
                    <button
                      key={`${projectResult.projectId ?? projectResult.projectName}-${session.sessionId}`}
                      className="w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/50"
                      onClick={() => onConversationResultClick(
                        // Pass the DB projectId (preferred) so the parent can
                        // cross-reference with the loaded projects list.
                        projectResult.projectId,
                        session.sessionId,
                        session.provider || session.matches[0]?.provider || 'claude',
                        session.matches[0]?.timestamp,
                        session.matches[0]?.snippet
                      )}
                    >
                      <div className="mb-1 flex items-center gap-1.5">
                        <MessageSquare className="h-3 w-3 flex-shrink-0 text-primary" />
                        <span className="truncate text-xs font-medium text-foreground">
                          {session.sessionSummary}
                        </span>
                        <SessionTaskStatusBadge
                          status={projectListProps.activeSessions.has(session.sessionId) ? 'running' : 'idle'}
                          className="flex-shrink-0"
                        />
                      </div>
                      <div className="space-y-1 pl-4">
                        {session.matches.map((match, idx) => (
                          <div key={idx} className="flex items-start gap-1">
                            <span className="mt-0.5 flex-shrink-0 text-[10px] font-medium uppercase text-muted-foreground/60">
                              {match.role === 'user' ? 'U' : 'A'}
                            </span>
                            <HighlightedSnippet
                              snippet={match.snippet}
                              highlights={match.highlights}
                            />
                          </div>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : null
        ) : searchMode === 'sessions' ? (
          conversationListItems.length === 0 ? (
            <div className="px-4 py-12 text-center md:py-8">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
                <MessageSquare className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="mb-2 text-base font-medium text-foreground md:mb-1">
                {t('sessions.noSessions')}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t('search.sessionsEmptyDescription', 'Completed sessions will appear here in newest-first order.')}
              </p>
            </div>
          ) : (
            <div className="flex h-full flex-col px-2">
              <div className="flex items-center justify-between px-1 pb-1">
                <p className="text-xs text-muted-foreground">
                  {t('search.sessionsListCount', {
                    count: conversationListItems.length,
                    defaultValue: '{{count}} sessions',
                  })}
                </p>
                {completedSessionsCount > 0 && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    {t('search.completedNoticeCount', {
                      count: completedSessionsCount,
                      defaultValue: '{{count}} new',
                    })}
                  </span>
                )}
              </div>
              <div ref={sessionListRef} className="min-h-0 flex-1">
                {sessionListHeight > 0 && (
                  <List
                    height={sessionListHeight}
                    itemCount={conversationListItems.length}
                    itemSize={SESSION_ROW_STRIDE}
                    width="100%"
                    overscanCount={6}
                  >
                    {({ index, style }: ListChildComponentProps) => {
                      const { project, session } = conversationListItems[index];
                      const completion = completedSessions.get(session.id);
                      const isSelected = projectListProps.selectedSession?.id === session.id;
                      const status: SessionTaskStatus =
                        projectListProps.activeSessions.get(session.id)?.taskStatus ?? completion?.status ?? 'idle';
                      const sessionTitle = getSessionName(session, t);
                      const sessionDate = getSessionDate(session);
                      const age = Number.isNaN(sessionDate.getTime()) ? '' : formatCompactArchivedAge(sessionDate.toISOString());

                      return (
                        <div style={style}>
                          <FlatSessionRow
                            key={`${project.projectId}-${session.id}`}
                            project={project}
                            session={session}
                            sessionTitle={sessionTitle}
                            age={age}
                            status={status}
                            isSelected={isSelected}
                            onClick={() => onConversationResultClick(project.projectId, session.id, session.__provider)}
                            onDeleteSession={projectListProps.onDeleteSession}
                            onSaveEditingSession={projectListProps.onSaveEditingSession}
                            onRefresh={() => onRefresh()}
                            t={t}
                          />
                        </div>
                      );
                    }}
                  </List>
                )}
              </div>
            </div>
          )
        ) : searchMode === 'archived' ? (
          isArchivedSessionsLoading ? (
            <div className="px-4 py-12 text-center md:py-8">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
              </div>
              <h3 className="mb-2 text-base font-medium text-foreground md:mb-1">
                {t('archived.loadingTitle', 'Loading archive...')}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t('archived.loadingDescription', 'Fetching hidden workspaces and sessions you can restore later.')}
              </p>
            </div>
          ) : archivedProjects.length === 0 && groupedArchivedSessions.length === 0 ? (
            <div className="px-4 py-12 text-center md:py-8">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
                <Archive className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="mb-2 text-base font-medium text-foreground md:mb-1">
                {archivedSessionsCount > 0
                  ? t('archived.noMatchingSessions', 'No matching archived items')
                  : t('archived.emptyTitle', 'No archived items')}
              </h3>
              <p className="text-sm text-muted-foreground">
                {archivedSessionsCount > 0
                  ? t('archived.tryDifferentSearch', 'Try a different search term.')
                  : t('archived.emptyDescription', 'Archived workspaces and sessions will appear here when you hide them from the active list.')}
              </p>
            </div>
          ) : (
            <div className="space-y-3 px-2">
              <div className="flex items-center justify-between px-1">
                <p className="text-xs text-muted-foreground">
                  {`${archivedSessionsCount} ${t(
                    archivedSessionsCount === 1 ? 'archived.sessionCountOne' : 'archived.sessionCountOther',
                    archivedSessionsCount === 1 ? 'archived item' : 'archived items',
                  )}`}
                </p>
              </div>
              {archivedProjects.map((project) => {
                const projectSessions = getAllSessions(project);

                return (
                  <div key={project.projectId} className="overflow-hidden rounded-xl border border-border/70 bg-card/60 shadow-sm">
                    <div className="flex items-start justify-between gap-3 border-b border-border/60 px-3 py-2.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Folder className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                          <span className="truncate text-sm font-medium text-foreground">
                            {project.displayName}
                          </span>
                          <span className="inline-flex items-center justify-center rounded-full bg-muted px-1 py-px text-center text-[7px] font-medium uppercase leading-none tracking-[0.02em] text-muted-foreground">
                            {t('archived.projectArchived', 'Project archived')}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground/70" title={project.fullPath}>
                          {project.fullPath}
                        </p>
                      </div>
                      <button
                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 transition-colors hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
                        onClick={() => onRestoreArchivedProject(project.projectId)}
                        title={t('archived.restoreProject', 'Restore workspace')}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {projectSessions.length > 0 && (
                      <div className="divide-y divide-border/50">
                        {projectSessions.map((session) => (
                          <button
                            key={String(session.id)}
                            className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-accent/40"
                            onClick={() => onArchivedSessionClick({
                              sessionId: String(session.id),
                              provider: session.__provider,
                              projectId: project.projectId,
                              projectPath: project.fullPath,
                              projectDisplayName: project.displayName,
                              sessionTitle:
                                (typeof session.summary === 'string' && session.summary.trim().length > 0
                                  ? session.summary
                                  : typeof session.name === 'string' && session.name.trim().length > 0
                                    ? session.name
                                    : String(session.id)),
                              createdAt: typeof session.created_at === 'string' ? session.created_at : null,
                              updatedAt: typeof session.updated_at === 'string' ? session.updated_at : null,
                              lastActivity:
                                typeof session.lastActivity === 'string'
                                  ? session.lastActivity
                                  : typeof session.updated_at === 'string'
                                    ? session.updated_at
                                    : typeof session.created_at === 'string'
                                      ? session.created_at
                                      : null,
                              isProjectArchived: true,
                            })}
                          >
                            <SessionProviderLogo provider={session.__provider} className="h-3.5 w-3.5 flex-shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-xs font-medium text-foreground">
                                  {(typeof session.summary === 'string' && session.summary.trim().length > 0
                                    ? session.summary
                                    : typeof session.name === 'string' && session.name.trim().length > 0
                                      ? session.name
                                      : String(session.id))}
                                </span>
                                <span className="ml-auto flex-shrink-0 text-[11px] text-muted-foreground">
                                  {formatCompactArchivedAge(
                                    typeof session.lastActivity === 'string'
                                      ? session.lastActivity
                                      : typeof session.updated_at === 'string'
                                        ? session.updated_at
                                        : typeof session.created_at === 'string'
                                          ? session.created_at
                                          : null,
                                  )}
                                </span>
                              </div>
                              <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground/70">
                                {session.__provider}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {groupedArchivedSessions.map((group) => (
                <div key={group.key} className="overflow-hidden rounded-xl border border-border/70 bg-card/60 shadow-sm">
                  <div className="flex items-start justify-between gap-3 border-b border-border/60 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Folder className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                        <span className="truncate text-sm font-medium text-foreground">
                          {group.projectDisplayName}
                        </span>
                        {group.isProjectArchived && (
                          <span className="inline-flex items-center justify-center rounded-full bg-muted px-1 py-px text-center text-[7px] font-medium uppercase leading-none tracking-[0.02em] text-muted-foreground">
                            {t('archived.projectArchived', 'Project archived')}
                          </span>
                        )}
                      </div>
                      {group.projectPath && (
                        <p className="mt-1 truncate text-xs text-muted-foreground/70" title={group.projectPath}>
                          {group.projectPath}
                        </p>
                      )}
                    </div>
                    <span className="flex-shrink-0 text-[11px] text-muted-foreground">
                      {group.sessions.length}
                    </span>
                  </div>
                  <div className="divide-y divide-border/50">
                    {group.sessions.map((session) => (
                      <div key={session.sessionId} className="flex items-center gap-2 px-3 py-2.5">
                        <button
                          className="flex min-w-0 flex-1 items-center gap-2 text-left transition-colors hover:text-foreground"
                          onClick={() => onArchivedSessionClick(session)}
                        >
                          <SessionProviderLogo provider={session.provider} className="h-3.5 w-3.5 flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-xs font-medium text-foreground">
                                {session.sessionTitle}
                              </span>
                              {session.lastActivity && (
                                <span className="ml-auto flex-shrink-0 text-[11px] text-muted-foreground">
                                  {formatCompactArchivedAge(session.lastActivity)}
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground/70">
                              {session.provider}
                            </p>
                          </div>
                        </button>
                        <button
                          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 transition-colors hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
                          onClick={() => onRestoreArchivedSession(session.sessionId)}
                          title={t('archived.restore', 'Restore session')}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                        <button
                          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700 transition-colors hover:bg-red-100 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/30"
                          onClick={() => onDeleteArchivedSession(session)}
                          title={t('archived.deletePermanently', 'Delete permanently')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <SidebarProjectList {...projectListProps} />
        )}
        </ScrollArea>
      </ContextMenu>

      <SidebarFooter
        updateAvailable={updateAvailable}
        restartRequired={restartRequired}
        releaseInfo={releaseInfo}
        latestVersion={latestVersion}
        currentVersion={currentVersion}
        onShowVersionModal={onShowVersionModal}
        onShowSettings={onShowSettings}
        t={t}
      />
        </div>
      </div>
    </div>
  );
}
