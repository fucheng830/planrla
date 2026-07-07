---
REQ-ID: REQ-024
title: 合并「对话」与 Running sessions 侧边栏视图 — 实施计划
date: 2026-07-07
status: plan
spec: ../specs/2026-07-06-merge-chat-running-sessions-design.md
---

# 合并「对话」与 Running sessions 侧边栏视图 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把侧边栏的「对话」(Conversations)和「Running」两个 tab 合并为单一「会话」(Sessions)列表,正在运行的 session 置顶 + emerald 标识;统一术语为 Sessions;数据层不动。

**Architecture:** 纯前端改动。`SidebarSearchMode` 类型从四态收敛为三态(删 `running`、`conversations`→`sessions`),`SidebarHeader` 删 Running 按钮、`SidebarContent` 删 running 分支并在 sessions 列表加 running 置顶排序 + emerald 视觉,i18n 10 语言术语对齐。后端/store/数据层/`useSidebarController` 的 running count 计算全部不动。

**Tech Stack:** React 18 + TypeScript 5 + i18next + Tailwind + Vite。项目**无测试框架**(package.json 无 vitest/jest/playwright),验证用 `npm run typecheck && npm run build` + 对照 spec 验收标准手测。

**关键约束(来自 spec 边界决策):**
- Projects tab / Archived tab 不动
- 搜索时 running 不置顶(保持 project-grouped 结构),仅加 emerald 徽标
- 非搜索的「会话」列表才 running 置顶
- running count 计算保留(作「会话」按钮 emerald 徽标数据源)

**i18n 翻译映射(Task 1 用):**

| locale | `modeSessions` 值 |
|---|---|
| en | Sessions |
| zh-CN | 会话 |
| zh-TW | 會話 |
| ja | セッション |
| ko | 세션 |
| fr | Sessions |
| de | Sitzungen |
| it | Sessioni |
| ru | Сеансы |
| tr | Oturumlar |

---

## Task 1: 统一 `conversations` → `sessions`(i18n key + 类型 + code 引用)

**纯重命名,不删 running。改完后 typecheck 必过,Running tab 仍工作。**

**Files:**
- Modify: `src/components/sidebar/types/types.ts:5`
- Modify: `src/components/sidebar/view/subcomponents/SidebarHeader.tsx`(:54, :145-149, :162, :292-296, :309)
- Modify: `src/components/sidebar/view/subcomponents/SidebarContent.tsx`(:203, :339)
- Modify: `src/components/sidebar/hooks/useSidebarController.ts`(:391)
- Modify: `src/i18n/locales/{en,zh-CN,zh-TW,ja,ko,fr,de,it,ru,tr}/sidebar.json`(`search.modeConversations` → `search.modeSessions`)

- [ ] **Step 1.1: 改类型定义**

`src/components/sidebar/types/types.ts:5`:

```ts
// 现状
export type SidebarSearchMode = 'projects' | 'conversations' | 'running' | 'archived';
// 改为(conversations → sessions,running 暂留,Task 2 删)
export type SidebarSearchMode = 'projects' | 'sessions' | 'running' | 'archived';
```

- [ ] **Step 1.2: 改 SidebarHeader.tsx 所有 `'conversations'` 字面量 + t() key**

`src/components/sidebar/view/subcomponents/SidebarHeader.tsx`,逐处替换:

| 行 | 现状 | 改为 |
|---|---|---|
| 54 | `searchMode === 'conversations'` | `searchMode === 'sessions'` |
| 145 | `onSearchModeChange('conversations')` | `onSearchModeChange('sessions')` |
| 146 | `searchMode === 'conversations'` | `searchMode === 'sessions'` |
| 149 | `searchMode === 'conversations'` | `searchMode === 'sessions'` |
| 162 | `t('search.modeConversations')` | `t('search.modeSessions')` |
| 292 | `onSearchModeChange('conversations')` | `onSearchModeChange('sessions')` |
| 293 | `searchMode === 'conversations'` | `searchMode === 'sessions'` |
| 296 | `searchMode === 'conversations'` | `searchMode === 'sessions'` |
| 309 | `t('search.modeConversations')` | `t('search.modeSessions')` |

- [ ] **Step 1.3: 改 SidebarContent.tsx**

`src/components/sidebar/view/subcomponents/SidebarContent.tsx`:

