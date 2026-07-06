# REQ-023 桌面端外链系统浏览器打开 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans 按任务逐条实施。步骤用 checkbox(`- [ ]`)追踪。
>
> **REQ-ID**:REQ-023
> **关联 spec**:[../specs/2026-07-06-external-link-handling-design.md](../specs/2026-07-06-external-link-handling-design.md)
> **worktree 约定**(planrla):实施代码前在主 worktree 开独立 worktree:`git worktree add .claude/worktrees/req023-external-link -b feat/req023-external-link main`,在 worktree 内执行本计划。验收通过后回主 worktree merge。

**Goal:** 让桌面端点击聊天/Markdown 里任意链接时,由系统默认浏览器打开,planrla 不再弹出空白新窗口,主窗口也不会被外链劫持。

**Architecture:** 把**安全关键的纯逻辑**(协议白名单判定、自家 origin 判定)抽到 `electron/links.js`(零 electron 依赖,可单测);**集成层**(挂 `setWindowOpenHandler` / `will-navigate`、调 `shell.openExternal`)留在 `electron/main.js`,走手测。验证用 Node 内置 `node --test`(零新依赖)。

**Tech Stack:** Electron 主进程(ESM,`"type":"module"`)、`node:test` + `node:assert/strict`(Node 18+ 内置)。

---

## 文件结构

| 文件 | 责任 | 改动 |
|------|------|------|
| `electron/links.js` | 纯逻辑:`ALLOWED_PROTOCOLS` / `isAllowedUrl(url)` / `selfOrigins(port, devUrl)` / `isSelfOrigin(url, port, devUrl)`。零 electron 依赖,可单测。 | Create |
| `electron/links.test.js` | `node:test` 单测:覆盖协议白名单(含 `javascript:`/`file:`/`data:` 拦截)与 selfOrigin 判定(dev / prod / 跨域)。零依赖。 | Create |
| `electron/main.js` | 集成:import links;`require('electron')` 加 `shell`;`createWindow()` 内挂 `setWindowOpenHandler` + `will-navigate`。 | Modify |

**为什么拆 links.js**:`main.js` 是 ESM 且 `require('electron')`,无法在纯 Node 环境单测;把判定逻辑独立成零依赖模块,安全逻辑就能用 `node --test` 零成本覆盖(协议拦截是防 XSS / 本地文件泄漏的关键,值得测)。`main.js` 只剩薄集成层。

---

## Task 1:`links.js` 协议白名单 `isAllowedUrl`(TDD)

**Files:**
- Create: `electron/links.test.js`
- Create: `electron/links.js`

- [ ] **Step 1: 写失败测试 `electron/links.test.js`**

创建 `electron/links.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedUrl, ALLOWED_PROTOCOLS } from './links.js';

test('isAllowedUrl:放行 http/https', () => {
  assert.equal(isAllowedUrl('http://localhost:7777'), true);
  assert.equal(isAllowedUrl('https://github.com/a/b'), true);
  assert.equal(isAllowedUrl('HTTP://EXAMPLE.COM'), true); // URL 规范化协议为小写
});

test('isAllowedUrl:放行 mailto/tel/sms', () => {
  assert.equal(isAllowedUrl('mailto:a@b.com'), true);
  assert.equal(isAllowedUrl('tel:+15551234'), true);
  assert.equal(isAllowedUrl('sms:12345'), true);
});

test('isAllowedUrl:拦截危险与非白名单协议', () => {
  assert.equal(isAllowedUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedUrl('file:///C:/x'), false);
  assert.equal(isAllowedUrl('data:text/html,<x>'), false);
  assert.equal(isAllowedUrl('ftp://x'), false);
  assert.equal(isAllowedUrl('custom-scheme://foo'), false);
});

test('isAllowedUrl:非法 URL 返回 false,不抛', () => {
  assert.equal(isAllowedUrl('not a url'), false);
  assert.equal(isAllowedUrl(''), false);
  assert.equal(isAllowedUrl('://no-scheme'), false);
});

test('ALLOWED_PROTOCOLS 包含五个协议', () => {
  assert.deepEqual([...ALLOWED_PROTOCOLS].sort(), ['http:', 'https:', 'mailto:', 'sms:', 'tel:']);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test electron/links.test.js
```
预期:**FAIL**(因为 `electron/links.js` 还不存在 → `Cannot find module './links.js'`)。

- [ ] **Step 3: 实现 `electron/links.js`**

创建 `electron/links.js`:

```js
// 外链处理的纯逻辑(零 electron 依赖,便于 node --test 单测)。
// 集成层(挂 handler / 调 shell.openExternal)在 main.js。

export const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:', 'sms:']);

// URL 是否为白名单协议。非法 URL 返回 false(不抛),由调用方静默丢弃。
export function isAllowedUrl(rawUrl) {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(rawUrl).protocol);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
node --test electron/links.test.js
```
预期:**PASS**(5 tests)。

