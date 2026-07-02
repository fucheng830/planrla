# Sidebar Open Performance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `GET /api/projects` 的 p95 从 ~900ms 降到 <400ms，靠去掉冗余 inline sync（Fix 1）+ 把 N+1 per-project 查询合并成一条窗口函数批量 SQL（Fix 2）。

**Architecture:** 纯后端改动，集中在 `server/modules/projects/` + `server/modules/database/repositories/sessions.db.ts`。Fix 1 翻 `skipSynchronization` 默认值 + 加 `?sync=1` 强制；Fix 2 抽一个纯分组函数（TDD）+ 一条批量 SQL，替换 `getProjectsWithSessions` 里的循环。前端零改动（watchers + WS 负责新鲜度）。

**Tech Stack:** TypeScript、better-sqlite3（SQLite 窗口函数：`ROW_NUMBER()`/`COUNT()` `OVER`，3.25+，better-sqlite3 自带 3.40+）、node:test（`npx tsx --test`）。

**Spec:** `docs/superpowers/specs/2026-07-02-projects-list-perf-design.md`

---

## 文件结构

**Create:**
- `server/modules/projects/services/project-session-grouping.ts` — 纯分组函数 `groupSessionRowsByProject`（把批量 SQL 的行按项目分组为首页 session + total + hasMore）
- `server/modules/projects/services/project-session-grouping.test.ts` — node:test 单元测试

**Modify:**
- `server/modules/projects/services/projects-with-sessions-fetch.service.ts` — Fix 1（`skipSynchronization` 默认 true）+ Fix 2（用批量查询替换 N+1 循环，L197–232）
- `server/modules/projects/projects.routes.ts` — `GET /` 支持 `?sync=1` 强制同步（默认跳过）
- `server/modules/database/repositories/sessions.db.ts` — 新增 `getSessionsByProjectPathsFirstPage`（窗口函数批量 SQL）
- `docs/product/V1_PRODUCT_ROADMAP.md` — P1 条目文案改为「sidebar 打开性能（projects 端点）」

**环境约束:**
- 纯函数测试用 `node:test`（`npx tsx --test`），与主项目一致；import 用无后缀（项目约定 + tsconfig 无 `allowImportingTsExtensions`）。
- 改动后用 `:3002`（或正在跑的实例）跑 curl 计时验收，对照 spec 的 before 数据。
- 提交前确认根目录无 `nul` 文件（CLAUDE.md）。
- 在 feature 分支上做（`feat/projects-perf`），不动 main。

---

## Task 1: Fix 1 — read path 默认不 inline sync + `?sync=1` 强制

**Files:**
- Modify: `server/modules/projects/services/projects-with-sessions-fetch.service.ts`（`getProjectsWithSessions` L180 + `getArchivedProjectsWithSessions` L248 的 `skipSynchronization` 默认值）
- Modify: `server/modules/projects/projects.routes.ts`（`GET /` 的 skipSynchronization 计算，~L67）

- [ ] **Step 1: 翻 `skipSynchronization` 默认值**

`projects-with-sessions-fetch.service.ts`，`getProjectsWithSessions` 签名（L180–182）改为默认 `skipSynchronization = true`：

```ts
export async function getProjectsWithSessions(
  options: GetProjectsWithSessionsOptions = {}
): Promise<ProjectListItem[]> {
  const skipSynchronization = options.skipSynchronization ?? true;
  if (!skipSynchronization) {
    await sessionSynchronizerService.synchronizeSessions();
  }
```

`getArchivedProjectsWithSessions`（L248–253）同样改：`const skipSynchronization = options.skipSynchronization ?? true;`，原 `if (!options.skipSynchronization)` 改成 `if (!skipSynchronization)`。

- [ ] **Step 2: 路由加 `?sync=1`（显式强制同步）；默认跳过**

`projects.routes.ts` 的 `GET /` handler（~L66–70），把现有 `skipSynchronization` 计算替换为：

```ts
    const forceSync =
      readQueryStringValue(req.query.sync).trim() === '1' ||
      readQueryStringValue(req.query.skipSynchronization).trim() === '0';
    const projects = await getProjectsWithSessions({
      skipSynchronization: !forceSync,
      sessionsLimit,
      sessionsOffset,
    });
```

