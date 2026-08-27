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
      <div className="flex w-full min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-shrink items-center">{leading}</div>
        {tabs && (
          <div className="ml-auto hidden min-w-0 flex-shrink overflow-x-auto sm:block">
            {tabs}
          </div>
        )}
        {actions && <div className={cn('flex flex-shrink-0 items-center gap-1', !tabs && 'ml-auto')}>{actions}</div>}
      </div>
    </header>
  );
}
