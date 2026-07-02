# REQ-010 restartRequired Toast 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **REQ-ID**: REQ-010

**Goal:** 桌面打包模式禁用 restartRequired 误报,修复 v0.2.0 安装后底部「已安装更新 — 请重启服务器」Toast 永存。

**Architecture:** `electron/main.js` spawn server 时传 `PLANRLA_PACKAGED` env → server `/health` 返回 `isPackaged` → 前端 `useVersionCheck` 仅在非打包时启用 version-mismatch 检测(抽 `computeRestartRequired` 纯函数便于单测)。

**Tech Stack:** Electron 38、Express(`server/index.js`)、React hook、node:test + tsx(单测,沿 `src/shared/theme/themeMode.test.ts` 惯例)。

**Spec:** `docs/superpowers/specs/2026-07-02-req010-restart-required-fix-design.md`

---

## 文件结构

**Modify:**
- `server/index.js:174-181` — `/health` handler 加 `isPackaged`
- `electron/main.js:129-138` — spawn env 加 `PLANRLA_PACKAGED`
- `src/hooks/useVersionCheck.ts:47-50` — 抽纯函数 + 改条件

**Create:**
- `src/hooks/useVersionCheck.test.ts` — 纯函数 4 case 单测

---

## Task 1: server /health 返回 isPackaged

**Files:** Modify `server/index.js:174-181`

- [ ] **Step 1: 改 /health handler**

```js
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        installMode,
        version: RUNNING_VERSION,
        isPackaged: process.env.PLANRLA_PACKAGED === '1'
    });
});
```

- [ ] **Step 2: Commit** `git commit -m "feat(server): expose isPackaged in /health (REQ-010)"`

---

## Task 2: electron/main.js 传 PLANRLA_PACKAGED env

**Files:** Modify `electron/main.js:129-138` spawn env 块

- [ ] **Step 1: 改 spawn env**

```js
env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    SERVER_PORT: String(serverPort),
    PLANRLA_PACKAGED: app.isPackaged ? '1' : '0',
},
```

- [ ] **Step 2: Commit** `git commit -m "feat(electron): pass PLANRLA_PACKAGED env to server spawn (REQ-010)"`

---

## Task 3: useVersionCheck.ts 抽纯函数 + 改条件

**Files:** Modify `src/hooks/useVersionCheck.ts`

- [ ] **Step 1: 加 computeRestartRequired 纯函数导出**(在 compareVersions 后)

```ts
/**
 * 是否需要提示「重启服务器」。
 * 打包桌面模式(app.isPackaged)下永远 false —— Electron 每次启动都重启 server,
 * 不存在 server 跑旧代码的场景;仅 npm/git 源码模式自更新后提示。
 */
export const computeRestartRequired = (
  isPackaged: boolean,
  serverVersion: string | null,
  bundleVersion: string
): boolean => {
  if (isPackaged) return false;
  if (typeof serverVersion !== 'string' || serverVersion.length === 0) return false;
  return serverVersion !== bundleVersion;
};
```

- [ ] **Step 2: 改 fetchHealth 内 restartRequired 逻辑**

原第 47-50 行 `if (typeof data.version === 'string' ...) { setRunningVersion; setRestartRequired(data.version !== version); }` 改为:

```ts
setRunningVersion(typeof data.version === 'string' && data.version.length > 0 ? data.version : null);
setRestartRequired(computeRestartRequired(!!data.isPackaged, data.version, version));
```

- [ ] **Step 3: typecheck** `npm run typecheck` → 无错误
- [ ] **Step 4: Commit** `git commit -m "fix(version): skip restartRequired when packaged (REQ-010)"`

---

## Task 4: 单测 computeRestartRequired

**Files:** Create `src/hooks/useVersionCheck.test.ts`

- [ ] **Step 1: 写测试**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRestartRequired } from './useVersionCheck';

test('computeRestartRequired: 打包模式永远 false(即使 version 不一致)', () => {
    assert.equal(computeRestartRequired(true, '0.3.0', '0.2.0'), false);
});

test('computeRestartRequired: 源码模式 + version 不一致 → true', () => {
    assert.equal(computeRestartRequired(false, '0.3.0', '0.2.0'), true);
});

test('computeRestartRequired: 源码模式 + version 一致 → false', () => {
    assert.equal(computeRestartRequired(false, '0.2.0', '0.2.0'), false);
});

test('computeRestartRequired: serverVersion 空/null → false(不误报)', () => {
    assert.equal(computeRestartRequired(false, '', '0.2.0'), false);
    assert.equal(computeRestartRequired(false, null as unknown as string, '0.2.0'), false);
});
```

- [ ] **Step 2: 跑测试** `npx tsx --test src/hooks/useVersionCheck.test.ts` → 4 PASS
- [ ] **Step 3: Commit** `git commit -m "test(version): computeRestartRequired cases (REQ-010)"`

---

## Task 5: 三道门验收 + BACKLOG 更新

- [ ] **Step 1 预检门**: `npm run typecheck && npm run build && git diff --check` 全过
- [ ] **Step 2 功能门**: /health 返回 isPackaged;main.js 传 env;4 case 单测全绿
- [ ] **Step 3 回归门**: `npm run desktop:dev` 开发模式启动正常
- [ ] **Step 4 BACKLOG**: REQ-010 `spec → review`(待 Archie 实机打包验收)
- [ ] **Step 5 Commit** `git commit -m "docs(req010): spec->review (3-gate passed)"`

---

## 验收清单(对齐 spec)
- [ ] typecheck/build/git diff --check 全过
- [ ] /health 返回 isPackaged
- [ ] computeRestartRequired 4 case 全绿
- [ ] 开发模式 desktop:dev 正常
- [ ] BACKLOG REQ-010 review
- [ ] (发版后) v0.2.1 打包安装无 Toast —— Archie 实机验收

## 风险与回退
- **server/index.js 编译**:index.js 是 .js 源,build:server(tsc)处理。RUNNING_VERSION 已在其中,说明 build 包含它,改 .js 源 build 后生效。
- **打包验证**:本 plan 到 review(代码层)。v0.2.1 打包无 Toast 需发版后实机。
- **回退**:若打包后仍误报,revert 这几个 commit,改用 spec 备选(移除 restartRequired 整套)。
