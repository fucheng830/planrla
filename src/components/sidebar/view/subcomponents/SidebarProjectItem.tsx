import { Check, ChevronDown, ChevronRight, Edit3, Folder, FolderTree, Star, Trash2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { TFunction } from 'i18next';

import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { CompletedSessionNotificationMap, SessionActivityMap } from '../../../../hooks/useSessionProtection';
import type { SessionWithProvider } from '../../types/types';

import SidebarProjectSessions from './SidebarProjectSessions';

type SidebarProjectItemProps = {
  project: Project;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isExpanded: boolean;
  isDeleting: boolean;
  isStarred: boolean;
  editingProject: string | null;
  editingName: string;
  sessions: SessionWithProvider[];
  initialSessionsLoaded: boolean;
  isLoadingMoreSessions: boolean;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  onEditingNameChange: (name: string) => void;
  onToggleProject: (projectName: string) => void;
  onOpenFileTree: (project: Project) => void;
  onProjectSelect: (project: Project) => void;
  onToggleStarProject: (projectName: string) => void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectName: string) => void;
  onDeleteProject: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  // REQ-049 fork — optional, plumbed down to SidebarSessionItem.
  onForkSession?: (sessionId: string) => void;
  onLoadMoreSessions: (projectId: string) => void;
  activeSessions: SessionActivityMap;
  completedSessions: CompletedSessionNotificationMap;
  onNewSession: (project: Project) => void;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  /** Sidebar drag-and-drop reordering (desktop list). */
  draggable?: boolean;
  isDragging?: boolean;
  isDropTarget?: boolean;
  onDragStartProject?: () => void;
  onDragOverProject?: (belowHalf: boolean) => void;
  onDropProject?: () => void;
  onDragEndProject?: () => void;
  t: TFunction;
};

const getSessionCountDisplay = (project: Project, sessions: SessionWithProvider[]): string => {
  const total = Number(project.sessionMeta?.total ?? sessions.length);
  return String(total);
};

