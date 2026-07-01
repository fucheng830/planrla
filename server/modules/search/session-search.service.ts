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
