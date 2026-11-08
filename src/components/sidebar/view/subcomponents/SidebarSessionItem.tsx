import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Archive, Check, Copy, Edit2, Folder, FolderOpen, GitBranch, Network, Pin, PinOff, SlidersHorizontal, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Badge, Button, Dialog, DialogContent, DialogTitle } from '../../../../shared/view/ui';
import ContextMenu, { type ContextMenuAction } from '../../../../shared/view/ContextMenu';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { SessionTaskStatus } from '../../../../shared/taskStatus';
import SessionTaskStatusBadge from '../../../../shared/SessionTaskStatusBadge';
import type { SessionWithProvider } from '../../types/types';
import { createSessionViewModel } from '../../utils/utils';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import { useA2aDelegate } from '../../contexts/A2aDelegateContext';
import { usePaletteOps } from '../../../../contexts/PaletteOpsContext';
import { copyTextToClipboard } from '../../../../utils/clipboard';
import { api } from '../../../../utils/api';
import { startSessionDrag } from '../../../../shared/view/sessionDrag';

type SidebarSessionItemProps = {
  project: Project;
  session: SessionWithProvider;
  selectedSession: ProjectSession | null;
  isProcessing: boolean;
  taskStatus: SessionTaskStatus;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  // REQ-049 fork — optional; when absent the fork button is not rendered.
  onForkSession?: (sessionId: string) => void;
  t: TFunction;
};

/**
 * Compact relative time for sidebar rows:
 * <1m, Xm, Xhr, Xd.
 */
