import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type WorkbenchHeaderProps = {
  leading: ReactNode;
  tabs?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function WorkbenchHeader({ leading, tabs, actions, className }: WorkbenchHeaderProps) {
  return (
    <header className={cn('flex min-h-11 flex-shrink-0 items-center justify-between gap-2 overflow-hidden border-b border-workbench-border bg-workbench-surface px-3 sm:px-4', className)}>
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-shrink basis-[min(100%,calc(100%-8px))]">{leading}</div>
        {tabs && (
          <div className="hidden min-w-0 flex-shrink basis-[min(52%,calc(100%-24px))] overflow-x-auto sm:block">
            {tabs}
          </div>
        )}
        {actions && <div className="flex flex-shrink-0 items-center gap-1">{actions}</div>}
      </div>
    </header>
  );
}
