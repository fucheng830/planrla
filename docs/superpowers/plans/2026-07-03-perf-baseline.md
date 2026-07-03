# 性能观测 Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立前后端性能测量能力（前端 measure wrapper + 4 测点 / 后端 latency middleware + 关键操作日志），dev console 出口，为后续 M2 优化提供 baseline。

**Architecture:** 前端 `src/shared/perf/timing.ts` 提供 `measure`/`measureAsync`（dev `console.debug`，生产零开销）+ 4 关键操作测点；后端 `/api` latency middleware（>50ms 记日志）+ provider 启动/session sync 耗时日志。

**Tech Stack:** TypeScript（前端 timing）、Express middleware（后端 latency）、`node:test`（纯函数测试，`npx tsx --test`）。

**Spec:** `docs/superpowers/specs/2026-07-03-perf-baseline-design.md`

---

## 文件结构

**Create:**
- `src/shared/perf/timing.ts` — `measure` / `measureAsync` wrapper + dev-mode gate + test hook
- `src/shared/perf/timing.test.ts` — node:test

**Modify:**
- `src/main.jsx` 或 `App.tsx` — 首次加载测点
- 会话切换测点（`useChatMessages` 或 `ChatInterface`，读现有定位）
- 首条消息测点（`useChatRealtimeHandlers`，读现有定位）
- `src/components/file-tree/view/FileTree.tsx` — 文件树展开测点（`handleToggleDir`）
- `server/index.js` — latency middleware（挂 `/api` 前）+ provider 启动/session sync 日志

**环境约束:**
- 项目无 vitest/jest；纯函数用 `node:test`（`npx tsx --test`），extensionless import（tsconfig Bundler）
- eslint `no-empty` 要求 catch 块加注释
- commitlint subject 不允许 PascalCase 词；首词小写
- 提交前确认根目录无 `nul` 文件

---

## Task B1: 前端 `timing.ts` 纯函数 + 测试

**Files:**
- Create: `src/shared/perf/timing.ts`
- Test: `src/shared/perf/timing.test.ts`

- [ ] **Step 1: 写失败测试**

`src/shared/perf/timing.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure, measureAsync, __setDevMode } from './timing';

test('measure: 返回 fn 值（dev 模式）', () => {
  __setDevMode(true);
  assert.equal(measure('op', () => 42), 42);
});

test('measure: dev 模式调 console.debug', () => {
  __setDevMode(true);
  const original = console.debug;
  let called = '';
  console.debug = (msg: string) => { called = msg; };
  try {
    measure('op', () => 1);
    assert.match(called, /^\[perf\] op took \d+ms$/);
  } finally {
    console.debug = original;
  }
});

test('measure: 生产模式不调 console.debug', () => {
  __setDevMode(false);
  const original = console.debug;
  let called = false;
  console.debug = () => { called = true; };
  try {
    assert.equal(measure('op', () => 7), 7);
    assert.equal(called, false);
  } finally {
    console.debug = original;
  }
});

test('measure: 抛错时仍 console.debug（finally）', () => {
  __setDevMode(true);
  const original = console.debug;
  let called = '';
  console.debug = (msg: string) => { called = msg; };
  try {
    assert.throws(() => measure('op', () => { throw new Error('boom'); }));
    assert.match(called, /^\[perf\] op took \d+ms$/);
  } finally {
    console.debug = original;
  }
});

test('measureAsync: 返回 Promise 值 + dev console.debug', async () => {
  __setDevMode(true);
  const original = console.debug;
  let called = '';
  console.debug = (msg: string) => { called = msg; };
  try {
    const result = await measureAsync('async-op', async () => 'done');
    assert.equal(result, 'done');
    assert.match(called, /^\[perf\] async-op took \d+ms$/);
  } finally {
    console.debug = original;
  }
});

test('measureAsync: 生产模式不调 console.debug', async () => {
  __setDevMode(false);
  const original = console.debug;
  let called = false;
  console.debug = () => { called = true; };
  try {
    assert.equal(await measureAsync('async-op', async () => 'x'), 'x');
    assert.equal(called, false);
  } finally {
    console.debug = original;
  }
});
```

