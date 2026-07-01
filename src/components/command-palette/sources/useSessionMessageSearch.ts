import { useEffect, useRef, useState } from 'react';

import { api } from '../../../utils/api';
import type { LLMProvider } from '../../../types/app';

export type SessionMessageMatch = {
  sessionId: string;
  label: string;
  snippet: string;
  provider: LLMProvider;
};

type FtsSessionRow = {
  session_id: string;
  provider: string;
  project_path: string | null;
  custom_name: string | null;
  updated_at: string | null;
  highlight: string;
  score: number;
};

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;

/**
 * Strips the <mark>...</mark> tags FTS5's snippet() emits so the command
 * palette shows plain text. (The command-palette render path doesn't render
 * highlight offsets, so a flat string is sufficient here.)
 */
function stripMarkTags(html: string): string {
  return html.replace(/<mark>/g, '').replace(/<\/mark>/g, '');
}

export function useSessionMessageSearch(
  // Filesystem path of the active project, matching the FTS5 row's
  // `project_path` column. NOTE: this is intentionally `fullPath`, not the
  // DB `projectId` primary key — passing the DB id here would never match
  // and silently filter out every result.
  projectPath: string | undefined,
  query: string,
  enabled: boolean,
) {
  const [items, setItems] = useState<SessionMessageMatch[]>([]);
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!enabled || !projectPath || trimmed.length < MIN_QUERY) {
      setItems([]);
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }

    abortRef.current?.abort();
    abortRef.current = null;
    seqRef.current++;

    const handle = setTimeout(() => {
      const seq = ++seqRef.current;
      const controller = new AbortController();
      abortRef.current = controller;

      fetch(api.searchConversationsUrl(trimmed), { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : { results: [] }))
        .then((data: { results?: FtsSessionRow[] }) => {
          if (seq !== seqRef.current) return;
          const rows = data.results ?? [];
          const matches: SessionMessageMatch[] = [];
          for (const row of rows) {
            // The legacy SSE endpoint emitted a per-project grouping whose
            // projectId was the project's path; the FTS5 row carries
            // project_path directly, so filter on the same value.
            if (row.project_path !== projectPath) continue;
            matches.push({
              sessionId: row.session_id,
              label: row.custom_name || row.session_id,
              snippet: stripMarkTags(row.highlight || ''),
              provider: row.provider as LLMProvider,
            });
          }
          setItems(matches);
        })
        .catch((e) => {
          if (e?.name === 'AbortError') return; // unmount / re-run — not an error
          if (seq !== seqRef.current) return;
          setItems([]);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(handle);
    };
  }, [projectPath, query, enabled]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  return items;
}
