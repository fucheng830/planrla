import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, FileText, GitBranch, Globe, KanbanSquare, MonitorPlay, Plus, X } from 'lucide-react';

import GitPanel from '../../git-panel/view/GitPanel';
import { KanbanPanel } from '../../kanban';
import { CronPromptsPanel } from '@planrla/scheduler';
import { BrowserUsePanel } from '../../browser-use';
import type { Project } from '../../../types/app';
import type { SettingsMainTab } from '../../settings/types/types';
import type { ExtensionTabId } from '../hooks/useExtensionPanel';

import EmbeddedBrowser from './subcomponents/EmbeddedBrowser';

type ExtensionPanelProps = {
  selectedProject: Project;
  onFileOpen?: (filePath: string) => void;
  onShowSettings?: (tab?: SettingsMainTab) => void;
  /** Controlled tab state — owned by useExtensionPanel in MainContent so the
   *  header toolbar can open/activate/toggle tabs too. */
  openTabs: ExtensionTabId[];
  activeTabId: ExtensionTabId | null;
  onOpenTab: (id: ExtensionTabId) => void;
  onActivateTab: (id: ExtensionTabId) => void;
  onCloseTab: (id: ExtensionTabId) => void;
  onClose: () => void;
};

const TAB_META: Record<ExtensionTabId, { labelKey: string; icon: typeof FileText }> = {
  markdown: { labelKey: 'extensionPanel.tabs.markdown', icon: FileText },
  review: { labelKey: 'extensionPanel.tabs.review', icon: GitBranch },
  browser: { labelKey: 'extensionPanel.tabs.browser', icon: Globe },
  kanban: { labelKey: 'tabs.kanban', icon: KanbanSquare },
  cron: { labelKey: 'tabs.cron', icon: CalendarClock },
  browserUse: { labelKey: 'tabs.browser', icon: MonitorPlay },
};

const MIN_PANEL_WIDTH = 300;

/**
 * Right-side extension panel with dynamic tabs (like VS Code editor tabs).
 * Default width is 50% of the container; drag the left edge to resize.
 */
export default function ExtensionPanel({
  selectedProject,
  onFileOpen,
  onShowSettings,
  openTabs,
  activeTabId,
  onOpenTab,
  onActivateTab,
  onCloseTab,
  onClose,
}: ExtensionPanelProps) {
  const { t } = useTranslation();
  const [panelWidth, setPanelWidth] = useState<number>(0); // 0 = use 50% via flex-basis
  const [isResizing, setIsResizing] = useState(false);
  const [newTabMenuOpen, setNewTabMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const newTabMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!newTabMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (newTabMenuRef.current && !newTabMenuRef.current.contains(e.target as Node)) {
        setNewTabMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [newTabMenuOpen]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current?.parentElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      // Width = distance from cursor to container's right edge.
      const newWidth = rect.right - e.clientX;
      const maxWidth = rect.width - 300; // leave at least 300px for chat
      if (newWidth >= MIN_PANEL_WIDTH && newWidth <= maxWidth) {
        setPanelWidth(newWidth);
      }
    };
    const handleMouseUp = () => setIsResizing(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  // When panelWidth is 0, use flex: 1 (shares space equally with chat → ~50%).
  // When user drags, switch to explicit pixel width.
  const widthStyle = panelWidth > 0 ? { width: `${panelWidth}px`, flexShrink: 0 } : { flex: 1 };

  return (
    <div
      ref={containerRef}
      className="relative flex h-full flex-shrink-0 flex-col border-l border-workbench-border bg-workbench-surface"
      style={widthStyle}
    >
      {/* Left resize handle — drag to adjust panel width */}
      <div
        onMouseDown={handleResizeStart}
        className="absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize bg-transparent hover:bg-workbench-accent/50"
      />

      {/* Tab bar — dynamic, only shows opened tabs */}
      {openTabs.length > 0 && (
        <div className="flex items-stretch border-b border-workbench-border">
          {openTabs.map((tabId) => {
            const meta = TAB_META[tabId];
            const isActive = tabId === activeTabId;
            return (
              <div
                key={tabId}
                onClick={() => onActivateTab(tabId)}
                className={`group flex cursor-pointer items-center gap-1.5 border-r border-border px-3 py-1.5 text-xs transition-colors ${
                  isActive ? 'bg-workbench-muted font-medium text-workbench-ink' : 'text-workbench-subtle hover:bg-workbench-muted'
                }`}
              >
                <meta.icon className="h-3 w-3" />
                <span>{t(meta.labelKey)}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onCloseTab(tabId); }}
                  className="ds-focus-ring ml-1 flex size-4 items-center justify-center rounded text-workbench-subtle hover:bg-workbench-muted hover:text-workbench-ink"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
          {/* New tab dropdown — click + to see menu of available panels */}
          <div className="relative flex items-center" ref={newTabMenuRef}>
            <button
              type="button"
              onClick={() => setNewTabMenuOpen((v) => !v)}
              className="ds-focus-ring flex h-full items-center justify-center px-2 text-workbench-subtle hover:bg-workbench-muted hover:text-workbench-ink"
              aria-label="New tab"
              title="New tab"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            {newTabMenuOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 min-w-36 rounded-md border border-workbench-border bg-workbench-raised p-1 shadow-lg">
                {(Object.keys(TAB_META) as ExtensionTabId[]).map((id) => {
                  const meta = TAB_META[id];
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => { onOpenTab(id); setNewTabMenuOpen(false); }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-workbench-subtle hover:bg-workbench-muted hover:text-workbench-ink"
                    >
                      <meta.icon className="h-3 w-3" />
                      {t(meta.labelKey)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto flex h-full items-center justify-center px-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Content area */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* Empty state — clickable entry points */}
        {activeTabId === null && (
          <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
            {(Object.keys(TAB_META) as ExtensionTabId[]).map((id) => {
              const meta = TAB_META[id];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onOpenTab(id)}
                  className="flex flex-col items-center gap-2 text-muted-foreground/50 transition-colors hover:text-foreground"
                >
                  <meta.icon className="h-10 w-10" strokeWidth={1} />
                  <span className="text-xs">{t(meta.labelKey)}</span>
                </button>
              );
            })}
          </div>
        )}

        {activeTabId === 'markdown' && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <FileText className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Markdown editor</p>
          </div>
        )}
        {activeTabId === 'review' && (
          <GitPanel selectedProject={selectedProject} isMobile={false} onFileOpen={onFileOpen} />
        )}
        {activeTabId === 'browser' && (
          <EmbeddedBrowser overlayActive={newTabMenuOpen} />
        )}
        {activeTabId === 'kanban' && (
          <KanbanPanel isVisible />
        )}
        {activeTabId === 'cron' && (
          <CronPromptsPanel isVisible />
        )}
        {activeTabId === 'browserUse' && (
          <BrowserUsePanel isVisible onShowSettings={onShowSettings ?? (() => {})} />
        )}
      </div>
    </div>
  );
}
