import type { ReactNode } from 'react';
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
  return (
    <div className="flex w-72 shrink-0 flex-col border-r border-border">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">#{index}</span>
          <span className="text-sm font-medium">{stage.name}</span>
        </div>
        <span
          className={`text-[10px] uppercase ${
            stage.role === 'agent' ? 'text-blue-500' : 'text-muted-foreground'
          }`}
        >
          {stage.role}
          {stage.agent ? ` · ${stage.agent}` : ''}
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">{children}</div>
    </div>
  );
}
