# planrla 看板 W4-前端 实施计划:原生 kanban 看板 UI

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps use checkbox (`- [ ]`)。

**Goal:** 为 W4-backend 交付的 kanban 自驱闭环补上前端——一个默认 tab 的原生看板,按项目(rootId)展示多阶段任务流,实时(WS)反映 agent 进度与 aux 徽章,支持从模板建任务、阶段推进(next/prev/jump/pause/resume/complete/cancel),以及模板 CRUD 编辑器。

**Architecture:** `KanbanContext`(任务列表 state + 按 rootId 拉取 + WS 订阅 `kanban-task-updated` upsert + reconnect 重取)+ `KanbanPanel`(keep-alive tab,套在 WebSocketProvider 内)+ `Board`(按模板 stages 渲染列,按 task.currentStageIndex 分桶)+ `TaskCard`(状态/aux 徽章)+ `TaskDetailModal`(阶段操作 + aux + stage run)+ `TaskTemplateEditor`(模板 CRUD,调 `/api/tasks/templates`)。前端**重声明**kanban 类型(不可跨 tsconfig import server)。rootId = `selectedProject.projectId`。

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind 3.4(CSS variable tokens,dark=`class`)+ react-router v6(仅 2 路由,tab 纯 state)+ lucide-react + 既有 `src/shared/view/ui` 原语(shadcn 风格)+ `src/utils/api.js` + `useWebSocket()`。

**基于:** `docs/superpowers/specs/2026-07-11-planrla-kanban-iteration-design.md` + W4-backend 已交付 API(`kanban.routes.ts` + `mcp.route.ts`)+ 前端摸底报告(explore,会话内)。

---

## 关键决策(基于 explore + W4-backend 实际 API)

1. **默认 tab,不需 opt-in**(spec:默认,不需装 CLI)。区别于 TaskMaster 的 `tasksEnabled && isTaskMasterInstalled` 条件——kanban tab **无条件**显示(只要 kanban 后端在,后端是 planrla 自带)。AppTab 加 `'kanban'`,`MainContentTabSwitcher.tsx` 的 `builtInTabs` 直接展开 `KANBAN_TAB`(无 shouldShow 门)。
2. **rootId = `selectedProject.projectId`**(W4-backend 已确认 `assembly.ts:36` `resolveRootPath = projectsDb.getProjectPathById`;前端 `useProjectsState().selectedProject.projectId` 即 rootId)。rootId 变 → 重取 `GET /api/tasks?rootId=`。
3. **WS 实时**:`useWebSocket().subscribe` 过滤 `event.type === 'kanban-task-updated' && event.rootId === currentRootId` → upsert task 到列表;`event.kind === 'websocket_reconnected'` → 重取全量(防丢 delta)。
4. **类型重声明**:在 `src/components/kanban/types.ts` 复制 server `Task/StageTemplate/TaskTemplate/TaskAuxFlags/TaskStatus/StageStatus` 的字段子集(wire-compatible,字段名一致)。前端 tsconfig 不含 `server/`,不能 import。
5. **keep-alive tab**:参照 `MainContent.tsx:203` TaskMaster 的 `<KanbanPanel isVisible={activeTab==='kanban'} />` + 内部 `isVisible ? 'block' : 'hidden'`,WS 订阅/状态在 tab 切换时不卸载。
6. **Board 列 = 模板 stages**:一个 Task 的列位置由 `task.currentStageIndex` 决定(它在哪个阶段就显示在哪列)。列标题/stage 配置从 `task.taskTemplateId` 关联的 `TaskTemplate.stages[].snapshot` 取。为避免每个 task 都拉模板,Board 顶部拉一次 `GET /api/tasks/templates` 缓存模板 map by id(同 rootId 内模板集稳定)。
7. **阶段操作走 REST**(非 MCP——MCP 是给 agent 自驱的;UI 操作走 `/api/tasks/:taskId/next|prev|...`)。body 带 `{rootId}`。
8. **aux 徽章**:TaskCard 上画 `askUserWaiting`(待答复)/`hasPlan`(有计划)/`hasTodos`(有TODO)/`hasTask`(子任务)/`sessionError`(错误)。参照 `task-master/view/TaskCard.tsx` 的 status→`{icon,color}` 映射 idiom。
9. **不破坏 TaskMaster**:TaskMaster tab 保持原样(opt-in 条件不变)。kanban 是新增独立 tab。两套 UI 不共享组件(全新 `src/components/kanban/`)。
10. **cron + webhook 本 plan 不含**(转独立 plan,同 W4-backend 切分)。前端只消费现有 REST + WS。

## 关键接口(W4-backend 实测,前端消费)

REST(挂 `/api/tasks`,带 `authenticateToken`):
- `GET /api/tasks?rootId=<projectId>` → `{tasks: Task[]}`
- `POST /api/tasks` body `{rootId, taskTemplateId, input}` → `{task: Task}`(+ WS 广播)
- `POST /api/tasks/:taskId/{next,prev,pause,resume,complete,cancel,fail}` body `{rootId}` → `{task}`
- `POST /api/tasks/:taskId/jump` body `{rootId, targetIndex}` → `{task}`
- `GET /api/tasks/templates` → `{templates: TaskTemplate[]}`
- `GET /api/tasks/templates/:id` → `{template}`;`POST /api/tasks/templates` body `TaskTemplate` → `{template}`;`DELETE /api/tasks/templates/:id` → `{ok:true}`

WS(由 server `broadcastTaskUpdated` 推):`{type:'kanban-task-updated', rootId, task: Task, timestamp}`

类型(前端重声明,字段对齐 server `server/modules/kanban/types.ts`):
- `TaskStatus = 'pending'|'queued'|'running'|'waiting_user'|'paused'|'success'|'fail'|'cancelled'`
- `StageStatus = 'pending'|'running'|'waiting_user'|'success'|'fail'|'cancelled'|'approved'|'rejected'`
- `TaskAuxFlags = {askUserWaiting, hasPlan, hasTodos, hasTask: boolean; sessionError?: string}`
- `StageTemplate = {id,name,role:'user'|'agent',autoAdvance,agent?,model?,mode?,effort?,planMode?,promptTemplate?,agentCanControlStage?,sessionReusePolicy?,...}`
- `TaskTemplateStage = {id, position, snapshot: StageTemplate}`
- `TaskTemplate = {id,name,description?,maxConcurrency,stages: TaskTemplateStage[],...}`
- `Task = {id,taskNumber,rootId,taskTemplateId,taskTemplateName?,createWorktree,currentStageIndex,status,schedulerAdmitted,labels:string[],auxFlags:TaskAuxFlags,worktreePath?,...}`

