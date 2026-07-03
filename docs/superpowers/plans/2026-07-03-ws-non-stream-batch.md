# WS 非流批量 + 去 latestMessage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WS 非流 shouldPersist 事件（tool_use 等）rAF 批量合并 store 写 + 去 WebSocketContext latestMessage（消除每帧 provider tree 重渲）。

**Architecture:** `useChatRealtimeHandlers` 把 shouldPersist 事件累积到 batchQueue + rAF 16ms flush → `batchBySession` 纯函数分组 → `sessionStore.appendRealtimeBatch`（已有 API，一次 set）。`WebSocketContext` 删 latestMessage state（dispatch 只 fan-out listeners），`TaskMasterContext` 改 subscribe listener 替代 latestMessage effect。

**Tech Stack:** React（rAF + useRef）、TypeScript、`node:test`（纯函数）。

**Spec:** `docs/superpowers/specs/2026-07-03-ws-non-stream-batch-design.md`

**Plan 阶段相对 spec 的简化（YAGNI，基于读现有代码）：**
1. **`status` / `permission_request` / `complete` 不走批量**：现有 `shouldPersist` 逻辑（useChatRealtimeHandlers L234-238）明确把这些排除（它们走 UI 副作用 switch，不 `appendRealtime`）。所以"非流批量 store 写"实际只针对 `shouldPersist=true` 事件（主要是 `tool_use`）。
2. **`batchEvents` 简化为 `batchBySession`**：spec 说"同 session 多 status 取最后 / tool_use 累积"等合并语义，但实际只有 shouldPersist 事件（tool_use 等追加型）进批量，不需"取最后/累积"判断 —— 都是顺序追加。所以纯函数简化为 groupBy session。
3. **`sessionStore.appendRealtimeBatch` 已存在**（L567），无需新增 store API。

---

## 文件结构

**Create:**
- `src/components/chat/utils/batchBySession.ts` — 按 session 分组 shouldPersist 事件的纯函数
- `src/components/chat/utils/batchBySession.test.ts` — node:test

**Modify:**
- `src/components/chat/hooks/useChatRealtimeHandlers.ts` — shouldPersist 事件累积 batchQueue + rAF flush → appendRealtimeBatch
- `src/contexts/WebSocketContext.tsx` — 删 latestMessage state + setLatestMessage + context 字段
- `src/components/task-master/context/TaskMasterContext.tsx` — latestMessage effect 改 subscribe listener

**环境约束:**
- 项目无 vitest/jest；纯函数 `node:test`（`npx tsx --test`），extensionless import
- eslint `no-empty` 要求 catch 块加注释
- commitlint subject 不允许 PascalCase 词；首词小写
- 提交前确认根目录无 `nul` 文件

---

## Task C1: `batchBySession` 纯函数 + 测试

**Files:**
- Create: `src/components/chat/utils/batchBySession.ts`
- Test: `src/components/chat/utils/batchBySession.test.ts`

- [ ] **Step 1: 写失败测试**

`src/components/chat/utils/batchBySession.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchBySession } from './batchBySession';
import type { NormalizedMessage } from '../../../stores/useSessionStore';

const msg = (id: string, sessionId: string, kind = 'tool_use'): NormalizedMessage =>
  ({ id, sessionId, kind, timestamp: '2026-01-01T00:00:00Z', provider: 'claude' } as unknown as NormalizedMessage);

test('空数组 → 空 Map', () => {
  assert.equal(batchBySession([]).size, 0);
});

test('单 session 多事件 → 同 key 累积顺序保留', () => {
  const result = batchBySession([
    { sessionId: 's1', msg: msg('a', 's1') },
    { sessionId: 's1', msg: msg('b', 's1') },
  ]);
  assert.equal(result.size, 1);
  assert.deepEqual(result.get('s1')!.map((m) => m.id), ['a', 'b']);
});

test('多 session → 分别分组', () => {
  const result = batchBySession([
    { sessionId: 's1', msg: msg('a', 's1') },
    { sessionId: 's2', msg: msg('b', 's2') },
    { sessionId: 's1', msg: msg('c', 's1') },
  ]);
  assert.equal(result.size, 2);
  assert.deepEqual(result.get('s1')!.map((m) => m.id), ['a', 'c']);
  assert.deepEqual(result.get('s2')!.map((m) => m.id), ['b']);
});

test('顺序保留（不重排）', () => {
  const result = batchBySession([
    { sessionId: 's1', msg: msg('1', 's1') },
    { sessionId: 's1', msg: msg('2', 's1') },
    { sessionId: 's1', msg: msg('3', 's1') },
  ]);
  assert.deepEqual(result.get('s1')!.map((m) => m.id), ['1', '2', '3']);
});
```

