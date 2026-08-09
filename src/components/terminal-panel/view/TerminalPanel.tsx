import type { MutableRefObject } from 'react';
import type { MouseEvent } from 'react';
import { Plus } from 'lucide-react';

import type { TerminalTab } from '../hooks/useTerminalTabs';
import StandaloneShell from '../../standalone-shell/view/StandaloneShell';
import type { ProjectSession } from '../../../types/app';
import TerminalTabsBar from './subcomponents/TerminalTabsBar';

type TerminalPanelProps = {
  terminals: TerminalTab[];
  activeTerminalId: string | null;
  panelHeight: number;
  resizeHandleRef: MutableRefObject<HTMLDivElement | null>;
  onResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onCollapse: () => void;
};

/**
 * VS Code-style bottom terminal panel. Hosts multiple keep-mounted terminal
 * instances (every opened terminal stays mounted; only the active one is
 * visible, the rest are `hidden` so their xterm scrollback survives).
 */
export default function TerminalPanel({
  terminals,
  activeTerminalId,
  panelHeight,
  resizeHandleRef,
  onResizeStart,
  onSwitch,
  onClose,
  onNew,
  onCollapse,
}: TerminalPanelProps) {
  return (
    <div
      className="flex flex-shrink-0 flex-col border-t border-[#1e1e1e] bg-[#1e1e1e]"
      style={{ height: panelHeight }}
    >
      {/* Top: resize handle (drag to change height) */}
      <div
        ref={resizeHandleRef}
        onMouseDown={onResizeStart}
        className="group relative h-1 flex-shrink-0 cursor-row-resize bg-transparent transition-colors hover:bg-blue-500/50"
      />

      {/* Tab bar (includes new/kill/collapse actions) */}
      <TerminalTabsBar
        terminals={terminals}
        activeTerminalId={activeTerminalId}
        onSwitch={onSwitch}
        onClose={onClose}
        onNew={onNew}
        onCollapse={onCollapse}
      />

      {/* Terminal instances (keep-mounted) */}
      <div className="min-h-0 flex-1 overflow-hidden bg-[#1e1e1e]">
        {terminals.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <button
              type="button"
              onClick={onNew}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              New terminal
            </button>
          </div>
        ) : (
          terminals.map((terminal) => (
            <div
              key={terminal.id}
              className={`h-full w-full ${terminal.id === activeTerminalId ? 'block' : 'hidden'}`}
            >
              <StandaloneShell
                project={terminal.project}
                session={{ id: terminal.id } as ProjectSession}
                isPlainShell
                isActive={terminal.id === activeTerminalId}
                showHeader={false}
                autoConnect
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
