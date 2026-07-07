# REQ-025:统一侧边栏 session 状态 UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans 逐 task 实施。Steps 用 checkbox(`- [ ]`)跟踪。

**REQ-ID:** REQ-025

**Goal:** 把 sidebar 三处(顶层 Sessions 列表 / Projects 内 session 行 / 搜索结果)的 session 状态视觉统一到单一共享组件 `SessionTaskStatusBadge`,删除 emerald/primary/isActive/isProcessing 等冗余 ad-hoc 信号。

**Architecture:** 抽出 `src/shared/SessionTaskStatusBadge.tsx`(从 SidebarSessionItem 局部定义搬出 + 加 i18n),三处 import 它;每行 status 统一为 `activeSessions.get(id)?.taskStatus ?? completion?.status ?? 'idle'`;行底仅留 selection primary 描边,状态全走 badge。

**Tech Stack:** React 18 + TypeScript + Tailwind + react-i18next + lucide-react。验证 = `npm run typecheck` + `npm run build` + `npm run lint`(仓内无组件单测,纯逻辑才用 node:test;本需求是 JSX 改动,走既有预检)。

**Worktree:** `.claude/worktrees/req025-sidebar-status-ui`(branch `feat/req025-sidebar-status-ui`)。所有命令在此 worktree 内执行。

**Spec:** `docs/superpowers/specs/2026-07-07-req025-sidebar-status-ui-unify-design.md`

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `src/shared/SessionTaskStatusBadge.tsx` | 唯一 session 状态视图组件;接收 `SessionTaskStatus`,渲染 tone 胶囊(idle 返回 null) | **Create** |
| `src/components/sidebar/view/subcomponents/SidebarSessionItem.tsx` | Projects 内 session 行(mobile + desktop 双变体) | **Modify**(删冗余信号 + import 共享 badge) |
| `src/components/sidebar/view/subcomponents/SidebarContent.tsx` | 顶层 Sessions 列表 + 搜索结果两处 | **Modify**(删 emerald/primary + 用共享 badge) |

不变:`src/shared/taskStatus.ts`(模型已正确)、`TaskIndicator.tsx`(Project 行配置态,out of scope)。

---

## Task 1:抽出 SessionTaskStatusBadge 到 src/shared/

**Files:**
- Create: `src/shared/SessionTaskStatusBadge.tsx`
- Modify: `src/components/sidebar/view/subcomponents/SidebarSessionItem.tsx`(删局部定义 L66-98 + 改 import)

- [ ] **Step 1: 创建共享组件**

Create `src/shared/SessionTaskStatusBadge.tsx`:

```tsx
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/utils';
import { getSessionTaskStatusView } from './taskStatus';
import type { SessionTaskStatus, SessionTaskStatusTone } from './taskStatus';

const taskStatusBadgeClassNames: Record<SessionTaskStatusTone, string> = {
  muted: 'bg-muted text-muted-foreground',
  info: 'bg-blue-500/10 text-blue-600 dark:text-blue-300',
  warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  success: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  danger: 'bg-red-500/10 text-red-700 dark:text-red-300',
};

type SessionTaskStatusBadgeProps = {
  status: SessionTaskStatus;
};

/**
 * 全 sidebar 唯一的 session 状态视图。idle → 不渲染;其余 → tone 胶囊。
 * 三处(顶层 Sessions 列表 / Projects 内 session 行 / 搜索结果)共用此组件。
 */
export default function SessionTaskStatusBadge({ status }: SessionTaskStatusBadgeProps) {
  const { t } = useTranslation();
  const statusView = getSessionTaskStatusView(status);

  if (statusView.status === 'idle') {
    return null;
  }

  const Icon = statusView.status === 'running'
    ? Loader2
    : statusView.status === 'completed'
      ? Check
      : AlertCircle;

  const label = t(`taskStatus.${statusView.status}`, statusView.label);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none',
        taskStatusBadgeClassNames[statusView.tone],
      )}
      title={label}
    >
      <Icon className={cn('h-2.5 w-2.5', statusView.status === 'running' && 'animate-spin')} />
      {label}
    </span>
  );
}
```

- [ ] **Step 2: 从 SidebarSessionItem 删除局部定义 + 改 import**

In `src/components/sidebar/view/subcomponents/SidebarSessionItem.tsx`:

2a. 删除 L66-98(整段 `taskStatusBadgeClassNames` + `function SessionTaskStatusBadge`)。

