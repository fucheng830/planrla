import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type WorkbenchSectionProps = {
  label: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function WorkbenchSection({ label, children, action, className }: WorkbenchSectionProps) {
  return (
    <section aria-label={label} className={cn('ds-panel space-y-3 p-3', className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="ds-label text-pretty">{label}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
