import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { TFunction } from 'i18next';

import { api } from '../../../../utils/api';
import type { LoadingProgress, Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { CompletedSessionNotificationMap, SessionActivityMap } from '../../../../hooks/useSessionProtection';
import type { SessionWithProvider } from '../../types/types';

import SidebarProjectItem from './SidebarProjectItem';
import SidebarProjectsState from './SidebarProjectsState';

export type SidebarProjectListProps = {
  projects: Project[];
  filteredProjects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  expandedProjects: Set<string>;
  editingProject: string | null;
  editingName: string;
  initialSessionsLoaded: Set<string>;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  deletingProjects: Set<string>;
  getProjectSessions: (project: Project) => SessionWithProvider[];
  onLoadMoreSessions: (projectId: string) => void;
  loadingMoreProjects: Set<string>;
  activeSessions: SessionActivityMap;
  completedSessions: CompletedSessionNotificationMap;
  forceExpanded?: boolean;
  isProjectStarred: (projectName: string) => boolean;
  onEditingNameChange: (value: string) => void;
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
  // REQ-049 fork — optional; when absent the fork button is not rendered.
  onForkSession?: (sessionId: string) => void;
  onNewSession: (project: Project) => void;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  t: TFunction;
};

export default function SidebarProjectList({
  projects,
  filteredProjects,
  selectedProject,
  selectedSession,
  isLoading,
  loadingProgress,
  expandedProjects,
  editingProject,
  editingName,
  initialSessionsLoaded,
  currentTime,
  editingSession,
  editingSessionName,
  deletingProjects,
  getProjectSessions,
  onLoadMoreSessions,
  loadingMoreProjects,
  activeSessions,
  completedSessions,
  forceExpanded = false,
  isProjectStarred,
  onEditingNameChange,
  onToggleProject,
  onOpenFileTree,
  onProjectSelect,
  onToggleStarProject,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteProject,
  onSessionSelect,
  onDeleteSession,
  onForkSession,
  onNewSession,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  t,
}: SidebarProjectListProps) {
  // Sidebar drag-and-drop reordering (desktop list only). Local state gives
  // instant feedback; the persistence request fires on drop and can fail
  // silently (order reverts on next reload — same tradeoff as star toggles
  // before their optimistic layer existed).
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null);
  const [dropTargetProjectId, setDropTargetProjectId] = useState<string | null>(null);
  const dropBelowRef = useRef(false);
  // Codex「新聊天」:全局入口,弹项目选择浮层后新建会话
  const [chatPickerOpen, setChatPickerOpen] = useState(false);
  const chatPickerRef = useRef<HTMLDivElement>(null);
  const [orderedProjects, setOrderedProjects] = useState<Project[] | null>(null);

  useEffect(() => {
    setOrderedProjects(null);
  }, [projects]);

  const handleDrop = (targetProjectId: string) => {
    setDraggingProjectId((currentDraggingId) => {
      setOrderedProjects((currentOrder) => {
        const baseList = currentOrder ?? filteredProjects;
        if (!currentDraggingId || currentDraggingId === targetProjectId) {
          return currentOrder;
        }
        const fromIndex = baseList.findIndex((p) => p.projectId === currentDraggingId);
        const toIndex = baseList.findIndex((p) => p.projectId === targetProjectId);
        if (fromIndex < 0 || toIndex < 0) {
          return currentOrder;
        }
        const next = [...baseList];
        const [moved] = next.splice(fromIndex, 1);
        const insertAt = dropBelowRef.current ? toIndex + 1 : toIndex;
        next.splice(insertAt > fromIndex ? insertAt - 1 : insertAt, 0, moved);
        void api.reorderProjects(next.map((p) => p.projectId)).catch(() => {});
        return next;
      });
      return null;
    });
    setDropTargetProjectId(null);
  };

  useEffect(() => {
    if (!chatPickerOpen) return;
    const onDocClick = (event: MouseEvent) => {
      if (chatPickerRef.current && !chatPickerRef.current.contains(event.target as Node)) {
        setChatPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [chatPickerOpen]);

  const state = (
    <SidebarProjectsState
      isLoading={isLoading}
      loadingProgress={loadingProgress}
      projectsCount={projects.length}
      filteredProjectsCount={filteredProjects.length}
      t={t}
    />
  );

  useEffect(() => {
    let baseTitle = 'Planrla';
    const displayName = selectedProject?.displayName?.trim();
    if (displayName) {
      baseTitle = `${displayName} - ${baseTitle}`;
    }
    document.title = baseTitle;
  }, [selectedProject]);

  const showProjects = !isLoading && projects.length > 0 && filteredProjects.length > 0;
  const visibleProjects = orderedProjects ?? filteredProjects;
  // Codex 会话树:不分组,项目平铺且默认全部展开(每组截断 5 条)

  const renderProject = (project: Project) => (
    // React key + per-project state lookups all use the DB `projectId`
    // so they remain stable across renames and session changes.
    <SidebarProjectItem
      key={project.projectId}
      project={project}
      selectedProject={selectedProject}
      selectedSession={selectedSession}
      isExpanded
      isDeleting={deletingProjects.has(project.projectId)}
      isStarred={isProjectStarred(project.projectId)}
      editingProject={editingProject}
      editingName={editingName}
      sessions={getProjectSessions(project)}
      initialSessionsLoaded={initialSessionsLoaded.has(project.projectId)}
      isLoadingMoreSessions={loadingMoreProjects.has(project.projectId)}
      currentTime={currentTime}
      editingSession={editingSession}
      editingSessionName={editingSessionName}
      onEditingNameChange={onEditingNameChange}
      onToggleProject={onToggleProject}
      onOpenFileTree={onOpenFileTree}
      onProjectSelect={onProjectSelect}
      onToggleStarProject={onToggleStarProject}
      onStartEditingProject={onStartEditingProject}
      onCancelEditingProject={onCancelEditingProject}
      onSaveProjectName={onSaveProjectName}
      onDeleteProject={onDeleteProject}
      onSessionSelect={onSessionSelect}
      onDeleteSession={onDeleteSession}
      onForkSession={onForkSession}
      onLoadMoreSessions={onLoadMoreSessions}
      activeSessions={activeSessions}
      completedSessions={completedSessions}
      onNewSession={onNewSession}
      onEditingSessionNameChange={onEditingSessionNameChange}
      onStartEditingSession={onStartEditingSession}
      onCancelEditingSession={onCancelEditingSession}
      onSaveEditingSession={onSaveEditingSession}
      t={t}
      draggable
      isDragging={draggingProjectId === project.projectId}
      isDropTarget={dropTargetProjectId === project.projectId}
      onDragStartProject={() => setDraggingProjectId(project.projectId)}
      onDragOverProject={(below) => {
        dropBelowRef.current = below;
        setDropTargetProjectId(project.projectId);
      }}
      onDropProject={() => handleDrop(project.projectId)}
      onDragEndProject={() => {
        setDraggingProjectId(null);
        setDropTargetProjectId(null);
      }}
    />
  );

  return (
    <div className="pb-safe-area-inset-bottom md:space-y-1">
      {showProjects && (
        <div ref={chatPickerRef} className="relative px-2 pb-1">
          <button
            type="button"
            onClick={() => setChatPickerOpen((v) => !v)}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-primary text-xs font-semibold text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('projects.newChat', '新聊天')}
          </button>
          {chatPickerOpen && (
            <div className="absolute left-2 right-2 top-11 z-40 max-h-72 overflow-y-auto rounded-xl border border-border bg-popover py-1 shadow-[0_8px_32px_hsl(0_0%_0%/0.14)]">
              <div className="border-b border-border/60 px-3 py-2 text-xs font-semibold text-foreground">
                {t('projects.newChatPickProject', '选择项目')}
              </div>
              {visibleProjects.map((project) => (
                <button
                  key={project.projectId}
                  type="button"
                  onClick={() => {
                    setChatPickerOpen(false);
                    onProjectSelect(project);
                    onNewSession(project);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted"
                >
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {project.displayName || project.projectId}
                  </span>
                  <span className="flex-shrink-0 text-[11px] tabular-nums text-muted-foreground/60">
                    {String(Number(project.sessionMeta?.total ?? getProjectSessions(project).length))}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {!showProjects
        ? state
        : visibleProjects.map(renderProject)}
    </div>
  );
}