2b. 在文件顶部 import 区(L5-12 附近)加:
```tsx
import SessionTaskStatusBadge from '../../../../../shared/SessionTaskStatusBadge';
```
(路径核对:SidebarSessionItem 现有 `import { Badge, Button, Tooltip } from '../../../../shared/view/ui';` —— `shared/view/ui` 是 4 个 `..`;`shared/SessionTaskStatusBadge` 同样 4 个 `..`,即 `'../../../../shared/SessionTaskStatusBadge'`。)

2c. 删除 L8-9 现有 taskStatus 导入(`SessionTaskStatus` type + `getSessionTaskStatusView`),因为局部 badge 删了就没人用 `getSessionTaskStatusView`;但 `SessionTaskStatus` type 仍被 props(L19 `taskStatus: SessionTaskStatus`)用。所以只删 `getSessionTaskStatusView`:
将 L8-9:
```tsx
import type { SessionTaskStatus, SessionTaskStatusTone } from '../../../../shared/taskStatus';
import { getSessionTaskStatusView } from '../../../../shared/taskStatus';
```
改为:
```tsx
import type { SessionTaskStatus } from '../../../../shared/taskStatus';
```
(`SessionTaskStatusTone` 也只被局部 badge 用,删。)

2d. 从 L2 的 lucide-react 导入里删 `AlertCircle`(局部 badge 删后唯一用处没了;`Check`/`Loader2` 仍被 rename 按钮 / isProcessing spinner 用,保留)。L2 改为:
```tsx
import { Check, Edit2, Loader2, Trash2, X } from 'lucide-react';
```

- [ ] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: PASS(无报错;`SessionTaskStatusTone` / `AlertCircle` / `getSessionTaskStatusView` 的未用引用已清)。

- [ ] **Step 4: build**

Run: `npm run build`
Expected: PASS(vite build + tsc server 都过)。

- [ ] **Step 5: commit**

```bash
git add src/shared/SessionTaskStatusBadge.tsx src/components/sidebar/view/subcomponents/SidebarSessionItem.tsx
git commit -m "refactor(shared): 抽出 SessionTaskStatusBadge 到 shared (REQ-025)"
```

(此 task 是纯抽离 + 给 badge 加 i18n;SidebarSessionItem 行为暂不变 —— isActive 点 / isProcessing 灰底在 Task 2 删。)

---

## Task 2:统一 SidebarSessionItem 状态视觉(删冗余信号)

**Files:**
- Modify: `src/components/sidebar/view/subcomponents/SidebarSessionItem.tsx`

- [ ] **Step 1: 删 isActive 绿点逻辑**

删 L123:
```tsx
const showRecentIndicator = !isProcessing && sessionView.isActive;
```

删 L161-171(return 内最前面的 `showRecentIndicator` 绿点 Tooltip 块):
```tsx
{showRecentIndicator && (
  <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 transform">
    <Tooltip content={t('tooltips.activeSessionIndicator')} position="right">
      <div
        role="status"
        aria-label={t('tooltips.activeSessionIndicator')}
        className="h-2 w-2 animate-pulse rounded-full bg-green-500"
      />
    </Tooltip>
  </div>
)}
```

(整块删;`<div className="group relative">` 外壳保留。)

- [ ] **Step 2: mobile 变体 —— 删 isProcessing 灰底 + isActive green 描边 + 独立 Loader2**

L175-183 的 mobile container className(当前):
```tsx
className={cn(
  'p-2 mx-3 my-0.5 rounded-md bg-card border active:scale-[0.98] transition-all duration-150 relative',
  isSelected ? 'bg-primary/5 border-primary/20' : '',
  !isSelected && isProcessing
    ? 'border-border/60 bg-muted/20'
    : !isSelected && sessionView.isActive
    ? 'border-green-500/30 bg-green-50/5 dark:bg-green-900/5'
    : 'border-border/30',
)}
```
改为(只留 selected + default):
```tsx
className={cn(
  'p-2 mx-3 my-0.5 rounded-md bg-card border active:scale-[0.98] transition-all duration-150 relative',
  isSelected ? 'bg-primary/5 border-primary/20' : 'border-border/30',
)}
```

