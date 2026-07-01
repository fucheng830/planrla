# 会话全文搜索（FTS5 倒排索引）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务执行。步骤用 `- [ ]` 勾选跟踪。

**Goal:** 用 SQLite FTS5 trigram 倒排索引替换 ripgrep，实现会话全文搜索（BM25 相关性排序 + snippet 高亮），解决 4456 会话"想到主题找不到"的痛点。

**Architecture:** 索引构建器读 session jsonl 提取消息文本 → FTS5 虚拟表（trigram tokenizer）；检索服务用 MATCH + bm25() + snippet()；启动时后台首次全量 + synchronizer 增量 hook；前端搜索框切到新端点。

**Tech Stack:** SQLite FTS5（better-sqlite3/node:sqlite）、trigram tokenizer、TypeScript ESM（server）、React（前端）、node:test（纯函数测试）

**Spec:** `docs/superpowers/specs/2026-07-02-session-fulltext-search-design.md`

---

## 文件结构

**Create:**
- `server/modules/search/session-search-indexer.ts` — 索引构建（buildIndexForSession / buildAllIndexes / isIndexEmpty + 纯函数 extractSessionText）
- `server/modules/search/session-search.service.ts` — 检索（searchSessions + 纯函数 escapeFtsQuery）
- `server/modules/search/search.routes.ts` — 路由 GET /api/search/sessions
- `server/modules/search/tests/session-search.test.ts` — 纯函数 node:test
- `server/modules/search/tests/verify-indexing.cjs` — 集成验证脚本（连真实 auth.db）

**Modify:**
- `server/modules/database/schema.ts` — 加 session_search FTS5 表
- `server/index.js` — 挂载 search 路由 + 启动后台全量索引
- `server/modules/providers/list/claude/claude-session-synchronizer.provider.ts` — 增量 hook（synchronizeFile 后建索引）
- `server/modules/providers/list/codex/codex-session-synchronizer.provider.ts` — 同样增量 hook
- `src/utils/api.js` — searchConversationsUrl 改指 /api/search/sessions

**注意（环境约束）:**
- 项目无 vitest/jest；用 node:test（node 22 内置）测纯函数
- better-sqlite3 native 有 Electron(139) vs 系统 node(127) 版本冲突——纯函数测试不碰 db，集成验证用 node:sqlite（node 内置，无 native 依赖）
- server 是 ESM TypeScript（`@/` alias 经 tsc-alias 编译）；测试文件用相对 import 避开 alias

---

## Task 1: FTS5 表 schema

**Files:**
- Modify: `server/modules/database/schema.ts`（在末尾追加）

- [ ] **Step 1: 加 session_search FTS5 表**

在 `server/modules/database/schema.ts` 末尾追加：

```sql
-- 会话全文搜索（FTS5 trigram 倒排索引）。详见 docs/superpowers/specs/2026-07-02-session-fulltext-search-design.md
CREATE VIRTUAL TABLE IF NOT EXISTS session_search USING fts5(
  content,
  session_id UNINDEXED,
  provider UNINDEXED,
  project_path UNINDEXED,
  tokenize = 'trigram'
);
```

- [ ] **Step 2: 验证表创建（启动 server 看 schema applied）**

```bash
cd D:/workspace/projects/ai/apps/planrla
npm run server &
sleep 5
# 验证 session_search 表存在
node --experimental-sqlite -e "
const {DatabaseSync}=require('node:sqlite');
const p=require('path').join(process.env.USERPROFILE,'.planrla','auth.db');
const db=new DatabaseSync(p,{readOnly:true});
console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='session_search'\").all());
db.close();
" 2>&1 | grep -v Experimental
kill %1
```
Expected: `[ { name: 'session_search' } ]`

- [ ] **Step 3: Commit**

```bash
git add server/modules/database/schema.ts
git commit -m "feat(search): add session_search FTS5 table (trigram)"
```

---

## Task 2: 纯函数 extractSessionText（读 jsonl 提取消息文本）

**Files:**
- Create: `server/modules/search/session-search-indexer.ts`
- Create: `server/modules/search/tests/session-search.test.ts`

- [ ] **Step 1: 写失败测试（node:test）**