- [ ] **Step 2: 跑确认失败**

```bash
cd D:/workspace/projects/ai/apps/planrla/.claude/worktrees/ws-batch
npx tsx --test src/components/chat/utils/batchBySession.test.ts
```
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`src/components/chat/utils/batchBySession.ts`：

```ts
import type { NormalizedMessage } from '../../../stores/useSessionStore';

/** 待批量写入 store 的单条事件（sessionId + 消息）。 */
export type BatchEntry = {
  sessionId: string;
  msg: NormalizedMessage;
};

/**
 * 把累积的 shouldPersist 事件按 session 分组，顺序保留。
 * flush 时对每个 session 调一次 `sessionStore.appendRealtimeBatch(sid, msgs)`，
 * 把 N 次 appendRealtime 合并为 per-session 一次 set。
 */
export function batchBySession(entries: BatchEntry[]): Map<string, NormalizedMessage[]> {
  const grouped = new Map<string, NormalizedMessage[]>();
  for (const entry of entries) {
    const arr = grouped.get(entry.sessionId);
    if (arr) {
      arr.push(entry.msg);
    } else {
      grouped.set(entry.sessionId, [entry.msg]);
    }
  }
  return grouped;
}
```

- [ ] **Step 4: 跑确认 4 tests PASS**

```bash
npx tsx --test src/components/chat/utils/batchBySession.test.ts
```

- [ ] **Step 5: typecheck + Commit**

```bash
npx tsc --noEmit -p tsconfig.json && echo TSC_OK
git add src/components/chat/utils/batchBySession.ts src/components/chat/utils/batchBySession.test.ts
git commit -m "feat(ws): batch by session pure fn"
```
> Verify no `nul` at root. Subject lowercase-only.

---

## Task C2: `useChatRealtimeHandlers` rAF 批量 shouldPersist 事件

**Files:**
- Modify: `src/components/chat/hooks/useChatRealtimeHandlers.ts`

- [ ] **Step 1: 加 batchQueue ref + rAF 调度 + flush**

在 `src/components/chat/hooks/useChatRealtimeHandlers.ts`：

a) 顶部 import 加：
```ts
import { batchBySession, type BatchEntry } from '../utils/batchBySession';
```

b) hook 内（`firstTokenLoggedRef` 附近，L93 后）加 batchQueue + rAF：
```ts
// 非流 shouldPersist 事件批量：rAF 16ms 窗口累积，flush 时 per-session appendRealtimeBatch，
// 把 N 次 appendRealtime 合并为 per-session 一次 store set → 降低 re-render 频率。
// stream_delta 不进（已有 100ms accumulatedStream 合并）；status/permission/complete 不进（shouldPersist=false）。
const batchQueueRef = useRef<BatchEntry[]>([]);
const rafIdRef = useRef<number | null>(null);

const flushBatch = useCallback(() => {
  rafIdRef.current = null;
  const queue = batchQueueRef.current;
  batchQueueRef.current = [];
  if (queue.length === 0) return;
  const grouped = batchBySession(queue);
  for (const [sid, msgs] of grouped) {
    sessionStore.appendRealtimeBatch(sid, msgs);
  }
}, [sessionStore]);

const scheduleFlush = useCallback(() => {
  if (rafIdRef.current !== null) return; // 已调度
  rafIdRef.current = requestAnimationFrame(flushBatch);
}, [flushBatch]);
```

c) **替换** L233-242 的 shouldPersist appendRealtime 块：

