import type { AppTab, LoadingProgress, Project, ProjectSession, LLMProvider } from '../../../types/app';
import type { CompletedSessionNotificationMap, SessionActivityMap } from '../../../hooks/useSessionProtection';

export type ProjectSortOrder = 'name' | 'date';
export type SidebarSearchMode = 'projects' | 'sessions' | 'archived' | 'files';
export type ArchivedProjectListItem = Project & { isArchived: true };

export type SessionWithProvider = ProjectSession & {
  __provider: LLMProvider;
};

export type ArchivedSessionListItem = {
  sessionId: string;
  provider: LLMProvider;
  projectId: string | null;
  projectPath: string | null;
  projectDisplayName: string;
  sessionTitle: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivity: string | null;
  isProjectArchived: boolean;
};

export type DeleteProjectConfirmation = {
  project: Project;
  sessionCount: number;
};

// Delete confirmation payload used by sidebar UX. `projectId`/`provider` are
// kept for wiring compatibility, while API deletion now keys only by sessionId.
export type SessionDeleteConfirmation = {
  projectId: string | null;
  sessionId: string;
  sessionTitle: string;
  provider: LLMProvider;
  isArchived: boolean;
};

export type SidebarProps = {
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  activeSessions: SessionActivityMap;
  completedSessions: CompletedSessionNotificationMap;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
  onNewSession: (project: Project) => void;
  onSessionDelete?: (sessionId: string) => void;
  // REQ-049 fork — copies the session into a new conversation and navigates to it.
  onSessionFork?: (sessionId: string) => void;
  onLoadMoreSessions?: (projectId: string) => Promise<void> | void;
  // `projectId` is the DB identifier; the sidebar hands it back to the parent
  // when the delete flow completes.
  onProjectDelete?: (projectId: string) => void;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  onRefresh: () => Promise<void> | void;
  onShowSettings: () => void;
  showSettings: boolean;
  settingsInitialTab: string;
  // REQ-051 session context menu: pins the agents tab to a provider on open.
  settingsInitialProvider?: LLMProvider | null;
  onCloseSettings: () => void;
  isMobile: boolean;
  // REQ-047 — 侧边栏"打开 Markdown 编辑器"入口回调。可选,不传则不渲染入口按钮。
  onOpenMarkdownEditor?: () => void;
  // REQ-046 — 侧边栏"打开后台任务面板"入口回调。可选,不传则不渲染入口按钮。
  onOpenBackgroundTasks?: () => void;
  activeTab?: AppTab;
  onOpenWorkbenchTab?: (tab: 'overview' | 'inbox' | 'workflow' | 'schedule' | 'kanban') => void;
};

export type SessionViewModel = {
  isActive: boolean;
  sessionName: string;
  sessionTime: string;
  messageCount: number;
};

// Retained as `name` for backwards compatibility with existing settings
// consumers; the value is populated from `projectId` by normalizeProjectForSettings.
export type SettingsProject = {
  name: string;
  displayName: string;
  fullPath: string;
  path?: string;
};
