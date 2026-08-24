import type { ReactNode } from 'react';

import { cn } from '../../../lib/utils';

type PageShellProps = {
  children: ReactNode;
  className?: string;
};

/** Scrollable workbench page container. Pages render inside the existing
 *  main-area tab system; the left rail/sidebar stays untouched. */
export function PageShell({ children, className }: PageShellProps) {
  return (
    <div className={cn('h-full overflow-auto bg-workbench-canvas', className)}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 p-4 lg:p-6">{children}</div>
    </div>
  );
}

type PageToolbarProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  filters?: ReactNode;
};

export function PageToolbar({ title, description, actions, filters }: PageToolbarProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-balance text-lg font-semibold leading-tight text-workbench-ink">{title}</h1>
          {description && <p className="mt-1 text-pretty text-sm text-workbench-subtle">{description}</p>}
        </div>
        {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}
    </div>
  );
}

type MetricCardProps = {
  label: string;
  value: string;
  hint?: string;
  progress?: number;
};

export function MetricCard({ label, value, hint, progress }: MetricCardProps) {
  return (
    <div className="ds-panel p-3">
      <p className="ds-label">{label}</p>
      <p className="mt-2 text-2xl font-semibold leading-none text-workbench-ink">{value}</p>
      {typeof progress === 'number' && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-workbench-muted">
          <div
            className="h-full rounded-full bg-workbench-accent"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
      {hint && <p className="mt-2 text-xs text-workbench-subtle">{hint}</p>}
    </div>
  );
}

type FilterChipProps = {
  label: string;
  active?: boolean;
  count?: number;
  onClick?: () => void;
};

export function FilterChip({ label, active, count, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'ds-focus-ring inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
        active
          ? 'border-workbench-accent/40 bg-workbench-accent/10 text-workbench-accent'
          : 'border-workbench-border bg-workbench-surface text-workbench-subtle hover:bg-workbench-muted hover:text-workbench-ink',
      )}
    >
      {label}
      {typeof count === 'number' && <span className="ds-mono opacity-70">{count}</span>}
    </button>
  );
}