L199-209 的 mobile `isProcessing ? Loader2 : age`(当前):
```tsx
{isProcessing ? (
  <span className="ml-auto flex-shrink-0">
    <Tooltip content={t('tooltips.processingSessionIndicator', 'Processing session')} position="top">
      <span className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
      </span>
    </Tooltip>
  </span>
) : compactSessionAge && (
  <span className="ml-auto flex-shrink-0 text-[11px] text-muted-foreground">{compactSessionAge}</span>
)}
```
改为(永远显示 age):
```tsx
{compactSessionAge && (
  <span className="ml-auto flex-shrink-0 text-[11px] text-muted-foreground">{compactSessionAge}</span>
)}
```

L217 mobile badge(当前):
```tsx
<SessionTaskStatusBadge status={taskStatus} />
```
改为(isProcessing 时强制 running):
```tsx
<SessionTaskStatusBadge status={isProcessing ? 'running' : taskStatus} />
```

- [ ] **Step 3: desktop 变体 —— 同样处理**

L239-247 的 desktop Button className(当前):
```tsx
className={cn(
  'h-auto w-full justify-start rounded-md border bg-card p-2 text-left font-normal transition-all duration-150',
  isSelected ? 'border-primary/20 bg-primary/5' : 'border-border/30',
  !isSelected && isProcessing
    ? 'border-border/60 bg-muted/20 hover:bg-muted/25'
    : !isSelected && sessionView.isActive
      ? 'border-green-500/30 bg-green-50/5 hover:bg-green-50/10 dark:bg-green-900/5 dark:hover:bg-green-900/10'
      : 'hover:bg-accent/50',
)}
```
改为:
```tsx
className={cn(
  'h-auto w-full justify-start rounded-md border bg-card p-2 text-left font-normal transition-all duration-150',
  isSelected ? 'border-primary/20 bg-primary/5' : 'border-border/30 hover:bg-accent/50',
)}
```

L262-284 的 desktop `isProcessing ? Loader2 : age`(当前带 opacity 过渡):
```tsx
{isProcessing ? (
  <span
    className={cn(
      'ml-auto flex-shrink-0 transition-opacity duration-200',
      isEditing ? 'opacity-0' : 'group-hover:opacity-0',
    )}
  >
    <Tooltip content={t('tooltips.processingSessionIndicator', 'Processing session')} position="top">
      <span className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
      </span>
    </Tooltip>
  </span>
) : compactSessionAge && (
  <span
    className={cn(
      'ml-auto flex-shrink-0 text-[11px] text-muted-foreground transition-opacity duration-200',
      isEditing ? 'opacity-0' : 'group-hover:opacity-0',
    )}
  >
    {compactSessionAge}
  </span>
)}
```
改为(age 永远显示,保留 hover 渐隐):
```tsx
{compactSessionAge && (
  <span
    className={cn(
      'ml-auto flex-shrink-0 text-[11px] text-muted-foreground transition-opacity duration-200',
      isEditing ? 'opacity-0' : 'group-hover:opacity-0',
    )}
  >
    {compactSessionAge}
  </span>
)}
```

L288 desktop badge(当前):
```tsx
<SessionTaskStatusBadge status={taskStatus} />
```
改为:
```tsx
<SessionTaskStatusBadge status={isProcessing ? 'running' : taskStatus} />
```

- [ ] **Step 4: 清未用 import**

isProcessing spinner 删后,`Loader2` 不再被引用。L2 改为:
```tsx
import { Check, Edit2, Trash2, X } from 'lucide-react';
```
(`Check` 仍用于 rename 保存按钮 L327。)

`isProcessing` prop 保留(仍用于 delete 按钮 gating L221 `!isProcessing` 与 L352 `!isProcessing`)—— 不删。

- [ ] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 6: build**

Run: `npm run build`
Expected: PASS。

- [ ] **Step 7: commit**

```bash
git add src/components/sidebar/view/subcomponents/SidebarSessionItem.tsx
git commit -m "refactor(sidebar): 统一 session 行状态视觉,删冗余信号 (REQ-025)"
```

---

## Task 3:统一 SidebarContent 顶层 Sessions 列表

**Files:**
- Modify: `src/components/sidebar/view/subcomponents/SidebarContent.tsx` L389-449(顶层 Sessions 列表行)

- [ ] **Step 1: 加 import**

文件顶部 import 区(L7 附近已有 `getSessionTaskStatusView` from taskStatus)加:
```tsx
import SessionTaskStatusBadge from '../../../../../shared/SessionTaskStatusBadge';
```
(路径核对:SidebarContent 在 `src/components/sidebar/view/subcomponents/`,与 SidebarSessionItem 同目录,故同样 4 个 `..`。)

