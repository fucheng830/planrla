import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VList } from 'virtua';
import { ChevronDown, History } from 'lucide-react';

import { authenticatedFetch } from '../../../../utils/api';
import type { NormalizedMessage } from '../../../../stores/useSessionStore';
import { Badge, Button, Dialog, DialogContent, DialogTitle } from '../../../../shared/view/ui';

import { normalizedToChatMessages } from '../../hooks/useChatMessages';
import { createCachedDiffCalculator } from '../../utils/messageTransforms';

import MessageComponent from './MessageComponent';

const PAGE_SIZE = 20;

/** One compaction epoch as listed by GET .../compactions. */
type CompactionEpoch = {
  epoch: number;
  boundaryTimestamp: string;
  archivedMessages: number | null;
  trigger: string | null;
};

type ArchiveMessagesPanelProps = {
  sessionId: string;
  open: boolean;
  onClose: () => void;
  /** Total archived count from the active view's compaction metadata. */
  archivedCount?: number;
};

type HistoryPage = {
  messages: NormalizedMessage[];
  hasMore: boolean;
};

async function fetchArchivedPage(
  sessionId: string,
  epoch: number,
  offset: number,
): Promise<HistoryPage> {
  const params = new URLSearchParams({
    view: 'archived',
    epoch: String(epoch),
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  const response = await authenticatedFetch(
    `/api/providers/sessions/${encodeURIComponent(sessionId)}/messages?${params.toString()}`,
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  const data = body?.data ?? body;
  return {
    messages: Array.isArray(data.messages) ? data.messages : [],
    hasMore: Boolean(data.hasMore),
  };
}

/**
 * REQ-052 「历史消息查询」面板: browses the compacted-away epochs of a
 * session without touching the main session store slot. Tail pagination
 * matches the main viewport (offset counts newest-loaded messages).
 */
export default function ArchiveMessagesPanel({
  sessionId,
  open,
  onClose,
  archivedCount,
}: ArchiveMessagesPanelProps) {
  const { t } = useTranslation('common');
  const [supported, setSupported] = useState(true);
  const [epochs, setEpochs] = useState<CompactionEpoch[]>([]);
  const [selectedEpoch, setSelectedEpoch] = useState<number | null>(null);
  const [messages, setMessages] = useState<NormalizedMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingEpochs, setIsLoadingEpochs] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const requestSeqRef = useRef(0);

  const createDiff = useMemo(() => createCachedDiffCalculator(), []);
  const chatMessages = useMemo(() => normalizedToChatMessages(messages), [messages]);
  const listProvider = messages[0]?.provider ?? 'claude';

  // Open → load the epoch list (newest first). Providers without compaction
  // support answer supported:false — the panel then shows its fallback state.
  useEffect(() => {
    if (!open) return;
    const requestId = ++requestSeqRef.current;
    setIsLoadingEpochs(true);
    setLoadFailed(false);
    setEpochs([]);
    setSelectedEpoch(null);
    setMessages([]);
    setHasMore(false);

    (async () => {
      try {
        const response = await authenticatedFetch(
          `/api/providers/sessions/${encodeURIComponent(sessionId)}/compactions`,
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        const data = body?.data ?? body;
        if (requestId !== requestSeqRef.current) return;
        setSupported(Boolean(data.supported));
        const list = Array.isArray(data.compactions) ? data.compactions : [];
        // Newest epoch last in the response — display newest first.
        setEpochs([...list].sort((a, b) => b.epoch - a.epoch));
      } catch (error) {
        console.error('[ArchivePanel] failed to load compactions:', error);
        if (requestId === requestSeqRef.current) setLoadFailed(true);
      } finally {
        if (requestId === requestSeqRef.current) setIsLoadingEpochs(false);
      }
    })();
  }, [open, sessionId]);

  // Epoch list loaded → select the newest epoch and load its messages.
  useEffect(() => {
    if (!open || epochs.length === 0 || selectedEpoch !== null) return;
    const newest = epochs[0].epoch;
    setSelectedEpoch(newest);

    const requestId = ++requestSeqRef.current;
    setIsLoadingMessages(true);
    setMessages([]);
    fetchArchivedPage(sessionId, newest, 0)
      .then((page) => {
        if (requestId !== requestSeqRef.current) return;
        setMessages(page.messages);
        setHasMore(page.hasMore);
      })
      .catch((error) => {
        console.error('[ArchivePanel] failed to load epoch messages:', error);
        if (requestId === requestSeqRef.current) setLoadFailed(true);
      })
      .finally(() => {
        if (requestId === requestSeqRef.current) setIsLoadingMessages(false);
      });
  }, [open, epochs, selectedEpoch, sessionId]);

  const handleSelectEpoch = useCallback(
    (epoch: number) => {
      if (epoch === selectedEpoch) return;
      const requestId = ++requestSeqRef.current;
      setSelectedEpoch(epoch);
      setIsLoadingMessages(true);
      setMessages([]);
      setHasMore(false);
      fetchArchivedPage(sessionId, epoch, 0)
        .then((page) => {
          if (requestId !== requestSeqRef.current) return;
          setMessages(page.messages);
          setHasMore(page.hasMore);
        })
        .catch((error) => {
          console.error('[ArchivePanel] failed to load epoch messages:', error);
          if (requestId === requestSeqRef.current) setLoadFailed(true);
        })
        .finally(() => {
          if (requestId === requestSeqRef.current) setIsLoadingMessages(false);
        });
    },
    [selectedEpoch, sessionId],
  );

  // 「加载更早」: tail pagination — offset = already-loaded count.
  const handleLoadEarlier = useCallback(() => {
    if (selectedEpoch === null || isLoadingMore) return;
    const requestId = ++requestSeqRef.current;
    setIsLoadingMore(true);
    fetchArchivedPage(sessionId, selectedEpoch, messages.length)
      .then((page) => {
        if (requestId !== requestSeqRef.current) return;
        setMessages((prev) => [...page.messages, ...prev]);
        setHasMore(page.hasMore);
      })
      .catch((error) => {
        console.error('[ArchivePanel] failed to load earlier messages:', error);
      })
      .finally(() => {
        if (requestId === requestSeqRef.current) setIsLoadingMore(false);
      });
  }, [selectedEpoch, isLoadingMore, sessionId, messages.length]);

  const selectedMeta = epochs.find((epoch) => epoch.epoch === selectedEpoch) ?? null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex h-[min(92dvh,48rem)] w-[calc(100vw-1rem)] max-w-3xl flex-col overflow-hidden rounded-3xl border-border/80 bg-popover/95 p-0 shadow-2xl backdrop-blur-xl sm:w-[min(94vw,48rem)]">
        <DialogTitle>{t('compaction.panelTitle')}</DialogTitle>

        {/* Header */}
        <div className="relative shrink-0 overflow-hidden border-b border-border/70 bg-gradient-to-br from-primary/15 via-background to-muted/40 px-4 pb-3 pt-3 sm:px-5 sm:pb-4 sm:pt-4">
          <div className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-primary/20 blur-3xl" />
          <div className="relative flex min-w-0 items-start gap-3">
            <div className="rounded-2xl border border-primary/30 bg-primary/10 p-2.5 text-primary">
              <History className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-bold uppercase tracking-[0.22em] text-primary">
                {t('compaction.panelEyebrow')}
              </p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">
                {t('compaction.panelTitle')}
              </p>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                {typeof archivedCount === 'number'
                  ? t('compaction.archivedCount', { count: archivedCount })
                  : t('compaction.panelSubtitle')}
              </p>
            </div>
          </div>
        </div>

        {/* Epoch switcher (newest → oldest) */}
        {epochs.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/70 bg-muted/20 px-4 py-2.5 sm:px-5">
            {epochs.map((epoch) => (
              <Button
                key={epoch.epoch}
                type="button"
                variant={epoch.epoch === selectedEpoch ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleSelectEpoch(epoch.epoch)}
                className="h-8 rounded-xl px-3 text-xs"
              >
                {t('compaction.epochBadge', { epoch: epoch.epoch })}
                {epoch.archivedMessages !== null && (
                  <Badge variant="secondary" className="ml-1.5 rounded-md px-1.5 text-[10px]">
                    {epoch.archivedMessages}
                  </Badge>
                )}
              </Button>
            ))}
            {selectedMeta?.boundaryTimestamp && (
              <span className="ml-auto text-xs text-muted-foreground">
                {new Date(selectedMeta.boundaryTimestamp).toLocaleString()}
              </span>
            )}
          </div>
        )}

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-hidden bg-background/60 px-4 py-3 sm:px-5">
          {isLoadingEpochs || isLoadingMessages ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-muted-foreground" />
              {t('compaction.loading')}
            </div>
          ) : loadFailed ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <p>{t('compaction.loadFailed')}</p>
              <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={onClose}>
                {t('buttons.close', { defaultValue: 'Close' })}
              </Button>
            </div>
          ) : !supported || epochs.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t('compaction.empty')}
            </div>
          ) : chatMessages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t('compaction.noMessagesInEpoch')}
            </div>
          ) : (
            <VList
              data={chatMessages}
              style={{ height: '100%' }}
              className="scrollbar-thin"
            >
              {(message, index) => (
                <div className="mx-auto w-full max-w-3xl" style={{ paddingBottom: '0.75rem' }}>
                  <MessageComponent
                    message={message}
                    prevMessage={index > 0 ? chatMessages[index - 1] : null}
                    nextMessage={index < chatMessages.length - 1 ? chatMessages[index + 1] : null}
                    createDiff={createDiff}
                    provider={listProvider}
                    canForkAtMessage={false}
                  />
                </div>
              )}
            </VList>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-border/70 bg-muted/20 px-4 py-3 sm:px-5">
          <span className="text-xs text-muted-foreground">
            {selectedEpoch !== null && t('compaction.epochBadge', { epoch: selectedEpoch })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleLoadEarlier}
            disabled={!hasMore || isLoadingMore || isLoadingMessages}
            className="rounded-xl"
          >
            {isLoadingMore && <div className="mr-2 h-3 w-3 animate-spin rounded-full border-b-2 border-current" />}
            <ChevronDown className="mr-1 h-3.5 w-3.5" />
            {t('compaction.loadEarlier')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