## File Structure

| 文件 | 职责 |
|---|---|
| `src/components/kanban/types.ts` | 重声明 kanban 类型(wire-compatible) |
| `src/components/kanban/api.ts` | `api.kanban = {listTasks, createTask, move, jump, listTemplates, getTemplate, saveTemplate, deleteTemplate}` 封装 `src/utils/api.js` |
| `src/components/kanban/KanbanContext.tsx` | Provider:tasks state、currentRootId、WS 订阅 upsert、reconnect 重取、actions(create/move/jump)调 api + 乐观/重取 |
| `src/components/kanban/KanbanPanel.tsx` | tab 容器(isVisible keep-alive),根布局:无项目→空态;有→ Board + 顶栏(建任务按钮) |
| `src/components/kanban/Board.tsx` | 横向列(模板 stages)+ 任务卡分桶(by currentStageIndex);WS 驱动重渲染 |
| `src/components/kanban/StageColumn.tsx` | 单列(stage 名 + 角色徽章 + 任务卡列表) |
| `src/components/kanban/TaskCard.tsx` | 单任务卡(状态色 + aux 徽章 + 点击开 detail) |
| `src/components/kanban/TaskDetailModal.tsx` | 任务详情 + 阶段操作(next/prev/jump/pause/resume/complete/cancel)+ aux + stage run 摘要 |
| `src/components/kanban/TaskTemplateEditor.tsx` | 模板列表 + 创建/编辑(stage 增删 + agent/model/mode/prompt/planMode/autoAdvance)+ 保存/删除 |
| `src/components/kanban/CreateTaskDialog.tsx` | 从模板建任务(选模板 + input) |
| `src/components/kanban/badges.tsx` | aux 徽章 + 状态→样式 映射工具 |
| `src/components/kanban/index.ts` | barrel:export `KanbanPanel` |

修改:
| 文件 | 改动 |
|---|---|
| `src/types/app.ts:8` | `AppTab` 加 `'kanban'` |
| `src/components/main-content/view/subcomponents/MainContentTabSwitcher.tsx` | 加 `KANBAN_TAB`,无条件展开进 `builtInTabs`(或加 `shouldShowKanbanTab` prop 恒 true) |
| `src/components/main-content/types/types.ts` + `MainContentHeader.tsx` | 若 tab switcher 需要 prop 透传,加 `shouldShowKanbanTab` |
| `src/components/main-content/view/MainContent.tsx` | 加 reset-fallback + `<KanbanPanel isVisible={activeTab==='kanban'} />` 内容分支 |
| `src/App.tsx` | 套 `<KanbanProvider>`(在 WebSocketProvider 内) |
| `src/i18n/locales/*/common.json` | 加 `tabs.kanban` + kanban 命名空间 key(en/zh 至少) |

## 约定

- 前端 import 用相对路径或 `@/`(=`src/`);无 `.js` 后缀(前端 tsconfig 不需)。UI 原语从 `src/shared/view/ui` barrel 导入。
- `cn()` from `src/lib/utils.js`。Tailwind token 类(`bg-card`/`text-muted-foreground`/`border-border`),状态色用 dark pair(`X dark:Y`),参照 `task-master/view/TaskCard.tsx`。
- Context+hook 模式参照 `src/contexts/TasksSettingsContext.jsx`。
- API 返回**raw Response**;调用方 `await res.json()` + 检查 `res.ok`。
- typecheck 前端:`npx tsc --noEmit -p tsconfig.json`(从 worktree 根)。
- commit conventional,尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 文件 ≤500 行。

---

## Task 1: 类型重声明 + api 封装 + i18n key

**Files:**
- Create: `src/components/kanban/types.ts`
- Create: `src/components/kanban/api.ts`
- Modify: `src/i18n/locales/en/common.json` + `src/i18n/locales/zh/common.json`(加 `tabs.kanban`)

### 步骤 0:Read `server/modules/kanban/types.ts`(确认字段) + `src/utils/api.js`(看 `api.taskmaster` 段作 `api.kanban` 模板) + 任一 `src/i18n/locales/*/common.json`(看 `tabs` 段结构)。

### 步骤 1:`src/components/kanban/types.ts`(重声明,与 server wire-compatible)

```typescript
// Wire-compatible redeclaration of server/modules/kanban/types.ts (frontend can't import server/).
// Keep field names identical to the JSON the /api/tasks endpoints return.

export type TaskStatus =
  | 'pending' | 'queued' | 'running' | 'waiting_user'
  | 'paused' | 'success' | 'fail' | 'cancelled';

export type StageStatus =
  | 'pending' | 'running' | 'waiting_user'
  | 'success' | 'fail' | 'cancelled' | 'approved' | 'rejected';

export type SessionReusePolicy = 'task_main' | 'same_stage' | 'always_new';

export interface TaskAuxFlags {
  askUserWaiting: boolean;
  hasPlan: boolean;
  hasTodos: boolean;
  hasTask: boolean;
  sessionError?: string;
}

export interface StageTemplate {
  id: string;
  name: string;
  role: 'user' | 'agent';
  autoAdvance: boolean;
  agent?: string;
  model?: string;
  mode?: string;
  effort?: string;
  planMode?: boolean;
  promptTemplate?: string;
  sessionReusePolicy?: SessionReusePolicy;
  agentCanControlStage?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface TaskTemplateStage {
  id: string;
  position: number;
  snapshot: StageTemplate;
}

export interface TaskTemplate {
  id: string;
  name: string;
  description?: string;
  maxConcurrency: number;
  stages: TaskTemplateStage[];
  createdAt?: string;
  updatedAt?: string;
}

export interface Task {
  id: string;
  taskNumber: number;
  rootId: string;
  taskTemplateId: string;
  taskTemplateName?: string;
  createWorktree: boolean;
  worktreePath?: string;
  worktreeBranch?: string;
  currentStageIndex: number;
  status: TaskStatus;
  schedulerAdmitted: boolean;
  mainSessionKey?: string;
  labels: string[];
  auxFlags: TaskAuxFlags;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface TaskListResponse { tasks: Task[] }
export interface TaskResponse { task: Task }
export interface TemplateListResponse { templates: TaskTemplate[] }
export interface TemplateResponse { template: TaskTemplate }
```

### 步骤 2:`src/components/kanban/api.ts`(封装 `api.get/post`)