- [ ] **Step 2: 删 emerald/primary 行底分支 + emerald 脉冲点 + primary 实心胶囊,改用共享 badge**

L389-447 当前整段 `conversationListItems.map(({ project, session }) => { ... })` 的返回 button。改动点:

2a. L394-396 当前 status 计算:
```tsx
const statusView = getSessionTaskStatusView(
  projectListProps.activeSessions.get(session.id)?.taskStatus ?? completion?.status ?? 'idle',
);
```
改为(保留 statusView 给后续可能用,另存 raw status 给 badge):
```tsx
const status: SessionTaskStatus =
  projectListProps.activeSessions.get(session.id)?.taskStatus ?? completion?.status ?? 'idle';
const statusView = getSessionTaskStatusView(status);
```
(`SessionTaskStatus` type 需 import:在 L7 的 taskStatus import 上,把 `getSessionTaskStatusView` 那行补上 type:`import { getSessionTaskStatusView } from '../../../../shared/taskStatus';` 改为 `import { getSessionTaskStatusView } from '../../../../shared/taskStatus'; import type { SessionTaskStatus } from '../../../../shared/taskStatus';`。或合并:`import { getSessionTaskStatusView, type SessionTaskStatus } from '../../../../shared/taskStatus';`。)

2b. L404-412 当前 button className(带 emerald + primary 分支):
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
改为(只留 selected + default;`isProcessing`/`isCompleted` 视觉交给 badge):
```tsx
className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
  isSelected
    ? 'border-primary/25 bg-primary/5'
    : 'border-transparent hover:border-border/60 hover:bg-accent/45'
}`}
```

2c. L415-421 当前 emerald 脉冲点:
```tsx
{isProcessing && (
  <span
    className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-emerald-500"
    aria-label={t('tooltips.processingSessionIndicator', 'Processing session')}
  />
)}
```
整段删。

2d. L426-430 当前 primary 实心胶囊:
```tsx
{statusView.status !== 'idle' && !isProcessing && (
  <span className="flex-shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium leading-none text-primary-foreground">
    {t(`taskStatus.${statusView.status}`, statusView.label)}
  </span>
)}
```
改为(共享 badge;badge 自己处理 idle=null 与 running 显示):
```tsx
<SessionTaskStatusBadge status={status} />
```

- [ ] **Step 3: 清未用变量**

`isCompleted`(L391)const 若此 task 后不再被引用(原来只用于行底分支 2b),删除 L390-391:
```tsx
const completion = completedSessions.get(session.id);
const isCompleted = Boolean(completion);
```
→ 只在 `completion?.status` 被用到时保留 `completion`。检查:`completion` 在 2a status 计算里用到(`completion?.status`),保留 `const completion = completedSessions.get(session.id);`;删 `isCompleted` 那行。

`isProcessing`(L393)若删 L415-421 + 2b 后不再被引用 —— 检查:`isProcessing` 原用于行底(2b,已删)+ 脉冲点(2c,已删)。badge 用的是 `status`(已含 running)。所以 `isProcessing` 现在无用,删 L393 `const isProcessing = projectListProps.activeSessions.has(session.id);`。

(`isSelected` L392 仍用于 2b selected 分支,保留。)

- [ ] **Step 4: typecheck**

Run: `npm run typecheck`
Expected: PASS(若有 "unused variable" 报错,核对 Step 3 清理)。

- [ ] **Step 5: build**

Run: `npm run build`
Expected: PASS。

- [ ] **Step 6: commit**

```bash
git add src/components/sidebar/view/subcomponents/SidebarContent.tsx
git commit -m "refactor(sidebar): 顶层 Sessions 列表状态走共享 badge (REQ-025)"
```

---

## Task 4:统一 SidebarContent 搜索结果

**Files:**
- Modify: `src/components/sidebar/view/subcomponents/SidebarContent.tsx` L308-353(搜索结果 session 行)

- [ ] **Step 1: 删搜索结果的 emerald 脉冲点,改用 badge**

L322-328 当前:
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
改(把 emerald 点换成 badge,放在 MessageSquare 后、summary 后皆可;此处放 summary 后保持原节奏):
```tsx
<div className="mb-1 flex items-center gap-1.5">
  <MessageSquare className="h-3 w-3 flex-shrink-0 text-primary" />
  <span className="truncate text-xs font-medium text-foreground">
    {session.sessionSummary}
  </span>
  <SessionTaskStatusBadge
    status={projectListProps.activeSessions.has(session.sessionId) ? 'running' : 'idle'}
  />
  ...