现有（L233-242）：
```ts
      const shouldPersist =
        msg.kind !== 'complete'
        && msg.kind !== 'status'
        && msg.kind !== 'permission_request'
        && msg.kind !== 'permission_cancelled';

      if (sid && shouldPersist) {
        sessionStore.appendRealtime(sid, msg as unknown as NormalizedMessage);
      }
```
改为（push batchQueue + scheduleFlush，不立即 appendRealtime）：
```ts
      const shouldPersist =
        msg.kind !== 'complete'
        && msg.kind !== 'status'
        && msg.kind !== 'permission_request'
        && msg.kind !== 'permission_cancelled';

      if (sid && shouldPersist) {
        // 批量：累积到 rAF 队列，flush 时 appendRealtimeBatch（一次 set per session）
        batchQueueRef.current.push({ sessionId: sid, msg: msg as unknown as NormalizedMessage });
        scheduleFlush();
      }
```

d) **stream_end / complete 分支**（finalize streaming）需要在 finalize 后 flush batch（避免 batch 内 tool_use 滞后于 finalize）：
在 `stream_end` 分支（L216-231）和 `complete` 分支的 `finalizeStreaming` 后，加 `flushBatch()`（或 if rafIdRef.current !== null, cancelAnimationFrame + flushBatch）。最简单：在 `stream_end` + `complete` 的现有 finalize 后调 `flushBatch()`。

> 但 flushBatch 在 flushBatch 定义之前？flushBatch 是 useCallback（定义在 hook 体），handleEvent 在 useEffect 内（L99），闭包引用 flushBatch（依赖）。需把 flushBatch 加到 handleEvent 的 useEffect 依赖。

e) **cleanup**（unmount / 依赖变）：在 handleEvent 的 useEffect cleanup 加：
```ts
return () => {
  unsubscribe();
  if (rafIdRef.current !== null) {
    cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = null;
  }
  // flush 残留（best-effort）
  flushBatch();
};
```

- [ ] **Step 2: typecheck + build:client**

```bash
npx tsc --noEmit -p tsconfig.json && echo TSC_OK
npm run build:client 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/hooks/useChatRealtimeHandlers.ts
git commit -m "feat(ws): batch shouldpersist events via raf"
```
> Subject lowercase-only.

---

## Task C3: 去 `latestMessage` + `TaskMasterContext` 改 subscribe

**Files:**
- Modify: `src/contexts/WebSocketContext.tsx`
- Modify: `src/components/task-master/context/TaskMasterContext.tsx`

- [ ] **Step 1: 读 TaskMasterContext latestMessage effect**

```bash
cd D:/workspace/projects/ai/apps/planrla/.claude/worktrees/ws-batch
sed -n '55,75p' src/components/task-master/context/TaskMasterContext.tsx
sed -n '335,370p' src/components/task-master/context/TaskMasterContext.tsx
```
理解 effect（L342-364）如何用 latestMessage（处理 TaskMaster WS 事件 → refreshCurrentProjectTaskMaster/refreshMCPStatus/refreshProjects/refreshTasks）。

- [ ] **Step 2: WebSocketContext 删 latestMessage**

在 `src/contexts/WebSocketContext.tsx`：

a) 删 `const [latestMessage, setLatestMessage] = useState<ServerEvent | null>(null);`（L71）

b) `dispatch`（L76-85）：删 `setLatestMessage(event);`（L84）。dispatch 只 fan-out listeners：
```ts
const dispatch = useCallback((event: ServerEvent) => {
  for (const listener of listenersRef.current) {
    try {
      listener(event);
    } catch (error) {
      console.error('WebSocket listener error:', error);
    }
  }
}, []);
```

c) context 类型 `WebSocketContextType`：删 `latestMessage: ServerEvent | null;`（L40）

d) context value（return 的 useMemo，L174-177）：删 `latestMessage`

> 注释 L37-38（"chat streams must use subscribe... latestMessage lossy"）可删（latestMessage 不再存在）。

- [ ] **Step 3: TaskMasterContext 改 subscribe listener**