（默认 `forceSync=false` → `skipSynchronization=true` → 不 sync。`?sync=1` 或旧 `?skipSynchronization=0` → 强制 sync，给手动刷新用。）

- [ ] **Step 3: 验证（curl 计时，对照 spec before ~0.9s）**

```bash
TOKEN=$(node debug/gen-token.cjs)   # 复用既有 token 生成脚本
# 默认（应明显变快，~0.25s）
for i in 1 2; do curl -s -m 20 -o /dev/null -w "%{time_total}\n" -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3002/api/projects?sessionsLimit=20"; done
# 强制 sync（应仍 ~0.9s）
curl -s -m 20 -o /dev/null -w "%{time_total}\n" -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3002/api/projects?sessionsLimit=20&sync=1"
```
Expected: 默认两条都 < 0.4s（sync 不再跑）；`&sync=1` 仍 ~0.9s（sync 在跑）。

- [ ] **Step 4: typecheck**

```bash
npx tsc --noEmit -p server/tsconfig.json 2>&1 | grep -iE "projects-with-sessions|projects.routes" || echo "✓ no errors"
```

- [ ] **Step 5: Commit**

```bash
git add server/modules/projects/services/projects-with-sessions-fetch.service.ts server/modules/projects/projects.routes.ts
git commit -m "perf(projects): skip inline sync on read path (sync only via ?sync=1)"
```

---

## Task 2: Fix 2a — 纯分组函数 + 测试（TDD）

**Files:**
- Create: `server/modules/projects/services/project-session-grouping.ts`
- Test: `server/modules/projects/services/project-session-grouping.test.ts`

- [ ] **Step 1: 写失败测试**

`server/modules/projects/services/project-session-grouping.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupSessionRowsByProject } from './project-session-grouping';

// 批量 SQL 返回的行：每行带 project_path / rn（组内序号，1 起）/ total（该项目总数）
const row = (projectPath: string, rn: number, total: number, id: string, updated_at: string) => ({
  session_id: id,
  provider: 'claude',
  custom_name: null,
  project_path: projectPath,
  updated_at,
  created_at: updated_at,
  rn,
  total,
});

test('每个项目的首页 session 按 rn<=limit 取，total/hasMore 正确', () => {
  const rows = [
    row('/a', 1, 3, 'a1', '2026-07-02T10:00:00Z'),
    row('/a', 2, 3, 'a2', '2026-07-02T09:00:00Z'),
    // /a total=3, limit=2 → 2 条返回，hasMore=true
    row('/b', 1, 1, 'b1', '2026-07-02T08:00:00Z'),
  ];
  const map = groupSessionRowsByProject(rows, ['/a', '/b'], { limit: 2, offset: 0 });
  assert.equal(map.size, 2);
  assert.equal(map.get('/a')!.sessions.length, 2);
  assert.equal(map.get('/a')!.total, 3);
  assert.equal(map.get('/a')!.hasMore, true);
  assert.equal(map.get('/b')!.sessions.length, 1);
  assert.equal(map.get('/b')!.hasMore, false);
});

test('0 session 的项目 → 空页 + total 0', () => {
  const map = groupSessionRowsByProject([], ['/empty', '/a'], { limit: 20, offset: 0 });
  assert.equal(map.get('/empty')!.sessions.length, 0);
  assert.equal(map.get('/empty')!.total, 0);
  assert.equal(map.get('/empty')!.hasMore, false);
});

test('每条 session 映射为 SessionSummary（id/provider/summary/lastActivity）', () => {
  const rows = [row('/a', 1, 1, 'a1', '2026-07-02T10:00:00Z')];
  const [s] = groupSessionRowsByProject(rows, ['/a'], { limit: 20, offset: 0 }).get('/a')!.sessions;
  assert.equal(s.id, 'a1');
  assert.equal(s.provider, 'claude');
  assert.equal(s.summary, '');
  assert.equal(s.lastActivity, '2026-07-02T10:00:00Z');
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx tsx --test server/modules/projects/services/project-session-grouping.test.ts
```
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现纯分组函数**

`server/modules/projects/services/project-session-grouping.ts`：

