---
REQ-ID: REQ-030
标题: AI 自动重命名(10 轮触发)实施计划
日期: 2026-07-11
关联 spec: docs/superpowers/specs/2026-07-11-req029-ai-auto-rename-design.md
---

# REQ-030 AI 自动重命名 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新会话第 10 次 assistant 响应完成 + 无标题时,前端自动发起 silent agent 调用让当前 provider 生成标题写库,用户无感。

**Architecture:** A1 — 复用 chat WS 通道加 `silent` 标志。后端 `chat-websocket.service.ts` 识别 silent run(绕过 per-session 单 run 互斥 + stream 事件打 silent 标记);前端 `useChatRealtimeHandlers` 丢弃 silent 事件;新增 `useAutoRename` hook 在 `complete` 事件检查轮数发起 silent 调用。

**Tech Stack:** React hooks · WebSocket(JSON-RPC-ish 帧)· Express · provider agent runners(claude-sdk/openai-codex/gemini-cli/cursor-cli/opencode-cli)

---

## File Structure

| 文件 | 责任 | 改动 |
|---|---|---|
| `server/modules/websocket/services/chat-websocket.service.ts` | WS handler,`handleChatSend`(L107-181) | 改:识别 `options.silent`,silent run 走独立 registry key 不撞 `RUN_IN_PROGRESS` |
| `server/modules/websocket/services/chat-run-registry.ts`(实际文件名执行时确认) | per-session run 互斥 + 事件打 seq | 改:startRun 接受 `silent` 维度;silent run 的 writer 输出事件加 `silent:true` |
| `src/components/chat/hooks/useChatRealtimeHandlers.ts` | WS→store 消费(L207-326) | 改:`stream_delta`/`stream_end`/`complete` 三分支检测 `silent:true` → 不入 store/不渲染/不响铃/不 refreshFromServer |
| `src/components/chat/hooks/useAutoRename.ts` | 触发逻辑 | 新建:订阅 `complete`,检查 assistant turn ≥ 10 + summary 空 + !inFlight → 发 silent `chat.send` |
| `src/components/chat/hooks/useAutoRename.test.ts` | 单测 | 新建 |
| `src/components/chat/hooks/useChatComposerState.ts` | composer | 改:挂载 `useAutoRename`(传 sendMessage/selectedSession/subscribe) |

**不改**:`session-query-mcp.route.ts`、`session-rename.service.ts`、`useRenameCommand.ts`(复用 `formatRenameCommandHint`)、`useProjectsState.ts`(`session_renamed` 监听已在)、DB schema、provider 矩阵。

---

## 前置约定

- **轮数定义**:`sessionStore.getMessages(sid)` 中 `role==='assistant' && kind==='text'` 的消息数 ≥ 10。(streaming 占位 `__streaming_*` 和 `stream_delta` kind 不计。)
- **"无标题"判定**:`!selectedSession.summary || summary === 'Untitled'`(执行时确认默认占位名,见 `provider.routes.ts:299` `parseSessionRenameSummary`)。
- **silent run**:WS 帧 `{ type:'chat.send', sessionId, content:<hint>, options:{ silent:true, model, ... } }`。server 不让它撞单 run 互斥;它的 stream 事件全部带 `silent:true`;前端丢弃。
- **复用的 hint 字符串**:`formatRenameCommandHint(sessionId)`(无标题版,`useRenameCommand.ts:26`)。

---

## Task 1: 后端 — handleChatSend 识别 silent + 绕过单 run 互斥

**Files:**
- Modify: `server/modules/websocket/services/chat-websocket.service.ts`(handleChatSend ~L107-181,chatRunRegistry.startRun ~L137-153)
- Test: `server/modules/websocket/services/chat-websocket.service.test.ts`(若无则新建,执行时确认测试约定,参照同目录现有 .test.ts)

- [ ] **Step 1: 写失败测试 — silent run 不被 RUN_IN_PROGRESS 挡**

