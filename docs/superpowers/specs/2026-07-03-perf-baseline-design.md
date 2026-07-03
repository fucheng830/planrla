# 性能观测 Baseline 设计（B sub-project）

> **状态**：设计待审
> **日期**：2026-07-03
> **范围**：planrla 前端 + 后端，M2 性能专项的 gating sub-project（无 baseline 后续优化无法度量）

## 背景

M2 性能专项的核心 gating 项。当前**前端零 instrumentation**（grep `performance.now/mark/measure`/`web-vitals`/`<Profiler>` 全无），后端仅 FT1 `/files` 路由加的 scan 耗时日志 + sessions-watcher 的零散 debounce 计时，无请求 latency middleware，无 provider 启动 / session sync 耗时记录。

后果：任何 M2 优化（文件树已做、WS 节流、消息虚拟化等）都"飞盲"——没有 before 数字，无法证明改进、无法回归检测。

## 目标

建立前后端**性能测量能力**（instrumentation + dev console 出口），为后续 M2 优化提供 baseline + 回归检测基线。**只测不优化**。

### 非目标（YAGNI）

- ❌ web-vitals（标准 CWV：LCP/INP/CLS）—— 后续可在 baseline 测点上加
- ❌ 上报端点 / 生产遥测 —— 后续
- ❌ 应用内开发者面板（UI）—— 后续
- ❌ React Profiler（组件级渲染耗时）—— 按需后续
- ❌ 任何实际优化 —— B 只建立测量，优化是 C/D/E/F 的事

## 设计

### 1. 前端 instrumentation

**新模块 `src/shared/perf/timing.ts`**：

```ts
const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;

/** 同步：performance.now 包 fn + dev console.debug 耗时 */
export function measure<T>(name: string, fn: () => T): T {
  if (!isDev) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    console.debug(`[perf] ${name} took ${Math.round(performance.now() - t0)}ms`);
  }
}

/** 异步版 */
export async function measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!isDev) return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    console.debug(`[perf] ${name} took ${Math.round(performance.now() - t0)}ms`);
  }
}
```

- 生产（`isDev=false`）直接调 fn，零开销（baseline 不影响生产性能）
- dev：`console.debug` 输出 `[perf] <name> took Nms`

**测点**（用 `measure` / `measureAsync` 包关键操作，4 个）：

| 测点 | 文件 | 触发 → 完成 |
|------|------|-------------|
| 首次加载 | `src/main.jsx` 或 `App.tsx` | app init → first paint |
| 会话切换 | `useChatMessages` 或 `ChatInterface` | select session → messages rendered |
| 首条消息渲染 | `useChatRealtimeHandlers` | send → first stream token |
| 文件树展开 | `FileTree.tsx` `handleToggleDir` | toggle dir → entries rendered |

> 测点选择对齐 V1 路线图 M2 验收点（首次加载/会话切换/首条消息/长会话滚动）+ 文件树（A 已做，加测点度量其收益）。

### 2. 后端 instrumentation

**latency middleware**（`server/index.js`，挂在所有 `/api/*` 路由前）：

```js
app.use('/api', (req, res, next) => {
  const t0 = performance.now();
  res.on('finish', () => {
    const ms = Math.round(performance.now() - t0);
    // 只记 >50ms 的（过滤噪音，快速请求不记）
    if (ms > 50) {
      console.log(`[api] ${req.method} ${req.path} took ${ms}ms`);
    }
  });
  next();
});
```

- 仅记 >50ms 请求（避免快速请求刷屏；性能敏感操作才记）
- `res.on('finish')` 在响应完成后记（含完整耗时）
- 输出 `[api] METHOD path took Nms`

**关键操作日志**（用 performance.now 包）：
- 文件扫描：FT1 已有 `[files] scan ... took Nms`，保留
- provider 启动：provider 初始化处加 `[perf] provider <name> startup took Nms`
- session sync：session-synchronizer 加 `[perf] session sync took Nms`（per session 或批量）

### 3. 出口

统一前缀约定：
- 前端：`[perf] <name> took Nms`（`console.debug`，dev 模式）
- 后端 API：`[api] METHOD path took Nms`（`console.log`，>50ms）
- 后端操作：`[perf] <op> took Nms`（`console.log`）

**baseline 阶段只 console**（dev 前端 / 后端日志）。生产：前端静默（isDev gate），后端 console.log（服务器日志，已有惯例）。上报/可视化后续。

### 4. 测试

- `measure` / `measureAsync` 纯函数 node:test：
  - 返回值正确（同步 + 异步）
  - dev 模式 console.debug 被调（mock console）
  - 生产模式 console.debug 不调（isDev=false）+ 零开销（fn 直接调）
- latency middleware：集成测（supertest 或手动 curl >50ms 请求 → 日志）

### 5. 测点埋点最小侵入

- 前端：`measure(name, () => { ...existing... })` 包现有逻辑，不重构
- 后端：middleware（无侵入）+ 关键操作包 performance.now（局部）

## 风险与约束

- **console 噪音**：dev 前端 + 后端 >50ms 日志可接受（baseline 阶段需看）；生产前端静默
- **performance.now 精度**：ms 级足够（M2 关注秒级/百毫秒级痛点）
- **测点侵入**：measure wrapper 最小侵入；不重构现有逻辑
- **后端 middleware 顺序**：latency middleware 必须挂在 `/api` 路由前（确保记所有 API 请求）

## 验收

- 前端 4 测点：dev 模式触发各操作 → console 见 `[perf] <name> took Nms`
- 前端生产模式：无 console.debug（isDev gate）
- 后端 latency middleware：>50ms API 请求 → `[api] METHOD path took Nms`
- 后端关键操作：provider 启动 / session sync → `[perf] <op> took Nms`
- measure/measureAsync 单测通过
- 后续 M2 优化（C/E/F）可基于这些 baseline 数字证明改进

## 范围

单 spec 可实现。建议 plan 拆 3 组：
1. 前端 timing.ts 纯函数 + 测试
2. 前端 4 测点埋点
3. 后端 latency middleware + 关键操作日志
