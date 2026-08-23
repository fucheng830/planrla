import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

export type WorkbenchRailItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
};

type WorkbenchRailProps = {
  items: readonly WorkbenchRailItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  className?: string;
};

export function WorkbenchRail({ items, activeId, onSelect, className }: WorkbenchRailProps) {
  return (
    <nav aria-label="Workbench navigation" className={cn('flex w-12 flex-col items-center gap-1 border-r border-workbench-border bg-workbench-surface py-3', className)}>
      {items.map(({ id, label, icon: Icon, badge }) => {
        const isActive = id === activeId;
        return (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-current={isActive ? 'page' : undefined}
            data-active={isActive}
            onClick={() => onSelect(id)}
            className={cn(
              'ds-focus-ring relative flex size-9 items-center justify-center rounded-md text-workbench-subtle transition-colors hover:bg-workbench-muted hover:text-workbench-ink',
              isActive && 'bg-workbench-muted text-workbench-accent',
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {badge && <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-workbench-accent" aria-label={badge} />}
          </button>
        );
      })}
    </nav>
  );
}
