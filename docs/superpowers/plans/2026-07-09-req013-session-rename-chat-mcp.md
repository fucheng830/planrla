# 会话重命名(chat 触发 · MCP 工具)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在 chat 里输入 `/rename`(或自然语言),由 Claude Code agent 生成标题并通过 MCP 工具 `set_session_title` 落库,侧边栏经 WS `session_renamed` 实时刷新。

**Architecture:** 不在 server 端调 LLM(消解 REQ-013 的 blocked)。agent 自身即 LLM,生成标题文本后调用 planrla 暴露的 MCP 工具;工具 handler 同进程写 `sessions.custom_name` 并广播 WS。`/rename` 斜杠命令由前端拦截、把当前 sessionId + 指令拼成 hint prepend 进用户消息(照搬 `/search` 范式)。

**Tech Stack:** Next.js + React + TypeScript(前端);Node/Express + better-sqlite3(后端);`@anthropic-ai/claude-agent-sdk`(agent);测试用 Node 内置 `node:test` + `node:assert/strict`(非 vitest/jest),跑法 `node --import tsx --test <file>`。

**对应 spec:** `docs/superpowers/specs/2026-07-09-req013-session-rename-chat-mcp-design.md`

---

## File Structure

| 文件 | 职责 | 新/改 |
|------|------|-------|
| `server/modules/mcp/session-rename.service.ts` | 重命名核心逻辑:`setSessionTitle(sessionId, title)` 做校验→落库→广播;`broadcastSessionRenamed` 遍历 `connectedClients`。抽出为独立可测单元 | 新 |
| `server/modules/mcp/tests/session-rename.service.test.ts` | `setSessionTitle` 单测:隔离 sqlite 验证落库、长度/空校验、FakeConnection 验证广播帧 | 新 |
| `server/modules/mcp/session-query-mcp.route.ts` | 加 `SET_SESSION_TITLE_TOOL` 定义 + `callTool` 分支(调 `setSessionTitle`)+ `tools/list` 注册 + 顶部注释从 read-only 更新 | 改 |
| `src/components/chat/hooks/useRenameCommand.ts` | `parseRenameCommand` / `formatRenameCommandHint` 纯函数 | 新 |
| `src/components/chat/hooks/useRenameCommand.test.ts` | 两个纯函数的单测 | 新 |
| `src/components/chat/hooks/useChatComposerState.ts` | `handleSubmit` 里 `/rename` 拦截(照搬 `/search` 拦截点),拼 hint + 注入 `currentSessionId` | 改 |
| `src/hooks/useProjectsState.ts` | `session_upserted` effect 里加 `session_renamed` 分支,就地更新对应 session 的 `summary` | 改 |
| `server/shared/types.ts` | realtime event kind 联合加 `'session_renamed'`(仅当 typecheck 报缺该字面量时) | 改(条件) |

**不改:** DB schema(`custom_name` 列已有)、provider 矩阵(MCP 已 `addMcpServerToAllProviders`)、手动重命名链路(侧边栏 ✏️)、`claude-sdk.js` systemPrompt。

---

## Task 1: server 重命名核心逻辑 + 单测(TDD)

**Files:**
- Create: `server/modules/mcp/session-rename.service.ts`
- Create: `server/modules/mcp/tests/session-rename.service.test.ts`

- [ ] **Step 1: 写失败测试**