```ts
/**
 * 批量 SQL（getSessionsByProjectPathsFirstPage）返回的行：每行带组内序号 rn + 该项目总数 total。
 * 本纯函数把它们按 project_path 分组，映射成「首页 session + total + hasMore」。
 * 与 DB 无关 —— SQL 只返回 rn <= offset+limit 的行，本函数不再做窗口过滤，只分组 + 计算 hasMore。
 */

export type SessionBatchRow = {
  session_id: string;
  provider: string;
  custom_name?: string | null;
  project_path: string;
  updated_at?: string | null;
  created_at?: string | null;
  rn: number;
  total: number;
};

export type SessionSummary = {
  id: string;
  provider: string;
  summary: string;
  messageCount: number;
  lastActivity: string;
};

export type ProjectSessionPage = {
  sessions: SessionSummary[];
  total: number;
  hasMore: boolean;
};

function mapRowToSummary(row: SessionBatchRow): SessionSummary {
  return {
    id: row.session_id,
    provider: row.provider,
    summary: row.custom_name || '',
    messageCount: 0,
    lastActivity: row.updated_at ?? row.created_at ?? new Date().toISOString(),
  };
}

export function groupSessionRowsByProject(
  rows: SessionBatchRow[],
  projectPaths: string[],
  pagination: { limit: number; offset: number },
): Map<string, ProjectSessionPage> {
  const result = new Map<string, ProjectSessionPage>();
  // 初始化所有项目（含 0 session 的）为空页
  for (const p of projectPaths) {
    result.set(p, { sessions: [], total: 0, hasMore: false });
  }
  // 按 rn 升序保证首页顺序；分到各项目
  const sorted = [...rows].sort((a, b) => a.rn - b.rn);
  for (const row of sorted) {
    const page = result.get(row.project_path);
    if (!page) continue; // 行属于未请求的项目（不应发生，防御）
    page.sessions.push(mapRowToSummary(row));
    page.total = row.total;
    page.hasMore = page.total > pagination.offset + page.sessions.length;
  }
  return result;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx tsx --test server/modules/projects/services/project-session-grouping.test.ts
```
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/modules/projects/services/project-session-grouping.ts server/modules/projects/services/project-session-grouping.test.ts
git commit -m "perf(projects): pure fn to group batched session rows by project"
```

---

## Task 3: Fix 2b — 批量 SQL `getSessionsByProjectPathsFirstPage`

**Files:**
- Modify: `server/modules/database/repositories/sessions.db.ts`（在 `getSessionsByProjectPathPage` 之后，~L377 新增方法）

- [ ] **Step 1: 加批量方法**

在 `sessions.db.ts` 的 `getSessionsByProjectPathPage` 方法之后（L376 后），新增：

```ts
  /**
   * 批量取多个项目的「首页」session + 每项目总数，一条 SQL（窗口函数）。
   * 替换 N+1：原来对每个项目跑 getSessionsByProjectPathPage + countSessionsByProjectPath。
   * 返回行带 rn（组内序号）+ total（项目总数）；调用方用 groupSessionRowsByProject 分组。
   */
  getSessionsByProjectPathsFirstPage(
    projectPaths: string[],
    limit: number,
    offset: number,
  ): Array<SessionRow & { project_path: string; rn: number; total: number }> {
    const db = getConnection();
    if (projectPaths.length === 0) return [];
    const normalized = projectPaths.map(normalizeProjectPath);
    const placeholders = normalized.map(() => '?').join(',');
    const rows = db
      .prepare(
        `WITH ranked AS (
           SELECT ${SESSION_ROW_COLUMNS}, project_path,
                  ROW_NUMBER() OVER (
                    PARTITION BY project_path
                    ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC
                  ) AS rn,
                  COUNT(*) OVER (PARTITION BY project_path) AS total
           FROM sessions
           WHERE project_path IN (${placeholders})
             AND isArchived = 0
         )
         SELECT * FROM ranked
         WHERE rn > ? AND rn <= ?`
      )
      .all(...normalized, offset, offset + limit) as Array<SessionRow & { project_path: string; rn: number; total: number }>;

    return rows;
  },