在 chat-websocket.service 的测试文件加用例:mock 一个 session 正在 run(正常 run 占用 sessionId),再发一个 `options.silent:true` 的 `chat.send`,断言 silent run **不**返回 `RUN_IN_PROGRESS` protocol_error,而是正常 startRun。

```ts
// 伪代码骨架 — 执行时对照实际测试 helper 风格
it('silent run bypasses RUN_IN_PROGRESS mutex', async () => {
  // 占用 normal run
  chatRunRegistry.startRun({ sessionId: SID, connection: ws, silent: false });
  // silent run 应当能启动
  const result = chatRunRegistry.startRun({ sessionId: SID, connection: ws2, silent: true });
  expect(result.run).toBeDefined();          // 不被拒
  expect(result.error).toBeUndefined();       // 没有 RUN_IN_PROGRESS
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run server/modules/websocket/services/chat-websocket.service.test.ts -t "silent run bypasses"`(或项目实际测试命令 `npm test -- <filter>`)
Expected: FAIL(startRun 还不认 silent 维度)

- [ ] **Step 3: 改 chatRunRegistry.startRun — silent 用独立 key 维度**

对照 `chat-run-registry.ts` 的 `startRun` 实际签名,让 registry 的内部 Map key 从 `sessionId` 改为 `sessionId + (silent? ':silent' : '')`,这样 silent run 和 normal run 互不占同一槽位。

```ts
// 改动骨架(对照实际行号)
function runKey(sessionId: string, silent: boolean) {
  return silent ? `${sessionId}:silent` : sessionId;
}
// startRun 内部所有 registry lookup 改用 runKey(sessionId, opts.silent)
```

- [ ] **Step 4: 改 handleChatSend — 透传 silent 到 startRun**

`chat-websocket.service.ts` handleChatSend(~L137):

```ts
const silent = Boolean(data.options?.silent);
const startResult = chatRunRegistry.startRun({
  sessionId,
  connection: ws,
  silent,
  // ...其他现有字段
});
// RUN_IN_PROGRESS 分支不变(silent run 现在有自己的 key,不会被 normal run 占用挡)
```

- [ ] **Step 5: 跑测试确认通过**

Run: 同 Step 2 命令
Expected: PASS

- [ ] **Step 6: commit**

```bash
git add server/modules/websocket/services/chat-websocket.service.ts server/modules/websocket/services/chat-run-registry.ts server/modules/websocket/services/chat-websocket.service.test.ts
git commit -m "feat(server): silent chat.run bypasses per-session mutex (REQ-030)"
```

---

## Task 2: 后端 — silent run 事件打 silent:true 标记

**Files:**
- Modify: `chat-run-registry.ts` 的 writer / event emit 路径(执行时对照 — writer 在 handleChatSend L171 `spawnFn(command, runtimeOptions, run.writer)`)
- Test: 同 Task 1 测试文件

- [ ] **Step 1: 写失败测试 — silent run 的事件带 silent:true**

```ts
it('silent run tags all streamed events with silent:true', () => {
  const run = chatRunRegistry.startRun({ sessionId: SID, connection: ws, silent: true });
  const events: unknown[] = [];
  run.on('event', (e) => events.push(e));  // 或对照实际 emitter API
  run.writer.write({ kind: 'stream_delta', content: 'x' });
  run.writer.write({ kind: 'complete', success: true });
  expect(events.every((e: any) => e.silent === true)).toBe(true);
});
```

- [ ] **Step 2: 跑测试确认失败** — Run 同前,Expected FAIL

- [ ] **Step 3: 实现 — silent run 的 writer/emit 包一层加 silent:true**

在 chatRunRegistry 创建 silent run 时,包装它的 writer/emit,给每条出站事件加 `silent: true` 字段。对照实际 writer 接口(可能是 `run.writer` 对象或 emitter),在事件流出 registry → WS 广播前注入:

```ts
// 骨架:silent run 的事件广播前打标
function broadcastEvent(run, event) {
  const enriched = run.silent ? { ...event, silent: true } : event;
  // 现有广播逻辑(enriched)
}
```

