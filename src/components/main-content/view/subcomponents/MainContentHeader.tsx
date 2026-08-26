import { PanelRight } from 'lucide-react';
import type { MainContentHeaderProps } from '../../types/types';
import MobileMenuButton from './MobileMenuButton';
import MainContentTabSwitcher from './MainContentTabSwitcher';
import { isWorkbenchPageTab } from './mainContentTabSwitcherModel';
import MainContentTitle from './MainContentTitle';
import { WorkbenchHeader } from '../../../workbench';

export default function MainContentHeader({
  activeTab,
  setActiveTab,
  onToggleTerminalPanel,
  onToggleExtension,
  isExtensionOpen,
  extensionActiveTab,
  onToggleExtensionTab,
  selectedProject,
  selectedSession,
  shouldShowBrowserTab,
  isMobile,
  onMenuClick,
}: MainContentHeaderProps) {
  return (
    <WorkbenchHeader
      className="pwa-header-safe"
      leading={
        <div className="flex min-w-0 items-center gap-2">
          {isMobile && <MobileMenuButton onMenuClick={onMenuClick} />}
          <MainContentTitle
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            selectedProject={selectedProject}
            selectedSession={selectedSession}
          />
        </div>
      }
      tabs={!isWorkbenchPageTab(activeTab) ? (
        <div className="relative min-w-0 overflow-hidden">
          <div className="scrollbar-hide overflow-x-auto">
            <MainContentTabSwitcher
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              shouldShowBrowserTab={shouldShowBrowserTab}
              onToggleTerminalPanel={onToggleTerminalPanel}
              extensionActiveTab={extensionActiveTab}
              onToggleExtensionTab={onToggleExtensionTab}
            />
          </div>
        </div>
      ) : undefined}
      actions={onToggleExtension && (
          <button
            type="button"
            onClick={onToggleExtension}
            className={`ds-focus-ring flex flex-shrink-0 items-center justify-center rounded-md p-1.5 ${isExtensionOpen ? 'bg-workbench-muted text-workbench-ink' : 'text-workbench-subtle hover:bg-workbench-muted hover:text-workbench-ink'}`}
            title="Extension panel"
            aria-label="Extension panel"
          >
            <PanelRight className="h-4 w-4" />
          </button>
      )}
    />
  );
}
