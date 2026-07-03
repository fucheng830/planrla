# WS 非流事件批量 + 去 latestMessage 设计（C sub-project）

> **状态**：设计待审
> **日期**：2026-07-03
> **范围**：planrla 前端 WebSocket（`WebSocketContext` + `useChatRealtimeHandlers` + `TaskMasterContext`），M2 性能专项 C

## 背景

WS 高频运行时（AI 快速输出工具调用 / 状态变化）的两个重渲热点：

1. **非流事件每帧同步 store 写**：`useChatRealtimeHandlers` 的 `handleEvent` 对每个 `status` / `tool_use` / `permission_request` 帧同步 `sessionStore` 写 + 触发 re-render。AI 一轮密集工具调用 = N 帧 = N 次 store 写 + N 次渲染。
2. **`WebSocketContext` 每帧 `setLatestMessage(event)`**（dispatch L84）→ 整个 WS provider tree 每帧重渲。但 `latestMessage` 只被 `TaskMasterContext`（L61）低频消费；chat 用 `subscribe` API（不依赖 latestMessage）。注释（L37-38）已承认 latestMessage "lossy under load"。

`stream_delta` 已在 handler 内用 `accumulatedStreamRef` + `streamTimerRef`（100ms setTimeout）合并 —— 不在 C 范围。

## 目标

1. **非流事件批量（handler 层）**：`useChatRealtimeHandlers` 收非流事件后，rAF 16ms 窗口合并同 session 事件，一次 `sessionStore` 写（替代每事件写）。
2. **去 `latestMessage`**：`TaskMasterContext` 改用 `subscribe` listener；`WebSocketContext` 删 `latestMessage` state + `setLatestMessage` + context 字段 → 消除每帧 provider tree 重渲。

### 非目标（YAGNI）

- ❌ 不动 `stream_delta` 100ms 合并（accumulatedStream + streamTimer，已优化）
- ❌ 不批量 sidebar 低频事件（`session_upserted` / `loading_progress` 由 `useProjectsState` 处理，不在本 hook）
- ❌ 不批量即时控制事件（`websocket_reconnected` / `chat_subscribed` 等，需即时响应）
- ❌ 不引入 WS 框架 / 协议改动
- ❌ 不改 WS 协议或后端

## 设计

### 1. 非流事件批量（handler 层，`useChatRealtimeHandlers`）

**现状**（`handleEvent` switch `msg.kind`）：
- `stream_delta`：`accumulatedStreamRef` 累积 + `streamTimerRef` 100ms setTimeout flush（**不动**）
- `status` / `tool_use` / `permission_request`：每帧同步 `sessionStore` 写
- `websocket_reconnected` / `chat_subscribed` / `stream_end` / `complete`：即时控制（不批量）

**改造**：
- 非流事件（`status` / `tool_use` / `permission_request`）累积到 `batchQueueRef`（按 sessionId 分组）
- `scheduleFlush`（rAF 16ms 调度）：flush `batchQueue` → `batchEvents` 合并 → 一次 `sessionStore` 写（per session）
- rAF 取消（unmount / 依赖变）
- 即时事件（control / stream_delta）走原路径，不进 batchQueue

**纯函数 `batchEvents(events: ServerEvent[]): BatchedUpdate`**（`src/components/chat/utils/batchEvents.ts`，node:test 可测）：

- 同 session 多 `status` → 取最后状态（语义：最新覆盖旧）
- 同 session 多 `tool_use` → 累积工具调用（顺序保留，追加）
- `permission_request` → 累积到 pending 列表
- 不同 session 不混（per-session Map）
- 返回 per-session 的 store 更新操作（status / tools / permission）

> `batchEvents` 是纯函数：输入事件数组，输出合并后的 per-session 更新。无副作用，易测。

**rAF 调度**（`useChatRealtimeHandlers` 内）：
```ts
const batchQueueRef = useRef<ServerEvent[]>([]);
const rafIdRef = useRef<number | null>(null);

const flushBatch = () => {
  rafIdRef.current = null;
  const events = batchQueueRef.current;
  batchQueueRef.current = [];
  if (events.length === 0) return;
  const batched = batchEvents(events);
  // apply batched to sessionStore (per session)
  applyBatchedToStore(sessionStore, batched);
};

const scheduleFlush = () => {
  if (rafIdRef.current !== null) return; // 已调度
  rafIdRef.current = requestAnimationFrame(flushBatch);
};

// handleEvent 非流分支：
// batchQueueRef.current.push(msg); scheduleFlush();
```