`server/modules/search/tests/session-search.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { extractSessionText } from '../session-search-indexer.ts';

test('extractSessionText 提取 user/assistant 消息文本', async () => {
  const tmp = path.join(process.env.TEMP ?? '/tmp', `sess-${Date.now()}.jsonl`);
  fs.writeFileSync(tmp, [
    JSON.stringify({ type: 'last-prompt', leafUuid: 'x', sessionId: 's1' }),  // meta 行跳过
    JSON.stringify({ type: 'user', message: { role: 'user', content: '讨论 React 性能优化' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '可以用 memo' }] } }),
    '',  // 空行跳过
    'not-json',  // 坏行跳过
  ].join('\n'));
  const text = await extractSessionText(tmp);
  assert.match(text, /user: 讨论 React 性能优化/);
  assert.match(text, /assistant: 可以用 memo/);
  fs.unlinkSync(tmp);
});

test('extractSessionText 文件不存在返回空字符串', async () => {
  const text = await extractSessionText('/nonexistent/path.jsonl');
  assert.equal(text, '');
});
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
cd D:/workspace/projects/ai/apps/planrla
npx tsx --test server/modules/search/tests/session-search.test.ts
```
Expected: FAIL（`extractSessionText is not exported` 或模块不存在）

- [ ] **Step 3: 实现 extractSessionText**

`server/modules/search/session-search-indexer.ts`：

```ts
import fs from 'node:fs';
import readline from 'node:readline';

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
```

- [ ] **Step 4: 跑测试，确认通过**

```bash
npx tsx --test server/modules/search/tests/session-search.test.ts
```
Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/modules/search/session-search-indexer.ts server/modules/search/tests/session-search.test.ts
git commit -m "feat(search): extractSessionText reads jsonl messages"
```

---

## Task 3: buildIndexForSession + buildAllIndexes + isIndexEmpty（db 操作）

**Files:**
- Modify: `server/modules/search/session-search-indexer.ts`（追加）
- Create: `server/modules/search/tests/verify-indexing.cjs`（集成验证脚本）

- [ ] **Step 1: 追加 db 操作函数**

在 `server/modules/search/session-search-indexer.ts` 顶部 import 区加：

```ts
import { getConnection } from '../../modules/database/connection.js';
import { sessionsDb } from '../../modules/database/index.js';
```

文件末尾追加：

```ts
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
```

- [ ] **Step 2: 集成验证脚本**

`server/modules/search/tests/verify-indexing.cjs`（用 node:sqlite 直接验证真实 auth.db，绕开 better-sqlite3 native 问题）：

```js
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
// 读 jsonl 提取文本（简化版）
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
```

- [ ] **Step 3: 跑验证脚本，确认 FTS5 索引 + 检索链路通**

```bash
cd D:/workspace/projects/ai/apps/planrla
node --experimental-sqlite server/modules/search/tests/verify-indexing.cjs 2>&1 | grep -v Experimental
```
Expected: 输出 `查到 1 条` + 含 snippet `<mark>...</mark>` 的结果

- [ ] **Step 4: Commit**

```bash
git add server/modules/search/session-search-indexer.ts server/modules/search/tests/verify-indexing.cjs
git commit -m "feat(search): buildIndexForSession + buildAllIndexes + isIndexEmpty"
```

---

## Task 4: searchSessions 检索服务 + escapeFtsQuery 纯函数

**Files:**
- Create: `server/modules/search/session-search.service.ts`
- Modify: `server/modules/search/tests/session-search.test.ts`（加 escapeFtsQuery 测试）

- [ ] **Step 1: 写 escapeFtsQuery 失败测试**

追加到 `tests/session-search.test.ts`（import 加 `escapeFtsQuery`）：

```ts
import { escapeFtsQuery } from '../session-search.service.ts';

