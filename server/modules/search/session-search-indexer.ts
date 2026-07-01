import { getConnection, sessionsDb } from '../database/index.js';

// 纯函数抽离到 session-search-text.ts，避免 tsx 单测触发 db import 链（@/ alias）
import { extractSessionText } from './session-search-text.js';
// re-export 保持 indexer.ts 公开 API 不变
export { extractSessionText } from './session-search-text.js';

/** 单 session 建索引：提取文本 → 旧行删除 → 新行插入。jsonl 不存在/无文本则只删不插。 */
export async function buildIndexForSession(sessionId: string): Promise<void> {
  const session = sessionsDb.getSessionById(sessionId);
  if (!session?.jsonl_path) return;
  const content = await extractSessionText(session.jsonl_path);
  const db = getConnection();
  db.prepare('DELETE FROM session_search WHERE session_id = ?').run(sessionId);
  if (content.trim()) {
    db.prepare(
      'INSERT INTO session_search (content, session_id, provider, project_path) VALUES (?, ?, ?, ?)'
    ).run(content, sessionId, session.provider, session.project_path ?? '');
  }
}

/** session_search 表是否为空（决定是否触发首次全量）。 */
export function isIndexEmpty(): boolean {
  const db = getConnection();
  const row = db.prepare('SELECT COUNT(*) AS c FROM session_search').get() as { c: number };
  return row.c === 0;
}

/** 全量构建：遍历所有 session，逐个 buildIndexForSession。onProgress 报告进度。后台调用。 */
export async function buildAllIndexes(onProgress?: (done: number, total: number) => void): Promise<void> {
  const all = sessionsDb.getAllSessions();
  const total = all.length;
  let done = 0;
  for (const s of all) {
    try { await buildIndexForSession(s.session_id); }
    catch (e) { console.error('[search] buildIndexForSession failed', s.session_id, e); }
    done++;
    onProgress?.(done, total);
  }
}
