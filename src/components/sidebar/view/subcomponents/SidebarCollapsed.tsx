import { Sparkles, PanelLeftOpen, AlertTriangle } from 'lucide-react';
import type { TFunction } from 'i18next';

import type { AppTab } from '../../../../types/app';
import type { SidebarSearchMode } from '../../types/types';
import { WorkbenchRail } from '../../../workbench';
import { getSidebarRailFooterItems, getSidebarRailItems } from './sidebarRailItems';

type SidebarCollapsedProps = {
  onExpand: () => void;
  onShowSettings: () => void;
  onOpenWorkbenchTab?: (tab: 'overview' | 'inbox' | 'workflow' | 'schedule' | 'chat') => void;
  onSearchModeChange: (mode: SidebarSearchMode) => void;
  activeTab: AppTab | undefined;
  searchMode: SidebarSearchMode;
  completedSessionsCount: number;
  updateAvailable: boolean;
  restartRequired: boolean;
  onShowVersionModal: () => void;
  t: TFunction;
};

export default function SidebarCollapsed({
  onExpand,
  onShowSettings,
  onOpenWorkbenchTab,
  onSearchModeChange,
  activeTab,
  searchMode,
  completedSessionsCount,
  updateAvailable,
  restartRequired,
  onShowVersionModal,
  t,
}: SidebarCollapsedProps) {
  const railItems = getSidebarRailItems(t, completedSessionsCount);
  const railFooterItems = getSidebarRailFooterItems(t);
  const isWorkbench =
    activeTab === 'overview' || activeTab === 'inbox' || activeTab === 'workflow' || activeTab === 'schedule';
  const activeRailId = isWorkbench ? activeTab : searchMode;

  return (
    <div className="flex h-full w-12 flex-col items-center gap-1 bg-background/80 py-3 backdrop-blur-sm">
      {/* Expand button with brand logo */}
      <button
        onClick={onExpand}
        className="group flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80"
        aria-label={t('common:versionUpdate.ariaLabels.showSidebar')}
        title={t('common:versionUpdate.ariaLabels.showSidebar')}
      >
        <PanelLeftOpen className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      </button>

      <div className="nav-divider my-1 w-6" />

      {/* Same entries as the expanded rail: sessions + workbench pages,
          settings/report/community pinned to the bottom. */}
      <WorkbenchRail
        className="w-auto flex-1 border-r-0 bg-transparent py-0"
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
            onSearchModeChange('sessions');
            onExpand();
          }
        }}
      />

      {/* Restart-required indicator */}
      {restartRequired && (
        <div
          className="relative flex h-8 w-8 items-center justify-center rounded-lg"
          aria-label={t('version.restartRequired')}
          title={t('version.restartRequired')}
        >
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
        </div>
      )}

      {/* Update indicator */}
      {updateAvailable && (
        <button
          onClick={onShowVersionModal}
          className="relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80"
          aria-label={t('common:versionUpdate.ariaLabels.updateAvailable')}
          title={t('common:versionUpdate.ariaLabels.updateAvailable')}
        >
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
        </button>
      )}
    </div>
  );
}