Create `server/modules/mcp/tests/session-rename.service.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';
import {
  MAX_SESSION_TITLE_LENGTH,
  setSessionTitle,
} from '@/modules/mcp/session-rename.service.js';

type FakeFrame = { kind: string; [k: string]: unknown };
type FakeConnection = { readyState: number; frames: FakeFrame[]; send: (data: string) => void };

function makeFakeConnection(): FakeConnection {
  const frames: FakeFrame[] = [];
  return { readyState: 1, frames, send: (data) => frames.push(JSON.parse(data)) };
}

async function withIsolatedDb<T>(fn: () => Promise<T> | T): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'planrla-rename-'));
  const prevDbPath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(dir, 'test.db');
  try {
    initializeDatabase();
    return await fn();
  } finally {
    closeConnection();
    process.env.DATABASE_PATH = prevDbPath;
    await rm(dir, { recursive: true, force: true });
  }
}

await withIsolatedDb(async () => {
  // Seed a session row to rename.
  const sessionId = 'sess-rename-1';
  sessionsDb.upsertSession({
    sessionId,
    provider: 'claude',
    providerSessionId: null,
    projectPath: null,
    jsonlPath: null,
    customName: 'Untitled Claude Session',
  });

  test('setSessionTitle writes custom_name and broadcasts session_renamed', () => {
    connectedClients.clear();
    const conn = makeFakeConnection();
    connectedClients.add(conn as never);

    const result = setSessionTitle(sessionId, '调试 WS 推送');

    assert.equal(result.title, '调试 WS 推送');
    assert.equal(sessionsDb.getSessionById(sessionId)?.custom_name, '调试 WS 推送');
    assert.equal(conn.frames.length, 1);
    assert.equal(conn.frames[0].kind, 'session_renamed');
    assert.equal(conn.frames[0].sessionId, sessionId);
    assert.equal(conn.frames[0].summary, '调试 WS 推送');

    connectedClients.clear();
  });

  test('setSessionTitle trims surrounding whitespace before writing', () => {
    connectedClients.clear();
    setSessionTitle(sessionId, '  padded title  ');
    assert.equal(sessionsDb.getSessionById(sessionId)?.custom_name, 'padded title');
  });

  test('setSessionTitle rejects empty title', () => {
    assert.throws(() => setSessionTitle(sessionId, '   '), /required/i);
  });

  test('setSessionTitle rejects title longer than MAX_SESSION_TITLE_LENGTH', () => {
    const tooLong = 'a'.repeat(MAX_SESSION_TITLE_LENGTH + 1);
    assert.throws(() => setSessionTitle(sessionId, tooLong), /exceed/i);
  });
});
```

> 注意:`sessionsDb.upsertSession` 的确切参数名以 `server/modules/database/repositories/sessions.db.ts` 里现有签名为准(实施时若名字不同,改为该文件里用于插入/初始化 session 行的那个方法 —— 通常和 synchronizer 写入用的是同一个)。若没有单步 upsert,可用 `updateSessionCustomName` 前先 `getSessionById` 确认种子行由 `initializeDatabase` 建好,或直接复制 synchronizer 的插入调用。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import tsx --test server/modules/mcp/tests/session-rename.service.test.ts`
Expected: FAIL — `Cannot find module '@/modules/mcp/session-rename.service.js'`(模块尚未创建)。

- [ ] **Step 3: 写最小实现**

Create `server/modules/mcp/session-rename.service.ts`:

```ts
import { sessionsService } from '@/modules/providers/index.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/index.js';

/**
 * Maximum length of an AI/user-generated session title. Tighter than the
 * 500-char cap on the manual rename REST endpoint — generated titles should
 * be short descriptors, not paragraphs.
 */
export const MAX_SESSION_TITLE_LENGTH = 50;

export type SessionRenameResult = { sessionId: string; title: string };

/**
 * Broadcast a `session_renamed` realtime event so the sidebar updates the
 * title in place without a full refresh. Mirrors the `session_upserted`
 * broadcast shape (kind + sessionId + timestamp) the chat run registry uses.
 */
export function broadcastSessionRenamed(sessionId: string, title: string): void {
  const payload = JSON.stringify({
    kind: 'session_renamed',
    sessionId,
    summary: title,
    timestamp: new Date().toISOString(),
  });
  connectedClients.forEach((client) => {
    if (client.readyState === WS_OPEN_STATE) {
      try {
        client.send(payload);
      } catch (error) {
        console.error('[session-rename] broadcast failed:', error);
      }
    }
  });
}

/**
 * Apply a rename: validate → persist via the same service the manual rename
 * REST endpoint uses (`renameSessionById` throws SESSION_NOT_FOUND if the row
 * is missing) → broadcast. Throws on empty / too-long titles.
 */
