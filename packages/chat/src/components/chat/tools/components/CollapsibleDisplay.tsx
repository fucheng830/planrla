import React from 'react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../../../../shared/view/ui';
import { CollapsibleSection } from './CollapsibleSection';

interface CollapsibleDisplayProps {
  toolName: string;
  toolId?: string;
  title: string;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  badge?: React.ReactNode;
  onTitleClick?: () => void;
  children: React.ReactNode;
  showRawParameters?: boolean;
  rawContent?: string;
  className?: string;
  toolCategory?: string;
}

const dotColorMap: Record<string, string> = {
  // ZCode 轨迹色标 token:深浅两态由 CSS 变量切换(与 OneLineDisplay 同源)。
  edit: 'bg-[hsl(var(--traj-tool))]',
  search: 'bg-[hsl(var(--traj-search))]',
  bash: 'bg-[hsl(var(--traj-bash))]',
  todo: 'bg-[hsl(var(--traj-reasoning))]',
  task: 'bg-[hsl(var(--traj-reasoning))]',
  agent: 'bg-[hsl(var(--traj-agent))]',
  plan: 'bg-[hsl(var(--traj-reasoning))]',
  question: 'bg-primary',
  default: 'bg-border',
};

export const CollapsibleDisplay: React.FC<CollapsibleDisplayProps> = ({
  toolName,
  title,
  defaultOpen = false,
  action,
  badge,
  onTitleClick,
  children,
  showRawParameters = false,
  rawContent,
  className = '',
  toolCategory,
}) => {
  const dotColor = dotColorMap[toolCategory || 'default'] || dotColorMap.default;

  return (
    <div className={`my-2 ${className}`}>
      <CollapsibleSection
        title={title}
        toolName={toolName}
        open={defaultOpen}
        action={action}
        badge={badge}
        onTitleClick={onTitleClick}
        dotColor={dotColor}
      >
        {children}

        {showRawParameters && rawContent && (
          <Collapsible className="mt-2">
            <CollapsibleTrigger className="flex items-center gap-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">
              <svg
                className="h-2.5 w-2.5 flex-shrink-0 transition-transform duration-150 data-[state=open]:rotate-90"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              raw params
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-1 overflow-hidden whitespace-pre-wrap break-words rounded border border-border/40 bg-muted p-2 font-mono text-[11px] text-muted-foreground">
                {rawContent}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CollapsibleSection>
    </div>
  );
};
