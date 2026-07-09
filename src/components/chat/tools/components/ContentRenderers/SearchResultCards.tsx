import React, { memo, useMemo } from 'react';

export interface SearchMatchCard {
  sessionId: string;
  sessionTitle: string | null;
  provider: string;
  projectPath: string | null;
  snippet: string;
  score?: number;
  timestamp?: string | null;
}

interface SearchResultCardsProps {
  matches: SearchMatchCard[];
  onOpenSession?: (sessionId: string) => void;
  emptyText?: string;
}

/**
 * Renders session-level search matches as clickable cards.
 *
 * Used by:
 *  - ToolRenderer for the `search_conversations` tool result (contentType
 *    'search-results') — the agent's global-search tool output.
 *  - (Future) the `/search` slash-command injection preview.
 *
 * Clicking a card opens the source session via `onOpenSession(sessionId)`,
 * which is plumbed down from ChatInterface's `onNavigateToSession`.
 *
 * `snippet` arrives with `<mark>...</mark>` tags from FTS5's snippet(); we
 * render it as HTML so the highlight survives (the value is server-produced
 * from FTS5, not user-injected, and is already escaped by SQLite).
 */
export const SearchResultCards: React.FC<SearchResultCardsProps> = memo(({
  matches,
  onOpenSession,
  emptyText,
}) => {
  const cards = useMemo(() => {
    if (!Array.isArray(matches)) return [];
    return matches.filter((m) => m && typeof m.sessionId === 'string');
  }, [matches]);

  if (cards.length === 0) {
    return (
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {emptyText || 'No matching sessions'}
      </div>
    );
  }

  return (
    <div className="mt-1 flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
      {cards.map((match, index) => {
        const title = match.sessionTitle?.trim() || match.sessionId;
        const handleClick = onOpenSession
          ? () => onOpenSession(match.sessionId)
          : undefined;
        return (
          <button
            key={`${match.sessionId}-${index}`}
            type="button"
            onClick={handleClick}
            disabled={!handleClick}
            className="group flex w-full flex-col gap-0.5 rounded border border-gray-200/70 bg-gray-50/60 px-2.5 py-1.5 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/50 disabled:cursor-default dark:border-gray-700/60 dark:bg-gray-800/40 dark:hover:border-blue-500/60 dark:hover:bg-blue-950/20"
            title={match.projectPath ? `Open session — ${match.projectPath}` : 'Open session'}
          >
            <div className="flex items-center gap-1.5">
              <span className="truncate text-xs font-medium text-gray-800 dark:text-gray-200">
                {title}
              </span>
              <span className="shrink-0 rounded bg-gray-200/70 px-1 py-px text-[10px] uppercase text-gray-600 dark:bg-gray-700/70 dark:text-gray-300">
                {match.provider}
              </span>
            </div>
            {match.snippet && (
              <span
                className="line-clamp-2 text-[11px] text-gray-600 dark:text-gray-400 [&_mark]:rounded [&_mark]:bg-yellow-200/70 [&_mark]:px-0.5 [&_mark]:text-gray-900 dark:[&_mark]:bg-yellow-500/30 dark:[&_mark]:text-yellow-100"
                // snippet comes from FTS5 snippet() with <mark> tags; safe to render.
                dangerouslySetInnerHTML={{ __html: match.snippet }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
});

SearchResultCards.displayName = 'SearchResultCards';
