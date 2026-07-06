---
REQ-ID: REQ-024
title: 合并「对话」与「Running sessions」侧边栏视图
date: 2026-07-06
status: spec
owner: Archie
---

# REQ-024:合并「对话」与「Running sessions」侧边栏视图

## 背景

用户反馈:侧边栏的「对话」(Conversations)和「Running sessions」两个 tab 感觉重复。

代码探索结论(打破「两套数据」的前提):

- 后端只有一张 `sessions` 表(`server/modules/database/schema.ts:82-103`),前端只有一个 session 消息 store(`useSessionStore.ts`)。
- 「对话」tab = 扁平列出**全部** session(`SidebarContent.tsx:339` 的 `searchMode === 'conversations'` 分支)。
- 「Running」tab = 同一批 session 里**当前正在跑**的子集(`SidebarContent.tsx:425` 的 `searchMode === 'running'` 分支),数据来自 in-memory 的 `processingSessions` / `chatRunRegistry`,刻意不持久化。
- 一个正在跑的 session 会**同时**出现在两个 tab 里 → 重复感的根源。
- 次要根源:i18n 里 `Conversations`/「对话」与 `Sessions`/「会话」混用(11 种语言)。

所以这不是「合并两套数据模型」(数据层是干净的、刻意为之的),而是**收敛 UI 视图 + 统一术语**。数据层不动。

## 目标

1. 消除重复感:一个正在跑的 session 不再出现在两个 tab。
2. 保留「一眼看到在跑啥」的能力(原 Running tab 的核心价值)。
3. 统一术语为「会话」/ Sessions,消除对话/会话混用。

## 范围

### 在范围内

- `SidebarSearchMode` 类型:`'conversations'` → `'sessions'`,删 `'running'`。
- `SidebarHeader`:删 Running 按钮(桌面 + 移动),四档 → 三档(Projects / 会话 / 归档)。
- `SidebarContent`:删 `searchMode === 'running'` 分支;`sessions` 分支承担合并列表,加 running 置顶排序 + running 视觉标识。
- i18n:统一术语,清理 dead key(11 种语言)。

### 不在范围内(YAGNI)

- **Projects tab 不动**:保持现有 `activeSessions` 行为(已有 `SidebarSessionItem` 的 processing 视觉)。
- **Archived tab 不动**。
- **数据层不动**:`sessions` 表、`useSessionStore`、`processingSessions`/`activeSessions` Map、`chatRunRegistry`、`/api/providers/sessions/running` 5s 轮询(`AppContent.tsx:92-133`)全部保留——合并后的列表复用这些作数据源。
- **后端不动**:无 schema 变更、无 API 变更、无 provider 协议变更。

## 设计

### 1. 信息架构(合并后)

侧边栏搜索模式:

```
现状:  projects | conversations | running | archived   (四档)
合并:  projects | sessions        |        | archived   (三档)
```

「会话」tab = 原 Conversations(全量扁平 + 搜索)+ 原 Running 的能力(运行中突出显示)。

### 2. 类型层(`src/components/sidebar/types/types.ts:5`)

```ts
// 现状
export type SidebarSearchMode = 'projects' | 'conversations' | 'running' | 'archived';
// 合并后
export type SidebarSearchMode = 'projects' | 'sessions' | 'archived';
```

连锁改动:所有 `searchMode === 'conversations'` → `'sessions'`、删所有 `'running'` 比较。typecheck 兜底——漏改必编译失败,可安全发现。

### 3. UI 层

#### 3.1 `SidebarHeader.tsx`(桌面 `:140-203` + 移动 `:277-349`)

- 删 Running 按钮(桌面 `:164-186` + 移动 `:311-334`),含 `Activity` 图标 + emerald 计数徽标。
- Conversations 按钮 → 「会话」按钮:
  - `onSearchModeChange('conversations')` → `('sessions')`。
  - 图标保持 `MessageSquare`(不换)。
  - 文案 `t('search.modeConversations')` → `t('search.modeSessions')`。
  - **徽标承载**:`completed` 徽标保留(primary 色,现有行为);新增 `running` 计数徽标(emerald 色,从 Running 按钮迁移),当 `runningSessionsCount > 0` 时显示。两个徽标用不同色 + 不同位置(如 completed 右上、running 左下)避免重叠,具体布局 plan 阶段定。