- [ ] **Step 2: 跑确认失败**

```bash
cd D:/workspace/projects/ai/apps/planrla/.claude/worktrees/perf-baseline
npx tsx --test src/shared/perf/timing.test.ts
```
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`src/shared/perf/timing.ts`：

```ts
/**
 * 性能测量 wrapper。dev 模式 console.debug 耗时；生产零开销（直接调 fn）。
 * 用法：`const r = measure('session-switch', () => compute())`
 *      `const r = await measureAsync('first-token', async () => await fetch())`
 */

// 模块级 dev 开关：默认从 import.meta.env（Vite）检测；__setDevMode 供测试注入。
let devMode =
  typeof import.meta !== 'undefined' &&
  !!(import.meta as any).env?.DEV;

/** @internal 测试 hook —— 注入 dev/prod 模式。生产代码勿调。 */
export function __setDevMode(v: boolean): void {
  devMode = v;
}

/** 同步：performance.now 包 fn + dev console.debug 耗时。生产直接调 fn（零开销）。 */
export function measure<T>(name: string, fn: () => T): T {
  if (!devMode) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    console.debug(`[perf] ${name} took ${Math.round(performance.now() - t0)}ms`);
  }
}

/** 异步版。 */
export async function measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!devMode) return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    console.debug(`[perf] ${name} took ${Math.round(performance.now() - t0)}ms`);
  }
}
```

> `import.meta.env.DEV` 是 Vite 注入（项目用 Vite）。`(import.meta as any).env?.DEV` 容错（非 Vite 环境 undefined → false）。node:test 环境 import.meta.env 未定义 → devMode false → 测 prod 路径；`__setDevMode(true)` 测 dev 路径。

- [ ] **Step 4: 跑确认 6 tests PASS**

```bash
npx tsx --test src/shared/perf/timing.test.ts
```

- [ ] **Step 5: typecheck + Commit**

```bash
npx tsc --noEmit -p tsconfig.json && echo TSC_OK
git add src/shared/perf/timing.ts src/shared/perf/timing.test.ts
git commit -m "feat(perf): measure wrapper pure fns"
```
> Verify no `nul` at root. Subject lowercase-only.

---

## Task B2: 前端 4 测点埋点

**Files:**
- Modify: `src/main.jsx`（或 `App.tsx`）— 首次加载
- Modify: 会话切换组件（`useChatMessages` 或 `ChatInterface`，读现有定位）
- Modify: `src/hooks/useChatRealtimeHandlers.ts`（或首条 token 处理点）— 首条消息
- Modify: `src/components/file-tree/view/FileTree.tsx` — 文件树展开

- [ ] **Step 1: 定位 4 测点入口**

```bash
cd D:/workspace/projects/ai/apps/planrla/.claude/worktrees/perf-baseline
# 首次加载入口
grep -n "createRoot\|ReactDOM.render\|<App" src/main.jsx src/App.tsx 2>/dev/null | head
# 会话切换（messages 渲染完成点）
grep -rn "selectedSession\|setMessages\|messages.*render" src/components/chat/ | grep -iE "useChatMessages|ChatInterface" | head
# 首条 stream token
grep -rn "stream_delta\|first.*token\|accumulatedStream" src/hooks/ src/components/chat/hooks/ | head
# 文件树展开（FT9 handleToggleDir）
grep -n "handleToggleDir" src/components/file-tree/view/FileTree.tsx
```
读这些定位每个测点的"触发 → 完成"边界。

- [ ] **Step 2: 埋点（measure 包关键操作）**

对每个测点，用 `measure` / `measureAsync` 包"触发→完成"的现有逻辑。**不重构**，只包 wrapper。

**a) 首次加载**（`src/main.jsx` 或 `App.tsx`）：在 app 初始化（createRoot render）外层包 `measure('app-init', ...)`。或在 App.tsx 的 useEffect（mount）记 first paint。