export function setSessionTitle(sessionId: string, title: string): SessionRenameResult {
  const trimmed = (title ?? '').trim();
  if (!trimmed) {
    throw new Error('title is required.');
  }
  if (trimmed.length > MAX_SESSION_TITLE_LENGTH) {
    throw new Error(`title must not exceed ${MAX_SESSION_TITLE_LENGTH} characters.`);
  }
  sessionsService.renameSessionById(sessionId, trimmed);
  broadcastSessionRenamed(sessionId, trimmed);
  return { sessionId, title: trimmed };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import tsx --test server/modules/mcp/tests/session-rename.service.test.ts`
Expected: PASS(4 tests pass)。若 `upsertSession` 签名不符,按 Step 1 注释修正种子代码后重跑。

- [ ] **Step 5: Commit**

```bash
git add server/modules/mcp/session-rename.service.ts server/modules/mcp/tests/session-rename.service.test.ts
git commit -m "feat(mcp): session rename service (validate/persist/broadcast)" -m "抽出 setSessionTitle 为可测单元,复用 renameSessionById 落库 + 广播 session_renamed WS 事件。" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 接入 MCP 工具 `set_session_title`

**Files:**
- Modify: `server/modules/mcp/session-query-mcp.route.ts`

- [ ] **Step 1: 更新顶部注释 + 加 import**

在 `server/modules/mcp/session-query-mcp.route.ts` 顶部注释块里,把 "it only exposes read access to persisted session transcripts (no auth secrets, no writes)." 改为说明现在含一个写工具:

```
 * Before `validateApiKey` / `authenticateToken` because it is local-only and
 * single-user. It is still local-only single-user; the trust boundary for the
 * one write tool (`set_session_title`) is identical to the existing manual
 * rename REST endpoint (PUT /sessions/:sessionId) — it only re-titles the
 * local user's own session row, no auth secrets, no cross-user surface.
```

在现有 import 区(文件顶部 `import` 行附近)加:

```ts
import { setSessionTitle } from './session-rename.service.js';
```

- [ ] **Step 2: 加工具定义**

在 `SEARCH_CONVERSATIONS_TOOL` 常量之后(约 L92 后)加:

```ts
const SET_SESSION_TITLE_TOOL: ToolDefinition = {
  name: 'set_session_title',
  description:
    'Set a custom title for a conversation session on this host. Call this AFTER you have generated a short (5-15 char) descriptive title from the conversation content, or when the user explicitly asks to rename/retitle the current or a specific session. The title is persisted and the sidebar updates in real time.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'The session id to retitle.' },
      title: {
        type: 'string',
        description: 'The new title. 1-50 chars after trim. Empty/overlong titles are rejected.',
      },
    },
    required: ['sessionId', 'title'],
  },
};
```

- [ ] **Step 3: 在 callTool 加分支**

在 `callTool` 函数里(现在 `if (name === SEARCH_CONVERSATIONS_TOOL.name)` 和 `if (name !== QUERY_SESSION_TOOL.name)` 之间)加一个分支,在 `name !== QUERY_SESSION_TOOL.name` 抛错之前:

```ts
  if (name === SET_SESSION_TITLE_TOOL.name) {
    return setSessionTitleTool(args);
  }
```

并在 `callTool` 上方(或 `searchConversations` 附近)加 handler:

```ts
function setSessionTitleTool(args: Record<string, unknown>) {
  const sessionId = readString(args.sessionId, 'sessionId');
  const title = readString(args.title, 'title');
  const result = setSessionTitle(sessionId, title);
  return jsonResponse(result);
}
```

> `readString` 已在文件里定义(L100-105),trim 后非空校验,抛 `{name} is required.`。长度上限 50 的校验在 `setSessionTitle` 内做。

- [ ] **Step 4: 注册到 tools/list**

把 `handleMessage` 里的 `tools/list` 返回(L253 附近)从:
```ts
    return { tools: [QUERY_SESSION_TOOL, SEARCH_CONVERSATIONS_TOOL] };
```
改为:
```ts
    return { tools: [QUERY_SESSION_TOOL, SEARCH_CONVERSATIONS_TOOL, SET_SESSION_TITLE_TOOL] };
```

- [ ] **Step 5: typecheck 确认**

Run: `npm run typecheck`
Expected: PASS,无错误。

- [ ] **Step 6: Commit**

```bash
git add server/modules/mcp/session-query-mcp.route.ts
git commit -m "feat(mcp): expose set_session_title tool to agent" -m "在 session-query MCP route 注册第 3 个工具,handler 调 setSessionTitle;更新顶部 read-only 注释说明写工具的信任边界。" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 前端 `/rename` 纯函数 + 单测(TDD)

**Files:**
- Create: `src/components/chat/hooks/useRenameCommand.ts`
- Create: `src/components/chat/hooks/useRenameCommand.test.ts`

- [ ] **Step 1: 写失败测试**

Create `src/components/chat/hooks/useRenameCommand.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseRenameCommand, formatRenameCommandHint } from './useRenameCommand';