- [ ] **Step 4: 跑测试确认通过** — Expected PASS

- [ ] **Step 5: commit**

```bash
git add server/modules/websocket/services/chat-run-registry.ts server/modules/websocket/services/chat-websocket.service.test.ts
git commit -m "feat(server): tag silent run events with silent:true (REQ-030)"
```

---

## Task 3: 前端 — useChatRealtimeHandlers 丢弃 silent 事件

**Files:**
- Modify: `src/components/chat/hooks/useChatRealtimeHandlers.ts`(`stream_delta` L207-238、`stream_end` L239-259、`complete` L276-326)
- Test: `src/components/chat/hooks/useChatRealtimeHandlers.test.ts`(若无则新建)

- [ ] **Step 1: 写失败测试 — silent 事件不进 store/不响铃/不触发 onSessionProcessing**

```ts
it('ignores silent-tagged events', () => {
  const store = makeMockStore();
  const handlers = makeHandlers({ store });
  handlers.handleEvent({ kind: 'stream_delta', sessionId: SID, content: 'hi', silent: true });
  handlers.handleEvent({ kind: 'stream_end', sessionId: SID, silent: true });
  handlers.handleEvent({ kind: 'complete', sessionId: SID, success: true, silent: true });
  expect(store.appendDelta).not.toHaveBeenCalled();
  expect(store.finalizeStreaming).not.toHaveBeenCalled();
  expect(store.refreshFromServer).not.toHaveBeenCalled();
  // 不响铃 / 不触发 onSessionProcessing(对照实际副作用)
});
```

- [ ] **Step 2: 跑测试确认失败** — `npm test -- useChatRealtimeHandlers`,Expected FAIL

- [ ] **Step 3: 实现 — 三个分支顶部加 silent 早返回**

```ts
// stream_delta 分支(L207 附近)顶部
if (event.silent) return;
// stream_end 分支(L239 附近)顶部
if (event.silent) return;
// complete 分支(L276 附近)顶部
if (event.silent) {
  // silent run 完成:不响铃、不刷新、不触发 onSessionProcessing
  // 但要触发 useAutoRename 的检查(见 Task 4)— 通过 onSessionCompleted 回调链
  onSessionCompleted?.(event.sessionId, { silent: true, success: event.success !== false });
  return;
}
```

注意:`complete` 的 silent 分支**仍要触发 `onSessionCompleted`**(Task 4 依赖它判断"上一轮完成了"),只是不触发 UI 副作用。

- [ ] **Step 4: 跑测试确认通过** — Expected PASS

- [ ] **Step 5: commit**

```bash
git add src/components/chat/hooks/useChatRealtimeHandlers.ts src/components/chat/hooks/useChatRealtimeHandlers.test.ts
git commit -m "feat(chat): drop silent run events from UI side-effects (REQ-030)"
```

---

## Task 4: 前端 — useAutoRename hook

**Files:**
- Create: `src/components/chat/hooks/useAutoRename.ts`
- Create: `src/components/chat/hooks/useAutoRename.test.ts`
- Reference: `useChatComposerState.ts`(L816 sendMessage 调用样式)、`useSessionStore.ts`(getMessages L699)、`useChatRealtimeHandlers.ts`(onSessionCompleted 回调)

- [ ] **Step 1: 写失败测试 — 10 轮 + 无标题 触发 silent 调用**

```ts
import { renderHook } from '@testing-library/react';
import { useAutoRename } from './useAutoRename';

it('fires silent rename when 10 assistant turns reached and no title', () => {
  const sent: unknown[] = [];
  const sessionStore = {
    getMessages: () => Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`, kind: 'text', role: 'assistant', content: 'x',
    })),
  };
  const selectedSession = { id: SID, summary: '' };
  const { result } = renderHook(() => useAutoRename({
    selectedSession, sessionStore,
    sendMessage: (m) => sent.push(m),
  }));
  act(() => result.current.onSessionCompleted(SID, { success: true }));
  expect(sent).toHaveLength(1);
  expect((sent[0] as any).options.silent).toBe(true);
  expect((sent[0] as any).content).toContain('重命名当前会话');
  expect((sent[0] as any).content).toContain(SID);
});