具体（按 main.jsx 实际结构调整）：
```tsx
import { measure } from './shared/perf/timing';
// createRoot(document.getElementById('root')).render(...) 包成：
measure('app-init', () => {
  createRoot(document.getElementById('root')!).render(<App />);
});
```
> 或用 `useEffect(() => measure('first-paint', () => {}), [])` 在 App mount 记（但 measure 空 fn 只记 wrapper 开销——更适合直接 `performance.now` + mount 时 log）。implementer 按入口选最直接的"init → paint"边界。

**b) 会话切换**（`useChatMessages` 或 `ChatInterface`）：selectedSession 变化 → messages 渲染。在切 session 的 effect 里包 `measure('session-switch', () => { ...load messages... })`。

**c) 首条消息**（`useChatRealtimeHandlers` 首个 stream_delta）：send 后首个 stream_delta 到达时 `measure('first-token', ...)` 或记 send→first-delta 间隔。

**d) 文件树展开**（`FileTree.tsx` `handleToggleDir`）：ensureDir 触发 → entries 渲染。包 `measureAsync('file-tree-expand', async () => { ...fetchDir + render... })`。

> 每个测点：import measure/measureAsync + 包现有逻辑。dev 模式触发 → console.debug `[perf] <name> took Nms`。

- [ ] **Step 3: typecheck + build:client + 手动 dev 验证**

```bash
npx tsc --noEmit -p tsconfig.json && echo TSC_OK
npm run build:client 2>&1 | tail -3
# dev 模式启动（可选，看 console.debug）
# npm run dev → 浏览器 devtools console 触发各操作 → 见 [perf] 日志
```
Expected: typecheck + build 干净。（dev console 验证可选，手动。）

- [ ] **Step 4: Commit**

```bash
git add src/main.jsx src/App.tsx src/components/chat/ src/components/file-tree/view/FileTree.tsx
git commit -m "feat(perf): frontend measurement probes"
```
> Subject lowercase-only. 实际 add 的文件按 Step 2 改动的。

---

## Task B3: 后端 latency middleware

**Files:**
- Modify: `server/index.js`（挂 `/api` 路由前）

- [ ] **Step 1: 读 server/index.js 路由挂载区**

```bash
cd D:/workspace/projects/ai/apps/planrla/.claude/worktrees/perf-baseline
grep -n "app.use('/api\|app.use(express\|app.use(authenticate" server/index.js | head
```
找到 `/api` 路由挂载前的位置（middleware 顺序：latency middleware 必须在 `/api` 路由前）。

- [ ] **Step 2: 加 latency middleware**

在 `/api` 路由前（或 `app.use('/api'...)` 前）加：

```js
// 性能 baseline：API 请求 latency 日志（>50ms 才记，过滤噪音）
app.use('/api', (req, res, next) => {
  const t0 = performance.now();
  res.on('finish', () => {
    const ms = Math.round(performance.now() - t0);
    if (ms > 50) {
      console.log(`[api] ${req.method} ${req.path} took ${ms}ms`);
    }
  });
  next();
});
```

> `performance.now()` Node 18+ 全局可用。`res.on('finish')` 响应完成后记。>50ms 过滤快速请求。挂 `/api` 前确保记所有 API 请求。

- [ ] **Step 3: build:server + 启动验证**