export default function SidebarProjectItem({
  project,
  selectedProject,
  selectedSession,
  isExpanded,
  isDeleting,
  isStarred,
  editingProject,
  editingName,
  sessions,
  initialSessionsLoaded,
  isLoadingMoreSessions,
  currentTime,
  editingSession,
  editingSessionName,
  onEditingNameChange,
  onToggleProject,
  onOpenFileTree,
  onProjectSelect,
  onToggleStarProject,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteProject,
  draggable = false,
  isDragging = false,
  isDropTarget = false,
  onDragStartProject,
  onDragOverProject,
  onDropProject,
  onDragEndProject,
  onSessionSelect,
  onDeleteSession,
  onForkSession,
  onLoadMoreSessions,
  activeSessions,
  completedSessions,
  onNewSession,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  t,
}: SidebarProjectItemProps) {
  // Project identity is tracked by the DB-assigned `projectId` everywhere
  // after the projectName → projectId migration.
  const isEditing = editingProject === project.projectId;
  const totalSessionCount = Number(project.sessionMeta?.total ?? sessions.length);
  const sessionCountDisplay = getSessionCountDisplay(project, sessions);
  const sessionCountLabel = `${sessionCountDisplay} session${totalSessionCount === 1 ? '' : 's'}`;

  const toggleProject = () => onToggleProject(project.projectId);
  const toggleStarProject = () => onToggleStarProject(project.projectId);

  const saveProjectName = () => {
    onSaveProjectName(project.projectId);
  };

  const selectAndToggleProject = () => {
    if (selectedProject?.projectId !== project.projectId) {
      onProjectSelect(project);
    }

    toggleProject();
  };

  const dragDepthRef = useRef(0);
  // 展开/选中后把项目行滚进可视区,让展开的会话子列表立即可见。
  const itemRef = useRef<HTMLDivElement>(null);
  const wasExpanded = useRef(false);
  useEffect(() => {
    if (isExpanded && !wasExpanded.current) {
      // 手动滚内层滚动容器(而非 scrollIntoView——它会一路滚到 <nav> 遮挡处)。
      // 把「项目行 + 展开内容」的头部对齐滚动容器顶,子会话紧随其下可见。
      const el = itemRef.current;
      const scroller = el?.closest('.overflow-auto');
      if (el && scroller) {
        scroller.scrollTo({ top: el.offsetTop, behavior: 'smooth' });
      }
    }
    wasExpanded.current = isExpanded;
  }, [isExpanded]);

  return (
    <div className={cn('md:space-y-1', isDeleting && 'opacity-50 pointer-events-none')}>
      <div className="md:group group">
        <div className="md:hidden">
          <div
            className={cn(
              'p-3 mx-3 my-1 rounded-lg bg-card border border-border/50 active:scale-[0.98] transition-all duration-150',
              isStarred && 'bg-yellow-50/50 dark:bg-yellow-900/5 border-yellow-200/30 dark:border-yellow-800/30',
            )}
            onClick={toggleProject}
          >
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <button
                  className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center active:scale-90 transition-all duration-150 border',
                    isStarred
                      ? 'bg-yellow-500/10 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800'
                      : 'bg-gray-500/10 dark:bg-gray-900/30 border-gray-200 dark:border-gray-800',
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleStarProject();
                  }}
                  title={isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites')}
                >
                  <Star
                    className={cn(
                      'w-4 h-4 transition-colors',
                      isStarred
                        ? 'text-yellow-600 dark:text-yellow-400 fill-current'
                        : 'text-gray-600 dark:text-gray-400',
                    )}
                  />
                </button>

                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <input
                      type="text"
                      value={editingName}
                      onChange={(event) => onEditingNameChange(event.target.value)}
                      className="w-full rounded-lg border-2 border-primary/40 bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-all duration-200 focus:border-primary focus:shadow-md focus:outline-none"
                      placeholder={t('projects.projectNamePlaceholder')}
                      autoFocus
                      autoComplete="off"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          saveProjectName();
                        }

                        if (event.key === 'Escape') {
                          onCancelEditingProject();
                        }
                      }}
                      style={{
                        fontSize: '16px',
                        WebkitAppearance: 'none',
                        borderRadius: '8px',
                      }}
                    />
                  ) : (
                    <>
                      <div className="flex min-w-0 flex-1 items-center justify-between">
                        <h3 className="truncate text-sm font-medium text-foreground">{project.displayName}</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">{sessionCountLabel}</p>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1">
                {isEditing ? (
                  <>
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500 shadow-sm transition-all duration-150 active:scale-90 active:shadow-none dark:bg-green-600"
                      onClick={(event) => {
                        event.stopPropagation();
                        saveProjectName();
                      }}
                    >
                      <Check className="h-4 w-4 text-white" />
                    </button>
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-500 shadow-sm transition-all duration-150 active:scale-90 active:shadow-none dark:bg-gray-600"
                      onClick={(event) => {
                        event.stopPropagation();
                        onCancelEditingProject();
                      }}
                    >
                      <X className="h-4 w-4 text-white" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-500/10 active:scale-90 dark:border-red-800 dark:bg-red-900/30"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteProject(project);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
                    </button>

                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 active:scale-90 dark:border-primary/30 dark:bg-primary/20"
                      onClick={(event) => {
                        event.stopPropagation();
                        onStartEditingProject(project);
                      }}
                    >
                      <Edit3 className="h-4 w-4 text-primary" />
                    </button>

                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-muted/30">
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground/90" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground/90" />
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          draggable={draggable}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', project.projectId);
            dragDepthRef.current = 0;
            onDragStartProject?.();
          }}
          onDragOver={(event) => {
            if (!draggable || !event.dataTransfer.types.includes('text/plain')) {
              return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            const rect = event.currentTarget.getBoundingClientRect();
            onDragOverProject?.(event.clientY > rect.top + rect.height / 2);
          }}
          onDragEnter={() => {
            dragDepthRef.current += 1;
          }}
          onDragLeave={() => {
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          }}
          onDrop={(event) => {
            event.preventDefault();
            dragDepthRef.current = 0;
            onDropProject?.();
          }}
          onDragEnd={() => onDragEndProject?.()}
          className={cn(
            // ZCode 列表项:柔和圆角,hover 半透明 surface
            'hidden md:flex w-full justify-between rounded-lg p-2 h-auto font-normal hover:bg-workbench-muted/60',
            selectedProject?.projectId === project.projectId && 'bg-workbench-muted',
            draggable && 'cursor-grab active:cursor-grabbing',
            isDragging && 'opacity-40',
            isDropTarget &&
              !isDragging &&
              'ring-2 ring-inset ring-workbench-accent/50 bg-workbench-accent/5',
          )}
          onClick={selectAndToggleProject}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              selectAndToggleProject();
            }
          }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Folder className="h-3.5 w-3.5 flex-shrink-0 text-workbench-subtle" aria-hidden="true" />
            <div className="min-w-0 flex-1 text-left">
              {isEditing ? (
                <div className="space-y-1">
                  <input
                    type="text"
                    value={editingName}
                    onChange={(event) => onEditingNameChange(event.target.value)}
                    className="w-full rounded-md border border-workbench-border bg-workbench-surface px-2 py-1 text-sm text-workbench-ink focus:ring-2 focus:ring-workbench-accent/20"
                    placeholder={t('projects.projectNamePlaceholder')}
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        saveProjectName();
                      }
                      if (event.key === 'Escape') {
                        onCancelEditingProject();
                      }
                    }}
                  />
                  <div className="truncate text-xs text-muted-foreground" title={project.fullPath}>
                    {project.fullPath}
                  </div>
                </div>
              ) : (
                <div className="truncate text-sm font-medium text-workbench-ink" title={project.displayName}>
                  {project.displayName}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-shrink-0 items-center gap-1">
            {isEditing ? (
              <>
                <button
                  type="button"
                  aria-label={t('tooltips.save')}
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-green-600 transition-colors hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-900/20"
                  onClick={(event) => {
                    event.stopPropagation();
                    saveProjectName();
                  }}
                >
                  <Check className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  aria-label={t('tooltips.cancel')}
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 dark:hover:bg-gray-800"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancelEditingProject();
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </>
            ) : (
              <>
                {/* REQ-054: actions collapse to zero width when idle so the
                    project name gets the full row (≈170px instead of 58px);
                    they expand on hover/focus-within replacing opacity tricks
                    that reserved layout space while invisible. */}
                <div className="touch:w-[112px] touch:gap-1 flex w-0 items-center gap-1 overflow-hidden transition-all duration-200 focus-within:w-[112px] focus-within:gap-1 group-hover:w-[112px] group-hover:gap-1">
                  <button
                    type="button"
                    aria-label={isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites')}
                    className={cn(
                      'flex h-6 w-6 flex-shrink-0 cursor-pointer items-center justify-center rounded hover:bg-accent',
                    )}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleStarProject();
                    }}
                    title={isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites')}
                  >
                    <Star
                      className={cn(
                        'h-3 w-3 transition-colors',
                        isStarred ? 'text-yellow-600 dark:text-yellow-400 fill-current' : 'text-muted-foreground',
                      )}
                    />
                  </button>
                  <button
                    type="button"
                    aria-label={t('tooltips.openFileTree', { defaultValue: 'Browse files' })}
                    className="flex h-6 w-6 flex-shrink-0 cursor-pointer items-center justify-center rounded hover:bg-accent"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenFileTree(project);
                    }}
                    title={t('tooltips.openFileTree', { defaultValue: 'Browse files' })}
                  >
                    <FolderTree className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('tooltips.renameProject')}
                    className="flex h-6 w-6 flex-shrink-0 cursor-pointer items-center justify-center rounded hover:bg-accent"
                    onClick={(event) => {
                      event.stopPropagation();
                      onStartEditingProject(project);
                    }}
                    title={t('tooltips.renameProject')}
                  >
                    <Edit3 className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('tooltips.deleteProject')}
                    className="flex h-6 w-6 flex-shrink-0 cursor-pointer items-center justify-center rounded hover:bg-accent dark:hover:bg-accent"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteProject(project);
                    }}
                    title={t('tooltips.deleteProject')}
                  >
                    <Trash2 className="h-3 w-3 text-muted-foreground transition-colors hover:text-red-500" />
                  </button>
                </div>
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground/90 transition-colors group-hover:text-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground/90 transition-colors group-hover:text-foreground" />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div ref={itemRef}>
      <SidebarProjectSessions
        project={project}
        isExpanded={isExpanded}
        sessions={sessions}
        selectedSession={selectedSession}
        initialSessionsLoaded={initialSessionsLoaded}
        hasMoreSessions={Boolean(project.sessionMeta?.hasMore)}
        isLoadingMoreSessions={isLoadingMoreSessions}
        activeSessions={activeSessions}
        completedSessions={completedSessions}
        currentTime={currentTime}
        editingSession={editingSession}
        editingSessionName={editingSessionName}
        onEditingSessionNameChange={onEditingSessionNameChange}
        onStartEditingSession={onStartEditingSession}
        onCancelEditingSession={onCancelEditingSession}
        onSaveEditingSession={onSaveEditingSession}
        onProjectSelect={onProjectSelect}
        onSessionSelect={onSessionSelect}
        onDeleteSession={onDeleteSession}
        onForkSession={onForkSession}
        onLoadMoreSessions={onLoadMoreSessions}
        onNewSession={onNewSession}
        t={t}
      />
      </div>
    </div>
  );
}
