import { Terminal, GitBranch, MonitorPlay, KanbanSquare, CalendarClock, type LucideIcon } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import { Tooltip } from '../../../../shared/view/ui';
import type { AppTab } from '../../../../types/app';
import { usePlugins } from '../../../../contexts/PluginsContext';
import PluginIcon from '../../../plugins/view/PluginIcon';

type MainContentTabSwitcherProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  shouldShowBrowserTab: boolean;
  /** When set, clicking the shell tab toggles the bottom terminal panel. */
  onToggleTerminalPanel?: () => void;
};

type BuiltInTab = {
  kind: 'builtin';
  id: AppTab;
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
 * the default main content; every icon toggles its view and clicking the
 * active one returns to chat.
 */
const BASE_TABS: BuiltInTab[] = [
  { kind: 'builtin', id: 'shell', labelKey: 'tabs.shell', icon: Terminal },
  { kind: 'builtin', id: 'git',   labelKey: 'tabs.git',   icon: GitBranch },
];

const BROWSER_TAB: BuiltInTab = {
  kind: 'builtin',
  id: 'browser',
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
        const isActive = tab.id === activeTab;
        const displayLabel = tab.kind === 'builtin' ? t(tab.labelKey) : tab.label;

        return (
          <Tooltip key={tab.id} content={displayLabel} position="bottom">
            <button
              type="button"
              onClick={() => {
                // Shell toggles the bottom terminal panel instead of
                // switching to a full-screen shell tab.
                if (tab.id === 'shell' && onToggleTerminalPanel) {
                  onToggleTerminalPanel();
                  return;
                }
                // Chat is the base view: clicking the active view's icon
                // returns to it.
                setActiveTab(isActive ? 'chat' : tab.id);
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