```ts
// :203
const showConversationSearch = searchMode === 'sessions' && searchFilter.trim().length >= 2;
// :339
) : searchMode === 'sessions' ? (
```

- [ ] **Step 1.4: 改 useSidebarController.ts**

`src/components/sidebar/hooks/useSidebarController.ts:391`:

```ts
if (searchMode !== 'sessions' || query.length < 2) {
```

- [ ] **Step 1.5: 改 10 个 sidebar.json 的 i18n key + 值**

每个 `src/i18n/locales/<locale>/sidebar.json` 里 `search` 对象的 `"modeConversations": "..."` 改为 `"modeSessions": "<映射表值>"`。例如 en:

```json
"modeSessions": "Sessions",
```

zh-CN:
```json
"modeSessions": "会话",
```

(其余 8 个按上方映射表。)key 名 `modeConversations` → `modeSessions`,值按表。JSON 逗号/格式保持。

- [ ] **Step 1.6: typecheck + build**

```bash
npm run typecheck && npm run build
```
Expected: 全过,无 `'conversations'` 残留错误。

- [ ] **Step 1.7: 手测**

`npm run dev`,打开 sidebar:
- 原 Conversations tab 文案变为「会话」(zh-CN)/ Sessions(en),功能正常(点选、搜索)。
- Running tab 仍在,仍工作(Task 2 才删)。
- 切换 i18n 语言(en/zh-CN/ja 任选),tab 文案正确。

- [ ] **Step 1.8: commit**

```bash
git add src/components/sidebar/types/types.ts src/components/sidebar/view/subcomponents/SidebarHeader.tsx src/components/sidebar/view/subcomponents/SidebarContent.tsx src/components/sidebar/hooks/useSidebarController.ts src/i18n/locales/*/sidebar.json
git commit -m "refactor(sidebar): REQ-024 统一 conversations → sessions(类型+i18n+code)"
```

---

## Task 2: 删 Running tab(类型 + UI 按钮 + 渲染分支 + 死代码)

**Files:**
- Modify: `src/components/sidebar/types/types.ts:5`
- Modify: `src/components/sidebar/view/subcomponents/SidebarHeader.tsx`(删 Running 按钮 桌面+移动、searchPlaceholder running 分支、清理 Activity import)
- Modify: `src/components/sidebar/view/subcomponents/SidebarContent.tsx`(删 running 分支、清理 Activity import)
- Modify: `src/components/sidebar/view/Sidebar.tsx:168`(`forceExpanded`)
- Modify: `src/components/sidebar/hooks/useSidebarController.ts`(:636-660 删 `runningProjects`、:663 简化)

- [ ] **Step 2.1: 类型删 `'running'`**

`src/components/sidebar/types/types.ts:5`:

```ts
export type SidebarSearchMode = 'projects' | 'sessions' | 'archived';
```

- [ ] **Step 2.2: SidebarHeader.tsx 删桌面 Running 按钮**

删除 `src/components/sidebar/view/subcomponents/SidebarHeader.tsx:164-186` 整块(从 `<Tooltip content={t('search.runningTooltip', 'Running sessions')} position="top">` 到对应 `</Tooltip>`)。

- [ ] **Step 2.3: SidebarHeader.tsx 删移动 Running 按钮**

删除 `:311-334` 整块(移动版同样的 Running Tooltip+button 块)。

- [ ] **Step 2.4: SidebarHeader.tsx 修 searchPlaceholder 三元**

`:54-58` 现状(示意,以实际为准):

```ts
const searchPlaceholder = searchMode === 'sessions'
  ? t('search.searchPlaceholder', 'Search sessions...')
  : searchMode === 'archived'
    ? t('search.searchArchivedPlaceholder', 'Search archived...')
    : searchMode === 'running'
      ? t('search.searchRunningPlaceholder', 'Search running...')
      : t('search.searchProjectsPlaceholder', 'Search projects...');
```

删除 `running` 分支:

```ts
const searchPlaceholder = searchMode === 'sessions'
  ? t('search.searchPlaceholder', 'Search sessions...')
  : searchMode === 'archived'
    ? t('search.searchArchivedPlaceholder', 'Search archived...')
    : t('search.searchProjectsPlaceholder', 'Search projects...');
```

- [ ] **Step 2.5: SidebarHeader.tsx 清理 import**

`:2` 顶部 import,若 `Activity` 删按钮后不再被引用,从 lucide-react import 列表中移除 `Activity`:

