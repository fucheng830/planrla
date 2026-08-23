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
    <header className={cn('flex min-h-11 flex-shrink-0 items-center border-b border-workbench-border bg-workbench-surface px-3 sm:px-4', className)}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0 flex-1">{leading}</div>
        {tabs && <div className="min-w-0 max-w-[52%] overflow-x-auto">{tabs}</div>}
        {actions && <div className="flex flex-shrink-0 items-center gap-1">{actions}</div>}
      </div>
    </header>
  );
}