const formatCompactSessionAge = (dateString: string, currentTime: Date): string => {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const diffInMinutes = Math.floor(Math.max(0, currentTime.getTime() - date.getTime()) / (1000 * 60));
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

  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays}d`;
};

export default function SidebarSessionItem({
  project,
  session,
  selectedSession,
  isProcessing,
  taskStatus,
  currentTime,
  editingSession,
  editingSessionName,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onProjectSelect,
  onSessionSelect,
  onDeleteSession,
  onForkSession,
  t,
}: SidebarSessionItemProps) {
  const sessionView = createSessionViewModel(session, currentTime, t);
  const isSelected = selectedSession?.id === session.id;
  const isEditing = editingSession === session.id;
  const compactSessionAge = formatCompactSessionAge(sessionView.sessionTime, currentTime);
  const editingContainerRef = useRef<HTMLDivElement>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  // REQ-020 S3 — A2A delegation toggle state. The server-provided flag travels
  // on the session payload as `a2a_exposed`; the context layers an optimistic
  // override on top so the toggle reacts instantly.
  const a2aDelegate = useA2aDelegate();
  const serverA2aExposed = Boolean((session as { a2a_exposed?: unknown }).a2a_exposed);
  const a2aExposed = a2aDelegate.isExposed(session.id, serverA2aExposed);
  const a2aPending = a2aDelegate.isPending(session.id);
  const toggleA2aExposed = (event: ReactMouseEvent) => {
    event.stopPropagation();
    if (a2aPending) {
      return;
    }
    void a2aDelegate.toggle(session.id, !a2aExposed);
  };

  // REQ-051 session context menu — pin toggle, clipboard ops, explorer open,
  // and "go to configuration" jump. Pin is optimistic on the local list via
  // onProjectSelect re-fetch trigger; the backend sort also honors isPinned.
  const { openSettings } = usePaletteOps();
  const isPinned = Boolean(session.isPinned);
  const jsonlPath = (session.jsonlPath as string | null | undefined) ?? null;
  const isDesktop = typeof window !== 'undefined' && Boolean(window.electronAPI);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  // Codex hover 详情浮层:portal 到 body(侧栏 overflow 会裁剪 absolute 浮层)
  const [hoverCardPos, setHoverCardPos] = useState<{ top: number; left: number } | null>(null);

  const flashCopied = (label: string) => {
    setCopiedLabel(label);
    window.setTimeout(() => setCopiedLabel((current) => (current === label ? null : current)), 1200);
  };

  const handleRowMouseEnter = (event: ReactMouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setHoverCardPos({ top: rect.top + rect.height / 2, left: rect.right + 10 });
  };

  const handleArchive = () => {
    onDeleteSession(project.projectId, session.id, sessionView.sessionName, session.__provider);
  };

  const handleCopy = async (text: string | null | undefined, label: string) => {
    if (!text) return;
    const ok = await copyTextToClipboard(text);
    if (ok) flashCopied(label);
  };

  const handleOpenInExplorer = () => {
    void window.electronAPI?.openPath?.(project.fullPath);
  };

  const handleGoToConfig = () => {
    openSettings('agents', session.__provider);
  };

  // The rename panel sits inside a group-hover opacity wrapper, so leaving the row
  // would visually hide it. While editing, dismiss only when the user clicks outside
  // the panel (matches Escape / cancel-button behaviour).
  useEffect(() => {
    if (!isEditing) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const container = editingContainerRef.current;
      if (container && !container.contains(event.target as Node)) {
        onCancelEditingSession();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isEditing, onCancelEditingSession]);

  // Sessions are owned by a project identified by `projectId` (DB primary key)
  // after the projectName → projectId migration.
  const selectMobileSession = () => {
    onProjectSelect(project);
    onSessionSelect(session, project.projectId);
  };

  const saveEditedSession = () => {
    onSaveEditingSession(project.projectId, session.id, editingSessionName, session.__provider);
  };

  const requestDeleteSession = () => {
    onDeleteSession(project.projectId, session.id, sessionView.sessionName, session.__provider);
  };

  // Session context menu — same ContextMenu component/pattern as the project
  // file tree (body-ported, viewport-safe, keyboard navigable, themed).
  const sessionMenuActions: ContextMenuAction[] = [
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
        setRenameValue(sessionView.sessionName);
        setRenameOpen(true);
      },
    },
    {
      key: 'pin',
      icon: isPinned ? PinOff : Pin,
      label: isPinned ? t('contextMenu.unpinSession', 'Unpin') : t('contextMenu.pinSession', 'Pin'),
      onSelect: () => void api.toggleSessionPin(session.id),
      showDividerBefore: true,
    },
    {
      key: 'archive',
      icon: Archive,
      label: t('contextMenu.archiveSession', 'Archive'),
      onSelect: handleArchive,
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
          onSelect: handleOpenInExplorer,
        } satisfies ContextMenuAction]
      : []),
    {
      key: 'config',
      icon: SlidersHorizontal,
      label: t('contextMenu.goToConfig', 'Go to configuration'),
      onSelect: handleGoToConfig,
      showDividerBefore: true,
    },
  ];

  return (
    <div className="group relative">
      <div className="md:hidden">
        <div
          className={cn(
            // ZCode 列表项:无边框 + 柔和圆角,选中用 surface 提亮而不是描边
            'p-2 mx-3 my-0.5 rounded-lg bg-transparent transition-colors duration-150 relative',
            isSelected ? 'bg-workbench-muted' : 'hover:bg-workbench-muted/60',
          )}
          onClick={selectMobileSession}
        >
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0',
                  isSelected ? 'bg-workbench-accent/10' : 'bg-workbench-muted',
              )}
            >
              <SessionProviderLogo provider={session.__provider} className="h-3 w-3" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate text-xs font-medium text-workbench-ink">{sessionView.sessionName}</div>
                {compactSessionAge && (
                  <span className="ml-auto flex-shrink-0 text-[11px] text-workbench-subtle">{compactSessionAge}</span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                {sessionView.messageCount > 0 && (
                  <Badge variant="secondary" className="px-1 py-0 text-xs">
                    {sessionView.messageCount}
                  </Badge>
                )}
                <SessionTaskStatusBadge status={isProcessing ? 'running' : taskStatus} />
              </div>
            </div>

            {!isProcessing && (
              <>
                <button
                  className={cn(
                    'ml-1 flex h-5 w-5 items-center justify-center rounded-md transition-transform active:scale-95',
                    a2aExposed
                      ? 'bg-primary/10 text-primary dark:bg-primary/20'
                      : 'bg-muted/50 text-muted-foreground',
                    a2aPending && 'opacity-50 pointer-events-none',
                  )}
                  onClick={toggleA2aExposed}
                  title={a2aExposed ? t('tooltips.a2aDelegateEnabled') : t('tooltips.a2aDelegate')}
                  aria-label={t('tooltips.a2aDelegate')}
                  aria-pressed={a2aExposed}
                >
                  <Network className={cn('h-2.5 w-2.5', a2aExposed && 'fill-current')} />
                </button>
                <button
                  className="ml-1 flex h-5 w-5 items-center justify-center rounded-md bg-red-50 opacity-70 transition-transform active:scale-95 dark:bg-red-900/20"
                  onClick={(event) => {
                    event.stopPropagation();
                    requestDeleteSession();
                  }}
                >
                  <Trash2 className="h-2.5 w-2.5 text-red-600 dark:text-red-400" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="hidden md:block">
        <ContextMenu actions={sessionMenuActions} menuLabel={t('contextMenu.sessionMenuLabel', 'Session context menu')} isDisabled={isEditing}>
          <Button
            variant="ghost"
            onMouseEnter={handleRowMouseEnter}
            onMouseLeave={() => setHoverCardPos(null)}
            className={cn(
              // ZCode 列表项:无边框 + 柔和圆角,选中用 surface 提亮
              'h-auto w-full justify-start rounded-lg p-2 text-left font-normal transition-colors duration-150',
              isSelected ? 'bg-workbench-muted' : 'hover:bg-workbench-muted/60',
            )}
            onClick={() => onSessionSelect(session, project.projectId)}
            draggable={!isEditing}
            onDragStart={(event) =>
              startSessionDrag(event, {
                sessionId: session.id,
                title: sessionView.sessionName,
                provider: session.__provider,
              })
            }
          >
            <div className="flex w-full min-w-0 items-center gap-2">
              {/* Codex 会话行:单行标题 + 右侧状态(spinner/蓝点) */}
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <div className="min-w-0 flex-1 truncate text-sm text-foreground">{sessionView.sessionName}</div>
                {isProcessing ? (
                  <span className="flex-shrink0 ml-auto flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center">
                    <span className="h-3 w-3 animate-spin rounded-full border border-muted-foreground/30 border-t-muted-foreground" />
                  </span>
                ) : (
                  <SessionTaskStatusBadge status={taskStatus} />
                )}
                {compactSessionAge && (
                  <span
                    className={cn(
                      'flex-shrink-0 text-[11px] text-workbench-subtle transition-opacity duration-200',
                      isEditing ? 'opacity-0' : 'group-hover:opacity-0',
                    )}
                  >
                    {compactSessionAge}
                  </span>
                )}
                {isPinned && (
                  <Pin className="h-3 w-3 flex-shrink-0 fill-primary/20 text-primary" aria-label={t('tooltips.pinnedSession', 'Pinned')} />
                )}
              </div>
            </div>
          </Button>
        </ContextMenu>

        {isEditing ? (
          <div
            ref={editingContainerRef}
            className="absolute right-2 top-1/2 flex -translate-y-1/2 transform items-center gap-1"
          >
            <input
              type="text"
              value={editingSessionName}
              onChange={(event) => onEditingSessionNameChange(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  saveEditedSession();
                } else if (event.key === 'Escape') {
                  onCancelEditingSession();
                }
              }}
              onClick={(event) => event.stopPropagation()}
              className="w-32 rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              autoFocus
            />
            <button
              className="flex h-6 w-6 items-center justify-center rounded bg-green-50 hover:bg-green-100 dark:bg-green-900/20 dark:hover:bg-green-900/40"
              onClick={(event) => {
                event.stopPropagation();
                saveEditedSession();
              }}
              title={t('tooltips.save')}
            >
              <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
            </button>
            <button
              className="flex h-6 w-6 items-center justify-center rounded bg-gray-50 hover:bg-gray-100 dark:bg-gray-900/20 dark:hover:bg-gray-900/40"
              onClick={(event) => {
                event.stopPropagation();
                onCancelEditingSession();
              }}
              title={t('tooltips.cancel')}
            >
              <X className="h-3 w-3 text-gray-600 dark:text-gray-400" />
            </button>
          </div>
        ) : (
          !isProcessing && (
            <button
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 transform items-center justify-center rounded bg-red-50 opacity-0 transition-all duration-200 hover:bg-red-100 group-hover:opacity-100 dark:bg-red-900/20 dark:hover:bg-red-900/40"
              onClick={(event) => {
                event.stopPropagation();
                requestDeleteSession();
              }}
              title={t('tooltips.deleteSessionOptions', 'Archive or permanently delete this session')}
            >
              <Trash2 className="h-3 w-3 text-red-600 dark:text-red-400" />
            </button>
          )
        )}

        <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
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
                  onSaveEditingSession(project.projectId, session.id, renameValue.trim(), session.__provider);
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
                  onSaveEditingSession(project.projectId, session.id, renameValue.trim(), session.__provider);
                  setRenameOpen(false);
                }}
              >
                {t('renameDialog.save', { defaultValue: 'Save' })}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        {hoverCardPos && !isEditing && createPortal(
          <div
            className="pointer-events-none fixed z-[80] w-64 rounded-xl border border-border bg-popover p-3 shadow-[0_8px_32px_hsl(0_0%_0%/0.14)]"
            style={{ top: hoverCardPos.top, left: hoverCardPos.left, transform: 'translateY(-50%)' }}
            role="tooltip"
          >
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={sessionView.sessionName}>
                {sessionView.sessionName}
              </span>
              <span className="flex-shrink-0 text-[11px] text-muted-foreground/70">{compactSessionAge}</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Folder className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{project.displayName || project.projectId}</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <GitBranch className="h-3 w-3 flex-shrink-0" />
              <span className="truncate font-mono">{project.fullPath}</span>
            </div>
          </div>,
          document.body,
        )}
      </div>
    </div>
  );
}
