# REQ-033 应用内浏览器面板 — 阶段 1 实施计划(纯浏览)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 planrla 桌面端右侧加一个可显隐/可调宽的浏览器分屏,用户能在应用内浏览任意 http/https 网站(地址栏导航 + 后退/前进/刷新),边聊边看,不跳系统浏览器。

**Architecture:** Electron `WebContentsView`(独立内存 partition,与主窗口隔离)附加到 mainWindow 右侧;渲染端用 `ResizeObserver` 把容器屏幕坐标经 preload IPC 推给 main 做 `setBounds`;导航/历史由 main 通过 `webContents` API + 事件回推。**阶段 1 不碰 server/browser-use.service**(现有截图查看器原样保留)。

**Tech Stack:** Electron 38(`WebContentsView` + `navigationHistory`)· React 18 + TypeScript · Tailwind · i18next · node:test(纯逻辑单测)

**REQ-ID:** REQ-033 · **spec:** `docs/superpowers/specs/2026-07-11-req033-in-app-browser-design.md`

---

## Scope 调整说明(相对 spec 第 11 节)

spec 阶段 1 写了「砍 `installRuntime`」,但阶段 1 又要求「截图查看器暂留」——截图查看器依赖 Playwright,砍了 `installRuntime` 它会永久 unavailable(矛盾)。**本计划把 `installRuntime` / runtime readiness 砍除移到阶段 2**(切换底层时一并清理)。阶段 1 = 纯增量新增 Electron 内嵌浏览,零回归风险,可独立发版。

**阶段 1 不碰:** `server/modules/browser-use/*`、`installRuntime`、`BrowserUsePanel`(截图查看器)、`browser-use-mcp.routes.ts`、provider MCP 注册。

---

## File Structure

| 文件 | 责任 | 动作 |
|------|------|------|
| `electron/browserPaneUtils.js` | 纯逻辑:URL 校验、partition 名、bounds 钳制(零 electron 依赖,可单测) | 新建 |
| `electron/browserPaneUtils.test.js` | 上述纯逻辑单测(node:test) | 新建 |
| `electron/browserPaneController.js` | `WebContentsView` 生命周期 + 导航 + setBounds + 事件回推 | 新建 |
| `electron/main.js` | 实例化 controller + 注册 ipcMain handler | 改 |
| `electron/preload.cjs` | 暴露 `window.browserPane.*`(contextBridge) | 改 |
| `src/types/browser-pane.d.ts` | `window.browserPane` 的 TS 声明 | 新建 |
| `src/hooks/useUiPreferences.ts` | 加 `browserPaneVisible` 偏好 | 改 |
| `src/components/browser-use/hooks/useBrowserPane.ts` | resize 拖动 + ResizeObserver→updateBounds + url/title 状态 | 新建 |
| `src/components/browser-use/view/BrowserPane.tsx` | 工具栏(地址栏/导航/收起)+ view 宿主容器 | 新建 |
| `src/components/browser-use/index.ts` | export `BrowserPane` | 改 |
| `src/components/main-content/view/MainContent.tsx` | 右侧槽位:editingFile→EditorSidebar,else browserPaneVisible→BrowserPane;入口按钮 | 改 |
| `src/i18n/locales/en/settings.json` | `browserPane.*` key | 改 |
| `src/i18n/locales/zh-CN/settings.json` | `browserPane.*` key | 改 |

---

## Task 1: 纯逻辑工具 + 单测

**Files:**
- Create: `electron/browserPaneUtils.js`
- Create: `electron/browserPaneUtils.test.js`

- [ ] **Step 1: 写失败测试**

Create `electron/browserPaneUtils.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNavigableUrl, toPartitionName, clampBounds } from './browserPaneUtils.js';

test('isNavigableUrl: 仅放行 http/https', () => {
  assert.equal(isNavigableUrl('https://example.com'), true);
  assert.equal(isNavigableUrl('http://localhost:7777'), true);
  assert.equal(isNavigableUrl('mailto:a@b.com'), false);
  assert.equal(isNavigableUrl('file:///x'), false);
  assert.equal(isNavigableUrl('javascript:alert(1)'), false);
  assert.equal(isNavigableUrl('not a url'), false);
  assert.equal(isNavigableUrl(''), false);
});

test('toPartitionName: 无 profile 用内存 partition;有 profile 用 persist:', () => {
  assert.equal(toPartitionName(null), 'planrla-browser');
  assert.equal(toPartitionName(''), 'planrla-browser');
  assert.equal(toPartitionName('Twitter'), 'persist:planrla-browser-twitter');
  assert.equal(toPartitionName('A/B C!'), 'persist:planrla-browser-a-b-c');
});

test('clampBounds: 钳制非负 + 最小尺寸 + 不超 max', () => {
  assert.deepEqual(
    clampBounds({ x: 10, y: 20, width: 500, height: 400 }, { width: 1000, height: 800 }),
    { x: 10, y: 20, width: 500, height: 400 },
  );
  assert.deepEqual(
    clampBounds({ x: -5, y: -5, width: 10, height: 10 }, { width: 1000, height: 800 }),
    { x: 0, y: 0, width: 100, height: 100 },
  );
  assert.equal(clampBounds({ width: 2000 }, { width: 1000, height: 800 }).width, 1000);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test electron/browserPaneUtils.test.js`
