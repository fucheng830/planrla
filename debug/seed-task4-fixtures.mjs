/**
 * REQ-052 / kanban task #4 E2E fixtures.
 *
 * Seeds an ISOLATED database (debug/e2e-auth.db) + a synthetic Claude JSONL
 * transcript with two compaction epochs, so the UI acceptance run can open a
 * session whose main viewport must show only post-boundary messages.
 *
 * Usage:  node debug/seed-task4-fixtures.mjs
 * Re-run: safe (INSERT OR REPLACE). Run AFTER the isolated server has booted
 * once (initializeDatabase creates the schema), or pass --init to create the
 * minimal schema here.
 *
 * Never touches ~/.planrla/auth.db — DATABASE_PATH used by the e2e server is
 * passed explicitly on the server command line.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dbPath = process.env.E2E_DB_PATH || path.join(root, 'debug', 'e2e-auth.db');
const fixtureDir = path.join(root, 'debug', 'e2e-fixture');

const PROVIDER_SESSION_ID = 'e2e-compact-req052';
const APP_SESSION_ID = 'e2e-app-req052';
const PROJECT_ID = 'e2e-req052-project';
const PROJECT_PATH = path.join(root, 'debug', 'e2e-project');
const SESSION_NAME = 'E2E 压缩归档验证';
const PROJECT_NAME = 'E2E-REQ052 压缩归档';

// ---------------------------------------------------------------------------
// 1. Synthetic transcript: two compaction epochs + post-boundary tail.
// ---------------------------------------------------------------------------
const T = (minute) => `2026-08-28T09:${String(minute).padStart(2, '0')}:00.000Z`;

const row = (object) => JSON.stringify(object);
const userText = (uuid, minute, text) => row({
  type: 'user', uuid, timestamp: T(minute), sessionId: PROVIDER_SESSION_ID, isMeta: false,
  message: { role: 'user', content: text },
});
const assistantText = (uuid, minute, text) => row({
  type: 'assistant', uuid, timestamp: T(minute), sessionId: PROVIDER_SESSION_ID,
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});
const assistantToolUse = (uuid, minute, toolId) => row({
  type: 'assistant', uuid, timestamp: T(minute), sessionId: PROVIDER_SESSION_ID,
  message: { role: 'assistant', content: [
    { type: 'text', text: '读一下配置确认视口分支。' },
    { type: 'tool_use', id: toolId, name: 'Read', input: { file_path: 'server/shared/types.ts' } },
  ] },
});
const toolResult = (uuid, minute, toolId) => row({
  type: 'user', uuid, timestamp: T(minute), sessionId: PROVIDER_SESSION_ID, isMeta: false,
  message: { role: 'user', content: [
    { type: 'tool_result', tool_use_id: toolId, content: 'export type CompactionView = ... (fixture)' },
  ] },
});
const compactSummary = (uuid, minute, text) => row({
  type: 'user', uuid, timestamp: T(minute), sessionId: PROVIDER_SESSION_ID, isCompactSummary: true,
  message: { role: 'user', content: text },
});

const lines = [
  // ── epoch 1 (archived by compaction #1) ──
  userText('u1', 1, 'E2E纪元1:这个长对话最初的需求背景讨论,应被第一次压缩归档。'),
  assistantText('a1', 2, 'E2E纪元1回复:确定采用虚拟边界方案,不搬运消息数据。'),
  compactSummary('b1', 3, '【纪元1摘要】完成了背景梳理与目标定义,选定虚拟边界+单一事实源方案。'),
  // ── epoch 2 (archived by compaction #2) ──
  userText('u2', 4, 'E2E纪元2:继续,这一轮带一次工具调用。'),
  assistantToolUse('a2', 5, 'tool-e2e-1'),
  toolResult('u2b', 6, 'tool-e2e-1'),
  compactSummary('b2', 7, '【纪元2摘要】实现了边界识别与 active/archived 视口分支,测试全绿。'),
  // ── active tail (what the main viewport must show) ──
  userText('u3', 8, '边界后的第一条消息:主视图应从压缩卡开始,看不到纪元1/2的原文。'),
  assistantText('a3', 9, '边界后的回复:主视图只剩压缩后内容;点压缩卡的入口可查全部历史。'),
];

fs.mkdirSync(fixtureDir, { recursive: true });
const jsonlPath = path.join(fixtureDir, `${PROVIDER_SESSION_ID}.jsonl`);
fs.writeFileSync(jsonlPath, lines.join('\n') + '\n', 'utf8');
fs.mkdirSync(PROJECT_PATH, { recursive: true });
console.log(`[seed] transcript: ${jsonlPath} (${lines.length} rows)`);

// ---------------------------------------------------------------------------
// 2. Database rows (projects + sessions) in the isolated DB.
// ---------------------------------------------------------------------------
if (!fs.existsSync(dbPath)) {
  console.error(`[seed] database not found: ${dbPath}`);
  console.error('[seed] start the isolated server first (it creates the schema), then re-run.');
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const epoch = Math.floor(Date.now() / 1000); // sqlite CURRENT_TIMESTAMP format base
db.prepare(`
  INSERT INTO projects (project_id, project_path, custom_project_name, isStarred, isArchived)
  VALUES (?, ?, ?, 0, 0)
  ON CONFLICT(project_path) DO UPDATE SET custom_project_name = excluded.custom_project_name
`).run(PROJECT_ID, PROJECT_PATH, PROJECT_NAME);

const nowIso = new Date().toISOString();
db.prepare(`
  INSERT INTO sessions (session_id, provider, provider_session_id, project_path, jsonl_path,
                        isArchived, a2a_exposed, isPinned, created_at, updated_at, custom_name)
  VALUES (?, 'claude', ?, ?, ?, 0, 0, 0, ?, ?, ?)
  ON CONFLICT(session_id) DO UPDATE SET
    provider_session_id = excluded.provider_session_id,
    jsonl_path = excluded.jsonl_path,
    updated_at = excluded.updated_at,
    custom_name = excluded.custom_name
`).run(APP_SESSION_ID, PROVIDER_SESSION_ID, PROJECT_PATH, jsonlPath, nowIso, nowIso, SESSION_NAME);

db.close();
console.log(`[seed] db: ${dbPath}`);
console.log(`[seed] project: ${PROJECT_NAME} → session "${SESSION_NAME}" (${APP_SESSION_ID})`);
console.log('[seed] expected: active total=3 (compact card + 2); epoch1=3; epoch2=3');
