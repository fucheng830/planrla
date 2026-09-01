import { useEffect, useRef, useState } from 'react';
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

  return (
    <div className="pb-safe-area-inset-bottom md:space-y-1">
      {!showProjects
        ? state
        : visibleProjects.map((project) => (
            // React key + per-project state lookups all use the DB `projectId`
            // so they remain stable across renames and session changes.
            <SidebarProjectItem
              key={project.projectId}
              project={project}
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              isExpanded={forceExpanded || expandedProjects.has(project.projectId)}
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
          ))}
    </div>
  );
}
