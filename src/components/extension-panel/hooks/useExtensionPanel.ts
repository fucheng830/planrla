import { useState } from 'react';

/**
 * Tabs available in the right-side extension panel. 'browser' is the Electron
 * embedded WebContentsView browser; 'browserUse' is the browser-use automation
 * panel; kanban/cron moved here from the main-area tab switcher.
 */
export type ExtensionTabId = 'markdown' | 'review' | 'browser' | 'kanban' | 'cron' | 'browserUse';

/**
 * State for the right-side extension panel, lifted out of the panel component
 * so the header toolbar buttons can open/activate/toggle individual tabs.
 */
export function useExtensionPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [openTabs, setOpenTabs] = useState<ExtensionTabId[]>([]);
  const [activeTabId, setActiveTabId] = useState<ExtensionTabId | null>(null);

  const openTab = (id: ExtensionTabId) => {
    setIsOpen(true);
    setOpenTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActiveTabId(id);
  };

  const closeTab = (id: ExtensionTabId) => {
    const next = openTabs.filter((tab) => tab !== id);
    setOpenTabs(next);
    if (activeTabId === id) {
      setActiveTabId(next.length > 0 ? next[next.length - 1] : null);
    }
  };

  /** Toolbar toggle: activate the tab, or close it when already active.
   *  Closing the last tab also closes the panel. */
  const toggleTab = (id: ExtensionTabId) => {
    if (isOpen && activeTabId === id) {
      closeTab(id);
      if (openTabs.length <= 1) {
        setIsOpen(false);
      }
    } else {
      openTab(id);
    }
  };

  const togglePanel = () => setIsOpen((v) => !v);
  const closePanel = () => setIsOpen(false);

  return {
    isOpen,
    openTabs,
    activeTabId,
    openTab,
    closeTab,
    toggleTab,
    togglePanel,
    closePanel,
    setActiveTabId,
  };
}