```typescript
import { api } from '@/utils/api';
import type {
  Task, TaskTemplate, TaskListResponse, TaskResponse,
  TemplateListResponse, TemplateResponse,
} from './types';

export const kanbanApi = {
  listTasks: async (rootId: string): Promise<Task[]> => {
    const res = await api.get(`/tasks?rootId=${encodeURIComponent(rootId)}`);
    if (!res.ok) throw new Error(`listTasks failed: ${res.status}`);
    const data = (await res.json()) as TaskListResponse;
    return data.tasks;
  },
  createTask: async (rootId: string, taskTemplateId: string, input: string): Promise<Task> => {
    const res = await api.post('/tasks', { rootId, taskTemplateId, input });
    if (!res.ok) throw new Error(`createTask failed: ${res.status}`);
    const data = (await res.json()) as TaskResponse;
    return data.task;
  },
  move: async (taskId: string, rootId: string, action: string): Promise<Task> => {
    const res = await api.post(`/tasks/${taskId}/${action}`, { rootId });
    if (!res.ok) throw new Error(`move ${action} failed: ${res.status}`);
    const data = (await res.json()) as TaskResponse;
    return data.task;
  },
  jump: async (taskId: string, rootId: string, targetIndex: number): Promise<Task> => {
    const res = await api.post(`/tasks/${taskId}/jump`, { rootId, targetIndex });
    if (!res.ok) throw new Error(`jump failed: ${res.status}`);
    const data = (await res.json()) as TaskResponse;
    return data.task;
  },
  listTemplates: async (): Promise<TaskTemplate[]> => {
    const res = await api.get('/tasks/templates');
    if (!res.ok) throw new Error(`listTemplates failed: ${res.status}`);
    const data = (await res.json()) as TemplateListResponse;
    return data.templates;
  },
  getTemplate: async (id: string): Promise<TaskTemplate> => {
    const res = await api.get(`/tasks/templates/${id}`);
    if (!res.ok) throw new Error(`getTemplate failed: ${res.status}`);
    const data = (await res.json()) as TemplateResponse;
    return data.template;
  },
  saveTemplate: async (tpl: TaskTemplate): Promise<TaskTemplate> => {
    const res = await api.post('/tasks/templates', tpl);
    if (!res.ok) throw new Error(`saveTemplate failed: ${res.status}`);
    const data = (await res.json()) as TemplateResponse;
    return data.template;
  },
  deleteTemplate: async (id: string): Promise<void> => {
    const res = await api.delete(`/tasks/templates/${id}`);
    if (!res.ok) throw new Error(`deleteTemplate failed: ${res.status}`);
  },
};
```

(确认 `src/utils/api.js` 的 `api` 导出名 + `get/post/delete` 签名——explore 报告说是 `api.get(endpoint)` 返回 raw Response,`endpoint` 是 `/api` 之后的部分。Read 文件确认;若 `api` 不是 named export 而是 default,改 import。)

### 步骤 3:i18n `tabs.kanban`

在每个 `src/i18n/locales/*/common.json` 的 `tabs` 段加 `"kanban": "Kanban"`(en)/`"kanban": "看板"`(zh)。Read 现有 `tabs` 段确认 key 位置(en/common.json:20 附近)。

### 步骤 4:typecheck + commit

```bash
npx tsc --noEmit -p tsconfig.json
git -C D:/workspace/projects/ai/apps/planrla/.claude/worktrees/kanban-w1 add src/components/kanban/types.ts src/components/kanban/api.ts src/i18n/locales/
git -C D:/workspace/projects/ai/apps/planban-w1 commit... (用 worktree 绝对路径)
```
（用 `git -C D:/workspace/projects/ai/apps/planrla/.claude/worktrees/kanban-w1 commit -m "feat(kanban-ui): add types, api client, i18n" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`）

---

## Task 2: KanbanContext + WS 订阅

**Files:**
- Create: `src/components/kanban/KanbanContext.tsx`

### 步骤 0:Read `src/contexts/WebSocketContext.tsx`(确认 `subscribe` 签名 + `ServerEvent` 形态)+ `src/contexts/TasksSettingsContext.jsx`(Context+hook 模板)+ `src/hooks/useProjectsState.ts`(`selectedProject` 取法)。

### 步骤 1:`KanbanContext.tsx`

