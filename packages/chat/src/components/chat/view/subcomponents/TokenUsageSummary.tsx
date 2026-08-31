import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ActivityIcon, Loader2 } from 'lucide-react';

type TokenUsageSummaryProps = {
  usage: Record<string, unknown> | null;
  /**
   * REQ-052: whether the active provider supports context compaction, mapped
   * from the backend capability matrix (supportsCompact). When false the
   * popover says so and clicks are inert — the server rejects with
   * COMPACT_UNSUPPORTED as a second safety net.
   */
  supportsCompact?: boolean;
  /** True while a chat.compact run is in flight for the viewed session. */
  isCompacting?: boolean;
  /** Messages currently rendered in the conversation pane. */
  visibleMessageCount?: number;
  /** Total messages in the session (0 = nothing to compact yet). */
  totalMessages?: number;
  /** Click handler — triggers chat.compact for the viewed session. */
  onCompact?: () => void;
};

const formatTokenCount = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }

  if (value >= 10_000) {
    return `${Math.round(value / 1_000)}K`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return value.toLocaleString();
};

const readUsageNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const CARD_WIDTH = 248;
const CARD_GAP = 8;

/**
 * Fixed position for the detail card: anchored above the button, right-aligned
 * with it (the button sits in the composer's bottom toolbar), clamped to the
 * viewport. Pattern mirrors Tooltip.tsx (portal + fixed + delay timer).
 */
function getCardStyle(anchor: DOMRect): CSSProperties {
  const left = Math.max(8, Math.min(anchor.right - CARD_WIDTH, window.innerWidth - CARD_WIDTH - 8));
  return {
    position: 'fixed',
    left: `${left}px`,
    top: `${Math.max(8, anchor.top - CARD_GAP)}px`,
    width: `${CARD_WIDTH}px`,
    transform: 'translateY(-100%)',
    zIndex: 1000,
  };
}

/**
 * Composer toolbar button summarizing token usage (REQ-052).
 *
 * - Hover ≥150ms opens a detail card (portal) with used/total tokens,
 *   input/output breakdown, context-window share, and visible message count,
 *   styled after the command menu (blue/white, blurred, large shadow).
 * - Click triggers context compaction (chat.compact) for the viewed session;
 *   the button shows a spinner while the run is in flight. The old
 *   button→/cost-modal binding is gone — /cost stays available as a slash
 *   command.
 */
export default function TokenUsageSummary({
  usage,
  supportsCompact = false,
  isCompacting = false,
  visibleMessageCount = 0,
  totalMessages = 0,
  onCompact,
}: TokenUsageSummaryProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const [cardStyle, setCardStyle] = useState<CSSProperties | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  const breakdown =
    usage?.breakdown && typeof usage.breakdown === 'object'
      ? usage.breakdown as Record<string, unknown>
      : null;
  const inputTokens = readUsageNumber(usage?.inputTokens ?? breakdown?.input);
  const outputTokens = readUsageNumber(usage?.outputTokens ?? breakdown?.output);
  const usedTokens = readUsageNumber(usage?.used) || inputTokens + outputTokens;
  const totalTokens = readUsageNumber(usage?.total);
  const contextShare = totalTokens > 0
    ? Math.min(100, Math.round((usedTokens / totalTokens) * 100))
    : 0;

  const isEmptySession = totalMessages === 0;
  const compactDisabled = isCompacting || !supportsCompact || isEmptySession || !onCompact;

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      if (anchor) {
        setCardStyle(getCardStyle(anchor));
      }
      setIsOpen(true);
    }, 150);
  }, [clearHoverTimer]);

  const handleMouseLeave = useCallback(() => {
    clearHoverTimer();
    setIsOpen(false);
  }, [clearHoverTimer]);

  // Avoid a late timer firing after unmount.
  useEffect(() => clearHoverTimer, [clearHoverTimer]);

  const statusLine = isCompacting
    ? t('tokenUsage.compacting')
    : isEmptySession
      ? t('tokenUsage.compactEmpty')
      : supportsCompact
        ? t('tokenUsage.compactHint')
        : t('tokenUsage.compactUnsupported');

  return (
    <div
      ref={anchorRef}
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        onClick={compactDisabled ? undefined : onCompact}
        disabled={isCompacting}
        aria-label={t('tokenUsage.compress')}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/70 bg-background/70 px-2 text-xs text-muted-foreground shadow-sm transition-colors hover:border-primary/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:gap-2 sm:px-2.5"
      >
        <span className="grid h-5 w-5 place-items-center rounded-md bg-primary/10 text-primary">
          {isCompacting
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <ActivityIcon className="h-3.5 w-3.5" />}
        </span>
        <span className="font-medium text-foreground">{formatTokenCount(usedTokens)}</span>
        <span className="hidden text-muted-foreground/70 sm:inline">{t('tokenUsage.tokens')}</span>
      </button>

      {isOpen && cardStyle && typeof document !== 'undefined' && createPortal(
        // pointer-events-none: the card is informational only — the button
        // itself is the trigger, and mouseleave on the wrapper stays authoritative.
        <div
          style={cardStyle}
          role="tooltip"
          className="animate-in fade-in-0 zoom-in-95 pointer-events-none rounded-xl border border-primary/40 bg-white/95 p-3 text-xs text-gray-900 shadow-[0_24px_60px_rgba(2,6,23,0.38),0_0_0_1px_rgba(148,163,184,0.12)] backdrop-blur-md duration-150 dark:border-primary/40 dark:bg-slate-950/95 dark:text-slate-100"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold">{t('tokenUsage.popoverTitle')}</span>
            <span className="grid h-4 w-4 place-items-center rounded bg-primary/10 text-primary">
              <ActivityIcon className="h-3 w-3" />
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('tokenUsage.usedTokens')}</span>
              <span className="font-medium">{usedTokens.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('tokenUsage.inputTokens')}</span>
              <span>{inputTokens.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('tokenUsage.outputTokens')}</span>
              <span>{outputTokens.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('tokenUsage.visibleMessages')}</span>
              <span>{visibleMessageCount.toLocaleString()} / {totalMessages.toLocaleString()}</span>
            </div>
          </div>

          {totalTokens > 0 && (
            <div className="mt-2.5">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-muted-foreground">{t('tokenUsage.contextShare')}</span>
                <span className="font-medium">{contextShare}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300"
                  style={{ width: `${contextShare}%` }}
                />
              </div>
            </div>
          )}

          <div className="mt-2.5 border-t border-border/40 pt-2 text-[11px] leading-4 text-muted-foreground">
            {statusLine}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