```ts
// 确认 Activity 不再被引用后,从 import { Activity, Archive, ... } 中删掉 Activity
```

(用 `npm run typecheck` 验证;`eslint-plugin-unused-imports` 也会抓。)

- [ ] **Step 2.6: SidebarContent.tsx 删 running 渲染分支**

删除 `src/components/sidebar/view/subcomponents/SidebarContent.tsx:425-457` 整个 `) : searchMode === 'running' ? ( ... )` 分支(从 `) : searchMode === 'running' ? (` 到下一个 `) : searchMode === 'archived' ? (` 之前)。

删除后,`:339` 的 sessions 分支直接接 `:458` 的 archived 分支。

- [ ] **Step 2.7: SidebarContent.tsx 清理 import**

`:2` 顶部 `import { Activity, Archive, Folder, MessageSquare, ... }`,删 running 分支后 `Activity` 不再被引用,移除:

```ts
import { Archive, Folder, MessageSquare, RotateCcw, Search, Trash2 } from 'lucide-react';
```

- [ ] **Step 2.8: Sidebar.tsx 修 forceExpanded**

`src/components/sidebar/view/Sidebar.tsx:168`:

```ts
// 现状
forceExpanded: searchMode === 'running',
// 改为(running tab 已删,永远不强制展开)
forceExpanded: false,
```

- [ ] **Step 2.9: useSidebarController.ts 简化 filteredProjects + 删 runningProjects**

`src/components/sidebar/hooks/useSidebarController.ts`:

删除 `:636-660` 整个 `runningProjects` useMemo 块(从 `const runningProjects = useMemo(() => {` 到对应 `}, [activeSessionIds, sortedProjects]);`)。

`:662-665` filteredProjects 简化:

```ts
// 现状
const filteredProjects = useMemo(
  () => filterProjects(searchMode === 'running' ? runningProjects : sortedProjects, debouncedSearchQuery),
  [debouncedSearchQuery, runningProjects, searchMode, sortedProjects],
);
// 改为
const filteredProjects = useMemo(
  () => filterProjects(sortedProjects, debouncedSearchQuery),
  [debouncedSearchQuery, sortedProjects],
);
```

- [ ] **Step 2.10: typecheck + build + lint**

```bash
npm run typecheck && npm run build && npm run lint
```
Expected: 全过。无 `'running'` 残留类型错误、无 `Activity` unused import 警告、无 `runningProjects` undefined 错误。

- [ ] **Step 2.11: 手测**

`npm run dev`:
- sidebar 只剩三档:Projects / 会话 / 归档,**无 Running 按钮**。
- 点 Projects / 会话 / 归档,各自正常。
- 发起会话发消息 → session 在 Projects tab 的所属项目下仍显示(processing 视觉不变)。
- 5s 轮询 `/api/providers/sessions/running` 仍在(Network 面板可见),`runningSessionsCount` 仍更新(为 Task 4 徽标准备)。

- [ ] **Step 2.12: commit**

```bash
git add -A
git commit -m "refactor(sidebar): REQ-024 删除 Running tab(类型+UI+分支+死代码)"
```

---

## Task 3: 会话列表 running 置顶排序 + emerald 视觉标识

**Files:**
- Modify: `src/components/sidebar/view/subcomponents/SidebarContent.tsx`(:206-214 排序、:382-421 列表项视觉)

- [ ] **Step 3.1: conversationListItems 加 running 置顶排序**

`src/components/sidebar/view/subcomponents/SidebarContent.tsx:206-214`,现状:

```ts
const conversationListItems: ConversationListItem[] = projects
  .flatMap((project) =>
    getAllSessions(project).map((session) => ({
      project,
      session,
      lastActivityTime: getSessionDate(session).getTime(),
    })),
  )
  .sort((itemA, itemB) => itemB.lastActivityTime - itemA.lastActivityTime);
```

改为(running 置顶,running 间按 startedAt 降序):

```ts
const activeSessions = projectListProps.activeSessions;
const conversationListItems: ConversationListItem[] = projects
  .flatMap((project) =>
    getAllSessions(project).map((session) => ({
      project,
      session,
      lastActivityTime: getSessionDate(session).getTime(),
    })),
  )
  .sort((itemA, itemB) => {
    const aRunning = activeSessions.has(itemA.session.id);
    const bRunning = activeSessions.has(itemB.session.id);
    if (aRunning && bRunning) {
      // 都在跑:晚启动的在前(最新启动最顶)
      const aStarted = activeSessions.get(itemA.session.id)?.startedAt ?? 0;
      const bStarted = activeSessions.get(itemB.session.id)?.startedAt ?? 0;
      return bStarted - aStarted;
    }
    if (aRunning) return -1;
    if (bRunning) return 1;
    return itemB.lastActivityTime - itemA.lastActivityTime;
  });
```