Expected: FAIL — `Cannot find module './browserPaneUtils.js'`

- [ ] **Step 3: 实现纯逻辑**

Create `electron/browserPaneUtils.js`:

```js
// 浏览器面板纯逻辑(零 electron 依赖,便于 node --test 单测)。
// 集成层(WebContentsView / setBounds)在 browserPaneController.js。

const NAVIGABLE_PROTOCOLS = new Set(['http:', 'https:']);

// 仅放行 http/https(浏览器视图导航入口)。mailto/tel/file/javascript 等不在此视图打开。
export function isNavigableUrl(rawUrl) {
  try {
    return NAVIGABLE_PROTOCOLS.has(new URL(rawUrl).protocol);
  } catch {
    return false;
  }
}

// profile → Electron session partition 名。无 profile 用内存 partition(关窗即清,不持久化)。
export function toPartitionName(profileName) {
  const safe = String(profileName || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return safe ? `persist:planrla-browser-${safe}` : 'planrla-browser';
}

// 钳制 bounds 在合理范围(非负、最小尺寸、不超容器),避免 WebContentsView.setBounds 抛错或越界。
const MIN_WIDTH = 100;
const MIN_HEIGHT = 100;

export function clampBounds(bounds, max) {
  const maxWidth = Math.max(MIN_WIDTH, max?.width ?? MIN_WIDTH);
  const maxHeight = Math.max(MIN_HEIGHT, max?.height ?? MIN_HEIGHT);
  const x = Math.max(0, Math.round(bounds?.x ?? 0));
  const y = Math.max(0, Math.round(bounds?.y ?? 0));
  const width = Math.min(maxWidth, Math.max(MIN_WIDTH, Math.round(bounds?.width ?? MIN_WIDTH)));
  const height = Math.min(maxHeight, Math.max(MIN_HEIGHT, Math.round(bounds?.height ?? MIN_HEIGHT)));
  return { x, y, width, height };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test electron/browserPaneUtils.test.js`
Expected: PASS — 3 tests

- [ ] **Step 5: 提交**

```bash
git add electron/browserPaneUtils.js electron/browserPaneUtils.test.js
git commit -m "feat(browser-pane): REQ-033 纯逻辑工具 + 单测

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: BrowserPaneController(Electron main)

**Files:**
- Create: `electron/browserPaneController.js`

> 本任务不写自动化单测(`WebContentsView` 依赖 Electron runtime,无法在 node:test 跑)。纯决策逻辑已委托 Task 1 的 `browserPaneUtils`(已测)。集成靠 typecheck + Task 10 手测清单。

- [ ] **Step 1: 实现 controller**

Create `electron/browserPaneController.js`:

```js
// BrowserPaneController:管理附加到 mainWindow 的单个 WebContentsView(浏览器面板)。
// 阶段 1:单视图、内存 partition、用户导航(不经 server / Claude)。
// ESM — package.json type:module;electron API 经 createRequire 拿(named import 在 ESM 拿不到)。
import { createRequire } from 'node:module';
import { isNavigableUrl, toPartitionName, clampBounds } from './browserPaneUtils.js';

const require = createRequire(import.meta.url);
const { WebContentsView } = require('electron');

