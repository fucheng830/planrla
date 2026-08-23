import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { StageTemplate } from './types';

export function StageColumn({
  stage,
  index,
  children,
}: {
  stage: StageTemplate;
  index: number;
  children: ReactNode;
}) {
  const { t } = useTranslation('kanban');
  return (
    <div className="flex w-72 shrink-0 flex-col border-r border-workbench-border">
      <div className="sticky top-0 z-[1] flex items-center justify-between border-b border-workbench-border bg-workbench-surface px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">#{index}</span>
          <span className="text-sm font-medium">{stage.name}</span>
        </div>
        <span
          className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide ${
            stage.role === 'agent' ? 'text-workbench-accent' : 'text-workbench-subtle'
          }`}
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              stage.role === 'agent' ? 'bg-workbench-accent' : 'bg-workbench-subtle/50'
            }`}
          />
          {t(`role.${stage.role}`)}
          {stage.agent ? ` · ${stage.agent}` : ''}
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">{children}</div>
    </div>
  );
}
