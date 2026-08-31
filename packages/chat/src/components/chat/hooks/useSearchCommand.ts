import { authenticatedFetch } from '../../../utils/api';

/**
 * /search slash-command payload shape (one row per matching session).
 * Mirrors server `SessionSearchResult` (FTS5 row + custom_name/updated_at).
 */
export interface SearchCommandMatch {
  session_id: string;
  provider: string;
  project_path: string | null;
  custom_name: string | null;
  updated_at: string | null;
  highlight: string;
  score: number;
}

export interface SearchCommandResult {
  matches: SearchCommandMatch[];
  query: string;
  error?: string;
}

const SEARCH_LIMIT = 20;

/**
 * Strips the `/search` token from the raw input and returns the remainder
 * trimmed — this is both the FTS5 query and the user's question to the agent.
 *
 * `/search auth implementation` → `auth implementation`
 * `/search` alone → '' (caller treats as no-op / hint)
 */
export function parseSearchCommand(rawInput: string): { query: string } {
  const trimmed = rawInput.trim();
  // Accept "/search <rest>" (case-insensitive). The composer's handleSubmit
  // only routes here when the input starts with '/search' followed by space
  // or end-of-string.
  const match = trimmed.match(/^\/search(?:\s+(.*))?$/i);
  if (!match) return { query: '' };
  return { query: (match[1] || '').trim() };
}

/**
 * Calls the FTS5 session-search API (GET /api/search/sessions) and returns
 * session-level matches. Failures resolve to an empty result set with
 * `error` set so the caller can surface a inline note instead of crashing.
 */
export async function runSearchCommand(
  query: string,
  opts: { provider?: string; projectPath?: string } = {},
): Promise<SearchCommandResult> {
  const q = (query || '').trim();
  if (!q) return { matches: [], query: q };

  const params = new URLSearchParams({ q, limit: String(SEARCH_LIMIT) });
  if (opts.provider) params.set('provider', opts.provider);
  if (opts.projectPath) params.set('projectPath', opts.projectPath);

  try {
    const res = await authenticatedFetch(`/api/search/sessions?${params.toString()}`);
    if (!res.ok) {
      return { matches: [], query: q, error: `search_failed_${res.status}` };
    }
    const data = await res.json();
    const matches: SearchCommandMatch[] = Array.isArray(data?.results) ? data.results : [];
    return { matches, query: q };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network_error';
    return { matches: [], query: q, error: message };
  }
}

/**
 * Formats the session-level matches into a compact context block that gets
 * prepended to the outgoing user message (mirrors the @reference hint pattern).
 *
 * One line per match: `session "<title>" (id=xxx, <provider>): <snippet>`.
 * The agent receives enough to cite a session and follow up with the
 * `query_session` / `search_conversations` tools for full context — this is
 * intentionally SESSION-LEVEL (not full message preload).
 *
 * Strips `<mark>` tags from the snippet so the plain-text block stays clean.
 */
export function formatSearchCommandHints(result: SearchCommandResult): string {
  const { matches, query, error } = result;
  if (error) {
    return `[搜索失败: ${error}] 查询="${query}"`;
  }
  if (matches.length === 0) {
    return `[搜索无结果: "${query}"]`;
  }
  const lines = matches.map((m) => {
    const title = (m.custom_name || '').trim() || m.session_id;
    const snippet = (m.highlight || '').replace(/<\/?mark>/g, '');
    return `session "${title}" (id=${m.session_id}, ${m.provider}): ${snippet}`;
  });
  const header = `[会话搜索结果 (query="${query}", ${matches.length} 条)] 用 search_conversations / query_session 工具按需查详细内容。`;
  return `${header}\n${lines.join('\n')}`;
}