export class BrowserPaneController {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.view = null;
    // 阶段 1 固定无 profile(内存 partition,关窗即清,与主窗口 cookie/localStorage 完全隔离)。
    this.partition = toPartitionName(null);
  }

  isOpen() {
    return this.view !== null;
  }

  open(initialUrl) {
    if (this.view) {
      // 已开;若给了合法 url 就导航过去
      if (initialUrl) this.navigate(initialUrl);
      return;
    }
    this.view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: this.partition,
      },
    });
    this.mainWindow.contentView.addChildView(this.view);
    this._attachListeners();
    if (initialUrl && isNavigableUrl(initialUrl)) {
      this.view.webContents.loadURL(initialUrl);
    }
    // 初次 open 后,渲染端 ResizeObserver 会经 updateBounds 推来正确 bounds;
    // 在此之前先放一个占位 bounds(屏幕外),避免闪现在左上角。
    this.view.setBounds({ x: 0, y: 0, width: MIN_PLACEHOLDER, height: MIN_PLACEHOLDER });
  }

  close() {
    if (!this.view) return;
    this.mainWindow.contentView.removeChildView(this.view);
    const wc = this.view.webContents;
    this.view = null;
    try { wc.destroy(); } catch { /* already destroyed */ }
  }

  navigate(rawUrl) {
    if (!this.view || !isNavigableUrl(rawUrl)) return false;
    this.view.webContents.loadURL(rawUrl);
    return true;
  }

  goBack() {
    this.view?.webContents.navigationHistory.goBack();
  }

  goForward() {
    this.view?.webContents.navigationHistory.goForward();
  }

  reload() {
    this.view?.webContents.reload();
  }

  updateBounds(rawBounds) {
    if (!this.view) return;
    const content = this.mainWindow.getContentBounds();
    const bounds = clampBounds(rawBounds, { width: content.width, height: content.height });
    this.view.setBounds(bounds);
  }

  _attachListeners() {
    const wc = this.view.webContents;
    const send = (channel, payload) => {
      if (this.mainWindow.isDestroyed()) return;
      this.mainWindow.webContents.send(channel, payload);
    };
    const emitUrl = (url) => send('browserPane:url-change', {
      url,
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    });
    wc.on('did-navigate', (_e, url) => emitUrl(url));
    wc.on('did-navigate-in-page', (_e, url) => emitUrl(url));
    wc.on('page-title-updated', (_e, title) => send('browserPane:title-change', { title }));
    // 阶段 1:外链在视图内的导航都是用户主动行为,允许(已在独立 partition 内)。
    // 不挂 setWindowOpenHandler —— 视图内 target=_blank 由 webContents 默认处理(view 内开)。
  }
}

const MIN_PLACEHOLDER = 100;
```

- [ ] **Step 2: typecheck(确认无语法/类型错)**

Run: `node --check electron/browserPaneController.js`(node --check 不验证 import 解析,只验语法;ESM 语法检查)
Expected: 无输出(语法 OK)

- [ ] **Step 3: 提交**

```bash
git add electron/browserPaneController.js
git commit -m "feat(browser-pane): REQ-033 BrowserPaneController(WebContentsView 管理)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: preload 暴露 window.browserPane + TS 声明

**Files:**
- Modify: `electron/preload.cjs`
- Create: `src/types/browser-pane.d.ts`

- [ ] **Step 1: preload 加 browserPane exposure**

在 `electron/preload.cjs` 末尾(`updater` exposure 之后)追加:

```js
// In-app browser pane bridge (REQ-033). Renderer drives a WebContentsView
// attached to mainWindow via these invoke/send calls; url/title push up via on*.
contextBridge.exposeInMainWorld('browserPane', {
  open: (url) => ipcRenderer.invoke('browserPane:open', url),
  close: () => ipcRenderer.invoke('browserPane:close'),
  navigate: (url) => ipcRenderer.invoke('browserPane:navigate', url),
  goBack: () => ipcRenderer.invoke('browserPane:goBack'),
  goForward: () => ipcRenderer.invoke('browserPane:goForward'),
  reload: () => ipcRenderer.invoke('browserPane:reload'),
  updateBounds: (bounds) => ipcRenderer.send('browserPane:updateBounds', bounds),
  onUrlChange: (fn) => {
    const handler = (_e, payload) => fn(payload);
    ipcRenderer.on('browserPane:url-change', handler);
    return () => ipcRenderer.removeListener('browserPane:url-change', handler);
  },
  onTitleChange: (fn) => {
    const handler = (_e, payload) => fn(payload);
    ipcRenderer.on('browserPane:title-change', handler);
    return () => ipcRenderer.removeListener('browserPane:title-change', handler);
  },
});
```

- [ ] **Step 2: TS 声明**

Create `src/types/browser-pane.d.ts`:

