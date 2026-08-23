import { FolderOpen } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type WorkbenchEmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
};

export function WorkbenchEmptyState({ title, description, action, icon, className }: WorkbenchEmptyStateProps) {
  return (
    <div className={cn('flex flex-1 items-center justify-center p-6', className)}>
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-md border border-workbench-border bg-workbench-muted text-workbench-subtle">
          {icon ?? <FolderOpen className="size-5" aria-hidden="true" />}
        </div>
        <h2 className="text-balance text-lg font-semibold text-workbench-ink">{title}</h2>
        <p className="mt-2 text-pretty text-sm leading-6 text-workbench-subtle">{description}</p>
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}
