// 验证：取一个真实 session，手动 INSERT FTS5，MATCH 查询，确认能搜到。
// 运行：node --experimental-sqlite server/modules/search/tests/verify-indexing.cjs
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(process.env.USERPROFILE, '.planrla', 'auth.db');
const db = new DatabaseSync(dbPath);
// 取一个 Claude session 的 jsonl
const row = db.prepare("SELECT session_id, jsonl_path FROM sessions WHERE provider='claude' AND jsonl_path IS NOT NULL LIMIT 1").get();
console.log('sample session:', row.session_id);
// 读 jsonl 提取文本（简化版——和生产 extractSessionText 同逻辑）
const lines = fs.readFileSync(row.jsonl_path, 'utf8').split('\n');
const parts = [];
for (const line of lines) {
  if (!line.trim()) continue;
  try {
    const o = JSON.parse(line);
    const m = o.message;
    if (!m?.content) continue;
    const t = typeof m.content === 'string' ? m.content : (Array.isArray(m.content) ? m.content.map(c=>c?.text||'').join(' ') : '');
    if (t.trim()) parts.push(`${m.role||'user'}: ${t}`);
  } catch {}
}
const content = parts.join('\n');
console.log('content 长度:', content.length, '前80字:', content.slice(0, 80));
// 建 FTS5 表（如不存在）+ INSERT
db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS session_search USING fts5(content, session_id UNINDEXED, provider UNINDEXED, project_path UNINDEXED, tokenize='trigram')");
db.prepare("DELETE FROM session_search WHERE session_id = ?").run(row.session_id);
db.prepare("INSERT INTO session_search (content, session_id, provider, project_path) VALUES (?,?,?,?)").run(content, row.session_id, 'claude', '');
// 取内容里的一段词做查询
const probe = content.match(/[一-龥]{3,}|[a-z]{3,}/i)?.[0] ?? 'test';
const r = db.prepare("SELECT session_id, snippet(session_search,0,'<mark>','</mark>','…',15) hl, bm25(session_search) sc FROM session_search WHERE content MATCH ? ORDER BY sc").all(`"${probe}"`);
console.log('probe:', probe, '=> 查到', r.length, '条');
console.log(r[0]);
db.close();
