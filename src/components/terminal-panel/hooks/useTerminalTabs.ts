import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Project } from '../../../types/app';

export type TerminalTab = {
  /** Unique id; also used as the shell sessionId so the backend ptySessionKey
   *  stays unique per terminal (avoids output cross-talk between tabs). */
  id: string;
  /** Display label shown in the tab bar ("Terminal 1", "Terminal 2", ...). */
  title: string;
  /** Project the terminal runs in (determines cwd). Null falls back to the
   *  user's home dir on the backend. */
  project: Project | null;
};

type UseTerminalTabsOptions = {
  selectedProject: Project | null;
  isMobile: boolean;
  initialHeight?: number;
};

const MIN_PANEL_HEIGHT = 120;
const TERMINAL_TITLE = (n: number) => `Terminal ${n}`;

/**
 * Multi-terminal tabs state for the bottom panel. Mirrors the openFiles /
 * activeFilePath shape of useEditorSidebar: every opened terminal stays mounted
 * (keep-mounted via `hidden` class in the panel), switching only toggles
 * visibility so scrollback and WS connections survive tab switches.
 */
export const useTerminalTabs = ({
  selectedProject,
  isMobile,
  initialHeight = 280,
}: UseTerminalTabsOptions) => {
  const [terminals, setTerminals] = useState<TerminalTab[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [panelHeight, setPanelHeight] = useState(initialHeight);
  const [isResizing, setIsResizing] = useState(false);
  const resizeHandleRef = useRef<HTMLDivElement | null>(null);

  const openTerminal = useCallback(
    (project?: Project | null) => {
      const id = crypto.randomUUID();
      setTerminals((prev) => {
        const number = prev.length + 1;
        return [...prev, { id, title: TERMINAL_TITLE(number), project: project ?? selectedProject }];
      });
      setActiveTerminalId(id);
      setIsPanelOpen(true);
    },
    [selectedProject],
  );

  const switchTerminal = useCallback((id: string) => {
    setActiveTerminalId(id);
  }, []);

  const closeTerminal = useCallback((id: string) => {
    setTerminals((prev) => {
      const index = prev.findIndex((t) => t.id === id);
      if (index < 0) return prev;
      const next = prev.slice();
      next.splice(index, 1);
      return next;
    });
    setActiveTerminalId((current) => {
      if (current !== id) return current;
      const remaining = terminals.filter((t) => t.id !== id);
      if (remaining.length === 0) {
        setIsPanelOpen(false);
        return null;
      }
      const closedIndex = terminals.findIndex((t) => t.id === id);
      const neighbourIndex = Math.min(closedIndex, remaining.length - 1);
      return remaining[Math.max(0, neighbourIndex)]?.id ?? null;
    });
  }, [terminals]);

  const togglePanel = useCallback(() => {
    setIsPanelOpen((prev) => {
      // Opening the panel with no terminals auto-creates the first one.
      if (!prev && terminals.length === 0) {
        const id = crypto.randomUUID();
        setTerminals((p) => [...p, { id, title: TERMINAL_TITLE(1), project: selectedProject }]);
        setActiveTerminalId(id);
        return true;
      }
      return !prev;
    });
  }, [terminals.length, selectedProject]);

  const handlePanelResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (isMobile) return;
      setIsResizing(true);
      event.preventDefault();
    },
    [isMobile],
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const panel = resizeHandleRef.current?.parentElement;
      const container = panel?.parentElement;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      // Panel height = distance from container bottom to cursor.
      const newHeight = containerRect.bottom - event.clientY;
      const maxHeight = containerRect.height * 0.8;
      if (newHeight >= MIN_PANEL_HEIGHT && newHeight <= maxHeight) {
        setPanelHeight(newHeight);
      }
    };
    const handleMouseUp = () => setIsResizing(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  return {
    terminals,
    activeTerminalId,
    isPanelOpen,
    panelHeight,
    isResizing,
    resizeHandleRef,
    openTerminal,
    switchTerminal,
    closeTerminal,
    togglePanel,
    handlePanelResizeStart,
  };
};