```ts
// 声明渲染端 window.browserPane(preload.cjs contextBridge 暴露)。
// 仅桌面端 Electron 存在;Web/Android 访问为 undefined,调用方须守卫。

export interface BrowserPaneUrlChange {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface BrowserPaneApi {
  open: (url?: string) => Promise<void>;
  close: () => Promise<void>;
  navigate: (url: string) => Promise<boolean>;
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  reload: () => Promise<void>;
  updateBounds: (bounds: { x: number; y: number; width: number; height: number }) => void;
  onUrlChange: (fn: (payload: BrowserPaneUrlChange) => void) => () => void;
  onTitleChange: (fn: (payload: { title: string }) => void) => () => void;
}

declare global {
  interface Window {
    browserPane?: BrowserPaneApi;
  }
}
```

- [ ] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: PASS(无新增错误)

- [ ] **Step 4: 提交**

```bash
git add electron/preload.cjs src/types/browser-pane.d.ts
git commit -m "feat(browser-pane): REQ-033 preload bridge + TS 声明

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: main.js 接线(实例化 controller + ipcMain)

**Files:**
- Modify: `electron/main.js`

- [ ] **Step 1: 加 import + require WebContentsView**

`electron/main.js` 顶部 import 区(L17 后)加:

```js
import { BrowserPaneController } from './browserPaneController.js';
```

L8 的 require 解构加 `WebContentsView`:

```js
const { app, BrowserWindow, Menu, ipcMain, safeStorage, shell, WebContentsView } = require('electron');
```

> 注:`WebContentsView` 在 controller 内部已 require 一次;main 侧 require 是为了显式声明依赖(也可省略,不会未使用报警因其不在 main 直接用)。若 lint 报未使用,移除 main 侧的 `WebContentsView` 只留 controller 内 require。

- [ ] **Step 2: 加 controller 句柄**

L23(`let mainWindow = null;`)附近加:

```js
let browserPaneController = null;
```

- [ ] **Step 3: createWindow 内实例化 + 注册 IPC + 关闭清理**

在 `createWindow()` 内、`mainWindow.on('closed', ...)`(L175)之前,加:

```js
  browserPaneController = new BrowserPaneController(mainWindow);
  ipcMain.handle('browserPane:open', (_e, url) => { browserPaneController?.open(url); });
  ipcMain.handle('browserPane:close', () => { browserPaneController?.close(); });
  ipcMain.handle('browserPane:navigate', (_e, url) => browserPaneController?.navigate(url) ?? false);
  ipcMain.handle('browserPane:goBack', () => { browserPaneController?.goBack(); });
  ipcMain.handle('browserPane:goForward', () => { browserPaneController?.goForward(); });
  ipcMain.handle('browserPane:reload', () => { browserPaneController?.reload(); });
  ipcMain.on('browserPane:updateBounds', (_e, bounds) => { browserPaneController?.updateBounds(bounds); });
```

把 L175 的 `mainWindow.on('closed', () => { mainWindow = null; })` 改为:

```js
  mainWindow.on('closed', () => {
    browserPaneController = null;
    mainWindow = null;
  });
```

> ipcMain.handle 重复注册会抛错。`createWindow` 只在启动 + mac activate 重建窗口时调;若窗口反复关/开,handle 会重复。阶段 1 单窗口场景可接受(mac activate 重建前 window-all-closed 已 quit 非 mac)。若实测在 mac 反复开关窗口报 `attempt to register a second handler`,把上述 `ipcMain.handle` 改为在 `app.whenReady()` 顶层注册一次(不在 createWindow 内),handler 通过闭包/模块级 `browserPaneController` 引用当前实例。

- [ ] **Step 4: 启动验证(手动)**

Run: `npm run desktop:dev`
Expected: 应用正常启动,无 IPC 注册报错;暂无可见 UI(Task 7 后才有面板)。

- [ ] **Step 5: 提交**

```bash
git add electron/main.js
git commit -m "feat(browser-pane): REQ-033 main 接线(controller + ipcMain)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: useUiPreferences 加 browserPaneVisible

**Files:**
- Modify: `src/hooks/useUiPreferences.ts`

- [ ] **Step 1: 加偏好字段**

`src/hooks/useUiPreferences.ts` 的 `UiPreferences` type(L3-11)末尾加字段:

```ts
type UiPreferences = {
  autoExpandTools: boolean;
  showRawParameters: boolean;
  showThinking: boolean;
  autoScrollToBottom: boolean;
  sendByCtrlEnter: boolean;
  sidebarVisible: boolean;
  voiceEnabled: boolean;
  browserPaneVisible: boolean;
};
```