在 `src/components/task-master/context/TaskMasterContext.tsx`：

a) `const { latestMessage } = useWebSocket();`（L61）改：
```ts
const { subscribe } = useWebSocket();
```

b) 删 latestMessage effect（L342-364），改 subscribe listener：
```ts
useEffect(() => {
  // 旧 latestMessage effect 的逻辑：处理 TaskMaster 相关 WS 事件
  const handleTaskMasterEvent = (message: TaskMasterWebSocketMessage | null) => {
    // ...现有 effect 内的处理逻辑（refreshCurrentProjectTaskMaster/refreshMCPStatus/refreshProjects/refreshTasks 的条件 + 调用）...
  };
  const unsubscribe = subscribe((event) => {
    handleTaskMasterEvent(event as unknown as TaskMasterWebSocketMessage);
  });
  return unsubscribe;
}, [currentProject?.projectId, subscribe, refreshCurrentProjectTaskMaster, refreshMCPStatus, refreshProjects, refreshTasks]);
```

> 把现有 effect 内的"处理 latestMessage"逻辑整体搬进 `handleTaskMasterEvent`（subscribe listener）。逻辑不变，只换触发源（latestMessage state → subscribe event）。依赖：去掉 latestMessage，加 subscribe + 原依赖。

- [ ] **Step 4: typecheck + build:client**

```bash
npx tsc --noEmit -p tsconfig.json && echo TSC_OK
npm run build:client 2>&1 | tail -3
```
> 可能需修其他 latestMessage 消费者（grep `latestMessage` in src/ 确认仅 TaskMasterContext + WebSocketContext）。如有其他，一并改 subscribe。

- [ ] **Step 5: Commit**

```bash
git add src/contexts/WebSocketContext.tsx src/components/task-master/context/TaskMasterContext.tsx
git commit -m "feat(ws): drop latestmessage taskmaster subscribe"
```
> Subject lowercase-only. "latestmessage" 避 PascalCase（去连字符或大写）。

---

## 验收清单

**C1**
- [ ] `batchBySession.test.ts` 4 tests PASS
- [ ] groupBy session + 顺序保留

**C2**
- [ ] shouldPersist 事件（tool_use 等）累积 batchQueue + rAF flush → appendRealtimeBatch
- [ ] stream_delta 不进 batch（100ms 合并不变）
- [ ] status/permission/complete 即时（不批量）
- [ ] unmount cleanup（cancelAnimationFrame + flush 残留）
- [ ] typecheck + build:client 干净

**C3**
- [ ] WebSocketContext 无 latestMessage state + dispatch 不 setLatestMessage + context 无 latestMessage 字段
- [ ] TaskMasterContext 用 subscribe listener（替代 latestMessage effect）
- [ ] 无其他 latestMessage 消费者残留（grep）
- [ ] typecheck + build:client 干净

**整体（B baseline 度量 + 手动）**
- [ ] stream_delta first-token 不回归（100ms 合并 + B2 测点不变）
- [ ] WS provider tree 重渲频率：去 latestMessage 后归零（latestMessage 是元凶）
- [ ] tool_use store 写：批量后降低（rAF 合并 N 帧 → per-session 一次 appendRealtimeBatch）
- [ ] chat 高频运行（AI 密集工具调用）：输入不卡

## 风险与回退

- **rAF 批量延迟 16ms**：tool_use UI 更新延迟 16ms（人眼无感）。stream/control/status/permission 即时不受影响。
- **flush 时机**：stream_end/complete 的 finalize 后需 flush batch（避免 tool_use 滞后于 finalize）。C2 Step 1d 处理。
- **TaskMaster subscribe 适配**：listener 内逻辑 = 旧 latestMessage effect（不丢功能）。C3 手动验证 TaskMaster。
- **stream_delta 不进 batch**：确保 handleEvent 的 stream_delta 分支（L184-214）在 batch push 之前 return（现有结构已是，stream_delta 有独立分支 + return）。
- **其他 latestMessage 消费者**：grep 确认仅 TaskMasterContext（已读，C3 Step 4 验证）。