- [ ] **Step 3.2: 会话列表项加 running 行 tint**

`:385-391` button className,现状:

```tsx
className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
  isSelected
    ? 'border-primary/25 bg-primary/5'
    : isCompleted
      ? 'border-primary/30 bg-primary/5 hover:bg-primary/10'
      : 'border-transparent hover:border-border/60 hover:bg-accent/45'
}`}
```

改为(isProcessing 优先于 isCompleted,emerald tint):

```tsx
className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
  isSelected
    ? 'border-primary/25 bg-primary/5'
    : isProcessing
      ? 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10'
      : isCompleted
        ? 'border-primary/30 bg-primary/5 hover:bg-primary/10'
        : 'border-transparent hover:border-border/60 hover:bg-accent/45'
}`}
```

- [ ] **Step 3.3: 会话列表项加 emerald 点**

`:394` 行内 `<div className="flex min-w-0 items-center gap-2">` 内,在 `<SessionProviderLogo>` 前插入 emerald 点:

```tsx
<div className="flex min-w-0 items-center gap-2">
  {isProcessing && (
    <span
      className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-emerald-500"
      aria-label={t('tooltips.processingSessionIndicator', 'Processing session')}
    />
  )}
  <SessionProviderLogo provider={session.__provider} className="h-3.5 w-3.5 flex-shrink-0" />
  <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
    {sessionTitle}
  </span>
  {/* ...原有 statusView badge + age... */}
</div>
```

(注:`statusView` badge 在 `:399-403` 原样保留——isProcessing 时它显示 running 状态 emerald 文字徽标,与 emerald 点共存,构成「点 + 文字徽标」双标识。)

- [ ] **Step 3.4: typecheck + build**

```bash
npm run typecheck && npm run build
```
Expected: 全过。

- [ ] **Step 3.5: 手测(核心验收)**

`npm run dev`,在「会话」tab:
- 发起一个新会话发消息 → 该 session **浮到列表顶部**,左侧 emerald 脉冲点 + 行 emerald tint + 右侧「Running」文字徽标。
- 同时发起 2-3 个会话 → 按**启动顺序**排顶部(最新启动的最顶)。
- 等任一 session 结束(provider complete)→ 自动从顶部落回时间位,emerald 点/徽标/tint 消失。
- 切到 Projects tab → 运行中 session 的视觉(现有 SidebarSessionItem processing 视觉)不变。

- [ ] **Step 3.6: commit**

```bash
git add src/components/sidebar/view/subcomponents/SidebarContent.tsx
git commit -m "feat(sidebar): REQ-024 会话列表 running 置顶 + emerald 标识"
```

---

## Task 4: 会话按钮 emerald running 徽标迁移(双徽标布局)

**Files:**
- Modify: `src/components/sidebar/view/subcomponents/SidebarHeader.tsx`(桌面 :154-161 + 移动 :301-308 的图标 span)

- [ ] **Step 4.1: 桌面会话按钮加 running 徽标**

`src/components/sidebar/view/subcomponents/SidebarHeader.tsx:154-161` 现状(桌面,MessageSquare 图标 span):

```tsx
<span className="relative flex h-3 w-3 items-center justify-center">
  <MessageSquare className="h-3 w-3" />
  {completedSessionsCount > 0 && (
    <span className="absolute -right-2.5 -top-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[8px] font-semibold leading-none text-primary-foreground shadow-sm ring-1 ring-background">
      {completedBadgeText}
    </span>
  )}
</span>
```

改为(新增 running emerald 徽标,右下,与 completed 右上错开):

```tsx
<span className="relative flex h-3 w-3 items-center justify-center">
  <MessageSquare className="h-3 w-3" />
  {completedSessionsCount > 0 && (
    <span className="absolute -right-2.5 -top-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[8px] font-semibold leading-none text-primary-foreground shadow-sm ring-1 ring-background">
      {completedBadgeText}
    </span>
  )}
  {runningSessionsCount > 0 && (
    <span className="absolute -right-2.5 -bottom-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-emerald-500 px-0.5 text-[8px] font-semibold leading-none text-white shadow-sm ring-1 ring-background">
      {runningBadgeText}
    </span>
  )}
</span>
```