`DEFAULTS`(L36-44)加默认值 `false`:

```ts
const DEFAULTS: UiPreferences = {
  autoExpandTools: false,
  showRawParameters: false,
  showThinking: true,
  autoScrollToBottom: true,
  sendByCtrlEnter: false,
  sidebarVisible: true,
  voiceEnabled: false,
  browserPaneVisible: false,
};
```

> `PREFERENCE_KEYS`/`VALID_KEYS` 由 `Object.keys(DEFAULTS)` 派生,自动包含新字段,无需手改。

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/hooks/useUiPreferences.ts
git commit -m "feat(browser-pane): REQ-033 加 browserPaneVisible UI 偏好

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: useBrowserPane hook(resize + bounds + 状态)

**Files:**
- Create: `src/components/browser-use/hooks/useBrowserPane.ts`

- [ ] **Step 1: 实现 hook**

Create `src/components/browser-use/hooks/useBrowserPane.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { BrowserPaneUrlChange } from '../../../types/browser-pane';

const MIN_WIDTH = 320;
const MAX_WIDTH_RATIO = 0.8;

type BrowserPaneState = {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
};

const INITIAL_STATE: BrowserPaneState = { url: '', title: '', canGoBack: false, canGoForward: false };

type UseBrowserPaneOptions = {
  enabled: boolean;
  isMobile: boolean;
  initialWidth?: number;
};

// 浏览器面板 hook:管理 resize 拖动、ResizeObserver→updateBounds、url/title 状态。
// enabled = 面板当前是否显示(关闭时不订阅、不推 bounds)。
export function useBrowserPane({ enabled, isMobile, initialWidth = 560 }: UseBrowserPaneOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resizeHandleRef = useRef<HTMLDivElement | null>(null);
  const [paneWidth, setPaneWidth] = useState(initialWidth);
  const [isResizing, setIsResizing] = useState(false);
  const [state, setState] = useState<BrowserPaneState>(INITIAL_STATE);

  // 订阅 url/title 变化(main 经 preload 推送)
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.browserPane : undefined;
    if (!enabled || !api) return;
    const offUrl = api.onUrlChange((p: BrowserPaneUrlChange) =>
      setState((s) => ({ ...s, url: p.url, canGoBack: p.canGoBack, canGoForward: p.canGoForward })),
    );
    const offTitle = api.onTitleChange((p) => setState((s) => ({ ...s, title: p.title })));
    return () => { offUrl?.(); offTitle?.(); };
  }, [enabled]);

  // ResizeObserver → updateBounds(rAF 节流)。容器尺寸或拖动状态变化时也重推一次。
  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    const api = typeof window !== 'undefined' ? window.browserPane : undefined;
    if (!el || !api) return;
    let rafId = 0;
    const send = () => {
      rafId = 0;
      const r = el.getBoundingClientRect();
      api.updateBounds({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
    };
    const schedule = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(send);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    schedule();
    return () => { ro.disconnect(); if (rafId) cancelAnimationFrame(rafId); };
  }, [enabled, paneWidth, isResizing]);

  // resize 拖动(复用 useEditorSidebar 模式:鼠标到容器右沿距离 = 面板宽)
  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: globalThis.MouseEvent) => {
      // resizeHandle 的父级 = 面板,再父级 = 含左侧 + 面板的水平 flex 容器
      const flexContainer = resizeHandleRef.current?.parentElement?.parentElement;
      if (!flexContainer) return;
      const rect = flexContainer.getBoundingClientRect();
      const w = rect.right - e.clientX;
      const max = rect.width * MAX_WIDTH_RATIO;
      if (w >= MIN_WIDTH && w <= max) setPaneWidth(w);
    };
    const onUp = () => setIsResizing(false);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  const handleResizeStart = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (isMobile) return;
    e.preventDefault();
    setIsResizing(true);
  }, [isMobile]);

  const navigate = useCallback((url: string) => {
    window.browserPane?.navigate(url);
  }, []);

  const goBack = useCallback(() => window.browserPane?.goBack(), []);
  const goForward = useCallback(() => window.browserPane?.goForward(), []);
  const reload = useCallback(() => window.browserPane?.reload(), []);

  return {
    containerRef,
    resizeHandleRef,
    paneWidth,
    handleResizeStart,
    state,
    navigate,
    goBack,
    goForward,
    reload,
  };
}
```

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/components/browser-use/hooks/useBrowserPane.ts
git commit -m "feat(browser-pane): REQ-033 useBrowserPane hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: BrowserPane 组件(工具栏 + 容器)