> rAF 16ms 窗口：同帧/邻近帧的事件合并。flush 在下一帧渲染前 → store 写一次 → 一次渲染。

### 2. 去 `latestMessage`

**`WebSocketContext.tsx` 改造**：
- 删 `const [latestMessage, setLatestMessage] = useState<ServerEvent | null>(null);`（L71）
- `dispatch`（L76-85）：删 `setLatestMessage(event)`（L84），只保留 fan-out listeners
- 删 context 类型 `latestMessage` 字段 + context value `latestMessage`
- 消除每帧 provider tree 重渲（dispatch 不再 setState）

**`TaskMasterContext.tsx` 改造**：
- 现状（L61）：`const { latestMessage } = useWebSocket();` + effect（L342-364）监听 latestMessage
- 改：用 `subscribe` listener 替代 effect
  ```ts
  const { subscribe } = useWebSocket();
  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      // 旧 latestMessage effect 的逻辑（处理 TaskMaster 相关事件）
      handleTaskMasterEvent(message);
    });
    return unsubscribe;
  }, [/* 依赖，按现有 effect */]);
  ```
- `handleTaskMasterEvent` = 旧 effect 内的逻辑（处理 TaskMaster WS 事件）

> TaskMaster 改 subscribe 后，不再触发 WS provider tree 重渲（subscribe 是 ref listener，不 setState）。WS provider tree 重渲频率归零（latestMessage 是唯一每帧 setState）。

### 3. 测试

- `batchEvents` 纯函数 node:test（`src/components/chat/utils/batchEvents.test.ts`）：
  - 同 session 多 status → 最后状态
  - 同 session 多 tool_use → 累积工具
  - 多 session 不混
  - permission_request 累积
  - 空输入 → 空更新
- rAF 调度 + store 写集成（手动，dev console B baseline 度量）
- TaskMaster subscribe 适配（手动，TaskMaster 功能保留）

### 4. B baseline 度量

- `first-token` / stream-delta（B2 测点）：before/after（stream 不动，预期不变 —— 验证不回归）
- WS provider tree 重渲频率：去 latestMessage 后应大幅降低（latestMessage 是元凶）
- 非流事件 store 写频率：批量后降低（rAF 合并 N 帧 → 1 写/帧）

## 风险与约束

- **rAF 批量延迟（16ms）**：非流事件 UI 更新延迟最多 16ms（人眼阈值边缘，可接受；AI 状态/工具调用延迟 16ms 无感）
- **`batchEvents` 合并语义**：status 取最后、tool_use 累积、permission 累积 —— 需正确（不丢信息）。测试覆盖。
- **TaskMaster subscribe 适配**：listener 内逻辑 = 旧 latestMessage effect（不丢功能）。手动验证 TaskMaster。
- **stream_delta 不动**：确保 rAF 批量不影响 stream_delta 的 100ms 合并（stream 不进 batchQueue）。
- **rAF 在非浏览器环境**：Electron renderer 有 rAF；如 SSR/测试无 rAF，fallback setTimeout(0)（batchEvents 实现时容错）。

## 验收

- `batchEvents` 纯函数测试通过
- 非流事件（status/tool_use/permission）批量：高频运行时 store 写频率降低（rAF 合并）
- WS provider tree 重渲：去 latestMessage 后不再每帧（归零或大幅降低）
- stream_delta：不回归（100ms 合并不变）
- TaskMaster 功能：subscribe 适配后正常（手动验证）
- chat 高频运行（AI 密集工具调用）：输入不卡（B baseline 度量 + 手动）

## 范围

单 spec 可实现。建议 plan 拆：
1. `batchEvents` 纯函数 + 测试
2. `useChatRealtimeHandlers` 接 rAF 批量
3. `WebSocketContext` 去 latestMessage + `TaskMasterContext` 改 subscribe
