// task #2 e2e fixture:构造隔离的「项目 + success 任务 + worktree(含 DELIVERY.md 与截图)」,
// 供 capture-task2-deliverable-panel.mjs 真实打开 DeliverablePanel 截图留证。
// 幂等可复跑:每次重建 fixture 目录与 db 行(独立 DATABASE_PATH,不碰真实用户数据)。
// 用法:node debug/task2-e2e-fixture.mjs
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const worktreeRoot = resolve(here, '..');
const fixtureDir = join(here, 'e2e-fixture');
const projectDir = join(fixtureDir, 'demo-project');
const fakeWorktree = join(projectDir, '.worktree', 'task2-demo');
const dbPath = join(fixtureDir, 'auth.db');

// --- 1. 重建 demo 项目(真 git 仓库 + 真 linked worktree,diff/分支才有真实数据) ---
rmSync(fixtureDir, { recursive: true, force: true });
mkdirSync(join(projectDir, '.git-info'), { recursive: true });
const g = (cmd, cwd = projectDir) =>
  execSync(cmd, { cwd, stdio: 'pipe', shell: false }).toString().trim();

g('git init -b main');
writeFileSync(join(projectDir, 'README.md'), '# demo project\n\nkanban task2 e2e fixture\n');
writeFileSync(join(projectDir, '.gitignore'), '.worktree/\nnode_modules/\n');
g('git add .');
g('git -c user.email=fixture@local -c user.name=fixture commit -m init');
g('git worktree add -b kanban/task2-demo .worktree/task2-demo');

// --- 2. worktree 内放交付物:截图 + 引用截图的 DELIVERY.md ---
const shotDir = join(fakeWorktree, 'debug', 'ui-acceptance');
mkdirSync(shotDir, { recursive: true });
cpSync(join(worktreeRoot, 'public', 'favicon.png'), join(shotDir, 'task2-demo-hover.png'));
writeFileSync(
  join(fakeWorktree, 'DELIVERY.md'),
  [
    '# 交付说明 · task #2 kanban 截图留证(演示任务)',
    '',
    '## 完成内容',
    '',
    'DeliverablePanel 支持渲染交付说明中引用的仓库内截图,验收人无需切换文件夹即可查看证据。',
    '',
    '## 验证证据',
    '',
    '![悬浮气泡组件](debug/ui-acceptance/task2-demo-hover.png)',
    '',
    '- 截图脚本:`debug/capture-task2-deliverable-panel.mjs`(worktree 根下,可复跑)',
    '',
  ].join('\n'),
);

// --- 3. 独立 sqlite 库:注册项目 + success 任务(与真实用户库完全隔离) ---
const require2 = createRequire(join(worktreeRoot, 'package.json'));
const Database = require2('better-sqlite3');
const db = new Database(dbPath);
// 触发 server 侧 schema 的表此刻还不存在——schema 由 server 启动时建;
// 这里只建本脚本需要的两张表(server 的 CREATE TABLE IF NOT EXISTS 会跳过)。
db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY NOT NULL,
  project_path TEXT NOT NULL UNIQUE,
  custom_project_name TEXT DEFAULT NULL,
  isStarred BOOLEAN DEFAULT 0,
  isArchived BOOLEAN DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  task_number INTEGER NOT NULL,
  root_id TEXT NOT NULL,
  task_template_id TEXT NOT NULL,
  task_template_name TEXT,
  create_worktree INTEGER NOT NULL DEFAULT 1,
  worktree_branch_mode TEXT,
  worktree_branch TEXT,
  worktree_path TEXT,
  current_stage_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  scheduler_admitted INTEGER NOT NULL DEFAULT 0,
  main_session_key TEXT,
  worktree_root_id TEXT,
  labels_json TEXT NOT NULL DEFAULT '[]',
  priority TEXT NOT NULL DEFAULT 'medium',
  dependencies_json TEXT NOT NULL DEFAULT '[]',
  provider_session_id TEXT,
  aux_ask_user_waiting INTEGER NOT NULL DEFAULT 0,
  aux_has_plan INTEGER NOT NULL DEFAULT 0,
  aux_has_todos INTEGER NOT NULL DEFAULT 0,
  aux_has_task INTEGER NOT NULL DEFAULT 0,
  aux_session_error TEXT,
  pending_ask_user TEXT,
  rework_feedback TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
`);
const now = new Date().toISOString();
db.prepare('INSERT OR REPLACE INTO projects (project_id, project_path, custom_project_name) VALUES (?, ?, ?)').run(
  'demo-root-task2', projectDir, '截图留证演示项目',
);
// 任务挂到一个「真实扫描可见」的项目 id 上:前端项目列表来自主目录会话扫描,
// 纯 db 行不出现;fixture 库独立,扫描建档只写 fixture 库,不碰真实用户数据。
const realRootId = process.env.FIXTURE_ROOT_ID || '0a1460f0-28ec-41df-834d-58bde78dce16';
db.prepare(`INSERT OR REPLACE INTO tasks
  (id, task_number, root_id, task_template_id, task_template_name, create_worktree, worktree_branch, worktree_path,
   current_stage_index, status, labels_json, priority, dependencies_json, created_at, updated_at, completed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
  'task2-demo-1', 2, realRootId, 'sdlc-default', '研发流程(需求 → 交付)',
  1, 'kanban/task2-demo', fakeWorktree,
  4, 'success', '[]', 'medium', '[]', now, now, now,
);
db.close();

console.log('fixture ready:');
console.log('  project   :', projectDir);
console.log('  worktree  :', fakeWorktree);
console.log('  db        :', dbPath);
console.log('  DELIVERY.md exists:', existsSync(join(fakeWorktree, 'DELIVERY.md')));