```typescript
import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { kanbanApi } from './api';
import type { Task, TaskTemplate } from './types';

interface KanbanContextValue {
  tasks: Task[];
  templates: TaskTemplate[];
  templatesById: Map<string, TaskTemplate>;
  loading: boolean;
  error: string | null;
  rootId: string | null;
  refresh: () => Promise<void>;
  createTask: (taskTemplateId: string, input: string) => Promise<void>;
  moveTask: (taskId: string, action: string) => Promise<void>;
  jumpTask: (taskId: string, targetIndex: number) => Promise<void>;
  reloadTemplates: () => Promise<void>;
  saveTemplate: (tpl: TaskTemplate) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
}

const KanbanContext = createContext<KanbanContextValue | null>(null);

export function useKanban(): KanbanContextValue {
  const ctx = useContext(KanbanContext);
  if (!ctx) throw new Error('useKanban must be used within KanbanProvider');
  return ctx;
}

export function KanbanProvider({ children, rootId }: { children: ReactNode; rootId: string | null }) {
  const { subscribe } = useWebSocket();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const templatesById = new Map(templates.map((t) => [t.id, t]));

  const refresh = useCallback(async () => {
    if (!rootId) { setTasks([]); return; }
    setLoading(true); setError(null);
    try {
      const [t, tpl] = await Promise.all([kanbanApi.listTasks(rootId), kanbanApi.listTemplates()]);
      setTasks(t); setTemplates(tpl);
    } catch (e: any) {
      setError(e?.message ?? 'failed to load kanban');
    } finally {
      setLoading(false);
    }
  }, [rootId]);

  const reloadTemplates = useCallback(async () => {
    try { setTemplates(await kanbanApi.listTemplates()); } catch (e: any) { setError(e?.message ?? 'templates load failed'); }
  }, []);

  // initial + on rootId change
  useEffect(() => { void refresh(); }, [refresh]);

  // WS subscription: upsert on kanban-task-updated; refetch on reconnect
  useEffect(() => {
    if (!rootId) return;
    const off = subscribe((event) => {
      if (event.kind === 'websocket_reconnected') { void refresh(); return; }
      if (event.type !== 'kanban-task-updated') return;
      if (event.rootId !== rootId) return;
      const task = event.task as Task | undefined;
      if (!task) return;
      setTasks((prev) => {
        const i = prev.findIndex((t) => t.id === task.id);
        if (i === -1) return [...prev, task];
        const next = prev.slice(); next[i] = task; return next;
      });
    });
    return off;
  }, [subscribe, rootId, refresh]);

  const createTask = useCallback(async (taskTemplateId: string, input: string) => {
    if (!rootId) return;
    try {
      const t = await kanbanApi.createTask(rootId, taskTemplateId, input);
      setTasks((prev) => (prev.some((x) => x.id === t.id) ? prev : [...prev, t]));
    } catch (e: any) { setError(e?.message ?? 'createTask failed'); }
  }, [rootId]);

  const moveTask = useCallback(async (taskId: string, action: string) => {
    if (!rootId) return;
    // optimistic: leave stale; server WS broadcast will upsert. On error, refetch.
    try {
      const t = await kanbanApi.move(taskId, rootId, action);
      setTasks((prev) => prev.map((x) => (x.id === t.id ? t : x)));
    } catch (e: any) { setError(e?.message ?? `${action} failed`); void refresh(); }
  }, [rootId, refresh]);

  const jumpTask = useCallback(async (taskId: string, targetIndex: number) => {
    if (!rootId) return;
    try {
      const t = await kanbanApi.jump(taskId, rootId, targetIndex);
      setTasks((prev) => prev.map((x) => (x.id === t.id ? t : x)));
    } catch (e: any) { setError(e?.message ?? 'jump failed'); void refresh(); }
  }, [rootId, refresh]);

  const saveTemplate = useCallback(async (tpl: TaskTemplate) => {
    try { const saved = await kanbanApi.saveTemplate(tpl); setTemplates((prev) => { const i = prev.findIndex((t) => t.id === saved.id); return i === -1 ? [...prev, saved] : prev.map((t) => (t.id === saved.id ? saved : t)); }); }
    catch (e: any) { setError(e?.message ?? 'saveTemplate failed'); }
  }, []);

  const deleteTemplate = useCallback(async (id: string) => {
    try { await kanbanApi.deleteTemplate(id); setTemplates((prev) => prev.filter((t) => t.id !== id)); }
    catch (e: any) { setError(e?.message ?? 'deleteTemplate failed'); }
  }, []);

  const value: KanbanContextValue = {
    tasks, templates, templatesById, loading, error, rootId,
    refresh, createTask, moveTask, jumpTask, reloadTemplates, saveTemplate, deleteTemplate,
  };
  return <KanbanContext.Provider value={value}>{children}</KanbanContext.Provider>;
}
```

### 步骤 2:typecheck(`npx tsc --noEmit -p tsconfig.json`)+ commit

```bash
git -C <worktree> add src/components/kanban/KanbanContext.tsx
git -C <worktree> commit -m "feat(kanban-ui): add KanbanContext with WS subscription" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: tab 接入(默认 kanban tab)+ KanbanPanel shell

**Files:**
- Modify: `src/types/app.ts:8`(AppTab 加 `'kanban'`)
- Modify: `src/components/main-content/view/subcomponents/MainContentTabSwitcher.tsx`(加 `KANBAN_TAB`)
- Modify: `src/components/main-content/view/MainContent.tsx`(reset-fallback + 内容分支)
- Modify: `src/App.tsx`(套 KanbanProvider)
- Create: `src/components/kanban/KanbanPanel.tsx`
- Create: `src/components/kanban/index.ts`(barrel)

### 步骤 0:Read `src/types/app.ts`、`MainContentTabSwitcher.tsx`(看 `BASE_TABS`/`TASKS_TAB`/`builtInTabs` 结构 + Pill 渲染)、`MainContent.tsx`(看 TaskMaster 的 reset-fallback `:93-97` + 内容分支 `:203` + `useProjectsState`/`selectedProject` 取法)、`App.tsx:127-146`(Provider 嵌套)。

### 步骤 1:`src/types/app.ts` AppTab 加 `'kanban'`

```typescript
export type AppTab = 'chat' | 'files' | 'shell' | 'git' | 'tasks' | 'kanban' | 'browser' | `plugin:${string}`;
```

### 步骤 2:`MainContentTabSwitcher.tsx` 加 KANBAN_TAB(无条件展开)

参照 `TASKS_TAB` 常量,加:
```typescript
import { LayoutGrid } from 'lucide-react';   // kanban icon(或 KanbanSquare,确认 lucide 有)
const KANBAN_TAB: BuiltInTab = { kind: 'builtin', id: 'kanban', labelKey: 'tabs.kanban', icon: LayoutGrid };
```
在 `builtInTabs` 数组里 `...BASE_TABS` 之后、`...(shouldShowBrowserTab ? [BROWSER_TAB] : [])` 之前(或之后),加 `KANBAN_TAB`(无条件,不进 shouldShow 三元):
```typescript
const builtInTabs: BuiltInTab[] = [
  ...BASE_TABS,
  KANBAN_TAB,
  ...(shouldShowBrowserTab ? [BROWSER_TAB] : []),
  ...(shouldShowTasksTab ? [TASKS_TAB] : []),
];
```
(确认 `BuiltInTab` 类型接受 `id: 'kanban'`——它应是 `BuiltInTab['id']` 含所有 AppTab builtin 值;Read 该类型。)

### 步骤 3:`MainContent.tsx` 加内容分支 + reset-fallback

参照 TaskMaster 的模式(line 93-97 reset、line 203 内容)。加:
```typescript
import { KanbanPanel } from '@/components/kanban';   // 或相对路径
// 在 TaskMaster 内容分支旁:
{activeTab === 'kanban' && <KanbanPanel isVisible={activeTab === 'kanban'} />}
```
(若 TaskMaster 用 keep-alive `{shouldShowTasksTab && <TaskMasterPanel isVisible={activeTab==='tasks'} />}`,kanban 也用 keep-alive:`{<KanbanPanel isVisible={activeTab==='kanban'} />}`——始终挂载,靠 isVisible 隐藏。选哪种取决于是否要常驻 WS 订阅;推荐 keep-alive,WS 订阅保活。)

reset-fallback:not needed(kanban 无条件显示,不会出现「active 但不可用」)。但若 `activeTab` 持久化到某个不该是 kanban 的场景,可加一个保护。一般不需要。

### 步骤 4:`App.tsx` 套 KanbanProvider

在 WebSocketProvider 内(需要 WS)、与 TaskMasterProvider 同层,套 KanbanProvider。**但 KanbanProvider 需要 `rootId`(selectedProject.projectId)**——而 selectedProject 在 `AppContent` 里(不在 App 顶层)。所以 KanbanProvider 应套在 `AppContent` 内、`MainContent` 外,这样能拿到 selectedProject。

Read `AppContent.tsx` 确认 selectedProject 取法(`useProjectsState()`),在 MainContent 外套:
```typescript
<KanbanProvider rootId={selectedProject?.projectId ?? null}>
  <MainContent ... />