```bash
npm run build:server
SERVER_PORT=3005 npm run server &
sleep 5
TOKEN=$(curl -sS -X POST http://127.0.0.1:3005/api/auth/login -H "Content-Type: application/json" -d '{"username":"planrla","password":"planrla"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).token||'')}catch{}})")
# 触发一个 >50ms 的请求（如 /files 大项目扫描，FT1 已记 [files] scan；这里看 [api] 日志）
PID=$(curl -sS "http://127.0.0.1:3005/api/projects" -H "Authorization: Bearer $TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log(a.data?.projects?.[0]?.projectId||a.projects?.[0]?.projectId||a[0]?.projectId||'')})")
curl -sS "http://127.0.0.1:3005/api/projects/$PID/files" -H "Authorization: Bearer $TOKEN" > /dev/null
# 看 server 日志：应有 [api] GET /api/projects/:id/files took Nms（如果 >50ms）
sleep 1
kill %1
```
Expected: server 日志见 `[api] GET /api/.../files took Nms`（>50ms 时）。FT1 的 `[files] scan` 也仍在。

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat(perf): api latency middleware over 50ms"
```
> Subject lowercase-only. "over 50ms" 避 PascalCase。

---

## Task B4: 后端关键操作日志（provider 启动 + session sync）

**Files:**
- Modify: provider 启动点（`server/modules/providers/`，读现有定位）
- Modify: `server/modules/providers/services/session-synchronizer.service.ts`（或 watcher，读现有）

- [ ] **Step 1: 定位 provider 启动 + session sync**

```bash
cd D:/workspace/projects/ai/apps/planrla/.claude/worktrees/perf-baseline
# provider 启动（initializeProviders / 各 provider constructor / spawn CLI）
grep -rn "initializeProviders\|spawn\|startProvider\|provider.*start\|createProvider" server/modules/providers/ | head
# session sync（synchronizeFile / synchronizeAll）
grep -rn "synchronizeFile\|synchronizeAll\|async synchronize" server/modules/providers/services/ | head
```
读这些定位 provider 启动 + session sync 的入口。

- [ ] **Step 2: 加耗时日志**

**a) provider 启动**：在 provider 初始化/spawn 完成处加：
```js
const t0 = performance.now();
// ...existing provider startup...
console.log(`[perf] provider ${name} startup took ${Math.round(performance.now() - t0)}ms`);
```
> 找到 provider 启动的"开始→完成"边界（如 spawn CLI 到 ready）。每个 provider 或统一的 initializeProviders。

**b) session sync**：在 `synchronizeFile` 或 `synchronizeAll`（批量）加：
```js
const t0 = performance.now();
// ...existing sync...
console.log(`[perf] session sync took ${Math.round(performance.now() - t0)}ms`);
```
> 单 session sync（synchronizeFile）可能频繁，考虑只记 >50ms 或批量（synchronizeAll）。

- [ ] **Step 3: build:server + 验证**

```bash
npm run build:server
SERVER_PORT=3005 npm run server &
sleep 6
# session sync 在 server 启动时跑（watcher 扫 provider dirs）—— 看日志 [perf] session sync
# provider 启动在首次用 provider 时（或 server 启动）—— 看 [perf] provider ... startup
kill %1
```
Expected: server 日志见 `[perf] provider <name> startup took Nms` + `[perf] session sync took Nms`（触发时）。

- [ ] **Step 4: Commit**

```bash
git add server/modules/providers/
git commit -m "feat(perf): provider startup and session sync timing"
```
> Subject lowercase-only.

---

## 验收清单

**前端**
- [ ] `timing.test.ts` 6 tests PASS
- [ ] dev 模式触发首次加载/会话切换/首条消息/文件树展开 → console.debug `[perf] <name> took Nms`
- [ ] 生产 build（isDev=false）：无 `[perf]` console.debug

**后端**
- [ ] >50ms API 请求 → `[api] METHOD path took Nms`
- [ ] provider 启动 → `[perf] provider <name> startup took Nms`
- [ ] session sync → `[perf] session sync took Nms`
- [ ] FT1 `[files] scan` 保留

**整体**
- [ ] 后续 M2 优化（C/E/F）可基于这些 baseline 数字对比

## 风险与回退

- **console 噪音**：前端 dev only（isDev gate）；后端 >50ms 过滤。生产前端静默。
- **测点侵入**：measure wrapper 最小侵入，不重构现有逻辑。
- **import.meta.env.DEV**：Vite 特定，生产 build 时被静态替换为 false（isDev=false，零开销）。node:test 容错（undefined → false + __setDevMode 注入）。
- **后端 middleware 顺序**：latency middleware 必须挂 `/api` 路由前（确保记所有 API 请求）。
