---
REQ-ID: REQ-025
title: 统一侧边栏 session 状态 UI(Projects / Sessions / 搜索)
date: 2026-07-07
status: spec
owner: Archie
---

# REQ-025:统一侧边栏 session 状态 UI

## 背景

门 2 验收 REQ-024 时 Archie 抓到:同一个 session 的 running / done 状态,在侧边栏不同位置呈现**不一致**的视觉。代码探索定位到根因 ——状态视图层有 **3+ 套 ad-hoc 实现**,没有一处走唯一真相源,且 REQ-024 又新增了 emerald 风格,加剧了分歧。

实证(当前 main,合并 REQ-024 后):

| 位置 | 文件 | running 视觉 | completed 视觉 |
|---|---|---|---|
| 顶层 Sessions 列表 | `SidebarContent.tsx` L389-449 | emerald 行底 + emerald 脉冲点 | primary 行底 + `bg-primary` 实心胶囊 |
| Projects 内 session 行 | `SidebarSessionItem.tsx` | `bg-muted/20` 灰底 + Loader2;另 `isActive` 绿点 + green 描边 | `SessionTaskStatusBadge`(tone 色) |
| 搜索结果 | `SidebarContent.tsx` L323 | `bg-emerald-500` 脉冲点(又一套) | 无 |

同时 `running` 颜色本身就有 3 个值:模型 `taskStatus.ts` 里 `running=info/blue`,`SidebarSessionItem` 的 `isActive`=green,REQ-024 =emerald(且 emerald 与模型的 `completed/success` **撞色**)。

关键发现:`src/shared/taskStatus.ts` 的状态模型本身设计良好(6 状态 × 5 tone,语义正确),`SessionTaskStatusBadge` 也正确实现了它 —— 但被局部定义在 `SidebarSessionItem.tsx` 内,且另两处没用它。问题在视图层未收敛,而非模型。

## 目标

- 全 sidebar 的 session 状态(running / waiting / completed / failed / needs_attention)使用**同一套视觉语言**,三处(顶层 Sessions 列表 / Projects 内 session 行 / 搜索结果)完全一致。
- 以现有 `taskStatus.ts` 模型为唯一真相源,视图层收敛到单一组件。
- 顺手清除冗余信号(isActive 绿点 / isProcessing 灰底 / emerald 行底 / primary 实心胶囊),代码净减。

## 范围

**In scope**
- `src/components/sidebar/view/subcomponents/SidebarContent.tsx`(顶层 Sessions 列表 L389-449 + 搜索结果 L308-353)
- `src/components/sidebar/view/subcomponents/SidebarSessionItem.tsx`(含 mobile `md:hidden` + desktop `hidden md:block` 双变体)
- 新建 `src/shared/SessionTaskStatusBadge.tsx`(从 SidebarSessionItem 抽出)
- 可选:`src/shared/taskStatus.ts` 导出 tone→class 映射

**Out of scope**
- `TaskIndicator.tsx` / `SidebarProjectItem.tsx` 的 **Project 行 TaskMaster/MCP 配置态**(fully-configured / taskmaster-only / mcp-only / not-configured / error)—— 另一概念(配置态,非运行态),不动。
- REQ-024 的 running **置顶排序**行为(位置逻辑,非视觉)—— 已验收,保留。
- `completedSessionsCount` 顶部 "X new" **通知计数**(通知维度,非状态)—— 保留。

## 设计

### §1 状态→视觉映射(全 sidebar 唯一,依 `taskStatus.ts`)

| `SessionTaskStatus` | tone | 图标 | 备注 |
|---|---|---|---|
| `idle` | muted | — | **不显示** badge |
| `running` | info(blue) | `Loader2`(animate-spin) | badge + 置顶(REQ-024 保留) |
| `waiting_for_input` | warning(amber) | `AlertCircle` | badge |
| `completed` | success(emerald) | `Check` | badge,仅通知窗口内(见 §5) |
| `failed` | danger(red) | `AlertCircle` | badge |
| `needs_attention` | warning(amber) | `AlertCircle` | badge |

tone→className:`{ muted: bg-muted, info: blue-500/10, warning: amber-500/10, success: emerald-500/10, danger: red-500/10 }`(沿用现 `SidebarSessionItem` 内的 `taskStatusBadgeClassNames`)。

### §2 单一组件契约

新建 `src/shared/SessionTaskStatusBadge.tsx`,把 `SidebarSessionItem.tsx` L66-98 的局部 `SessionTaskStatusBadge` + `taskStatusBadgeClassNames` **整体提到此处**,与 `taskStatus.ts` 配对。

API:
```tsx
type Props = { status: SessionTaskStatus; size?: 'sm' | 'xs'; };
export default function SessionTaskStatusBadge({ status, size = 'sm' }: Props): JSX.Element | null;
```
- `status === 'idle'` → 返回 `null`(不渲染)
- 否则渲染胶囊(`Loader2` running 时 spin)+ i18n label(`t('taskStatus.<status>')` 或 statusView.label 兜底)

**每行 status 来源**(三处统一):
```ts
const status: SessionTaskStatus =
  activeSessions.get(id)?.taskStatus        // running / waiting_for_input
  ?? completion?.status                      // recently completed/failed/...
  ?? 'idle';
```
(即顶层 Sessions 列表现有写法 L394-396 的泛化。)

### §3 三处应用