**Files:**
- Create: `src/components/browser-use/view/BrowserPane.tsx`

- [ ] **Step 1: 实现组件**

Create `src/components/browser-use/view/BrowserPane.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, RotateCw, X } from 'lucide-react';

import { Button } from '../../../shared/view/ui';
import { useBrowserPane } from '../hooks/useBrowserPane';

type BrowserPaneProps = {
  isMobile: boolean;
  onClose: () => void;
  initialUrl?: string;
};

export default function BrowserPane({ isMobile, onClose, initialUrl = 'https://www.google.com' }: BrowserPaneProps) {
  const { t } = useTranslation('settings');
  const [addressInput, setAddressInput] = useState(initialUrl);
  const { containerRef, resizeHandleRef, paneWidth, handleResizeStart, state, navigate, goBack, goForward, reload } =
    useBrowserPane({ enabled: true, isMobile });

  // 挂载即 open view + 导航到初始 url
  useEffect(() => {
    window.browserPane?.open(initialUrl);
    setAddressInput(initialUrl);
    return () => {
      window.browserPane?.close();
    };
  }, [initialUrl]);

  // main 回推的 url 变化时,同步地址栏(用户未在输入时)
  useEffect(() => {
    if (state.url && document.activeElement?.tagName !== 'INPUT') {
      setAddressInput(state.url);
    }
  }, [state.url]);

  const submitAddress = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = addressInput.trim();
    if (!trimmed) return;
    // 无协议前缀补 https://
    const withProto = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
    navigate(withProto);
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col border-l border-border bg-background"
      style={{ width: `${paneWidth}px`, flexShrink: 0 }}
    >
      {/* 工具栏 */}
      <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1.5">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={goBack} disabled={!state.canGoBack} title={t('browserPane.back')} aria-label={t('browserPane.back')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={goForward} disabled={!state.canGoForward} title={t('browserPane.forward')} aria-label={t('browserPane.forward')}>
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={reload} title={t('browserPane.reload')} aria-label={t('browserPane.reload')}>
          <RotateCw className="h-4 w-4" />
        </Button>
        <form onSubmit={submitAddress} className="min-w-0 flex-1">
          <input
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            placeholder={t('browserPane.addressPlaceholder')}
            className="w-full rounded-md border border-border bg-muted/40 px-2 py-1 text-sm text-foreground outline-none focus:border-primary/50"
            spellCheck={false}
          />
        </form>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose} title={t('browserPane.close')} aria-label={t('browserPane.close')}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* WebContentsView 宿主:透明占位,native view 由 main 附加到此屏幕区域 */}
      <div ref={containerRef} className="min-h-0 flex-1 bg-neutral-100 dark:bg-neutral-900" />

      {/* resize 手柄(左边缘) */}
      <div
        ref={resizeHandleRef}
        onMouseDown={handleResizeStart}
        className="absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/30"
        style={{ transform: `translateX(-${paneWidth}px)` }}
      />
    </div>
  );
}
```

> **注 — resize 手柄定位**:上面用 `transform: translateX(-paneWidth)` 把手柄贴到面板左边缘。如果手柄不跟随或挡住交互,改用 `position: relative` 的兄弟元素方案(参考 `EditorSidebar` 的 resize handle 写法,在 `src/components/code-editor/view/EditorSidebar.tsx` 里)。执行时以 EditorSidebar 实际写法为准对齐。

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/components/browser-use/view/BrowserPane.tsx
git commit -m "feat(browser-pane): REQ-033 BrowserPane 组件(工具栏 + 容器)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: 集成进 MainContent + 入口按钮 + export

**Files:**
- Modify: `src/components/browser-use/index.ts`
- Modify: `src/components/main-content/view/MainContent.tsx`

- [ ] **Step 1: export BrowserPane**

`src/components/browser-use/index.ts`:

```ts
export { default as BrowserUsePanel } from './view/BrowserUsePanel';
export { default as BrowserPane } from './view/BrowserPane';
```

- [ ] **Step 2: MainContent 加偏好 + import**

`src/components/main-content/view/MainContent.tsx`:

L8 改为同时 import 两者:

```ts
import { BrowserUsePanel, BrowserPane } from '../../browser-use';
```

L58 解构偏好加 `browserPaneVisible`:

```ts
const { autoExpandTools, showRawParameters, showThinking, autoScrollToBottom, sendByCtrlEnter, browserPaneVisible } = preferences;
```

加偏好 setter(在 `useUiPreferences` 返回值里解构 `setPreference`,L57 附近):

```ts
const { preferences, setPreference } = useUiPreferences();
```

> 注:现有 L57 是 `const { preferences } = useUiPreferences();` —— 改为同时解构 `setPreference`。

- [ ] **Step 3: 右侧槽位互斥渲染**

把 L222-234 的 `<EditorSidebar ... />` 块替换为条件渲染(编辑器优先,否则浏览器面板):

```tsx
        {editingFile ? (
          <EditorSidebar
            editingFile={editingFile}
            isMobile={isMobile}
            editorExpanded={editorExpanded}
            editorWidth={editorWidth}
            hasManualWidth={hasManualWidth}
            resizeHandleRef={resizeHandleRef}
            onResizeStart={handleResizeStart}
            onCloseEditor={handleCloseEditor}
            onToggleEditorExpand={handleToggleEditorExpand}
            projectPath={selectedProject.path}
            fillSpace={activeTab === 'files'}
          />
        ) : browserPaneVisible ? (
          <BrowserPane
            isMobile={isMobile}
            onClose={() => setPreference('browserPaneVisible', false)}
          />
        ) : null}
```

- [ ] **Step 4: 加打开入口(工具栏按钮)**

在 `MainContentHeader`(L138-147)已有 props 模式下,最小侵入做法:在 `MainContent` 顶部容器内加一个浮动按钮。在 L137 `<div className="flex h-full flex-col">` 内、`MainContentHeader` 之后(L148)加:

```tsx
      <div className="flex justify-end px-2">
        <button
          type="button"
          onClick={() => setPreference('browserPaneVisible', !browserPaneVisible)}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          title={browserPaneVisible ? 'Hide browser pane' : 'Open browser pane'}
        >
          {browserPaneVisible ? 'Hide browser' : 'Browse'}
        </button>
      </div>
```

> 这是 MVP 入口。后续可移到 Sidebar 或 Command Palette;阶段 1 先有可用入口即可。i18n 化在 Task 9。

- [ ] **Step 5: typecheck + build**

Run: `npm run typecheck && npm run build:client`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/components/browser-use/index.ts src/components/main-content/view/MainContent.tsx
git commit -m "feat(browser-pane): REQ-033 MainContent 集成(右侧分屏 + 入口)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: i18n key(en + zh-CN)

**Files:**
- Modify: `src/i18n/locales/en/settings.json`
- Modify: `src/i18n/locales/zh-CN/settings.json`

- [ ] **Step 1: en 加 browserPane 段**

在 `src/i18n/locales/en/settings.json` 的 `"browserUse": { ... }` 段之后(同级),加:

```json
  "browserPane": {
    "back": "Back",
    "forward": "Forward",
    "reload": "Reload",
    "close": "Close pane",
    "addressPlaceholder": "Enter URL or search"
  },
```

- [ ] **Step 2: zh-CN 加 browserPane 段**

`src/i18n/locales/zh-CN/settings.json` 对应位置加:

```json
  "browserPane": {
    "back": "后退",
    "forward": "前进",
    "reload": "刷新",
    "close": "关闭面板",
    "addressPlaceholder": "输入网址或搜索"
  },
```

> 其他 8 语言(de/fr/it/ja/ko/ru/tr/zh-TW)i18next 缺 key 时 fallback 到 en;阶段 1 不强制全覆盖,后续 i18n 专项统一补。

- [ ] **Step 3: build 验证(JSON 合法)**

Run: `npm run build:client`
Expected: PASS(JSON 解析无错)

- [ ] **Step 4: 提交**

