import { getConnection } from '../database/index.js';
import { escapeFtsQuery } from './session-search-query.js';

export type SessionSearchResult = {
  session_id: string;
  provider: string;
  project_path: string | null;
  custom_name: string | null;
  updated_at: string | null;
  highlight: string;
  score: number;
};

/**
 * 全文检索：MATCH + bm25 排序 + snippet 高亮。bm25 越负越相关。
 *
 * 参数化查询：仅 MATCH 部分经 escapeFtsQuery 包成 FTS5 短语（防注入靠双引号转义），
 * 其余 provider/project_path/limit 均走 ? 绑定。
 */
export function searchSessions(
  query: string,
  opts: { provider?: string; projectPath?: string; limit?: number } = {}
): SessionSearchResult[] {
  const trimmed = (query ?? '').trim();
  if (!trimmed) return [];
  const db = getConnection();
  // PERF NOTE: latency is dominated by snippet() — SQLite computes it per
  // *matching* row, not per returned row, so lowering LIMIT does NOT reduce
  // snippet cost (measured: "session" L50=152ms ≈ L20=122ms; rank-only L20
  // without snippet = 18ms). Two-phase (rank without snippet, then snippet the
  // winners) was measured and rejected: it helps only pathological broad terms
  // (session 122→76ms, still >50ms) while regressing mid-frequency queries
  // (typescript 64→83ms, 全文搜索 87→98ms). The real lever is scoping MATCH to
  // the active project — pass projectPath server-side (the route already
  // accepts it; the frontend currently filters client-side). See
  // debug/latency-twophase.cjs and the plan's 验证证据 section.
  const limit = Math.min(opts.limit ?? 50, 200);
  let sql = `
    SELECT ss.session_id, ss.provider, ss.project_path,
           s.custom_name, s.updated_at,
           snippet(session_search, 0, '<mark>', '</mark>', '…', 20) AS highlight,
           bm25(session_search) AS score
    FROM session_search ss
    JOIN sessions s ON s.session_id = ss.session_id
    WHERE ss.content MATCH ?
  `;
  const params: Array<string | number> = [escapeFtsQuery(trimmed)];
  if (opts.provider) {
    sql += ' AND ss.provider = ?';
    params.push(opts.provider);
  }
  if (opts.projectPath) {
    sql += ' AND ss.project_path = ?';
    params.push(opts.projectPath);
  }
  sql += ' ORDER BY score LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params) as SessionSearchResult[];
}