#### 3.2 `SidebarContent.tsx`

**`conversationListItems` 排序(`:206-214`)——核心改动:**

现状:纯按 `lastActivityTime` 降序。

合并后(running 置顶):

```ts
const conversationListItems = projects
  .flatMap(...)
  .sort((a, b) => {
    const aRunning = activeSessions.has(a.session.id);
    const bRunning = activeSessions.has(b.session.id);
    if (aRunning && bRunning) {
      // 都在跑:晚开始的在前(最新启动的最顶)
      return startedAtOf(b) - startedAtOf(a);
    }
    if (aRunning) return -1;
    if (bRunning) return 1;
    return b.lastActivityTime - a.lastActivityTime; // 都不跑,原逻辑
  });
```

- `activeSessions` 从 `projectListProps.activeSessions` 取(已传入组件)。
- `startedAtOf(x)` = `activeSessions.get(x.session.id)?.startedAt ?? 0`(`SessionActivity.startedAt`,客户端时钟)。
- session 结束(从 `activeSessions` 移除)自动落回时间位,无额外状态管理。

**会话列表项视觉(`:382-421`)——running 高亮:**

现状:行 `:374` 已算 `isProcessing`,但仅用于 `:399-403` 的 taskStatus badge。

合并后,`isProcessing === true` 的行额外:

- 左侧 emerald 点(复用 `SidebarSessionItem:161-171` 的 `showRecentIndicator` 视觉模式:`h-2 w-2 rounded-full bg-green-500`,置顶态用 emerald 强调)。
- 行背景轻微 emerald tint(复用现有 `bg-emerald-500/5` 体系,对齐 Running 按钮的 `ring-emerald-500/15` 色调)。
- 「Running」文字徽标:复用 `:399-403` 的 `statusView` badge(running 状态已是 emerald + 文字),不重复造。

emerald 点 + 现有 statusView badge 已覆盖「置顶 + 徽标」承诺,行 tint 是可选增强(plan 阶段定浓度)。

**删 running 分支(`:425-457`):** 整段移除。

**`showConversationSearch`(`:203`):** `searchMode === 'conversations'` → `'sessions'`。

**搜索结果分支(`:243-338`)的 running 处理:**

搜索结果是 project-grouped 结构,置顶会破坏分组。决策:**搜索时 running 不强制置顶**,但命中的 running session 在其行内显示 emerald 徽标(复用会话列表项的 running 视觉)。理由:搜索是找特定内容,running 置顶意义低;且保持 project 分组结构稳定。(非搜索的会话列表才置顶。)

#### 3.3 `SidebarSessionItem.tsx`

**不改**。Projects tab 仍用此组件,其 `isProcessing` 视觉(`:178-183, :242-247, :262-274`)保持原样。本次合并只动「会话」tab 的内联渲染,不扩散到 Projects tab。

### 4. 数据层(不动,仅复用)

| 数据源 | 用途 | 改动 |
|---|---|---|
| `projectListProps.activeSessions`(`SessionActivityMap`) | 置顶排序 + 徽标数据源 | 只读复用,无改动 |
| `/api/providers/sessions/running` 5s 轮询 | 维持 `activeSessions` 实时性 | 无改动 |
| `chatRunRegistry`(server) | 轮询的源头 | 无改动 |
| `useSessionStore` / `sessions` 表 | session 消息 + 持久化 | 无改动 |
| `useSidebarController`(`:193-194, 994`) | 计算 `runningSessionsCount` | 无改动(保留作「会话」按钮 emerald 徽标数据源) |

### 5. i18n(11 种语言)

#### 5.1 术语统一

- `search.modeConversations` → `search.modeSessions`(值:zh-CN「会话」,en「Sessions」,其他语言对应 session 等价词)。
- 全量扫描 `sidebar.json` / `chat.json` 中 conversation/对话 混用的 key,统一为 session/会话。重点排查:`deleteConfirmation.sessionCount`(现写「N 个对话」)、`sessions.*`。

#### 5.2 dead key 清理(已确认无需清理)

已核实 `en/sidebar.json`:Running 相关文案全部用 `t(key, 'fallback')` 内联默认值(`SidebarHeader.tsx:168` 的 `search.runningTooltip`、`SidebarContent.tsx:432-437` 的 `running.emptyTitle/emptyDescription/noMatchingSessions`),**i18n 文件里无对应 key 定义**。

