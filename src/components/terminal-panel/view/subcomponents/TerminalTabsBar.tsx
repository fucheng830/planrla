import { useTranslation } from 'react-i18next';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';

import type { TerminalTab } from '../../hooks/useTerminalTabs';

type TerminalTabsBarProps = {
  terminals: TerminalTab[];
  activeTerminalId: string | null;
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onCollapse: () => void;
};

/**
 * VS Code-style terminal tab bar. Tabs show the shell name, the active tab has
 * a top accent border. Right side has new/kill/collapse action buttons.
 */
export default function TerminalTabsBar({ terminals, activeTerminalId, onSwitch, onClose, onNew, onCollapse }: TerminalTabsBarProps) {
  const { t } = useTranslation('shell');

  return (
    <div className="flex h-9 items-stretch bg-[#252526]">
      {terminals.map((terminal) => {
        const isActive = terminal.id === activeTerminalId;
        return (
          <div
            key={terminal.id}
            role="tab"
            tabIndex={0}
            onClick={() => onSwitch(terminal.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSwitch(terminal.id); } }}
            className={[
              'group relative flex max-w-48 min-w-0 cursor-pointer items-center gap-1.5 border-r border-[#1e1e1e] px-3 text-[11px] transition-colors',
              isActive
                ? 'bg-[#1e1e1e] text-white'
                : 'bg-transparent text-[#969696] hover:bg-[#2a2d2e]',
            ].join(' ')}
          >
            {/* Active tab top accent line */}
            {isActive && (
              <span className="absolute inset-x-0 top-0 h-0.5 bg-primary" />
            )}
            <span className="truncate">{terminal.title}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onClose(terminal.id); }}
              className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-[#969696] hover:bg-white/10 hover:text-white"
              aria-label={t('closeTerminal', { defaultValue: 'Kill terminal' })}
              title={t('closeTerminal', { defaultValue: 'Kill terminal' })}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        );
      })}

      {/* Right-side action buttons */}
      <div className="ml-auto flex items-stretch">
        <button
          type="button"
          onClick={onNew}
          className="flex items-center justify-center px-2 text-[#969696] transition-colors hover:bg-white/5 hover:text-white"
          aria-label={t('newTerminal', { defaultValue: 'New terminal' })}
          title={t('newTerminal', { defaultValue: 'New terminal' })}
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onCollapse}
          className="flex items-center justify-center px-2 text-[#969696] transition-colors hover:bg-white/5 hover:text-white"
          aria-label={t('collapsePanel', { defaultValue: 'Close panel' })}
          title={t('collapsePanel', { defaultValue: 'Close panel' })}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
