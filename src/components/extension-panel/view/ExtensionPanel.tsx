import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, GitBranch, Globe, Plus, X } from 'lucide-react';

import GitPanel from '../../git-panel/view/GitPanel';
import EmbeddedBrowser from './subcomponents/EmbeddedBrowser';
import type { Project } from '../../../types/app';

type ExtensionTabId = 'markdown' | 'review' | 'browser';

type OpenTab = {
  id: ExtensionTabId;
  label: string;
};

type ExtensionPanelProps = {
  selectedProject: Project;
  onFileOpen?: (filePath: string) => void;
  onOpenMarkdownEditor: () => void;
  onClose: () => void;
};

const TAB_META: Record<ExtensionTabId, { label: string; icon: typeof FileText }> = {
  markdown: { label: 'Markdown', icon: FileText },
  review: { label: 'Review', icon: GitBranch },
  browser: { label: 'Browser', icon: Globe },
};

const MIN_PANEL_WIDTH = 300;

/**
 * Right-side extension panel with dynamic tabs (like VS Code editor tabs).
 * Default width is 50% of the container; drag the left edge to resize.
 */
export default function ExtensionPanel({ selectedProject, onFileOpen, onClose }: ExtensionPanelProps) {
  const { t } = useTranslation();
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<ExtensionTabId | null>(null);
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

  const openTab = (id: ExtensionTabId) => {
    setOpenTabs((prev) => (prev.some((tab) => tab.id === id) ? prev : [...prev, { id, label: TAB_META[id].label }]));
    setActiveTabId(id);
  };

  const closeTab = (id: ExtensionTabId) => {
    setOpenTabs((prev) => {
      const next = prev.filter((tab) => tab.id !== id);
      if (activeTabId === id) {
        setActiveTabId(next.length > 0 ? next[next.length - 1].id : null);
      }
      return next;
    });
  };

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
      className="relative flex h-full flex-shrink-0 flex-col border-l border-border bg-card"
      style={widthStyle}
    >
      {/* Left resize handle — drag to adjust panel width */}
      <div
        onMouseDown={handleResizeStart}
        className="absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-primary/50"
      />

      {/* Tab bar — dynamic, only shows opened tabs */}
      {openTabs.length > 0 && (
        <div className="flex items-stretch border-b border-border">
          {openTabs.map((tab) => {
            const meta = TAB_META[tab.id];
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={`group flex cursor-pointer items-center gap-1.5 border-r border-border px-3 py-1.5 text-xs transition-colors ${
                  isActive ? 'bg-background font-medium text-foreground' : 'text-muted-foreground hover:bg-background/60'
                }`}
              >
                <meta.icon className="h-3 w-3" />
                <span>{tab.label}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                  className="ml-1 flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
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
              className="flex h-full items-center justify-center px-2 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="New tab"
              title="New tab"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            {newTabMenuOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 min-w-36 rounded-md border border-border bg-popover p-1 shadow-lg">
                {(Object.keys(TAB_META) as ExtensionTabId[]).map((id) => {
                  const meta = TAB_META[id];
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => { openTab(id); setNewTabMenuOpen(false); }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <meta.icon className="h-3 w-3" />
                      {meta.label}
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
                  onClick={() => openTab(id)}
                  className="flex flex-col items-center gap-2 text-muted-foreground/50 transition-colors hover:text-foreground"
                >
                  <meta.icon className="h-10 w-10" strokeWidth={1} />
                  <span className="text-xs">{meta.label}</span>
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
      </div>
    </div>
  );
}