test('escapeFtsQuery 包成 FTS5 短语查询并转义双引号', () => {
  assert.equal(escapeFtsQuery('性能优化'), '"性能优化"');
  assert.equal(escapeFtsQuery('含"引号"的查询'), '"含""引号""的查询"');
  assert.equal(escapeFtsQuery(''), '""');
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx tsx --test server/modules/search/tests/session-search.test.ts
```
Expected: FAIL（escapeFtsQuery 未导出）

- [ ] **Step 3: 实现 searchSessions + escapeFtsQuery**

`server/modules/search/session-search.service.ts`：

```ts
import { getConnection } from '../../modules/database/connection.js';

export type SessionSearchResult = {
  session_id: string;
  provider: string;
  project_path: string | null;
  custom_name: string | null;
  updated_at: string | null;
  highlight: string;
  score: number;
};

/** 把用户 query 包成 FTS5 短语查询（双引号转义为""）。trigram tokenizer 下短语查询命中 3+ 字符序列。 */
export function escapeFtsQuery(q: string): string {
  return '"' + (q ?? '').replace(/"/g, '""') + '"';
}

/** 语义/全文检索：MATCH + bm25 排序 + snippet 高亮。bm25 越负越相关。 */
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
  const params: any[] = [escapeFtsQuery(trimmed)];
  if (opts.provider) { sql += ' AND ss.provider = ?'; params.push(opts.provider); }
  if (opts.projectPath) { sql += ' AND ss.project_path = ?'; params.push(opts.projectPath); }
  sql += ' ORDER BY score LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params) as SessionSearchResult[];
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx tsx --test server/modules/search/tests/session-search.test.ts
```
Expected: 所有 test PASS（含 escapeFtsQuery 的 3 个）

- [ ] **Step 5: Commit**

```bash
git add server/modules/search/session-search.service.ts server/modules/search/tests/session-search.test.ts
git commit -m "feat(search): searchSessions (MATCH + bm25 + snippet)"
```

---

## Task 5: 搜索路由 + 挂载

**Files:**
- Create: `server/modules/search/search.routes.ts`
- Modify: `server/index.js`（挂载路由）

- [ ] **Step 1: 实现路由**

`server/modules/search/search.routes.ts`：

```ts
import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { searchSessions } from './session-search.service.js';

const router = Router();

// GET /api/search/sessions?q=<query>&provider=&projectPath=&limit=
router.get('/sessions', authenticateToken, (req, res) => {
  const q = String(req.query.q ?? '');
  const provider = req.query.provider ? String(req.query.provider) : undefined;
  const projectPath = req.query.projectPath ? String(req.query.projectPath) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  try {
    const results = searchSessions(q, { provider, projectPath, limit });
    res.json({ results });
  } catch (e: any) {
    // FTS5 语法错（query 含特殊字符且转义失败）→ 空结果而非 500
    console.error('[search] query failed:', e?.message);
    res.json({ results: [], error: 'query_failed' });
  }
});

export default router;
```

- [ ] **Step 2: 挂载到 server/index.js**

找到 `server/index.js` 里 `app.use('/api/auth', authRoutes);` 这片路由挂载区（约 L216 附近），在合适位置加：

```js
import searchRoutes from './modules/search/search.routes.js';
// ...
app.use('/api/search', authenticateToken, searchRoutes);
```

- [ ] **Step 3: 重新 build server + 启动，curl 验证**

```bash
cd D:/workspace/projects/ai/apps/planrla
npm run build:server
npm run server &
sleep 6
# 先 login 拿 token
TOKEN=$(curl -sS -X POST http://127.0.0.1:3001/api/auth/login -H "Content-Type: application/json" -d '{"username":"planrla","password":"planrla"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))")
# 先建至少一条索引（手动触发 buildIndexForSession，从 verify 脚本已知链路通）
# 搜索
curl -sS "http://127.0.0.1:3001/api/search/sessions?q=planrla" -H "Authorization: Bearer $TOKEN" | head -c 300
kill %1
```
Expected: `{"results":[...],"error":...}` 或 `{"results":[{"session_id":...,"highlight":"<mark>...</mark>",...}]}`

- [ ] **Step 4: Commit**

```bash
git add server/modules/search/search.routes.ts server/index.js
git commit -m "feat(search): GET /api/search/sessions route"
```

---

## Task 6: 启动时后台首次全量索引

**Files:**
- Modify: `server/index.js`（startServer 内，initializeDatabase 后）

- [ ] **Step 1: 加首次全量逻辑**

找到 `server/index.js` 的 `startServer()`，在 `await initializeDatabase();` 之后（`configureWebPush()` 附近）加：

```js
import { isIndexEmpty, buildAllIndexes } from './modules/search/session-search-indexer.js';
// ... 在 startServer 里：
        await initializeDatabase();

        // 首次全量构建会话搜索索引（后台，不阻塞 server.listen）
        try {
          if (isIndexEmpty()) {
            console.log(`${c.info('[INFO]')} Session search index empty, building in background...`);
            buildAllIndexes((done, total) => {
              if (done % 50 === 0 || done === total) console.log(`${c.dim(`[search] indexing ${done}/${total}`)}`);
            }).then(() => {
              console.log(`${c.ok('[OK]')} Session search index built`);
            }).catch(err => console.error('[search] background build failed:', err?.message));
          }
        } catch (e) { console.error('[search] index check failed:', e?.message); }
```

- [ ] **Step 2: 启动 server 验证后台索引跑起来**

```bash
cd D:/workspace/projects/ai/apps/planrla
# 临时清空索引（验证全量触发）
node --experimental-sqlite -e "const {DatabaseSync}=require('node:sqlite');const p=require('path').join(process.env.USERPROFILE,'.planrla','auth.db');const db=new DatabaseSync(p);db.exec('DELETE FROM session_search');console.log('cleared');db.close()" 2>&1 | grep -v Experimental
npm run build:server && (npm run server &)
sleep 10
# 查后台索引日志
# 查索引行数
node --experimental-sqlite -e "const {DatabaseSync}=require('node:sqlite');const p=require('path').join(process.env.USERPROFILE,'.planrla','auth.db');const db=new DatabaseSync(p,{readOnly:true});console.log('indexed:',db.prepare('SELECT COUNT(*) c FROM session_search').get().c);db.close()" 2>&1 | grep -v Experimental
kill %1
```
Expected: 日志显示 `[search] indexing N/M`，索引行数持续增长（最终接近 session 总数）

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(search): background full index build on startup"
```

---

## Task 7: 增量索引 hook（claude + codex synchronizer）

**Files:**
- Modify: `server/modules/providers/list/claude/claude-session-synchronizer.provider.ts`
- Modify: `server/modules/providers/list/codex/codex-session-synchronizer.provider.ts`

- [ ] **Step 1: claude synchronizer 加 hook**

找到 `claude-session-synchronizer.provider.ts` 的 `synchronizeFile()` 末尾 `return sessionsDb.createSession(...)` 那行（约 L99 / L130 附近两处 createSession）。在 createSession 返回的 sessionId 之后触发索引。

顶部 import：
```ts
import { buildIndexForSession } from '../../../search/session-search-indexer.js';
```

把 `synchronizeFile` 末尾改为（保留原 createSession 调用，追加索引触发）：
```ts
    const timestamps = await readFileTimestamps(filePath);
    const sessionId = sessionsDb.createSession(
      parsed.sessionId,
      this.provider,
      parsed.projectPath,
      parsed.sessionName,
      timestamps.createdAt,
      timestamps.updatedAt,
      filePath
    );
    // 增量索引：session 同步后建/更新搜索索引（后台 fire-and-forget，不阻塞同步）
    void buildIndexForSession(parsed.sessionId).catch(e =>
      console.error('[search] incremental build failed', parsed.sessionId, e)
    );
    return sessionId;
```

> 注：第一处 `synchronizeAll` 里的批量 createSession（约 L66）也可加 hook，但批量场景首次全量已覆盖；MVP 只 hook `synchronizeFile`（单文件增量更新点）。

- [ ] **Step 2: codex synchronizer 同样加 hook**

`codex-session-synchronizer.provider.ts` 找到对应的 createSession 后位置，同样追加 `void buildIndexForSession(...)`。codex provider 路径同样 import `../../../search/session-search-indexer.js`。

- [ ] **Step 3: build + 验证增量（手动改一个 jsonl 的 mtime 触发同步，看索引更新）**

```bash
cd D:/workspace/projects/ai/apps/planrla
npm run build:server
# 启动 server，触发某 session 同步，看日志 [search] incremental build
npm run server &
sleep 8
# touch 一个 jsonl 触发同步（或新建 session）
# 观察日志
kill %1
```
Expected: server 日志在某 session 同步后出现 `[search] incremental build`（或无错误）

- [ ] **Step 4: Commit**

```bash
git add server/modules/providers/list/claude/claude-session-synchronizer.provider.ts server/modules/providers/list/codex/codex-session-synchronizer.provider.ts
git commit -m "feat(search): incremental index hook on session sync"
```

---

## Task 8: 前端切换到 FTS5 端点

**Files:**
- Modify: `src/utils/api.js`（searchConversationsUrl 改指新端点）
- Modify: `src/components/sidebar/hooks/useSidebarController.ts`（结果适配 snippet）
- Modify: `src/components/command-palette/sources/useSessionMessageSearch.ts`（结果适配）

- [ ] **Step 1: 看 searchConversationsUrl 现状 + 调用方期望的结果格式**

```bash
cd D:/workspace/projects/ai/apps/planrla
sed -n '118,128p' src/utils/api.js
grep -nB1 -A8 "searchConversationsUrl" src/components/sidebar/hooks/useSidebarController.ts | head -25
grep -nB1 -A8 "searchConversationsUrl" src/components/command-palette/sources/useSessionMessageSearch.ts | head -25
```
（先看现有调用方怎么解析 ripgrep 返回的 matches/highlights，确定新结果映射）

- [ ] **Step 2: 改 searchConversationsUrl 指向新端点**

`src/utils/api.js` L121 的 `searchConversationsUrl`：把 URL 从 `/api/providers/...search` 改为 `/api/search/sessions?q=${encodeURIComponent(query)}&limit=${limit}`。

> 注：旧端点（ripgrep）保留（fallback），主搜索改用新端点。如果调用方期望的返回结构差异大（ripgrep 返回 message-level matches，FTS5 返回 session-level highlight），需在调用方做结果映射。

- [ ] **Step 3: 调用方结果适配**

`useSidebarController.ts:365` 和 `useSessionMessageSearch.ts:51` 调用后，把 FTS5 返回的 `{ results: [{ session_id, provider, custom_name, highlight, score }] }` 映射成 UI 期望的格式（session 列表项 + snippet 高亮）。具体映射按 Step 1 观察的现有 UI 数据结构来——重点是展示 session（custom_name 或 untitled）+ `highlight`（含 `<mark>` 标记）。

- [ ] **Step 4: build 前端 + 实测**

```bash
cd D:/workspace/projects/ai/apps/planrla
npm run build:client
# desktop 启动，搜索框输入 3+ 字主题词，确认结果按相关性排序 + 高亮
npm run desktop
# （手动在 UI 搜索框测，确认结果展示）
```
Expected: 搜索框输入主题词 → 返回相关 session 列表（BM25 排序）+ snippet 高亮片段

- [ ] **Step 5: Commit**

```bash
git add src/utils/api.js src/components/sidebar/hooks/useSidebarController.ts src/components/command-palette/sources/useSessionMessageSearch.ts
git commit -m "feat(search): frontend uses FTS5 /api/search/sessions"
```

---

## 验收清单

- [ ] 8 个 task 全部 commit
- [ ] desktop 启动后台全量索引（日志 `[search] indexing N/M` → `[OK] built`）
- [ ] 搜索框输入 3+ 字中文主题（如"性能优化"）→ 返回相关 session（BM25 排序 + snippet 高亮）
- [ ] 新 session 同步后增量立即可搜到
- [ ] 查询性能 <50ms
- [ ] 1-2 字短查询降级（可接受不命中，或后续加 fallback）

## 风险与回退

- **better-sqlite3 FTS5 不支持**：better-sqlite3 自带 SQLite 3.40+，FTS5 + trigram（3.34+）默认启用。若打包版缺失，回退方案是改用 `unicode61`（中文需配合 simple tokenizer 或接受按字匹配）。
- **首次全量慢**：4456 session 读 jsonl 可能几分钟。已设计为后台 + 进度日志，不阻塞 server。可加"跳过过旧 session"优化（按 updated_at）。
- **trigram 1-2 字不命中**：MVP 接受；后续可对短查询 fallback 到 LIKE '%x%'。
