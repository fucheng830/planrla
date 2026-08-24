import { Terminal, MonitorPlay, KanbanSquare, CalendarClock, LayoutDashboard, Inbox, Workflow, CalendarDays, type LucideIcon } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import { Tooltip } from '../../../../shared/view/ui';
import type { AppTab } from '../../../../types/app';
import type { ExtensionTabId } from '../../../extension-panel/hooks/useExtensionPanel';
import { usePlugins } from '../../../../contexts/PluginsContext';
import PluginIcon from '../../../plugins/view/PluginIcon';

type MainContentTabSwitcherProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  shouldShowBrowserTab: boolean;
  /** When set, clicking the shell tab toggles the bottom terminal panel. */
  onToggleTerminalPanel?: () => void;
  /** Active tab inside the right-side extension panel (null when closed/none). */
  extensionActiveTab?: ExtensionTabId | null;
  /** Toggle a tab inside the right-side extension panel. */
  onToggleExtensionTab?: (id: ExtensionTabId) => void;
};

type BuiltInTab = {
  kind: 'builtin';
  /** 'shell' toggles the bottom terminal panel; workbench pages replace the
   *  main area; the rest are extension-panel tabs. */
  id: 'shell' | 'overview' | 'inbox' | 'workflow' | 'schedule' | ExtensionTabId;
  labelKey: string;
  icon: LucideIcon;
};

type PluginTab = {
  kind: 'plugin';
  id: AppTab;
  label: string;
  pluginName: string;
  iconFile: string;
};

type TabDefinition = BuiltInTab | PluginTab;

/**
 * Secondary views shown as standalone icon buttons. Chat is NOT listed — it is
 * the default main content. 'shell' toggles the bottom terminal panel;
 * kanban/cron/browserUse toggle tabs in the right-side extension panel;
 * plugin tabs replace the main content and clicking the active one returns
 * to chat.
 */
const BASE_TABS: BuiltInTab[] = [
  { kind: 'builtin', id: 'shell', labelKey: 'tabs.shell', icon: Terminal },
  { kind: 'builtin', id: 'overview', labelKey: 'tabs.overview', icon: LayoutDashboard },
  { kind: 'builtin', id: 'inbox', labelKey: 'tabs.inbox', icon: Inbox },
  { kind: 'builtin', id: 'workflow', labelKey: 'tabs.workflow', icon: Workflow },
  { kind: 'builtin', id: 'schedule', labelKey: 'tabs.schedule', icon: CalendarDays },
  // 'git' is intentionally not here: its entry point moved to the branch
  // indicator next to the project name in MainContentTitle.
];

const BROWSER_TAB: BuiltInTab = {
  kind: 'builtin',
  id: 'browserUse',
  labelKey: 'tabs.browser',
  icon: MonitorPlay,
};

const KANBAN_TAB: BuiltInTab = {
  kind: 'builtin',
  id: 'kanban',
  labelKey: 'tabs.kanban',
  icon: KanbanSquare,
};

const CRON_TAB: BuiltInTab = {
  kind: 'builtin',
  id: 'cron',
  labelKey: 'tabs.cron',
  icon: CalendarClock,
};

export default function MainContentTabSwitcher({
  activeTab,
  setActiveTab,
  shouldShowBrowserTab,
  onToggleTerminalPanel,
  extensionActiveTab,
  onToggleExtensionTab,
}: MainContentTabSwitcherProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();

  const builtInTabs: BuiltInTab[] = [
    ...BASE_TABS,
    KANBAN_TAB,
    CRON_TAB,
    ...(shouldShowBrowserTab ? [BROWSER_TAB] : []),
  ];

  const pluginTabs: PluginTab[] = plugins
    .filter((p) => p.enabled)
    .map((p) => ({
      kind: 'plugin',
      id: `plugin:${p.name}` as AppTab,
      label: p.displayName,
      pluginName: p.name,
      iconFile: p.icon,
    }));

  const tabs: TabDefinition[] = [...builtInTabs, ...pluginTabs];

  return (
    <div className="flex items-center gap-0.5">
      {tabs.map((tab) => {
        const isActive =
          tab.kind === 'plugin'
            ? tab.id === activeTab
            : tab.id === 'overview' || tab.id === 'inbox' || tab.id === 'workflow' || tab.id === 'schedule'
              ? tab.id === activeTab
              : tab.id !== 'shell' && tab.id === extensionActiveTab;
        const displayLabel = tab.kind === 'builtin' ? t(tab.labelKey) : tab.label;

        return (
          <Tooltip key={tab.id} content={displayLabel} position="bottom">
            <button
              type="button"
              onClick={() => {
                if (tab.kind === 'plugin') {
                  // Chat is the base view: clicking the active plugin's icon
                  // returns to it.
                  setActiveTab(isActive ? 'chat' : tab.id);
                  return;
                }
                // Shell toggles the bottom terminal panel instead of
                // switching to a full-screen shell tab.
                if (tab.id === 'shell') {
                  onToggleTerminalPanel?.();
                  return;
                }
                // Workbench pages are full main-area views.
                if (tab.id === 'overview' || tab.id === 'inbox' || tab.id === 'workflow' || tab.id === 'schedule') {
                  setActiveTab(isActive ? 'chat' : tab.id);
                  return;
                }
                // Kanban/cron/browserUse live in the right-side extension panel.
                onToggleExtensionTab?.(tab.id);
              }}
              className={`flex flex-shrink-0 items-center justify-center rounded p-1.5 transition-colors ${
                isActive
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
              aria-label={displayLabel}
              aria-pressed={isActive}
            >
              {tab.kind === 'builtin' ? (
                <tab.icon className="h-4 w-4" strokeWidth={isActive ? 2.2 : 1.8} />
              ) : (
                <PluginIcon
                  pluginName={tab.pluginName}
                  iconFile={tab.iconFile}
                  className="flex h-4 w-4 items-center justify-center [&>svg]:h-full [&>svg]:w-full"
                />
              )}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