test('parseRenameCommand: bare /rename → no explicit title', () => {
  assert.deepEqual(parseRenameCommand('/rename'), {});
  assert.deepEqual(parseRenameCommand('/rename   '), {});
});

test('parseRenameCommand: /rename <title> → explicitTitle trimmed', () => {
  assert.deepEqual(parseRenameCommand('/rename 调试 WS 推送'), { explicitTitle: '调试 WS 推送' });
  assert.deepEqual(parseRenameCommand('/rename   spaced out  '), { explicitTitle: 'spaced out' });
});

test('parseRenameCommand: case-insensitive, not matching non-rename', () => {
  assert.deepEqual(parseRenameCommand('/RENAME foo'), { explicitTitle: 'foo' });
  assert.deepEqual(parseRenameCommand('/renamex'), {});
});

test('formatRenameCommandHint: bare form instructs AI to generate + call tool, includes sessionId', () => {
  const hint = formatRenameCommandHint('sess-123');
  assert.match(hint, /id=sess-123/);
  assert.match(hint, /set_session_title/);
  assert.ok(!hint.includes('"'));
});

test('formatRenameCommandHint: explicit form uses the provided title', () => {
  const hint = formatRenameCommandHint('sess-123', '调试 WS 推送');
  assert.match(hint, /id=sess-123/);
  assert.match(hint, /"调试 WS 推送"/);
  assert.match(hint, /set_session_title/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import tsx --test src/components/chat/hooks/useRenameCommand.test.ts`
Expected: FAIL — `Cannot find module './useRenameCommand'`.

- [ ] **Step 3: 写最小实现**

Create `src/components/chat/hooks/useRenameCommand.ts`:

```ts
/**
 * /rename slash-command parsing + hint formatting (mirrors useSearchCommand).
 *
 * `/rename` alone → ask the agent to generate a short title from the
 * conversation and call `set_session_title`.
 * `/rename <title>` → ask the agent to use the provided title verbatim.
 *
 * The hint is prepended to the outgoing user message (same prepend pattern as
 * @reference / /search) so the agent sees the current sessionId and the
 * instruction in one block.
 */
export function parseRenameCommand(rawInput: string): { explicitTitle?: string } {
  const trimmed = rawInput.trim();
  const match = trimmed.match(/^\/rename(?:\s+(.*))?$/i);
  if (!match) {
    return {};
  }
  const rest = (match[1] || '').trim();
  return rest ? { explicitTitle: rest } : {};
}

export function formatRenameCommandHint(sessionId: string, explicitTitle?: string): string {
  if (explicitTitle) {
    return `[重命名当前会话 (id=${sessionId})] 请用标题"${explicitTitle}"调用 set_session_title 工具写入。`;
  }
  return `[重命名当前会话 (id=${sessionId})] 请根据本次对话内容生成一个简短(5-15 字)的标题,并调用 set_session_title 工具写入。`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import tsx --test src/components/chat/hooks/useRenameCommand.test.ts`
Expected: PASS(5 tests pass)。

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/hooks/useRenameCommand.ts src/components/chat/hooks/useRenameCommand.test.ts
git commit -m "feat(chat): add /rename command parser and hint formatter" -m "parseRenameCommand + formatRenameCommandHint 纯函数,照搬 useSearchCommand 范式,注入当前 sessionId + 调用 set_session_title 指令。" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 前端拦截 `/rename` 并注入 hint

**Files:**
- Modify: `src/components/chat/hooks/useChatComposerState.ts`

- [ ] **Step 1: 加 import**

在 `useChatComposerState.ts` 顶部 `useSearchCommand` import 块(L30-34)之后加:

```ts
import { parseRenameCommand, formatRenameCommandHint } from './useRenameCommand';
```

- [ ] **Step 2: 在 handleSubmit 加 `/rename` 拦截**

定位 `handleSubmit`(约 L565)。现有 `/search` 拦截在 L584:
```ts
      let searchHints = '';
      let effectiveInput = currentInput;
      const trimmedCommandInput = currentInput.trim();
      if (/^\/search(?:\s|$)/i.test(trimmedCommandInput)) {
```

把 `let searchHints` 那行改为同时声明 renameHints,并在 `/search` 分支后、`else` 分支前插入 `/rename` 分支。即把:
```ts
      let searchHints = '';
      let effectiveInput = currentInput;
      const trimmedCommandInput = currentInput.trim();
      if (/^\/search(?:\s|$)/i.test(trimmedCommandInput)) {
        // ... existing /search body ...
      } else {
```
改为(在 `/search` 的 `}` 后、`else` 前插入 `else if`):
```ts
      let searchHints = '';
      let renameHints = '';
      let effectiveInput = currentInput;
      const trimmedCommandInput = currentInput.trim();
      if (/^\/search(?:\s|$)/i.test(trimmedCommandInput)) {
        // ... existing /search body unchanged ...
      } else if (/^\/rename(?:\s|$)/i.test(trimmedCommandInput)) {
        if (!currentSessionId) {
          addMessage({
            type: 'assistant',
            content: '请先选择一个会话再使用 /rename。',
            timestamp: Date.now(),
          });
          setInput('');
          inputValueRef.current = '';
          resetCommandMenuState();
          if (textareaRef.current) textareaRef.current.style.height = 'auto';
          return;
        }
        const { explicitTitle } = parseRenameCommand(trimmedCommandInput);
        renameHints = formatRenameCommandHint(currentSessionId, explicitTitle);
        effectiveInput = explicitTitle
          ? `将当前会话重命名为"${explicitTitle}"`
          : '请为当前会话生成一个简短的标题。';
      } else {
```

> `currentSessionId` 已在 hook args 里(L39 `currentSessionId: string | null`)。`addMessage`、`setInput`、`inputValueRef`、`resetCommandMenuState`、`textareaRef` 都在 `/search` 分支里已用,scope 内可用。

- [ ] **Step 3: 把 renameHints 拼进 messageContent**

定位 hints 拼装(L642-646):
```ts
      const referenceHints = formattedHints;
      const hints = [searchHints, referenceHints].filter(Boolean).join('\n\n---\n\n');
```
改为:
```ts
      const referenceHints = formattedHints;
      const hints = [searchHints, renameHints, referenceHints].filter(Boolean).join('\n\n---\n\n');
```

- [ ] **Step 4: typecheck 确认**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/hooks/useChatComposerState.ts
git commit -m "feat(chat): intercept /rename and inject sessionId hint" -m "handleSubmit 里照搬 /search 拦截,/rename 时取 currentSessionId 拼 hint prepend 进消息;无选中会话时给提示。" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 前端监听 `session_renamed` WS 事件刷新侧边栏

**Files:**
- Modify: `src/hooks/useProjectsState.ts`
- Modify(条件): `server/shared/types.ts`

- [ ] **Step 1: 在 session_upserted effect 加 session_renamed 分支**

定位 `useProjectsState.ts` 的 realtime effect(L591 `useEffect(() => { const handleEvent = ...`)。在 `loading_progress` 分支 return 之后、`if (event.kind !== 'session_upserted') return;`(L611)之前插入:

```ts
      if (event.kind === 'session_renamed') {
        const renamed = event as { sessionId: string; summary: string };
        if (!renamed.sessionId) {
          return;
        }
        setProjects((previousProjects) =>
          previousProjects.map((project) => {
            const sessions = project.sessions ?? [];
            const idx = sessions.findIndex((s) => String(s.id) === renamed.sessionId);
            if (idx < 0) {
              return project;
            }
            const nextSessions = [...sessions];
            nextSessions[idx] = { ...nextSessions[idx], summary: renamed.summary };
            return { ...project, sessions: nextSessions };
          }),
        );
        // Keep the currently selected session header in sync too.
        setSelectedSession((prev) =>
          prev && String(prev.id) === renamed.sessionId
            ? { ...prev, summary: renamed.summary }
            : prev,
        );
        return;
      }
```

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`

- [ ] **Step 3(条件): 若 typecheck 报 'session_renamed' 不在 event kind 联合**

如果 Step 2 报类似 `Comparison appears unintentional ... 'session_renamed'` 或 `Property does not exist on the union`,打开 `server/shared/types.ts`,找到 realtime event kind 联合(含 `'session_upserted'` 的那一行,L189 附近),加一个成员:

```ts
  | 'session_renamed'
```

> 该联合被前端经代码生成或共享类型消费。若前端用的是另一份独立的 `ServerEvent`(宽松、带 index signature),则 Step 2 直接 PASS,跳过本步。

重跑 `npm run typecheck` 直到 PASS。

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useProjectsState.ts server/shared/types.ts
git commit -m "feat(chat): listen for session_renamed to refresh sidebar" -m "useProjectsState 的 realtime effect 加 session_renamed 分支,就地更新对应 session summary + 同步 selectedSession。" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> 若 `server/shared/types.ts` 未改动,只 `git add src/hooks/useProjectsState.ts`。

---

## Task 6: 全量验证 + 手动 e2e

- [ ] **Step 1: 跑全部相关单测**

Run:
```bash
node --import tsx --test server/modules/mcp/tests/session-rename.service.test.ts
node --import tsx --test src/components/chat/hooks/useRenameCommand.test.ts
```
Expected: 两个文件全 PASS。

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: PASS(`tsc --noEmit` 前端 + 后端均无错误)。

- [ ] **Step 3: lint**

Run: `npm run lint`
Expected: 无新增 error(已有 warning 可忽略;若有 error 按 `npm run lint:fix` 修)。

- [ ] **Step 4: build**

Run: `npm run build`
Expected: build 成功(`vite build` + server build 无失败)。

- [ ] **Step 5: 手动 e2e(开发者本机跑 app)**

1. 启动 app(dev 模式)。
2. 打开一个有内容的会话(确保 `currentSessionId` 存在)。
3. 在 chat 输入 `/rename`,回车发送。
4. 预期:agent 回复已生成标题,调用 `set_session_title`,**侧边栏该会话标题实时更新**(无需刷新)。
5. 再输入 `/rename 调试 WS 推送`,回车。
6. 预期:标题变为"调试 WS 推送"。
7. 在 DB 确认:`SELECT custom_name FROM sessions WHERE session_id='<那个 id>'` 等于新标题。
8. 回归:侧边栏 hover ✏️ 手动重命名仍可用;`query_session` / `search_conversations` 工具仍正常(在 chat 里 @引用别的会话或自然语言搜)。

> 若 agent 不主动调 `set_session_title`:检查 MCP server 是否注册成功(看 server 启动日志 `planrla-session-query` + `~/.claude.json` 的 mcpServers);确认 hint 块真的被 prepend(在 sendMessage 前打印 messageContent)。工具 description 已明确指示调用时机。

- [ ] **Step 6: 更新 BACKLOG 状态**

把 `docs/process/BACKLOG.md` 里 REQ-013 从 Blocked 区移到 In Progress(状态 `doing` 或 `review`,取决于此时进度),更新备注为:「架构转向:不在 server 调 LLM(消解 blocked),改 chat agent 调 MCP 工具 `set_session_title` 落库 + WS `session_renamed`;`/rename` 斜杠命令触发。spec/plan 见 docs/superpowers/」。

> 注意:BACKLOG.md 若此时有其他并行暂存改动(如 REQ-027),只 stage 本条 REQ-013 的 diff 行(`git add -p docs/process/BACKLOG.md` 选自己的 hunk),不要带入他人改动。

```bash
git add docs/process/BACKLOG.md
git commit -m "chore(backlog): REQ-013 → doing (chat-triggered mcp rename)" -m "blocked 根因(server 调不到 LLM)被架构转向消解,进入实施。" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review(已对照 spec 核查)

- **Spec 覆盖**:3.1 MCP 工具 → Task 1+2;3.2 WS 推送 → Task 1(broadcast)+ Task 5(前端监听);3.3 `/rename` → Task 3+4;3.4 sessionId 注入 → Task 4(`currentSessionId` 拼 hint);3.5 标题约束(1-50)→ Task 1(`MAX_SESSION_TITLE_LENGTH` + 测试);验收标准 1-7 → Task 6 e2e + 各单测覆盖。✓
- **占位符**:Task 1 Step 1 对 `upsertSession` 种子方法留了"以现有签名为准"的说明(因未读该函数确切签名)—— 实施时按 `sessions.db.ts` 实际方法调整,这是唯一需实施者核对处,已显式标注,非隐藏 TODO。其余步骤代码完整。
- **类型一致**:`setSessionTitle(sessionId, title)`(Task 1)↔ `setSessionTitleTool` 调用(Task 2)↔ 测试(Task 1)签名一致;`parseRenameCommand` / `formatRenameCommandHint`(Task 3)↔ Task 4 调用一致;`session_renamed` 事件 payload(`{kind, sessionId, summary, timestamp}`,Task 1 broadcast)↔ 前端消费(Task 5 读 `summary`)一致。✓