```bash
git add src/i18n/locales/en/settings.json src/i18n/locales/zh-CN/settings.json
git commit -m "i18n(browser-pane): REQ-033 en/zh-CN browserPane key

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: 收尾(全量验证 + 手测清单)

**Files:** 无代码改动

- [ ] **Step 1: 全量 typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS

- [ ] **Step 2: 启动桌面 dev 跑手测清单**

Run: `npm run desktop:dev`

对照 spec 阶段 1 验收标准,逐条手测:

1. **基础导航**:点 `Browse` 按钮开面板 → 地址栏输 `https://github.com` 回车 → 看到真实 GitHub 页面(非截图)。
2. **用户直接操作**:在加载出的页面上点击链接/滚动/输入 → 页面正常响应(真实交互,非截图)。
3. **视频**:地址栏输一个 YouTube 视频页 → 视频可播放(验证非截图 + 真实渲染)。
4. **后退/前进/刷新**:点过几个链接后,后退/前进/刷新按钮按预期工作;按钮 disabled 态正确(无历史时后退灰)。
5. **resize 拖动**:拖面板左边缘 → 宽度变化;WebContentsView bounds 实时跟随无错位、无闪烁。
6. **收起**:点 `Hide browser` / 关闭按钮 → 面板消失,view 已 destroy(再开是新会话)。
7. **独立 partition**:面板内登录某站点(如 GitHub)→ 关闭面板 → 主应用 cookie 状态无变化(反之亦然);重新打开面板,内存 partition 已清(未登录态)。
8. **REQ-023 不回归**:聊天里点 `http://localhost:7777` 链接 → 仍甩系统浏览器(主窗口 setWindowOpenHandler 未受影响)。
9. **与 EditorSidebar 互斥**:打开浏览器面板时,点文件树打开文件 → EditorSidebar 取代浏览器面板显示;关编辑器 → 浏览器面板回来。

- [ ] **Step 3: 打包验证(必须,不只 dev)**

> 记忆 `planrla-internal-mcp-asar`:Electron 在 asar 打包后行为可能差异。阶段 1 必须在打包版验证 WebContentsView 附加正常。

Run: `npm run desktop:pack`(只打包不签名,出 unpacked dir)
在 unpacked 目录启动 exe,重复 Step 2 的 1/2/5/7 四条核心验收。
Expected: 打包版行为与 dev 一致。

- [ ] **Step 4: 回归 server/browser-use 未受影响**

在 Settings 里 enable browser-use(截图查看器),打开 `activeTab==='browser'` → 截图查看器仍可用(阶段 1 未碰它)。> 若 Playwright 未装,截图查看器报「Install」——这是既有行为,非本需求回归。

- [ ] **Step 5: 最终提交(如有微调)+ push**

```bash
git status
# 若有手测中发现并修复的小问题,已分步提交;此处确认工作区干净
git log --oneline -10  # 确认 9 个 task commit 都在
```

push 到远端(可选,按团队约定):
```bash
git push -u origin feat/req033-in-app-browser
```

---

## Self-Review(plan 作者自查记录)

**1. Spec coverage**(对照 spec 第 11 节阶段 1):
- main BrowserPaneController + WebContentsView + partition + preload IPC:Task 2/3/4 ✅
- 渲染端 BrowserPane 分屏 + 工具栏 + ResizeObserver→setBounds:Task 6/7/8 ✅
- 入口开关:Task 8 Step 4 ✅
- 「砍 installRuntime」:**移到阶段 2**(Scope 调整说明已注明,阶段 1 不碰 server)
- 现有截图查看器暂留:Task 10 Step 4 验证未受影响 ✅
- 验收 6 条:typecheck/build(Task 10 Step 1)+ 手测 1-9(Task 10 Step 2)+ 打包(Task 10 Step 3)+ REQ-023 回归(Task 10 Step 2.8)✅

**2. Placeholder scan**:Task 7 注里提到「以 EditorSidebar 实际写法为准对齐」——这是对执行者的合理提示(EditorSidebar resize handle 写法是现成参考),非 placeholder;关键代码已给。Task 8 入口标注「MVP,后续可移 Sidebar」——阶段 1 可用,非占位。

**3. Type consistency**:`BrowserPaneApi`(Task 3 .d.ts)与 `useBrowserPane`(Task 6)调用的方法名一致(open/close/navigate/goBack/goForward/reload/updateBounds/onUrlChange/onTitleChange)✅。`BrowserPaneController`(Task 2)方法与 ipcMain handler(Task 4)一致 ✅。

**已知风险/执行注意**:
- `webContents.navigationHistory` 是 Electron 36+ API(package.json electron ^38,可用)。若实测 38 仍要旧 `canGoBack()`,改 controller 的 `_attachListeners` + goBack/goForward。
- ipcMain.handle 重复注册(mac 反复开关窗口):Task 4 Step 3 注已给降级方案(移 whenReady 顶层)。
- resize 手柄定位(Task 7)用 translateX 方案,若不跟随,参考 EditorSidebar。
- `Browse` 入口按钮(Task 8 Step 4)是 MVP 浮动按钮,位置/样式可在执行时按现有 UI 风格微调(功能不变)。