1. **顶层 Sessions 列表**(`SidebarContent.tsx` L389-449)
   - 删:emerald 行底 `border-emerald-500/30 bg-emerald-500/5`、emerald 脉冲点、`bg-primary` 实心状态胶囊(L427-430)、`isProcessing`/`isCompleted` 驱动的行底分支(L407-411)
   - 改:行底仅留 `selected` primary 描边;状态走 `<SessionTaskStatusBadge status={status} />`
   - 留:running 置顶排序(L215-227)、`completedSessionsCount` 顶部 "X new" 计数(L380-387)

2. **Projects 内 session 行**(`SidebarSessionItem.tsx`,mobile + desktop 双变体)
   - 删:`showRecentIndicator`(isActive 绿点 L161-171)、`isProcessing` 灰底 + 独立 Loader2(L199-209 / L262-274)、`isActive` green 描边(L180-182 / L244-246)、局部 `SessionTaskStatusBadge` + `taskStatusBadgeClassNames` 定义(L66-98)
   - 改:import 共享 `SessionTaskStatusBadge`;行底仅留 `selected` primary 描边
   - **status 收敛契约**:`isProcessing` 与 `taskStatus` 不再各自驱动视觉。显示用的 status 统一为 `isProcessing ? 'running' : (taskStatus ?? 'idle')`(parent 传入的 `taskStatus` 在非 processing 时承载 completed/failed/…)。`isProcessing` prop **保留**,但仅用于非视觉逻辑(delete 按钮 gating:`!isProcessing` 才显示删除),不再驱动任何状态视觉。
   - 留:rename/edit/delete 按钮组、messageCount badge、provider logo、age

3. **搜索结果**(`SidebarContent.tsx` L308-353)
   - 删:`bg-emerald-500` 脉冲点(L323-328)
   - 改:running 命中走 `<SessionTaskStatusBadge status={activeSessions.has(id) ? 'running' : 'idle'} />`(搜索结果无 completion 上下文,只标 running)

### §4 删除清单(净减)

- `SidebarSessionItem`:`isActive` 绿点逻辑 + green 描边 + isProcessing 灰底 + 独立 Loader2 + 局部 badge 定义
- `SidebarContent` 顶层列表:emerald 行底 + emerald 脉冲点 + primary 实心胶囊 + isProcessing/isCompleted 行底分支
- `SidebarContent` 搜索结果:emerald 脉冲点

新增仅 `src/shared/SessionTaskStatusBadge.tsx`(从 SidebarSessionItem 搬运,非净增)。预计净减代码行数。

### §5 边角与保留

- **选中态**:各处保留 primary 描边/底(是"选择"非"状态")。
- **running 置顶**:REQ-024 已验收的位置逻辑,不动。
- **completed 时效**:`completedSessions` 是通知窗口内的"最近完成/未读";清除后 status 回 `idle` → 无 badge。避免每个老 session 永久挂绿勾。
- **idle**:无 badge,行恢复默认(仅 selection 区分)。
- **mobile + desktop**:`SidebarSessionItem` 双变体同步改,样式一致。
- **i18n**:badge label 走 `taskStatus.<status>` 翻译键(已存在;缺则 statusView.label 兜底)。

### §6 影响文件

| 文件 | 动作 |
|---|---|
| `src/shared/SessionTaskStatusBadge.tsx` | 新建(从 SidebarSessionItem 抽出) |
| `src/shared/taskStatus.ts` | 可选:导出 `taskStatusBadgeClassNames` 供组件复用 |
| `src/components/sidebar/view/subcomponents/SidebarContent.tsx` | 改:顶层列表 + 搜索结果两处 |
| `src/components/sidebar/view/subcomponents/SidebarSessionItem.tsx` | 改:删冗余信号 + import 共享 badge |

## 验收标准

1. **三处一致**:同一 session 的同一状态(running / completed / failed / waiting),在【顶层 Sessions 列表】【Projects 内 session 行】【搜索结果】三处视觉**完全一致**(同色、同图标、同胶囊形状)。
2. **状态映射正确**:running=blue+Loader2 转、completed=emerald+Check、failed=red+AlertCircle、waiting_for_input=amber+AlertCircle、idle=无 badge。
3. **状态信号单一来源**:三处 session 行的状态视觉**仅**来自 `<SessionTaskStatusBadge>`。具体移除:`SidebarContent` 顶层列表的 emerald 行底/emerald 脉冲点/`bg-primary` 实心胶囊/isProcessing·isCompleted 行底分支;搜索结果的 emerald 脉冲点;`SidebarSessionItem` 的 `isActive` 绿点 + green 描边 + isProcessing 灰底 + 独立 Loader2。(archive 区的 emerald 恢复按钮、其他非状态用途的 emerald 不动。)
4. **保留行为**:选中态 primary 描边、running 置顶、completed 通知计数、"X new" 顶部计数 —— 行为不变。
5. **单一组件**:`SessionTaskStatusBadge` 位于 `src/shared/`,三处 import 同一组件,无重复定义。
6. **双变体**:mobile(`md:hidden`)与 desktop(`hidden md:block`)session 行状态视觉一致。
7. **TaskIndicator 不动**:Project 行 TaskMaster 配置态视觉无变化。
8. **预检三件套过**:`npm run typecheck && npm run build && git diff --check` 全过。
9. **回归**:Projects 展开/折叠、session 选择、rename/delete、搜索流程 不受影响。

## 不在范围(后续可选)

- Project 行 `TaskIndicator` 与 session 状态的视觉关系(若后续 Archie 觉得配置态也该统一,另开需求)。
- `SidebarContent.tsx` 文件超 500 行基线(REQ-024 时已记录,可独立 refactor backlog)。