- [ ] **Step 5: Commit**

```bash
git add electron/links.js electron/links.test.js
git commit -m "feat(req023): add isAllowedUrl protocol whitelist + tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2:`links.js` selfOrigin 判定(TDD)

**Files:**
- Modify: `electron/links.test.js`(追加测试)
- Modify: `electron/links.js`(追加实现)

- [ ] **Step 1: 在 `electron/links.test.js` 末尾追加失败测试**

在文件末尾追加(保留 Task 1 的 import,补一行 `selfOrigins`/`isSelfOrigin` 的 import):

更新顶部 import 为:
```js
import { isAllowedUrl, ALLOWED_PROTOCOLS, selfOrigins, isSelfOrigin } from './links.js';
```

在文件末尾追加:
```js
test('selfOrigins:prod 模式(无 devUrl)只含内嵌 server', () => {
  assert.deepEqual([...selfOrigins(3002, undefined)].sort(), ['http://127.0.0.1:3002']);
});

test('selfOrigins:dev 模式含 devUrl,serverPort=0 也保留(靠 devUrl 兜底)', () => {
  const origins = [...selfOrigins(0, 'http://127.0.0.1:5173')];
  assert.ok(origins.includes('http://127.0.0.1:5173'));
  assert.ok(origins.includes('http://127.0.0.1:0'));
});

test('selfOrigins:无效 devUrl 被跳过,不抛', () => {
  assert.deepEqual([...selfOrigins(3001, 'not-a-url')], ['http://127.0.0.1:3001']);
});

test('isSelfOrigin:自家路径放行', () => {
  assert.equal(isSelfOrigin('http://127.0.0.1:3002/chat', 3002, undefined), true);
  assert.equal(isSelfOrigin('http://127.0.0.1:5173/', 0, 'http://127.0.0.1:5173'), true);
});