```
(搜索结果无 completion 上下文,只标 running;idle 时 badge 自渲染 null。原 emerald 点的位置由 badge 接替 —— 视觉上从"行首小点"变"summary 后胶囊",与另两处一致。)

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: PASS(`SessionTaskStatusBadge` 已在 Task 3 import 过,同文件无需重复 import)。

- [ ] **Step 3: build**

Run: `npm run build`
Expected: PASS。

- [ ] **Step 4: lint**

Run: `npm run lint`
Expected: PASS(无未用变量/未用 import)。

- [ ] **Step 5: commit**

```bash
git add src/components/sidebar/view/subcomponents/SidebarContent.tsx
git commit -m "refactor(sidebar): 搜索结果状态走共享 badge (REQ-025)"
```

---

## Task 5:全预检 + dev 手测

**Files:** 无改动,纯验证。

- [ ] **Step 1: 全预检三件套**

Run:
```bash
npm run typecheck && npm run build && npm run lint && git diff --check
```
Expected: 全 PASS,git diff --check 无空格错。

- [ ] **Step 2: 启 dev server 手测三处一致性**

Run(后台):`npm run dev`(worktree 内)。注意:worktree 无独立 node_modules(共享主仓),若 server:dev 报 better-sqlite3 ABI 不符,在**主 worktree** 跑 `npm run sync:node` 再重试(已知坑,见 memory `planrla-desktop-native-abi.md`)。

浏览器开 `http://localhost:5173`,对照 spec 验收标准逐项验:
1. 顶层 Sessions 列表 / Projects 展开 session 行 / 搜索结果 —— 同一 session 同状态视觉一致(blue running / emerald completed / red failed / amber waiting)。
2. running 带 Loader2 转、completed 带 Check、idle 无 badge。
3. 无 emerald 行底 / emerald 脉冲点 / primary 实心胶囊 / isActive 绿点 / isProcessing 灰底。
4. 选中态 primary 描边、running 置顶、completed 通知计数 —— 行为不变。
5. mobile + desktop 视口都看一遍(DevTools 切换)。
6. TaskIndicator(Project 行配置态小圆圈)无变化。

- [ ] **Step 3: 推 feat 分支(为 13 构建做准备)**

```bash
git push -u origin feat/req025-sidebar-status-ui
```

(后续:Archie 验收 → 合并 main → 13 构建 → v0.7.0 发版,独立流程。)

---

## Self-Review

**1. Spec coverage**
- §1 状态映射 → Task 1 共享组件实现 ✓
- §2 单一组件契约 → Task 1 ✓
- §3.1 顶层 Sessions 列表 → Task 3 ✓
- §3.2 SidebarSessionItem(含 status 收敛契约 `isProcessing ? 'running' : taskStatus`)→ Task 2 Step 2/3 ✓
- §3.3 搜索结果 → Task 4 ✓
- §4 删除清单 → Task 2/3/4 各步 ✓
- §5 保留(选中态 / 置顶 / completed 计数 / TaskIndicator 不动)→ Task 2/3 显式保留 + Task 5 验收 ✓
- §6 影响文件 → File Structure ✓
- 验收标准 1-9 → Task 5 Step 2 覆盖功能项;预检三件套覆盖 §8 ✓

**2. Placeholder scan**:无 TBD/TODO;每步有确切代码或命令 ✓

**3. Type 一致性**:
- `SessionTaskStatusBadge` API = `{ status: SessionTaskStatus }` —— Task 1 定义,Task 2/3/4 调用一致 ✓
- `SessionTaskStatus` type import 路径 = `../../../../shared/taskStatus`(从 subcomponents)—— Task 1(SidebarSessionItem)/Task 3(SidebarContent)一致 ✓
- 共享组件 import 路径 = `../../../../shared/SessionTaskStatusBadge` —— Task 1/3 一致(Task 4 同文件,无需重复 import)✓

**4. 风险点**:
- Task 3 Step 3 删 `isProcessing`/`isCompleted` 变量 —— 实施时务必确认无其它引用(grep `isProcessing`/`isCompleted` 在 L389-449 范围内)。
- commit message 全中文起头(避 commitlint subject-case)✓
- worktree 共享主仓 node_modules —— dev server 启动前可能需主仓 `sync:node`(Task 5 Step 2 已注)。
