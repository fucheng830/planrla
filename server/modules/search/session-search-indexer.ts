import fs from 'node:fs';
import readline from 'node:readline';

import { getConnection, sessionsDb } from '../database/index.js';

/**
 * 从 session jsonl 提取所有消息文本，拼接成 "role: content" 多行。
 * 跳过非消息行（last-prompt 等 meta）、空行、坏行、无 content 的行。
 * content 可能是 string 或 [{type:'text', text:'...'}]，两者都处理。
 */
export async function extractSessionText(jsonlPath: string): Promise<string> {
  if (!fs.existsSync(jsonlPath)) return '';
  const stream = fs.createReadStream(jsonlPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const parts: string[] = [];
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: any;
    try { row = JSON.parse(trimmed); } catch { continue; }
    const msg = row?.message;
    if (!msg?.content) continue;
    const text = typeof msg.content === 'string'
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map((c: any) => c?.text ?? '').join(' ')
        : '';
    if (text.trim()) parts.push(`${msg.role ?? 'user'}: ${text}`);
  }
  return parts.join('\n');
}

/** 单 session 建索引：提取文本 → 旧行删除 → 新行插入。jsonl 不存在/无文本则只删不插。 */
export async function buildIndexForSession(sessionId: string): Promise<void> {
  const all = sessionsDb.getAllSessions();
  const session = all.find((s: any) => s.session_id === sessionId);
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