it('does not fire when already titled', () => {
  // summary = '已有标题' → 不触发
  // ...断言 sent.length === 0
});

it('does not fire twice (in-flight guard)', () => {
  // 连续两次 onSessionCompleted → 只发一次
});

it('does not fire before 10 turns', () => {
  // 9 条 assistant → 不触发
});
```

- [ ] **Step 2: 跑测试确认失败** — `npm test -- useAutoRename`,Expected FAIL(模块不存在)

- [ ] **Step 3: 实现 useAutoRename**

```ts
// src/components/chat/hooks/useAutoRename.ts
import { useRef } from 'react';
import { formatRenameCommandHint } from './useRenameCommand';

const TITLE_THRESHOLD = 10;
const DEFAULT_PLACEHOLDERS = /^(Untitled|)$/i;  // 执行时对齐 parseSessionRenameSummary

interface UseAutoRenameArgs {
  selectedSession: { id: string; summary?: string } | null;
  sessionStore: { getMessages: (sid: string) => Array<{ kind: string; role?: string }> };
  sendMessage: (msg: unknown) => void;
}

export function useAutoRename({ selectedSession, sessionStore, sendMessage }: UseAutoRenameArgs) {
  const inFlightRef = useRef(false);

  const onSessionCompleted = (sessionId: string, opts: { success: boolean; silent?: boolean }) => {
    // 只在正常 run(silent run 完成时不是触发点)、且成功完成时检查
    if (opts.silent || !opts.success) return;
    if (!selectedSession || selectedSession.id !== sessionId) return;
    if (inFlightRef.current) return;
    if (selectedSession.summary && !DEFAULT_PLACEHOLDERS.test(selectedSession.summary)) return;

    const msgs = sessionStore.getMessages(sessionId);
    const assistantTurns = msgs.filter((m) => m.kind === 'text' && m.role === 'assistant').length;
    if (assistantTurns < TITLE_THRESHOLD) return;

    inFlightRef.current = true;
    const hint = formatRenameCommandHint(sessionId);  // 无标题版
    sendMessage({
      type: 'chat.send',
      sessionId,
      content: hint,
      options: { silent: true },
    });
    // inFlightRef 在 session_renamed 写库后复位(见 Task 4 Step 3b)
  };

  return { onSessionCompleted };
}
```

- [ ] **Step 3b: inFlight 复位 — 监听 session_renamed 或新 silent run complete**

`inFlightRef` 复位时机:custom_name 写库后(`session_renamed` 事件)或 silent run complete 后。复用 `useProjectsState` 的 `session_renamed` 监听不易(在别的 hook),所以简化:silent run complete(Task 3 的 `onSessionCompleted(silent:true)`)时复位。

```ts
// onSessionCompleted 里补 silent 分支:
if (opts.silent) {
  inFlightRef.current = false;  // silent run 结束,允许下次(虽然 custom_name 写了守卫也挡)
  return;
}
```

- [ ] **Step 4: 跑测试确认通过** — Expected PASS(4 个用例全过)

- [ ] **Step 5: commit**

```bash
git add src/components/chat/hooks/useAutoRename.ts src/components/chat/hooks/useAutoRename.test.ts
git commit -m "feat(chat): useAutoRename hook fires silent rename at turn 10 (REQ-030)"
```

---

## Task 5: 前端 — 在 composer 挂载 useAutoRename + 接 onSessionCompleted

**Files:**
- Modify: `src/components/chat/hooks/useChatComposerState.ts`(挂载点 + 把 onSessionCompleted 接到 realtime handler)

- [ ] **Step 1: 写失败测试 — composer 接线触发 useAutoRename**

集成测试:mock sessionStore 10 assistant turns + 空 summary,触发 realtime complete,断言 `sendMessage` 被以 `silent:true` 调用一次。

- [ ] **Step 2: 跑确认失败**

- [ ] **Step 3: 实现 — 挂载 + 接线**

在 `useChatComposerState.ts`:

```ts
import { useAutoRename } from './useAutoRename';
// ...在 hook 体里:
const { onSessionCompleted: onAutoRenameCompleted } = useAutoRename({
  selectedSession,
  sessionStore,
  sendMessage,  // 现有 L816 用的那个
});
// 把 onAutoRenameCompleted 并入 realtime handler 的 onSessionCompleted 回调链
// (对照 useChatRealtimeHandlers 的 onSessionCompleted 接线点 — L310 一带)
```

接线细节:若 `onSessionCompleted` 已有回调链(在 useProjectsState/useSessionProtection),把 `onAutoRenameCompleted` 加进同一 sid 的通知链;若没有,在 useChatRealtimeHandlers 的 complete 分支(L310)调 `onAutoRenameCompleted(sid, { success, silent })`。

- [ ] **Step 4: 跑测试 + typecheck + build**

```bash
npm run typecheck && npm run build
```
Expected: 无类型错误,build 成功

- [ ] **Step 5: commit**

```bash
git add src/components/chat/hooks/useChatComposerState.ts src/components/chat/hooks/useChatRealtimeHandlers.ts
git commit -m "feat(chat): wire useAutoRename into composer + complete handler (REQ-030)"
```

---

## Task 6: 端到端验收

- [ ] **Step 1: 手测 Claude provider**
  - 新会话,发 10 轮对话(确保 summary 为空)
  - 第 10 次 assistant 响应完成后,观察侧边栏:标题应自动变成 AI 生成的简短标题
  - chat UI 不应出现 rename hint 消息或 agent 响应(silent)

- [ ] **Step 2: 手测守卫**
  - 已手动改名(`summary` 非空)的会话,发 10+ 轮 → 不触发自动重命名
  - 自动命名后的会话,继续发到 20 轮 → 不重复触发

- [ ] **Step 3: 手测跨 provider**
  - 切到 Codex / Grok provider,新会话 10 轮 → 自动命名工作(各 provider agent 调 set_session_title 的行为验证)

- [ ] **Step 4: 手测失败静默**
  - 模拟 agent 不调 set_session_title(如断网)→ 对话不阻塞、不报错

- [ ] **Step 5: 回归**
  - 手动 `/rename`、侧边栏✏️、`query_session`、`search_conversations` 行为正常

- [ ] **Step 6: 预检 + 发版准备**

```bash
npm run typecheck && npm run build && git diff --check
```
Expected: 全过 → 进 review/accepted 流程

---

## Self-Review(plan 写完后自检)

- **Spec 覆盖**:spec §4.1(触发条件)→ Task 4;§4.2(轮数)→ Task 4 Step 3;§4.3(触发动作)→ Task 4+5;§4.4(silent 不污染)→ Task 2+3;§4.5(跨 provider)→ Task 6 Step 3;§4.6(失败静默)→ Task 6 Step 4;§7 验收 → Task 6。全覆盖。
- **类型一致**:`onSessionCompleted(sessionId, { success, silent })` 在 Task 3/4/5 一致;`options.silent` 在 Task 1/4/5 一致;`runKey` 在 Task 1/2 一致。
- **无占位符**:每 step 给了代码骨架或命令;几处标"执行时对照实际行号"(handleChatSend L107-181、chatRunRegistry 实际文件名、parseSessionRenameSummary 占位名)——这些是 plan 阶段无法 100% 确定的实际代码细节,执行时打开文件对照即可,不是 spec 缺陷。
- **范围聚焦**:单一需求,无需分解。

## 执行说明

本 plan 涉及前后端 + WS 协议(server silent 标记 + 前端丢弃),Task 1-2 必须先做(server 先支持 silent),Task 3 再做(前端丢弃),Task 4-5 最后(触发逻辑)。Task 顺序即依赖顺序。
