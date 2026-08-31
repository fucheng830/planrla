import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, History } from 'lucide-react';

import type { ChatMessage } from '../../types/types';

import { Markdown } from './Markdown';

type CompactSummaryCardProps = {
  message: ChatMessage;
  /** REQ-052: archived message count for the archive-panel entry button. */
  archivedCount?: number | null;
  /** REQ-052: opens the archive (history) panel. */
  onViewArchivedHistory?: () => void;
};

/**
 * REQ-052: a compaction boundary summary renders as a collapsible
 * "context compacted" card — not a normal assistant bubble — with the
 * archive (history) panel as its entry point.
 */
export default function CompactSummaryCard({
  message,
  archivedCount,
  onViewArchivedHistory,
}: CompactSummaryCardProps) {
  const { t } = useTranslation('common');
  const [isExpanded, setIsExpanded] = useState(false);
  const summaryText = String(message.content || '').trim();
  const formattedTime = new Date(message.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      data-message-timestamp={message.timestamp || undefined}
      className="chat-message mx-auto w-full max-w-3xl px-3 sm:px-0"
    >
      <div className="rounded-2xl border border-workbench-border bg-workbench-muted/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 flex-shrink-0 text-workbench-subtle" />
          <span className="text-sm font-medium text-workbench-ink">
            {t('compaction.cardTitle')}
          </span>
          <span className="ml-auto text-xs text-workbench-subtle">{formattedTime}</span>
        </div>

        {summaryText && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setIsExpanded((prev) => !prev)}
              className="ds-focus-ring flex w-full items-center gap-1 text-xs text-workbench-subtle hover:text-workbench-ink"
              aria-expanded={isExpanded}
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
              {isExpanded ? t('compaction.collapseSummary') : t('compaction.expandSummary')}
            </button>
            {isExpanded ? (
              <div className="mt-2 text-sm text-workbench-ink">
                <Markdown className="prose prose-sm prose-gray max-w-none dark:prose-invert">
                  {summaryText}
                </Markdown>
              </div>
            ) : (
              <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-sm text-workbench-subtle">
                {summaryText}
              </p>
            )}
          </div>
        )}

        {/* Entry renders whenever the handler exists; the active viewport may
            report archivedMessages = null (count is resolved lazily by the
            compactions endpoint), so the label degrades to a count-less one. */}
        {onViewArchivedHistory && (
          <button
            type="button"
            onClick={onViewArchivedHistory}
            className="ds-focus-ring mt-3 flex items-center gap-1.5 rounded-lg border border-workbench-border bg-background px-3 py-1.5 text-xs font-medium text-workbench-accent hover:opacity-90"
          >
            <History className="h-3.5 w-3.5" />
            {typeof archivedCount === 'number' && archivedCount > 0
              ? t('compaction.viewHistory', { count: archivedCount })
              : t('compaction.viewHistoryNoCount')}
          </button>
        )}
      </div>
    </div>
  );
}
