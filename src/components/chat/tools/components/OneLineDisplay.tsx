import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { copyTextToClipboard } from '../../../../utils/clipboard';
import { ToolStatusBadge } from './ToolStatusBadge';
import type { ToolStatus } from './ToolStatusBadge';

type ActionType = 'copy' | 'open-file' | 'jump-to-results' | 'none';

interface OneLineDisplayProps {
  toolName: string;
  icon?: string;
  label?: string;
  value: string;
  secondary?: string;
  action?: ActionType;
  onAction?: () => void;
  style?: string;
  wrapText?: boolean;
  colorScheme?: {
    primary?: string;
    secondary?: string;
    background?: string;
    border?: string;
    icon?: string;
  };
  resultId?: string;
  toolResult?: any;
  toolId?: string;
  status?: ToolStatus;
  category?: string;
}

const dotColorMap: Record<string, string> = {
  edit: 'bg-amber-500 dark:bg-amber-400',
  search: 'bg-slate-400 dark:bg-slate-500',
  bash: 'bg-green-500 dark:bg-green-400',
  todo: 'bg-violet-500 dark:bg-violet-400',
  task: 'bg-violet-500 dark:bg-violet-400',
  agent: 'bg-purple-500 dark:bg-purple-400',
  plan: 'bg-indigo-500 dark:bg-indigo-400',
  question: 'bg-blue-500 dark:bg-blue-400',
  default: 'bg-border',
};

const CardShell: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`group my-2 overflow-hidden rounded-lg border border-border bg-card shadow-sm ${className}`}>
    {children}
  </div>
);

const CardHeader: React.FC<{ dotColor?: string; toolName: string; label?: string; children?: React.ReactNode }> = ({
  dotColor,
  toolName,
  label,
  children,
}) => (
  <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-2 text-xs">
    {dotColor && <span className={`h-2 w-2 flex-shrink-0 rounded-full ${dotColor}`} />}
    <span className="flex-shrink-0 font-medium text-muted-foreground">{label || toolName}</span>
    {children}
  </div>
);

/**
 * Unified one-line display for simple tool inputs and results
 * Used by: Bash, Read, Grep/Glob (minimized), TodoRead, etc.
 */
export const OneLineDisplay: React.FC<OneLineDisplayProps> = ({
  toolName,
  icon,
  label,
  value,
  secondary,
  action = 'none',
  onAction,
  style,
  wrapText = false,
  colorScheme = {
    primary: 'text-foreground',
    secondary: 'text-muted-foreground',
    background: '',
    border: 'border-border',
    icon: 'text-muted-foreground',
  },
  toolResult,
  toolId,
  status,
  category,
}) => {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);
  const isTerminal = style === 'terminal';

  const handleAction = async () => {
    if (action === 'copy' && value) {
      const didCopy = await copyTextToClipboard(value);
      if (!didCopy) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else if (onAction) {
      onAction();
    }
  };

  const dotColor = dotColorMap[category || 'default'] || dotColorMap.default;

  const renderCopyButton = () => (
    <button
      onClick={handleAction}
      className="ml-auto flex-shrink-0 text-muted-foreground transition-all hover:text-foreground"
      title={t('codeBlock.copy')}
      aria-label={t('codeBlock.copy')}
    >
      {copied ? (
        <svg className="h-3 w-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );

  // Terminal style: dark card with a command block
  if (isTerminal) {
    return (
      <CardShell>
        <CardHeader dotColor={dotColor} toolName={toolName} label={label}>
          {status && <ToolStatusBadge status={status} className="ml-auto" />}
          {action === 'copy' && renderCopyButton()}
        </CardHeader>
        <div className="px-3 py-2">
          <div className="rounded bg-gray-900 px-3 py-2 dark:bg-black">
            <code className={`block font-mono text-xs text-green-400 ${wrapText ? 'whitespace-pre-wrap break-all' : 'truncate'}`}>
              <span className="select-none text-green-600 dark:text-green-500">$ </span>{value}
            </code>
          </div>
          {secondary && (
            <div className="mt-1.5 text-[11px] italic text-muted-foreground/60">
              {secondary}
            </div>
          )}
        </div>
      </CardShell>
    );
  }

  // File open style
  if (action === 'open-file') {
    const displayName = value.split('/').pop() || value;
    return (
      <CardShell>
        <div className="flex items-center gap-2 px-3 py-2 text-xs">
          <span className={`h-2 w-2 flex-shrink-0 rounded-full ${dotColor}`} />
          <span className="flex-shrink-0 font-medium text-muted-foreground">{label || toolName}</span>
          <span className="text-[10px] text-muted-foreground/40">/</span>
          <button
            onClick={handleAction}
            className="flex-1 truncate text-left font-mono text-xs text-primary transition-colors hover:text-primary/80 hover:underline"
            title={value}
          >
            {displayName}
          </button>
          {status && <ToolStatusBadge status={status} className="ml-auto" />}
        </div>
      </CardShell>
    );
  }

  // Search / jump-to-results style
  if (action === 'jump-to-results') {
    return (
      <CardShell>
        <div className="flex items-center gap-2 px-3 py-2 text-xs">
          <span className={`h-2 w-2 flex-shrink-0 rounded-full ${dotColor}`} />
          <span className="flex-shrink-0 font-medium text-muted-foreground">{label || toolName}</span>
          <span className="text-[10px] text-muted-foreground/40">/</span>
          <span className={`min-w-0 flex-1 truncate font-mono text-xs ${colorScheme.primary}`}>
            {value}
          </span>
          {secondary && (
            <span className="flex-shrink-0 text-[11px] italic text-muted-foreground/60">
              {secondary}
            </span>
          )}
          {status && <ToolStatusBadge status={status} className="ml-auto" />}
          {toolResult && (
            <a
              href={`#tool-result-${toolId}`}
              className="ml-1 flex flex-shrink-0 items-center gap-0.5 text-[11px] text-primary transition-colors hover:text-primary/80"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </a>
          )}
        </div>
      </CardShell>
    );
  }

  // Default one-line style
  return (
    <CardShell>
      <div className={`flex items-center gap-2 px-3 py-2 text-xs ${colorScheme.background || ''}`}>
        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${dotColor}`} />
        {icon && icon !== 'terminal' && (
          <span className={`${colorScheme.icon} flex-shrink-0 text-xs`}>{icon}</span>
        )}
        {!icon && (label || toolName) && (
          <span className="flex-shrink-0 font-medium text-muted-foreground">{label || toolName}</span>
        )}
        {(icon || label || toolName) && (
          <span className="text-[10px] text-muted-foreground/40">/</span>
        )}
        <span className={`font-mono text-xs ${wrapText ? 'whitespace-pre-wrap break-all' : 'truncate'} min-w-0 flex-1 ${colorScheme.primary}`}>
          {value}
        </span>
        {secondary && (
          <span className={`flex-shrink-0 text-[11px] ${colorScheme.secondary} italic`}>
            {secondary}
          </span>
        )}
        {status && <ToolStatusBadge status={status} className="ml-auto" />}
        {action === 'copy' && renderCopyButton()}
      </div>
    </CardShell>
  );
};
