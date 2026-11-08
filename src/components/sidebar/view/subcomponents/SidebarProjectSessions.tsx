import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button } from '../../../../shared/view/ui';
import type { CompletedSessionNotificationMap, SessionActivityMap } from '../../../../hooks/useSessionProtection';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';

import SidebarSessionItem from './SidebarSessionItem';

type SidebarProjectSessionsProps = {
  project: Project;
  isExpanded: boolean;
  sessions: SessionWithProvider[];
  selectedSession: ProjectSession | null;
  initialSessionsLoaded: boolean;
  hasMoreSessions: boolean;
  isLoadingMoreSessions: boolean;
  activeSessions: SessionActivityMap;
  completedSessions: CompletedSessionNotificationMap;
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
  onLoadMoreSessions: (projectId: string) => void;
  onNewSession: (project: Project) => void;
  t: TFunction;
};

function SessionListSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-md p-2">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 h-3 w-3 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-1">
              <div className="h-3 animate-pulse rounded bg-muted" style={{ width: `${60 + index * 15}%` }} />
              <div className="h-2 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

export default function SidebarProjectSessions({
  project,
  isExpanded,
  sessions,
  selectedSession,
  initialSessionsLoaded,
  hasMoreSessions,
  isLoadingMoreSessions,
  activeSessions,
  completedSessions,
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
  onLoadMoreSessions,
  onNewSession: _onNewSession,
  t,
}: SidebarProjectSessionsProps) {
  // Codex 会话树:每组默认显示前 5 条,其余折叠进「展开显示」
  const [expandedAll, setExpandedAll] = useState(false);
  if (!isExpanded) {
    return null;
  }

  const hasSessions = sessions.length > 0;
  const visibleSessions = expandedAll ? sessions : sessions.slice(0, 5);
  const hiddenCount = sessions.length - visibleSessions.length;

  return (
    <div className="mt-0.5 space-y-0.5">
      {!initialSessionsLoaded ? (
        <SessionListSkeleton />
      ) : !hasSessions ? (
        <div className="px-3 py-2 text-left">
          <p className="text-xs text-muted-foreground">{t('sessions.noSessions')}</p>
        </div>
      ) : (
        <>
          {visibleSessions.map((session) => {
            const activity = activeSessions.get(session.id);
            const completion = completedSessions.get(session.id);

            return (
              <SidebarSessionItem
                key={session.id}
                project={project}
                session={session}
                selectedSession={selectedSession}
                isProcessing={Boolean(activity)}
                taskStatus={activity?.taskStatus ?? completion?.status ?? 'idle'}
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
                t={t}
              />
            );
          })}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setExpandedAll((v) => !v)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground/70 transition-colors hover:text-foreground"
            >
              {expandedAll ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  {t('sessions.collapseSessions', '收起显示')}
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  {t('sessions.expandSessions', '展开显示')}
                </>
              )}
            </button>
          )}

          {hasMoreSessions && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-center text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onLoadMoreSessions(project.projectId)}
              disabled={isLoadingMoreSessions}
            >
              {isLoadingMoreSessions ? t('sessions.loadingSessions') : 'Load more sessions'}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