- [ ] **Step 4.2: 移动会话按钮加 running 徽标**

`:301-308`(移动版同样结构)做相同改动:在 completed 徽标后追加 running emerald 徽标(右下 `-right-2.5 -bottom-2`)。

- [ ] **Step 4.3: 确认 runningBadgeText 已定义**

`SidebarHeader.tsx` 顶部应有 `runningBadgeText` 变量定义(原 Running 按钮用的计数格式化)。Task 2 删了 Running 按钮但 `runningBadgeText` / `runningSessionsCount` prop 应保留(后者是 `useSidebarController` 的 count)。若 `runningBadgeText` 在 Task 2 被误删,恢复它——它的定义形如:

```ts
const runningBadgeText = runningSessionsCount > 99 ? '99+' : String(runningSessionsCount);
```

(以实际原有定义为准;若已被删,从 Task 2 的 commit 里找回。)

- [ ] **Step 4.4: typecheck + build**

```bash
npm run typecheck && npm run build
```
Expected: 全过。

- [ ] **Step 4.5: 手测**

`npm run dev`:
- 无 session 运行时,「会话」按钮只有 completed 徽标(primary 色,右上),无 emerald 徽标。
- 发起会话 → 「会话」按钮右下出现 emerald 计数徽标,与右上 completed 徽标**不重叠**(一上一下)。
- 同时跑 2 个 → emerald 徽标显示「2」。

- [ ] **Step 4.6: commit**

```bash
git add src/components/sidebar/view/subcomponents/SidebarHeader.tsx
git commit -m "feat(sidebar): REQ-024 会话按钮迁移 running emerald 计数徽标"
```

---

## Task 5: 搜索分支 running 徽标(不置顶)

**Files:**
- Modify: `src/components/sidebar/view/subcomponents/SidebarContent.tsx`(:309 搜索结果项)

- [ ] **Step 5.1: 搜索结果项加 running emerald 点**

`src/components/sidebar/view/subcomponents/SidebarContent.tsx:309` 现状(搜索结果 session button 内):

```tsx
<div className="mb-1 flex items-center gap-1.5">
  <MessageSquare className="h-3 w-3 flex-shrink-0 text-primary" />
  <span className="truncate text-xs font-medium text-foreground">
    {session.sessionSummary}
  </span>
  ...
```

改为(命中 running 时在 MessageSquare 前加 emerald 点):

```tsx
<div className="mb-1 flex items-center gap-1.5">
  {projectListProps.activeSessions.has(session.sessionId) && (
    <span
      className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-emerald-500"
      aria-label={t('tooltips.processingSessionIndicator', 'Processing session')}
    />
  )}
  <MessageSquare className="h-3 w-3 flex-shrink-0 text-primary" />
  <span className="truncate text-xs font-medium text-foreground">
    {session.sessionSummary}
  </span>
  ...
```

(搜索结果保持 project-grouped 结构,**不置顶**;仅命中的 running session 加 emerald 点标识。)

- [ ] **Step 5.2: typecheck + build**

```bash
npm run typecheck && npm run build
```
Expected: 全过。

- [ ] **Step 5.3: 手测**

`npm run dev`:
- 发起一个会话(让它 running)。
- 在「会话」tab 搜索框输入该 running session 标题片段(≥2 字符)。
- 搜索结果里命中项显示 emerald 点,但**不浮顶**(保持在其 project 组内)。

- [ ] **Step 5.4: commit**

```bash
git add src/components/sidebar/view/subcomponents/SidebarContent.tsx
git commit -m "feat(sidebar): REQ-024 搜索结果 running 命中加 emerald 点(不置顶)"
```

---

## Task 6: 最终验收(对照 spec 验收标准)

- [ ] **Step 6.1: 预检三件套**

```bash
npm run typecheck && npm run build && git diff --check
```
Expected: 全过,无空白错误。

- [ ] **Step 6.2: 功能验收(对照 spec §验收标准 3)**

`npm run dev`,逐条核对:

1. sidebar 只剩三档:Projects / 会话 / 归档,无 Running 按钮。✅
2. 发起会话 → session 在「会话」tab 置顶 + emerald 点 + Running 文字徽标 + 行 tint。✅
3. 多个 running → 按启动顺序排顶部(最新最顶)。✅
4. session 结束 → 自动落回时间位,emerald 标识消失。✅
5. 「会话」按钮显示 running emerald 计数 + completed primary 计数,不重叠。✅
6. 搜索时命中 running session → 显示 emerald 点(不置顶)。✅

- [ ] **Step 6.3: 术语验收**

- UI 中「对话」文案统一为「会话」(zh-CN),grep 确认无 `modeConversations` 残留:
  ```bash
  grep -rn "modeConversations" src/
  ```
  Expected: 无输出。

- [ ] **Step 6.4: 回归验收**

- Projects tab 行为不变(运行中 session 仍有现有 processing 视觉)。✅
- Archived tab 不变。✅
- i18n 切 en / zh-CN / ja,「会话」tab 文案正确、无裸 key fallback。✅

- [ ] **Step 6.5: 代码卫生验收**

- grep 确认无 `'running'` 残留 SidebarSearchMode 引用:
  ```bash
  grep -rn "searchMode === 'running'\|onSearchModeChange('running')" src/
  ```
  Expected: 无输出。
- 确认无 `runningProjects` 残留:
  ```bash
  grep -rn "runningProjects" src/
  ```
  Expected: 无输出。
- 确认 `Activity` import 在 SidebarHeader/SidebarContent 已清理(若不再用):
  ```bash
  npm run lint
  ```
  Expected: 无 unused import 警告。

- [ ] **Step 6.6: 更新 BACKLOG 状态**

`docs/process/BACKLOG.md`,REQ-024 行状态 `spec` → `review`(实施完成,等验收),plan 列填上本 plan 路径:

```markdown
| REQ-024 | 合并「对话」与 Running sessions 侧边栏视图 | — | P1 | feat | review | [spec](../superpowers/specs/2026-07-06-merge-chat-running-sessions-design.md) | [plan](../superpowers/plans/2026-07-07-req024-merge-chat-running-sessions.md) | _(未发版)_ |
```

- [ ] **Step 6.7: commit**

```bash
git add docs/process/BACKLOG.md
git commit -m "chore(backlog): REQ-024 → review(实施完成,待验收)"
```

---

## Self-Review(plan 自查)

**1. Spec coverage:**
- 合并目标(单列表 + 运行态标识)→ Task 3 ✓
- 运行态呈现(置顶 + emerald 徽标,结束回原位)→ Task 3 + Task 4 ✓
- 术语统一(会话/Sessions)→ Task 1 ✓
- 路径 2(UI + 类型清理,无死代码)→ Task 2 删死代码 ✓
- Projects tab 不动 → 无 task 改 Projects(确认)✓
- 搜索时 running 不置顶 → Task 5 ✓
- SidebarHeader 删 Running 按钮 → Task 2 ✓
- SidebarSearchMode 收敛 → Task 1 + Task 2 ✓
- i18n 10 语言(修正 spec 的「11」笔误)→ Task 1 ✓
- 验收标准 → Task 6 ✓

**2. 补充(spec 影响文件列表遗漏,plan 覆盖):**
- spec 影响文件未列 `Sidebar.tsx`,但 `:168 forceExpanded` 受 running 删除影响 → Task 2 Step 2.8 覆盖 ✓
- spec 影响文件未列 `useSidebarController.ts` 的 `runningProjects` 死代码 → Task 2 Step 2.9 覆盖 ✓

**3. Placeholder scan:** 无 TBD/TODO;每 step 含完整代码或精确路径行号 ✓。

**4. Type consistency:**
- `SidebarSearchMode` 全程使用一致(Task 1 定 `sessions`,后续 task 引用 `sessions`)✓
- `runningBadgeText` / `runningSessionsCount` 在 Task 4 引用,Task 2 保留(只删 Running 按钮 UI,不删变量)✓
- `activeSessions` 引用一致(`projectListProps.activeSessions`,SessionActivityMap 的 `.has(id)` / `.get(id)?.startedAt`)✓

**5. spec 笔误修正:** spec 写「11 种语言」,实测 grep `modeConversations` 命中 10 个 locale 文件(de/en/fr/it/ja/ko/ru/tr/zh-TW/zh-CN)。plan 按 10 执行。需回填修正 spec。

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-07-07-req024-merge-chat-running-sessions.md`. 执行选项见对话(offer execution choice)。