</KanbanProvider>
```
(若 KanbanProvider 必须在 WebSocketProvider 内,确认 AppContent 已在 WebSocketProvider 下游——App.tsx 里 `<WebSocketProvider>` 包 `<Router><AppContent/></Router>`,所以 AppContent 内套 KanbanProvider 即在 WS 下游。✓)

### 步骤 5:`KanbanPanel.tsx`(shell)

```typescript
import { useKanban } from './KanbanContext';
import { Board } from './Board';
import { CreateTaskDialog } from './CreateTaskDialog';
import { TaskTemplateEditor } from './TaskTemplateEditor';
import { Button } from '@/shared/view/ui';
import { useState } from 'react';

export function KanbanPanel({ isVisible }: { isVisible: boolean }) {
  const { rootId, loading, error, refresh } = useKanban();
  const [showCreate, setShowCreate] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

  return (
    <div className={`${isVisible ? 'block' : 'hidden'} h-full`}>
      {!rootId ? (
        <EmptyState text="Select a project to view its kanban board." />
      ) : (
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Button size="sm" onClick={() => setShowCreate(true)}>New Task</Button>
            <Button size="sm" variant="outline" onClick={() => setShowTemplates(true)}>Templates</Button>
            <Button size="sm" variant="ghost" onClick={() => void refresh()}>Refresh</Button>
            {error && <span className="text-xs text-destructive">{error}</span>}
          </div>
          <div className="flex-1 overflow-hidden">
            {loading ? <EmptyState text="Loading…" /> : <Board />}
          </div>
        </div>
      )}
      {showCreate && <CreateTaskDialog onClose={() => setShowCreate(false)} />}
      {showTemplates && <TaskTemplateEditor onClose={() => setShowTemplates(false)} />}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{text}</div>;
}
```

### 步骤 6:`src/components/kanban/index.ts` barrel
```typescript
export { KanbanPanel } from './KanbanPanel';
```

### 步骤 7:typecheck + commit。注:`Board`/`CreateTaskDialog`/`TaskTemplateEditor` 在后续 task 创建;此 task 先用占位 import 或推迟 import 到对应 task。**推荐**:此 task 只做 tab 接入 + KanbanPanel shell(临时把 Board/Create/Templates 的 import 注释,渲染 EmptyState),Task 4-6 再补真实组件。这样每 task 独立可 typecheck。

(为避免占位,Task 3 的 KanbanPanel 先不 import Board/CreateTaskDialog/TaskTemplateEditor,只渲染顶栏 + EmptyState("Board coming in T4");Task 4 补 Board import;Task 5 补 CreateTaskDialog;Task 6 补 TaskTemplateEditor。每 task 增量。)

```bash
npx tsc --noEmit -p tsconfig.json
git -C <worktree> add src/types/app.ts src/components/main-content/ src/App.tsx src/components/kanban/KanbanPanel.tsx src/components/kanban/index.ts
git -C <worktree> commit -m "feat(kanban-ui): wire kanban tab + KanbanPanel shell" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Board + StageColumn + badges

**Files:**
- Create: `src/components/kanban/Board.tsx`
- Create: `src/components/kanban/StageColumn.tsx`
- Create: `src/components/kanban/badges.tsx`

### 步骤 1:`badges.tsx`(状态→样式 + aux 徽章)

参照 `task-master/view/TaskCard.tsx:32-70` 的 `{icon, iconColor, textColor}` idiom。

```typescript
import { AlertCircle, ClipboardList, ListChecks, GitBranch, Loader2 } from 'lucide-react';
import type { TaskStatus, TaskAuxFlags } from './types';

export function statusStyle(status: TaskStatus): { label: string; dot: string; text: string } {
  switch (status) {
    case 'running': return { label: 'Running', dot: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-400' };
    case 'queued': return { label: 'Queued', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' };
    case 'waiting_user': return { label: 'Waiting', dot: 'bg-purple-500', text: 'text-purple-600 dark:text-purple-400' };
    case 'paused': return { label: 'Paused', dot: 'bg-gray-400', text: 'text-gray-500 dark:text-gray-400' };
    case 'success': return { label: 'Done', dot: 'bg-green-500', text: 'text-green-600 dark:text-green-400' };
    case 'fail': return { label: 'Failed', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' };
    case 'cancelled': return { label: 'Cancelled', dot: 'bg-gray-300', text: 'text-gray-400 dark:text-gray-500' };
    default: return { label: 'Pending', dot: 'bg-gray-300', text: 'text-muted-foreground' };
  }
}

export function AuxBadges({ flags }: { flags: TaskAuxFlags }) {
  return (
    <div className="flex items-center gap-1">
      {flags.askUserWaiting && <Badge title="Awaiting your answer"><AlertCircle className="h-3 w-3 text-purple-500" /></Badge>}
      {flags.hasPlan && <Badge title="Has plan"><ClipboardList className="h-3 w-3 text-blue-500" /></Badge>}
      {flags.hasTodos && <Badge title="Has TODOs"><ListChecks className="h-3 w-3 text-green-500" /></Badge>}
      {flags.hasTask && <Badge title="Has subtasks"><GitBranch className="h-3 w-3 text-indigo-500" /></Badge>}
      {flags.sessionError && <Badge title={flags.sessionError}><AlertCircle className="h-3 w-3 text-destructive" /></Badge>}
      {flags.sessionError === undefined && !flags.askUserWaiting && !flags.hasPlan && !flags.hasTodos && !flags.hasTask && (
        <span className="text-[10px] text-muted-foreground">—</span>
      )}
    </div>
  );
}

function Badge({ title, children }: { title: string; children: React.ReactNode }) {
  return <span title={title} className="inline-flex">{children}</span>;
}
```

### 步骤 2:`StageColumn.tsx`

```typescript
import type { ReactNode } from 'react';
import type { StageTemplate } from './types';

export function StageColumn({ stage, index, children }: { stage: StageTemplate; index: number; children: ReactNode }) {
  return (
    <div className="flex w-72 shrink-0 flex-col border-r border-border">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">#{index}</span>
          <span className="text-sm font-medium">{stage.name}</span>
        </div>
        <span className={`text-[10px] uppercase ${stage.role === 'agent' ? 'text-blue-500' : 'text-muted-foreground'}`}>
          {stage.role}{stage.agent ? ` · ${stage.agent}` : ''}
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">{children}</div>
    </div>
  );
}
```

### 步骤 3:`Board.tsx`

```typescript
import { useKanban } from './KanbanContext';
import { StageColumn } from './StageColumn';
import { TaskCard } from './TaskCard';   // Task 5 创建;此 task 先占位或注释

export function Board() {
  const { tasks, templatesById } = useKanban();

  // Derive the column layout from the first task's template (all tasks in a root share the same template set typically).
  // If multiple templates exist, union their stages by position is messy — for v1 use the template of the most-recent task,
  // or if no tasks, show a hint to create one.
  if (tasks.length === 0) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No tasks yet. Create one from a template.</div>;
  }
  // pick the template referenced by the first task (kanban is single-template-per-board in v1)
  const tplId = tasks[0].taskTemplateId;
  const tpl = templatesById.get(tplId);
  if (!tpl) return <div className="p-4 text-sm text-muted-foreground">Template not found.</div>;

  const stages = tpl.stages;
  // bucket tasks by currentStageIndex (clamp to [0, stages.length-1])
  const byStage: Record<number, typeof tasks> = {};
  for (const t of tasks) {
    const i = Math.max(0, Math.min(stages.length - 1, t.currentStageIndex));
    (byStage[i] ??= []).push(t);
  }

  return (
    <div className="flex h-full overflow-x-auto">
      {stages.map((s, i) => (
        <StageColumn key={s.id} stage={s.snapshot} index={i}>
          {(byStage[i] ?? []).map((t) => <TaskCard key={t.id} task={t} />)}
        </StageColumn>
      ))}
    </div>
  );
}
```

(`TaskCard` 在 Task 5 创建。此 task 实现时,临时把 `TaskCard` import + 用法注释,渲染 `{(byStage[i] ?? []).map(t => <div key={t.id}>{t.taskNumber}</div>)}` 占位,Task 5 替换为真 TaskCard。或直接在 Task 4 实现 TaskCard 的最小版,Task 5 增强。**推荐**:Task 4 实现最小 TaskCard(只显示 taskNumber + status dot),Task 5 增强 aux 徽章 + 点击开 modal。)

### 步骤 4:typecheck + commit

```bash
npx tsc --noEmit -p tsconfig.json
git -C <worktree> add src/components/kanban/Board.tsx src/components/kanban/StageColumn.tsx src/components/kanban/badges.tsx
git -C <worktree> commit -m "feat(kanban-ui): add Board, StageColumn, badges" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: TaskCard + TaskDetailModal

**Files:**
- Create: `src/components/kanban/TaskCard.tsx`
- Create: `src/components/kanban/TaskDetailModal.tsx`

### 步骤 1:`TaskCard.tsx`

```typescript
import { useState } from 'react';
import { Card } from '@/shared/view/ui';
import type { Task } from './types';
import { AuxBadges, statusStyle } from './badges';
import { TaskDetailModal } from './TaskDetailModal';

export function TaskCard({ task }: { task: Task }) {
  const [open, setOpen] = useState(false);
  const s = statusStyle(task.status);
  return (
    <>
      <Card
        className="cursor-pointer p-2 text-xs hover:border-primary/40"
        onClick={() => setOpen(true)}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">#{task.taskNumber}</span>
          <span className={`flex items-center gap-1 ${s.text}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot}`} />
            {s.label}
          </span>
        </div>
        <div className="mt-1 text-muted-foreground">{task.taskTemplateName ?? task.taskTemplateId}</div>
        <div className="mt-1"><AuxBadges flags={task.auxFlags} /></div>
        {task.auxFlags.sessionError && <div className="mt-1 truncate text-destructive">{task.auxFlags.sessionError}</div>}
      </Card>
      {open && <TaskDetailModal task={task} onClose={() => setOpen(false)} />}
    </>
  );
}
```

(确认 `Card` 接受 `onClick` + `className`——Read `src/shared/view/ui/Card.tsx`;若 Card 是 `div`+forwardRef 接受原生 props,onClick 可用。)

### 步骤 2:`TaskDetailModal.tsx`(阶段操作 + aux + 摘要)

```typescript
import { Dialog, DialogContent, DialogTitle, Button } from '@/shared/view/ui';
import { useKanban } from './KanbanContext';
import { AuxBadges, statusStyle } from './badges';
import type { Task } from './types';

export function TaskDetailModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const { templatesById, moveTask, jumpTask } = useKanban();
  const tpl = templatesById.get(task.taskTemplateId);
  const s = statusStyle(task.status);
  const isTerminal = task.status === 'success' || task.status === 'fail' || task.status === 'cancelled';
  const stage = tpl?.stages[task.currentStageIndex]?.snapshot;

  const MoveBtn = ({ action, label, disabled }: { action: string; label: string; disabled?: boolean }) => (
    <Button size="sm" variant="outline" disabled={disabled || isTerminal} onClick={() => void moveTask(task.id, action)}>{label}</Button>
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogTitle className="sr-only">Task #{task.taskNumber}</DialogTitle>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Task #{task.taskNumber}</h2>
            <span className={`flex items-center gap-1 ${s.text}`}>
              <span className={`inline-block h-2 w-2 rounded-full ${s.dot}`} />{s.label}
            </span>
          </div>
          <div className="text-sm text-muted-foreground">{task.taskTemplateName ?? task.taskTemplateId}</div>
          <div className="text-xs text-muted-foreground">
            Stage {task.currentStageIndex}{stage ? ` · ${stage.name} (${stage.role}${stage.agent ? `/${stage.agent}` : ''})` : ''}
          </div>
          <AuxBadges flags={task.auxFlags} />
          {task.auxFlags.sessionError && <div className="rounded bg-destructive/10 p-2 text-xs text-destructive">{task.auxFlags.sessionError}</div>}
          {task.worktreePath && <div className="truncate text-[11px] text-muted-foreground" title={task.worktreePath}>wt: {task.worktreePath}</div>}
          <div className="flex flex-wrap gap-2 pt-2">
            <MoveBtn action="prev" label="← Prev" disabled={task.currentStageIndex <= 0} />
            <MoveBtn action="next" label="Next →" />
            <MoveBtn action="pause" label="Pause" disabled={task.status !== 'running' && task.status !== 'queued'} />
            <MoveBtn action="resume" label="Resume" disabled={task.status !== 'paused'} />
            <MoveBtn action="complete" label="Complete" />
            <MoveBtn action="cancel" label="Cancel" />
          </div>
          {tpl && (
            <div className="pt-2">
              <div className="mb-1 text-xs font-medium">Jump to stage</div>
              <div className="flex flex-wrap gap-1">
                {tpl.stages.map((st, i) => (
                  <Button key={st.id} size="sm" variant={i === task.currentStageIndex ? 'default' : 'ghost'}
                    disabled={i === task.currentStageIndex || isTerminal} onClick={() => void jumpTask(task.id, i)}>
                    {i}: {st.snapshot.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### 步骤 3:typecheck + commit

```bash
npx tsc --noEmit -p tsconfig.json
git -C <worktree> add src/components/kanban/TaskCard.tsx src/components/kanban/TaskDetailModal.tsx
git -C <worktree> commit -m "feat(kanban-ui): add TaskCard and TaskDetailModal with stage actions" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: CreateTaskDialog + TaskTemplateEditor

**Files:**
- Create: `src/components/kanban/CreateTaskDialog.tsx`
- Create: `src/components/kanban/TaskTemplateEditor.tsx`

### 步骤 1:`CreateTaskDialog.tsx`(选模板 + input → createTask)

```typescript
import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, Button, Input } from '@/shared/view/ui';
import { useKanban } from './KanbanContext';

export function CreateTaskDialog({ onClose }: { onClose: () => void }) {
  const { templates, createTask } = useKanban();
  const [tplId, setTplId] = useState(templates[0]?.id ?? '');
  const [input, setInput] = useState('');

  const submit = async () => {
    if (!tplId) return;
    await createTask(tplId, input);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogTitle className="sr-only">New Task</DialogTitle>
        <div className="space-y-3">
          <h2 className="text-base font-semibold">New Task</h2>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Template</div>
            {templates.length === 0 ? (
              <div className="text-xs text-muted-foreground">No templates. Create one in the Templates editor first.</div>
            ) : (
              <select className="w-full rounded border border-border bg-background p-1.5 text-sm" value={tplId} onChange={(e) => setTplId(e.target.value)}>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Input (passed to the task prompt as `{'{{input}}'}`)</div>
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. implement feature X" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button disabled={!tplId} onClick={submit}>Create</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### 步骤 2:`TaskTemplateEditor.tsx`(列表 + 创建/编辑 stage + 保存/删除)

```typescript
import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, Button, Input } from '@/shared/view/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useKanban } from './KanbanContext';
import type { TaskTemplate, TaskTemplateStage, StageTemplate } from './types';

function newStage(role: 'user' | 'agent'): StageTemplate {
  return { id: crypto.randomUUID(), name: role === 'user' ? 'New user stage' : 'New agent stage', role, autoAdvance: role === 'user', agent: role === 'agent' ? 'claude' : undefined, promptTemplate: '', createdAt: '', updatedAt: '' };
}

function emptyTemplate(): TaskTemplate {
  return { id: crypto.randomUUID(), name: 'New template', maxConcurrency: 1, stages: [{ id: crypto.randomUUID(), position: 0, snapshot: newStage('user') }], createdAt: '', updatedAt: '' };
}

export function TaskTemplateEditor({ onClose }: { onClose: () => void }) {
  const { templates, saveTemplate, deleteTemplate } = useKanban();
  const [editing, setEditing] = useState<TaskTemplate | null>(null);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogTitle className="sr-only">Task Templates</DialogTitle>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Task Templates</h2>
            <Button size="sm" onClick={() => setEditing(emptyTemplate())}><Plus className="mr-1 h-3 w-3" />New</Button>
          </div>
          {!editing && (
            <div className="space-y-1">
              {templates.length === 0 && <div className="text-xs text-muted-foreground">No templates yet.</div>}
              {templates.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded border border-border p-2">
                  <div>
                    <div className="text-sm font-medium">{t.name}</div>
                    <div className="text-xs text-muted-foreground">{t.stages.length} stages · concurrency {t.maxConcurrency}</div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(structuredClone(t))}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => void deleteTemplate(t.id)}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {editing && <TemplateForm tpl={editing} onCancel={() => setEditing(null)} onSave={async (t) => { await saveTemplate(t); setEditing(null); }} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TemplateForm({ tpl, onSave, onCancel }: { tpl: TaskTemplate; onSave: (t: TaskTemplate) => void; onCancel: () => void }) {
  const [t, setT] = useState<TaskTemplate>(tpl);
  const updateStage = (idx: number, patch: Partial<StageTemplate>) => {
    const stages = t.stages.slice();
    const cur = stages[idx];
    stages[idx] = { ...cur, snapshot: { ...cur.snapshot, ...patch } };
    setT({ ...t, stages });
  };
  const addStage = (role: 'user' | 'agent') => {
    const snapshot = newStage(role);
    setT({ ...t, stages: [...t.stages, { id: snapshot.id, position: t.stages.length, snapshot }] });
  };
  const removeStage = (idx: number) => setT({ ...t, stages: t.stages.filter((_, i) => i !== idx).map((s, i) => ({ ...s, position: i })) });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} className="flex-1" />
        <Input type="number" min={1} value={t.maxConcurrency} onChange={(e) => setT({ ...t, maxConcurrency: Math.max(1, Number(e.target.value) || 1) })} className="w-20" title="Max concurrency" />
      </div>
      <div className="space-y-2">
        {t.stages.map((st, i) => (
          <div key={st.id} className="space-y-1 rounded border border-border p-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">#{i}</span>
              <Input value={st.snapshot.name} onChange={(e) => updateStage(i, { name: e.target.value })} className="flex-1" />
              <select value={st.snapshot.role} onChange={(e) => updateStage(i, { role: e.target.value as 'user' | 'agent' })} className="rounded border border-border bg-background p-1 text-xs">
                <option value="user">user</option>
                <option value="agent">agent</option>
              </select>
              <Button size="sm" variant="ghost" onClick={() => removeStage(i)}><Trash2 className="h-3 w-3" /></Button>
            </div>
            {st.snapshot.role === 'agent' && (
              <div className="flex flex-wrap items-center gap-2 pl-5">
                <select value={st.snapshot.agent ?? 'claude'} onChange={(e) => updateStage(i, { agent: e.target.value })} className="rounded border border-border bg-background p-1 text-xs">
                  {['claude', 'codex', 'cursor', 'gemini', 'opencode'].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={st.snapshot.planMode ?? false} onChange={(e) => updateStage(i, { planMode: e.target.checked })} /> plan</label>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={st.snapshot.autoAdvance} onChange={(e) => updateStage(i, { autoAdvance: e.target.checked })} /> autoAdvance</label>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={st.snapshot.agentCanControlStage ?? true} onChange={(e) => updateStage(i, { agentCanControlStage: e.target.checked })} /> self-drive</label>
              </div>
            )}
            <textarea value={st.snapshot.promptTemplate ?? ''} onChange={(e) => updateStage(i, { promptTemplate: e.target.value })} placeholder="Prompt template. Use {{input}}, {{task_id}}, {{task_number}}, {{stage_name}}…" className="w-full rounded border border-border bg-background p-1.5 font-mono text-xs" rows={2} />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => addStage('user')}><Plus className="mr-1 h-3 w-3" />User stage</Button>
        <Button size="sm" variant="outline" onClick={() => addStage('agent')}><Plus className="mr-1 h-3 w-3" />Agent stage</Button>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onSave({ ...t, stages: t.stages.map((s, i) => ({ ...s, position: i })) })}>Save</Button>
      </div>
    </div>
  );
}
```

### 步骤 3:typecheck + commit

```bash
npx tsc --noEmit -p tsconfig.json
git -C <worktree> add src/components/kanban/CreateTaskDialog.tsx src/components/kanban/TaskTemplateEditor.tsx
git -C <worktree> commit -m "feat(kanban-ui): add create-task dialog and template editor" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 集成 polish + 手动测试清单 + KanbanPanel 补全组件接线

**Files:**
- Modify: `src/components/kanban/KanbanPanel.tsx`(把 Task 3 占位的 Board/Create/Templates import 接上真实组件,Task 3-6 已增量完成则此 task 仅验证)

### 步骤 1:确认 KanbanPanel 已 import 真实 Board/CreateTaskDialog/TaskTemplateEditor(若 Task 3 用了占位,现在替换)。

### 步骤 2:全量 typecheck + 前端 build

```bash
npx tsc --noEmit -p tsconfig.json
npm run build:client   # vite build,确认无运行时构建错误
```

### 步骤 3:手动测试清单(无法自动化的 live agent 路径)
- [ ] 选一个项目 → kanban tab 出现(默认),空态显示。
- [ ] Templates 编辑器 → 建 2 阶段模板(user→agent claude,autoAdvance,带 `{{input}}` prompt)→ 保存 → 列表出现。
- [ ] New Task → 选模板 → 填 input → Create → 卡片出现在 stage 0 列。
- [ ] 卡片点击 → 详情 modal → aux 徽章显示;Prev/Next/Jump/Pause/Resume/Cancel 按预期调 REST(网络 tab 看 `/api/tasks/:id/next` 200)。
- [ ] 跑一个 agent 阶段(真实 Claude,需 live)→ 卡片 aux 徽章实时更新(WS kanban-task-updated)→ 阶段推进时卡片移列。
- [ ] tab 切换 chat→kanban→chat:看板状态保活(keep-alive),不重新拉取(除非 WS reconnect)。
- [ ] dark mode 下配色正常(token 类生效)。

### 步骤 4:commit

```bash
git -C <worktree> add -A
git -C <worktree> commit -m "feat(kanban-ui): integration polish + manual test checklist" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
(若 Task 3-6 已增量接好 KanbanPanel,此 task 可能无代码改动——仅手动测试;则跳过 commit,记录测试结果。)

---

## W4-前端 完成标准

- `src/components/kanban/` 全套组件就位;kanban tab 默认显示;按项目展示多阶段任务流;WS 实时更新 aux 徽章 + 阶段迁移;阶段操作 REST 调通;模板 CRUD UI 可用。
- `npx tsc --noEmit -p tsconfig.json` 0 错误;`npm run build:client` 成功。
- TaskMaster tab 不受影响(opt-in 条件不变)。
- 手动测试清单跑通(尤其是 live agent → WS → 卡片更新这条无自动化测试的路径)。
- **不含(留独立 plan)**:cron 定时任务、webhook 通知 channel、看板的高级特性(标签过滤/排序/搜索——spec 未要求 v1)。

## Self-Review

- **Spec coverage**:spec 第 3 节前端 `src/components/kanban/`(Board/StageColumn/TaskCard/TaskDetailModal/TaskTemplateEditor ✓ 全覆盖)+ "默认 tab 不需装 CLI"(✓ Task 3 无条件展开)+ aux 徽章(✓ badges.tsx)+ WS 实时(✓ KanbanContext subscribe)+ 模板编辑(✓ Task 6)。spec 第 7 节 W4 前端的 cron/webhook 明确转独立 plan。✓
- **Placeholder scan**:Task 3 的 Board/Create/Templates import 用增量策略(Task 3 渲染占位 EmptyState,Task 4-6 逐 task 替换为真组件——每 task 独立可 typecheck,非占位)。所有组件代码完整可运行。无 "TODO"/"add validation"。
- **Type 一致性**:`Task/StageTemplate/TaskTemplate/TaskAuxFlags`(Task 1 定义)在所有组件 + KanbanContext + api 一致;`kanbanApi` 方法名(listTasks/createTask/move/jump/listTemplates/getTemplate/saveTemplate/deleteTemplate)在 api.ts 定义,KanbanContext 调用一致;`useKanban()` 暴露的字段(tasks/templates/templatesById/loading/error/rootId/refresh/createTask/moveTask/jumpTask/reloadTemplates/saveTemplate/deleteTemplate)在所有消费组件(Board/TaskCard/Modal/Create/Editor/Panel)一致。✓
- **API 契约对齐**:每个 api 方法调用的路径/body 与 W4-backend `kanban.routes.ts` 实际路由一致(GET `/tasks?rootId=`;POST `/tasks {rootId,taskTemplateId,input}`;POST `/tasks/:id/{action} {rootId}`;POST `/tasks/:id/jump {rootId,targetIndex}`;`/tasks/templates*`)。✓
- **不确定性处理**:Card onClick 是否可用(implementer Read Card.tsx 确认);`api` named export vs default(Read utils/api.js 确认);`BuiltInTab['id']` 接受 `'kanban'`(Read 类型确认);Provider 套在 AppContent 内拿 selectedProject(Read AppContent 确认)。都给了 Read 指令。