因此:删 UI 代码即自动删文案,**无需清理 i18n dead key**。其他 10 种语言结构应与 en 一致(plan 阶段抽检 1-2 种确认)。

#### 5.3 执行方式

11 语言批量改动用脚本/统一 key 映射,不逐个手改,避免翻译漂移。具体工具 sed 还是 node 脚本,plan 阶段定。

## 边界决策(已与 Archie 确认)

| 决策点 | 选择 | 备注 |
|---|---|---|
| 合并目标 | 合成一个列表 + 运行态标识 | 不是统一术语了事 |
| 运行态呈现 | 置顶 + emerald 徽标 | 结束自动回原位 |
| 术语 | 统一「会话」/ Sessions | 对齐代码底层 |
| 改动边界 | 路径 2:UI + 类型清理 | 无死代码,符合文件卫生 |
| Projects tab | 不动 | 不扩大范围 |
| 搜索时 running | 不置顶,仅加徽标 | 保持 project 分组结构 |

## 验收标准

1. **类型**:`npm run typecheck` 通过(无 `'conversations'`/`'running'` 残留引用)。
2. **构建**:`npm run build` 通过。
3. **功能**(对照本 spec 手测):
   - 侧边栏只剩三档:Projects / 会话 / 归档,无 Running 按钮。
   - 发起一个新会话发消息 → 该 session 在「会话」tab **置顶** + emerald 标识。
   - 同时发起多个 → 按启动顺序排顶部(最新启动最顶)。
   - session 结束 → 自动落回时间位,emerald 标识消失。
   - 「会话」按钮显示 running 计数徽标(emerald)与 completed 徽标(primary),互不重叠。
   - 搜索时,命中的 running session 显示 emerald 徽标(但不置顶)。
4. **术语**:UI 中「对话」文案统一为「会话」(zh-CN),无 conversation 残留。
5. **回归**:
   - Projects tab 行为不变(运行中 session 仍有现有 processing 视觉)。
   - Archived tab 不变。
   - i18n 切换其他语言,「会话」tab 文案正确、无 dead key 残留导致的 fallback 裸 key。
6. **代码卫生**:无 dead 代码(running 分支、Running 按钮、相关 dead key 全部清理)。

## 风险

| 风险 | 缓解 |
|---|---|
| i18n 11 语言翻译漂移 | 统一 key 映射 + 脚本批量改;改完抽检 2-3 种语言 |
| SidebarSearchMode 改名连锁漏改 | typecheck 兜底,漏改必失败 |
| 「会话」按钮双徽标(completed + running)视觉拥挤 | plan 阶段出具体布局,验收点 3 确认不重叠 |
| 搜索分支 running 处理是边缘情况,可能被忽略 | spec 已明确「搜索仅加徽标不置顶」,plan 覆盖测试 |
| Projects tab 的 `SidebarSessionItem` 与会话列表内联渲染风格不一致(历史遗留) | 本次不统一(超出范围),记为后续可选优化 |

## 影响文件(预估)

| 类别 | 文件 | 改动 |
|---|---|---|
| 类型 | `src/components/sidebar/types/types.ts` | SidebarSearchMode 收敛 |
| UI | `src/components/sidebar/view/subcomponents/SidebarHeader.tsx` | 删 Running 按钮 + 会话按钮双徽标 |
| UI | `src/components/sidebar/view/subcomponents/SidebarContent.tsx` | 删 running 分支 + sessions 分支置顶排序/视觉 |
| i18n | `src/i18n/locales/*/sidebar.json`(×11) | `modeConversations`→`modeSessions` + 排查 conversation 混用 |
| i18n | `src/i18n/locales/*/chat.json`(按需) | conversation → session 文案 |

后端、store、数据层、`useSidebarController`:**0 改动**(running count 计算保留作徽标源)。

## 不做(YAGNI)

- 不重命名 `ProjectSession` / `useSessionStore` / `sessions` 表(底层已是 session,无需动)。
- 不重构 Projects tab 信息架构。
- 不合并 `SidebarSessionItem` 与会话列表内联渲染(历史遗留,超出范围)。
- 不加「只看运行中」的快捷过滤芯片(置顶 + 徽标已满足,避免重新引入 Running tab 的等价物)。