```

> 注：`SESSION_ROW_COLUMNS` / `normalizeProjectPath` / `getConnection` 都是本文件既有；`SessionRow` 类型已存在。窗口函数在 better-sqlite3 自带的 SQLite 3.40+ 上可用。`isArchived = 0` 与既有 `getSessionsByProjectPathPage` 一致（只取非归档）。

- [ ] **Step 2: typecheck（server）**

```bash
npx tsc --noEmit -p server/tsconfig.json 2>&1 | grep -iE "sessions.db" || echo "✓ no errors"
```

- [ ] **Step 3: Commit**

```bash
git add server/modules/database/repositories/sessions.db.ts
git commit -m "perf(sessions): batched first-page sessions SQL via window functions"
```

---

## Task 4: Fix 2c — `getProjectsWithSessions` 用批量查询替换 N+1 循环

**Files:**
- Modify: `server/modules/projects/services/projects-with-sessions-fetch.service.ts`（L180–241 的循环）

- [ ] **Step 1: import 批量方法 + 分组函数**

文件顶部 import 区加（无后缀）：

```ts
import { groupSessionRowsByProject } from './project-session-grouping';
```

`readProjectSessionsPageByPath`（L143）保持不动（load-more 单项目仍用它）。`sessionsDb` 的 import 已有，确认它导出了新方法 `getSessionsByProjectPathsFirstPage`（Task 3 加的）。

- [ ] **Step 2: 用批量查询替换循环里的 per-project 查询**

`getProjectsWithSessions`（L180–241）整体替换为（保留 Fix 1 的 `skipSynchronization ?? true`、`broadcastProgress`、`generateDisplayName`、`fs.existsSync` 在路由层已做、本函数不重复）：

```ts
export async function getProjectsWithSessions(
  options: GetProjectsWithSessionsOptions = {}
): Promise<ProjectListItem[]> {
  const skipSynchronization = options.skipSynchronization ?? true;
  if (!skipSynchronization) {
    await sessionSynchronizerService.synchronizeSessions();
  }

  const projectRows = projectsDb.getProjectPaths() as Array<{
    project_id: string;
    project_path: string;
    custom_project_name?: string | null;
    isStarred?: number;
  }>;
  const totalProjects = projectRows.length;
  const projectPaths = projectRows.map((r) => r.project_path);

  // 批量取所有项目的首页 session + total（一条 SQL，替换原 N+1 循环）
  const pagination = normalizeSessionPagination({
    limit: options.sessionsLimit,
    offset: options.sessionsOffset,
  });
  const batchRows = sessionsDb.getSessionsByProjectPathsFirstPage(
    projectPaths,
    pagination.limit,
    pagination.offset,
  );
  const pagesByPath = groupSessionRowsByProject(batchRows, projectPaths, pagination);

  broadcastProgress({ phase: 'loading', current: 0, total: totalProjects });

  const projects: ProjectListItem[] = [];
  let processedProjects = 0;
  for (const row of projectRows) {
    processedProjects += 1;
    broadcastProgress({
      phase: 'loading',
      current: processedProjects,
      total: totalProjects,
      currentProject: row.project_path,
    });

    const displayName =
      row.custom_project_name && row.custom_project_name.trim().length > 0
        ? row.custom_project_name
        : await generateDisplayName(path.basename(row.project_path) || row.project_path, row.project_path);

    const page = pagesByPath.get(row.project_path) ?? { sessions: [], total: 0, hasMore: false };
    projects.push({
      projectId: row.project_id,
      path: row.project_path,
      displayName,
      fullPath: row.project_path,
      isStarred: Boolean(row.isStarred),
      sessions: page.sessions,
      sessionMeta: { hasMore: page.hasMore, total: page.total },
    });
  }

  broadcastProgress({ phase: 'complete', current: totalProjects, total: totalProjects });
  return projects;
}
```

> 循环里不再有 DB 查询 —— 批量查询已提前一次性取完。`generateDisplayName`（async/IO）仍在循环里逐项调，但它的成本远小于 DB 往返；如 Phase 1 实测显示它仍是热点，后续单独缓存（本 plan 不做，YAGNI）。

- [ ] **Step 3: typecheck（server）**

```bash
npx tsc --noEmit -p server/tsconfig.json 2>&1 | grep -iE "projects-with-sessions" || echo "✓ no errors"
```

- [ ] **Step 4: 验证（curl 计时，对照 Task 1 的 after）**

```bash
TOKEN=$(node debug/gen-token.cjs)
for i in 1 2 3; do curl -s -m 20 -o /dev/null -w "%{time_total}\n" -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3002/api/projects?sessionsLimit=20"; done
# 结果条数 + 最大项目的 total 仍正确（4202）
curl -s -m 20 -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3002/api/projects?sessionsLimit=5" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s);const b=[...a].sort((x,y)=>(y.sessionMeta?.total||0)-(x.sessionMeta?.total||0))[0];console.log('projects:',a.length,'| biggest total:',b?.sessionMeta?.total,'| first-page len:',b?.sessions?.length)})"
```
Expected: 3 次默认读都 < 0.2s（Fix 1+2 叠加）；projects 数 + biggest total（4202）+ first-page len（5）正确。

- [ ] **Step 5: 跑既有项目测试，确认无回归**

```bash
npx tsx --test server/modules/projects/services/project-session-grouping.test.ts   # 本 plan Task 2
npx tsc --noEmit -p server/tsconfig.json   # server 整体类型
```
Expected: 测试 PASS；typecheck 无错误。

- [ ] **Step 6: Commit**

```bash
git add server/modules/projects/services/projects-with-sessions-fetch.service.ts
git commit -m "perf(projects): replace N+1 session query with batched SQL"
```

---

## Task 5: 端到端验收 + roadmap 文案

**Files:**
- Modify: `docs/product/V1_PRODUCT_ROADMAP.md`（P1 条目文案）

- [ ] **Step 1: 在 :3002 上跑完整 before/after 对照**

记录到 spec 末尾或本 plan 验收区：

| 端点 | before | after（目标）|
|---|---|---|
| `GET /api/projects`（默认）| ~0.9s | < 0.2s |
| `GET /api/projects?sync=1`（强制）| ~0.9s | ~0.9s（不变）|
| `GET /api/projects/:id/sessions?offset=N` | 13–19ms | 不回归 |
| sidebar 冷开 TTFB | ~1s | < 0.4s |

```bash
TOKEN=$(node debug/gen-token.cjs)
echo "default:"; for i in 1 2 3; do curl -s -m 20 -o /dev/null -w "  %{time_total}\n" -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3002/api/projects?sessionsLimit=20"; done
echo "sync=1:"; curl -s -m 20 -o /dev/null -w "  %{time_total}\n" -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3002/api/projects?sessionsLimit=20&sync=1"
```

- [ ] **Step 2: 改 roadmap P1 文案**

`docs/product/V1_PRODUCT_ROADMAP.md` P1 区，把 `- 产品官网/落地页...` 上面那条（关于会话列表）—— 等等，会话列表分页是「会话列表分页/缓存」那条。改为：

```md
- 会话列表分页/缓存 —— 已分页（20/页）；实测瓶颈转去 sidebar 打开性能，见 `docs/superpowers/specs/2026-07-02-projects-list-perf-design.md`（已修：projects 端点 inline sync + N+1）。
```

- [ ] **Step 3: Commit**

```bash
git add docs/product/V1_PRODUCT_ROADMAP.md
git commit -m "docs(roadmap): redirect P1 session-list item to projects-perf (done)"
```

---

## 验收清单

- [ ] `GET /api/projects`（默认）p50 < 200ms、p95 < 400ms（before ~900ms）
- [ ] `GET /api/projects?sync=1` 仍能触发 sync（~0.9s，手动刷新可用）
- [ ] `GET /api/projects/:id/sessions?offset=N` 仍 < 50ms（不回归）
- [ ] 返回结构不变：30 项目、biggest total=4202、首页 len=sessionsLimit
- [ ] `npx tsx --test server/modules/projects/services/project-session-grouping.test.ts` 全绿
- [ ] `npx tsc --noEmit -p server/tsconfig.json` 无错误
- [ ] 既有功能不回归（sidebar 项目/会话列表正常显示、load-more 正常、FTS5 搜索正常）

## 风险与回退

- **`?sync=1` 行为**：若手动刷新（Ctrl+R）的 onRefresh 不带 `?sync=1`，则刷新不再强制 sync —— 但 watchers + WS 负责新鲜度，可接受。如需刷新必同步，前端 onRefresh 的 fetch 加 `?sync=1`（1 行，本 plan 不含，YAGNI 先）。
- **窗口函数兼容性**：better-sqlite3 自带 SQLite 3.40+，窗口函数（3.25+）可用。如打包版异常，回退 = 把批量 SQL 拆成「一条 totals（GROUP BY）+ 一条首页（ROW_NUMBER 子查询）」两条。
- **`generateDisplayName` 仍在循环**：若 Task 4 实测显示它是新热点（>50ms），后续单独缓存（本 plan 不做）。
