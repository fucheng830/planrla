import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type WorkbenchInspectorProps = {
  title: string;
  children: ReactNode;
  onClose?: () => void;
  className?: string;
};

export function WorkbenchInspector({ title, children, onClose, className }: WorkbenchInspectorProps) {
  return (
    <aside aria-label={title} className={cn('ds-panel flex min-h-0 min-w-0 flex-col overflow-hidden', className)}>
      <div className="ds-panel-header flex-shrink-0">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-workbench-ink text-balance">{title}</h2>
        {onClose && (
          <button type="button" onClick={onClose} className="ds-focus-ring rounded-md p-1 text-workbench-subtle hover:bg-workbench-muted hover:text-workbench-ink" aria-label={`Close ${title}`}>
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
    </aside>
  );
}
