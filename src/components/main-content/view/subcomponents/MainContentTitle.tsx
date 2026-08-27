import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitBranch } from 'lucide-react';

import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import type { AppTab, Project, ProjectSession } from '../../../../types/app';
import { usePlugins } from '../../../../contexts/PluginsContext';
import { authenticatedFetch } from '../../../../utils/api';

type MainContentTitleProps = {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  selectedProject: Project;
  selectedSession: ProjectSession | null;
};

/** Fetches the current git branch for the project; null when not a git repo. */
function useProjectBranch(projectId: string | null | undefined): string | null {
  const [branch, setBranch] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setBranch(null);
      return;
    }
    const controller = new AbortController();
    authenticatedFetch(`/api/git/status?project=${encodeURIComponent(projectId)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setBranch(data && !data.error && data.branch ? String(data.branch) : null))
      .catch(() => setBranch(null));
    return () => controller.abort();
  }, [projectId]);

  return branch;
}

function getTabTitle(activeTab: AppTab, t: (key: string) => string, pluginDisplayName?: string) {
  if (activeTab.startsWith('plugin:') && pluginDisplayName) {
    return pluginDisplayName;
  }

  // 'files' is no longer a top-level tab (file tree moved to the sidebar).
  // Fall through to the default title so the chat header stays consistent when
  // the sidebar shows the file tree alongside the conversation.

  if (activeTab === 'git') {
    return t('tabs.git');
  }

  if (activeTab === 'overview' || activeTab === 'inbox' || activeTab === 'workflow' || activeTab === 'schedule') {
    return t(`tabs.${activeTab}`);
  }

  return t('mainContent.project');
}

function getSessionTitle(session: ProjectSession, t: (key: string) => string): string {
  if (session.__provider === 'cursor') {
    return (session.name as string) || t('mainContent.untitledSession');
  }

  return (session.summary as string) || t('mainContent.newSession');
}

export default function MainContentTitle({
  activeTab,
  setActiveTab,
  selectedProject,
  selectedSession,
}: MainContentTitleProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();

  const pluginDisplayName = activeTab.startsWith('plugin:')
    ? plugins.find((p) => p.name === activeTab.replace('plugin:', ''))?.displayName
    : undefined;

  const branch = useProjectBranch(selectedProject.projectId);

  const showSessionIcon = activeTab === 'chat' && Boolean(selectedSession);
  const showChatNewSession = activeTab === 'chat' && !selectedSession;
  const isWorkbenchTitle = activeTab === 'overview' || activeTab === 'inbox' || activeTab === 'workflow' || activeTab === 'schedule';

  const subtitle = (
    <div className="flex items-center gap-1.5 text-[11px] leading-tight text-workbench-subtle">
      <span className="truncate">{selectedProject.displayName}</span>
      {branch && (
        <button
          type="button"
          onClick={() => setActiveTab(activeTab === 'git' ? 'chat' : 'git')}
          className={`flex flex-shrink-0 items-center gap-1 rounded px-1 py-0.5 transition-colors ${
            activeTab === 'git'
              ? 'bg-workbench-muted text-workbench-ink'
              : 'text-workbench-subtle hover:bg-workbench-muted hover:text-workbench-ink'
          }`}
          title={t('tabs.git')}
          aria-label={t('tabs.git')}
          aria-pressed={activeTab === 'git'}
        >
          <GitBranch className="h-3 w-3" />
          <span className="max-w-40 truncate">{branch}</span>
        </button>
      )}
    </div>
  );

  return (
    <div className="scrollbar-hide flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
      {showSessionIcon && (
        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
          <SessionProviderLogo provider={selectedSession?.__provider} className="h-4 w-4" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        {activeTab === 'chat' && selectedSession ? (
          <div className="min-w-0">
            <h2 className="scrollbar-hide overflow-x-auto whitespace-nowrap text-balance text-sm font-semibold leading-tight text-workbench-ink">
              {getSessionTitle(selectedSession, t)}
            </h2>
            {subtitle}
          </div>
        ) : showChatNewSession ? (
          <div className="min-w-0">
            <h2 className="text-balance text-base font-semibold leading-tight text-workbench-ink">{t('mainContent.newSession')}</h2>
            {subtitle}
          </div>
        ) : (
          <div className="min-w-0">
            <h2 className="text-balance text-sm font-semibold leading-tight text-workbench-ink">
              {getTabTitle(activeTab, t, pluginDisplayName)}
            </h2>
            {/* Workbench pages are aggregate/cross-source views — a single
                project/branch subtitle misleads there. */}
            {!isWorkbenchTitle && subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
