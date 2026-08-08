import React from 'react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';

interface CollapsibleSectionProps {
  title: string;
  toolName?: string;
  open?: boolean;
  action?: React.ReactNode;
  badge?: React.ReactNode;
  onTitleClick?: () => void;
  children: React.ReactNode;
  className?: string;
  dotColor?: string;
}

/**
 * Reusable collapsible section with a terminal-style card header
 */
export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  toolName,
  open = false,
  action,
  badge,
  onTitleClick,
  children,
  className = '',
  dotColor,
}) => {
  const headerBase =
    'flex select-none items-center gap-2 border-b border-border bg-muted/50 px-3 py-2 text-xs transition-colors';
  const dot = dotColor ? (
    <span className={`h-2 w-2 flex-shrink-0 rounded-full ${dotColor}`} />
  ) : null;

  return (
    <Collapsible
      defaultOpen={open}
      className={cn('group/section overflow-hidden rounded-lg border border-border bg-card shadow-sm', className)}
    >
      {/* When there's a clickable title (Edit/Write), only the chevron toggles collapse */}
      {onTitleClick ? (
        <div className={`${headerBase} hover:bg-muted`}>
          {dot}
          <CollapsibleTrigger className="flex flex-shrink-0 items-center p-0.5 text-muted-foreground hover:text-foreground">
            <svg
              className="h-3 w-3 transition-transform duration-150 group-data-[state=open]/section:rotate-90"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </CollapsibleTrigger>
          {toolName && (
            <span className="flex-shrink-0 font-medium text-muted-foreground">{toolName}</span>
          )}
          {toolName && (
            <span className="flex-shrink-0 text-[10px] text-muted-foreground/40">/</span>
          )}
          <button
            onClick={onTitleClick}
            className="flex-1 truncate text-left font-mono text-primary transition-colors hover:text-primary/80 hover:underline"
          >
            {title}
          </button>
          {badge && <span className="ml-auto flex-shrink-0">{badge}</span>}
          {action && <span className="ml-1 flex-shrink-0">{action}</span>}
        </div>
      ) : (
        <CollapsibleTrigger className={`${headerBase} w-full hover:bg-muted hover:text-foreground`}>
          {dot}
          {toolName && (
            <span className="flex-shrink-0 font-medium">{toolName}</span>
          )}
          {toolName && (
            <span className="flex-shrink-0 text-[10px] text-muted-foreground/40">/</span>
          )}
          <span className="flex-1 truncate text-left">{title}</span>
          {badge && <span className="ml-auto flex-shrink-0">{badge}</span>}
          {action && <span className="ml-1 flex-shrink-0">{action}</span>}
          <svg
            className="h-3 w-3 flex-shrink-0 text-muted-foreground transition-transform duration-150 group-data-[state=open]/section:rotate-90"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </CollapsibleTrigger>
      )}

      <CollapsibleContent>
        <div className="px-3 py-2">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
