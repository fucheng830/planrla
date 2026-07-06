# REQ-023:桌面端外链系统浏览器打开 — 设计

> **日期**:2026-07-06
> **状态**:Draft(待 Archie 审阅)
> **REQ-ID**:REQ-023
> **类型**:fix
> **目标版本**:v0.6.2(patch)
> **关联**:`docs/process/BACKLOG.md`、`electron/main.js`、`electron/preload.cjs`

## 1. 背景(根因)

Archie 在桌面端点击 AI 回复里的 URL(如 `http://localhost:7777`),planrla 弹出一个**新的空白窗口**,而非在浏览器打开。

根因:`electron/main.js` 的 `createWindow()`(138-154 行)只配了 `webPreferences`,**没有 `setWindowOpenHandler`**(全项目 main + preload 均无 `setWindowOpenHandler` / `openExternal`)。而渲染端几乎所有链接都写了 `target="_blank"`(`MarkdownPreview.tsx:21`、聊天 markdown、McpServers、ProviderLoginModal、PluginSettingsTab 等几十处)。

Electron 对 `target="_blank"` / `window.open` 的默认行为 = **新建一个裸 BrowserWindow 去加载该 URL**:
- 当 URL 是 `localhost:7777`(本地 API 服务,根路径返回 JSON/空、非 HTML)→ 新窗口显示**空白**(Archie 看到的现象);
- 当 URL 是外网 → 加载出网页,但是个没地址栏、不可导航的裸 Electron 窗口,体验差。

**附带隐患**:渲染端若有没写 `target="_blank"` 的普通 `<a href="外链">`(如 ReactMarkdown 默认渲染的链接),点击会让**主窗口整个被导航到外链**,应用"跳走"——比空白弹窗更严重。当前未见此场景,但需兜底。

## 2. 目标 & 范围

**目标**:点击聊天/Markdown 里任意链接 → 在**系统默认浏览器**打开;planrla 自身绝不弹新窗口,主窗口绝不被外链劫持。

**范围**:仅 `electron/main.js`(主进程)。**渲染端零改动**。

**非目标**:不做应用内浏览器 tab / 预览面板(Archie 明确选「全部系统浏览器打开」方案,YAGNI)。

**协议策略**(Archie 已拍板):
- 放行:`http` / `https` / `mailto` / `tel` / `sms` → `shell.openExternal` 交给系统
- 丢弃:`javascript:` / `file:` / `data:` / 任意自定义协议(防 XSS / 本地文件泄漏)
- 打开反馈:**静默**,不加 toast(浏览器弹出本身即反馈)

## 3. 设计

### 3.1 协议白名单函数(新增,放 `main.js` 顶部工具区)

```js
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:', 'sms:']);

// 把外链转给系统默认处理程序(浏览器/邮件/电话)。非白名单协议静默丢弃。
function openExternalByPolicy(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { return; }            // 解析失败丢弃
  if (ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    shell.openExternal(rawUrl);                                  // 非阻塞,失败交系统
  }
}
```

> `shell` 加入顶部 require:`const { app, BrowserWindow, Menu, ipcMain, safeStorage, shell } = require('electron');`

### 3.2 拦截开窗(`target=_blank` / `window.open`)— 治「空白新窗口」

在 `createWindow()` 内、创建 `mainWindow` 之后:

```js
mainWindow.webContents.setWindowOpenHandler(({ url }) => {
  openExternalByPolicy(url);
  return { action: 'deny' };   // 永不让 Electron 自己开新窗口
});
```

### 3.3 防主窗口被外链劫持(`will-navigate` 兜底)

紧接其后:

```js
mainWindow.webContents.on('will-navigate', (event, url) => {
  if (!isSelfOrigin(url)) {
    event.preventDefault();      // 主窗口不跳走
    openExternalByPolicy(url);   // 把意图转给系统浏览器(普通 a 标签外链也能开)
  }
});
```

`isSelfOrigin`(只允许主窗口导航到自家 dev server / 内嵌 server):

```js
function selfOrigins() {
  const origins = [`http://127.0.0.1:${serverPort}`];
  if (process.env.ELECTRON_DEV_URL) origins.push(process.env.ELECTRON_DEV_URL);
  return origins
    .map(o => { try { return new URL(o).origin; } catch { return null; } })
    .filter(Boolean);
}
function isSelfOrigin(url) {
  try { return selfOrigins().includes(new URL(url).origin); }
  catch { return false; }
}
```

> dev 模式 `serverPort=0`,但 `ELECTRON_DEV_URL` 存在 → `isSelfOrigin` 仍能识别 dev server origin;prod 模式靠 `127.0.0.1:serverPort`。

### 3.4 兼容性
- 锚点链接(`href="#xxx"`)不触发 `window.open` / `will-navigate`,不受影响。
- `ELECTRON_DEV_URL`(dev 启动)、`initAutoUpdater`(自动更新)、`cloud-auth:*` IPC(云端登录)走 `loadURL` / `ipcMain`,不触发 `window.open`,不受影响。
- 渲染端保留现有 `target="_blank" rel="noopener noreferrer"`,handler 会拦截,无需改动。

## 4. 验收标准

1. **本地服务**:点击 AI 回复里的 `http://localhost:7777` → 系统默认浏览器打开,planrla 不弹任何新窗口。
2. **外网**:点击任意 `https://` 链接(planrla.com / github.com 等)→ 系统浏览器打开,planrla 无新窗口。
3. **mailto/tel**:点击 `mailto:` / `tel:` 链接 → 系统邮件/电话应用打开。
4. **危险协议拦截**:`javascript:` / `file:` / `data:` / 自定义协议链接 → 点击无反应(不开窗、不导航、不报错)。
5. **主窗口不被劫持**:主窗口内普通外链 `<a>`(无 `target=_blank`)→ 点击后系统浏览器打开,主窗口保持原页面不跳走。
6. **回归**:dev 模式(`npm run desktop`)正常加载 dev server;打包版正常加载内嵌 server;自动更新、云端登录功能正常。

## 5. 测试计划

- **Archie 的 agency 场景**:`/tmp/agencyctl.exe serve` 跑着,聊天里粘 `http://localhost:7777`,点击 → 浏览器打开。
- **外网**:粘 `https://github.com`,点击 → 浏览器打开。
- **拦截**:Markdown 注入 `[x](javascript:alert(1))`,点击 → 无反应。
- **回归**:dev + 打包双模式启动确认。

## 6. 改动文件 & 规模

| 文件 | 改动 |
|------|------|
| `electron/main.js` | +`shell` require;+`openExternalByPolicy` / `selfOrigins` / `isSelfOrigin`;`createWindow()` 内挂 `setWindowOpenHandler` + `will-navigate` |

预估 **< 35 行**,符合 bug 修复规模(≤50 行/会话)。渲染端、preload、server 零改动。