test('isSelfOrigin:跨域 / 非法 URL 拒绝', () => {
  assert.equal(isSelfOrigin('https://evil.com/', 3002, undefined), false);
  assert.equal(isSelfOrigin('http://127.0.0.1:3001/x', 0, 'http://127.0.0.1:5173'), false);
  assert.equal(isSelfOrigin('not-a-url', 3001, undefined), false);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test electron/links.test.js
```
预期:**FAIL**(新测试因 `selfOrigins` / `isSelfOrigin` 未导出 → `undefined is not a function` 或 import error)。

- [ ] **Step 3: 在 `electron/links.js` 末尾追加实现**

```js
// 主窗口允许导航的自家 origin 集合:内嵌 server(prod)+ dev server(dev 模式)。
export function selfOrigins(serverPort, devUrl) {
  const candidates = [`http://127.0.0.1:${serverPort}`];
  if (devUrl) candidates.push(devUrl);
  const origins = new Set();
  for (const c of candidates) {
    try { origins.add(new URL(c).origin); } catch { /* 无效候选跳过 */ }
  }
  return origins;
}

// url 是否属于主窗口自家 origin。非法 url 返回 false(不抛)。
export function isSelfOrigin(url, serverPort, devUrl) {
  try {
    return selfOrigins(serverPort, devUrl).has(new URL(url).origin);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
node --test electron/links.test.js
```
预期:**PASS**(10 tests)。

- [ ] **Step 5: Commit**

```bash
git add electron/links.js electron/links.test.js
git commit -m "feat(req023): add selfOrigins/isSelfOrigin + tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3:`main.js` 集成 handler

**Files:**
- Modify: `electron/main.js:8`(require 加 `shell`)
- Modify: `electron/main.js`(顶部 import 加 links)
- Modify: `electron/main.js:127-163`(`createWindow` 内挂 handler)

- [ ] **Step 1: 顶部 require 加 `shell`**

`electron/main.js` 第 8 行,把:
```js
const { app, BrowserWindow, Menu, ipcMain, safeStorage } = require('electron');
```
改为:
```js
const { app, BrowserWindow, Menu, ipcMain, safeStorage, shell } = require('electron');
```

- [ ] **Step 2: 顶部 import 区加 links**

在 `electron/main.js` 第 16 行(`import { initAutoUpdater } from './updater.js';`)之后新增一行:
```js
import { isAllowedUrl, isSelfOrigin } from './links.js';
```

- [ ] **Step 3: `createWindow` 内挂 `setWindowOpenHandler`**

在 `electron/main.js` 的 `createWindow()` 函数内,定位 `mainWindow.on('closed', () => { mainWindow = null; });` 这一行(约 162 行),在它**之前**插入:
```js
  // 永不让 Electron 自己开新窗口:外链一律转系统浏览器(REQ-023)。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // 防主窗口被普通 <a href="外链"> 劫持跳走:自家 origin 外的导航阻止 + 转浏览器。
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isSelfOrigin(url, serverPort, process.env.ELECTRON_DEV_URL)) {
      event.preventDefault();
      if (isAllowedUrl(url)) shell.openExternal(url);
    }
  });
```

- [ ] **Step 4: 跑全量单测 + typecheck 确认无回归**

```bash
node --test electron/links.test.js
npm run typecheck
```
预期:`node --test` PASS(10 tests);`typecheck` 通过(electron/ 不在 tsconfig 内,不应受影响,确认无破坏)。

- [ ] **Step 5: 启 dev 模式快速冒烟**

```bash
npm run desktop:dev
```
预期:窗口正常加载 dev server(`http://127.0.0.1:5173`),无白屏、无控制台报错。**先不关**,留给 Task 4 手测。若加载失败先排查(与本次改动无关则继续,本次只改链接 handler,不动 loadURL)。

- [ ] **Step 6: Commit**

```bash
git add electron/main.js
git commit -m "feat(req023): intercept external links in main window (system browser)

setWindowOpenHandler denies new-window + routes to shell.openExternal;
will-navigate guards main window from being hijacked by plain <a> links.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4:手测验收(对照 spec §4 验收标准)

**Files:** 无(纯验收)

**前置:** Task 3 的 `npm run desktop:dev` 仍开着,窗口已加载。另外起一个本地服务模拟 Archie 的 agency 场景(若 `/tmp/agencyctl.exe` 不可用,用任意本地端口服务替代,如 `python -m http.server 7777`)。

- [ ] **Step 1: 本地服务链接 → 系统浏览器**

在 planrla 任意聊天框发送一条包含 `http://localhost:7777` 的消息(AI 回复或自己粘),渲染成链接后点击。
预期:**系统默认浏览器**打开 `http://localhost:7777`;planrla **不弹任何新窗口**。

- [ ] **Step 2: 外网 https 链接 → 系统浏览器**

发送含 `https://github.com` 的消息,点击链接。
预期:系统浏览器打开 github.com;planrla 无新窗口。

- [ ] **Step 3: 危险协议拦截**

发送 Markdown:`[陷阱](javascript:alert(1))`,点击链接。
预期:**无反应**——不开窗、不导航、不弹 alert、不报错。

- [ ] **Step 4: mailto/tel**(可选,系统若未配邮件/电话客户端会无反应,属正常)

发送 `mailto:test@example.com`,点击。
预期:系统邮件应用打开写信窗口(或系统提示无默认应用)。

- [ ] **Step 5: 主窗口不被劫持**

在 DevTools Console(`Ctrl+Shift+I`)执行:
```js
const a = document.createElement('a'); a.href = 'https://example.com'; a.click();
```
预期:系统浏览器打开 example.com,**planrla 主窗口保持原页面不跳走**。

- [ ] **Step 6: 回归确认**

- dev 模式下应用启动、聊天、文件浏览等核心流程正常。
- 自动更新提示(若有新版本)不受影响。

- [ ] **Step 7: 验收记录 + 收尾**

全绿后在 worktree 内:
```bash
git log --oneline main..HEAD   # 确认 3 个 commit(对应 Task 1/2/3)
```
回报 Archie 做最终验收(Archie 三道门:预检 typecheck/build + 功能对照 spec §4 + 回归抽查)。通过后回主 worktree:
```bash
git merge --no-ff feat/req023-external-link
git worktree remove .claude/worktrees/req023-external-link
git branch -d feat/req023-external-link
```

---

## Self-Review(写计划后自检)

- **Spec 覆盖**:spec §3.1(openExternalByPolicy/isAllowedUrl)→ Task 1+2;§3.2(setWindowOpenHandler)→ Task 3 Step 3;§3.3(will-navigate)→ Task 3 Step 3;§3.4 兼容性 → Task 3 Step 5 + Task 4。spec §4 验收 6 条 → Task 4 Step 1-6 一一映射。✓
- **占位符**:无 TBD/TODO;所有代码块完整。✓
- **类型一致**:`isAllowedUrl(url)` / `isSelfOrigin(url, serverPort, devUrl)` / `selfOrigins(serverPort, devUrl)` 在测试、实现、main.js 集成三处签名一致。✓
- **签名细节**:`isSelfOrigin` 在 main.js 调用为 `isSelfOrigin(url, serverPort, process.env.ELECTRON_DEV_URL)`,与 Task 2 定义一致。✓
