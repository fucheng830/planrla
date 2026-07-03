# REQ-011 桌面端自动更新(phase 1 MVP)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打包版 Planrla 半自动「检测 → 下载 → 重启安装」更新到最新版,更新源 Cloudflare R2 + 自有域名,前端全局通知 + 设置页「关于」区。

**Architecture:** electron-updater 6.8.9(generic provider → `updates.planrla.com/desktop`)在 main 进程封装,事件经 IPC 推 renderer;renderer 用 `useAutoUpdater` hook 订阅状态 + 调 IPC;`<UpdateNotification />` 全局 toast + SettingsPage「关于」区;`publish-r2.js` 用 wrangler 把 `latest.yml` + exe + zip 推到 R2。web/git 模式不变(继续 `useVersionCheck`)。

**Tech Stack:** electron-updater 6.8.9, electron 38(IPC + contextBridge), React 18 + TypeScript, vitest(项目测试框架,如非请实施时确认), wrangler(R2)。

**Spec:** `docs/superpowers/specs/2026-07-03-req011-auto-update-design.md`
**REQ-ID:** REQ-011

---

## File Structure

**新增:**
- `src/types/updater.ts` — `UpdaterState` 联合类型(state 枚举 + payload)
- `electron/updater.js` — main 端 `initAutoUpdater(mainWindow)`:autoUpdater 配置 + 事件→IPC push + IPC handlers
- `src/hooks/useAutoUpdater.ts` — renderer hook:订阅 `updater:state` + 透传 check/download/quitInstall
- `src/components/UpdateNotification.tsx` — 全局 toast,按 state 切文案/按钮
- `scripts/publish-r2.js` — wrangler 上传 latest.yml + exe + zip + blockmap 到 R2
- `src/hooks/useAutoUpdater.test.ts`、`src/components/UpdateNotification.test.tsx`、`scripts/publish-r2.test.js`

**修改:**
- `electron/main.js` — 删内联 `setupAutoUpdater`,import `initAutoUpdater`
- `electron/preload.cjs` — `contextBridge.exposeInMainWorld('updater', ...)`
- `src/types/global.d.ts`(或现存 global 类型文件)— `window.updater` 声明
- SettingsPage 组件(实施时定位)— 加「关于/更新」区
- `package.json` — 加 `"publish:update"` script
- `docs/process/templates/release-checklist.md` — 加第 ⑧ 步 `publish:update`
- `docs/commercial/RELEASE_CHECKLIST.md` — `NOMAD_` → `PLANRLA_` 命名修正

---

## Task 1: UpdaterState 类型 + window.updater 声明

**Files:**
- Create: `src/types/updater.ts`
- Modify: `src/types/global.d.ts`(若不存在,创建)

- [ ] **Step 1: 写 `src/types/updater.ts`**

```typescript
/** main → renderer 通过 IPC 'updater:state' 推送的更新状态。 */
export type UpdaterState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseNotesUrl?: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded' }
  | { state: 'error'; message: string };

/** preload 暴露给 renderer 的 window.updater 形状。 */
export interface UpdaterApi {
  check: () => Promise<void>;
  download: () => Promise<void>;
  quitInstall: () => Promise<void>;
  onState: (fn: (s: UpdaterState) => void) => () => void;
}
```

- [ ] **Step 2: 在 global 类型文件声明 `window.updater`**(若项目无 global.d.ts,创建 `src/types/global.d.ts`)

```typescript
import type { UpdaterApi } from './updater';
declare global {
  interface Window {
    updater?: UpdaterApi;
  }
}
```

- [ ] **Step 3: 跑 typecheck**

Run: `npm run typecheck`
Expected: PASS(无新增错误)

- [ ] **Step 4: Commit**

```bash
git add src/types/updater.ts src/types/global.d.ts
git commit -m "feat(req011): UpdaterState type + window.updater declaration"
```

---

## Task 2: useAutoUpdater hook(TDD)

**Files:**
- Create: `src/hooks/useAutoUpdater.ts`
- Test: `src/hooks/useAutoUpdater.test.ts`

- [ ] **Step 1: 写失败测试 `src/hooks/useAutoUpdater.test.ts`**

```typescript
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAutoUpdater } from './useAutoUpdater';
import type { UpdaterState } from '../types/updater';

describe('useAutoUpdater', () => {
  let stateListener: ((s: UpdaterState) => void) | null = null;
  const api = {
    check: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue(undefined),
    quitInstall: vi.fn().mockResolvedValue(undefined),
    onState: vi.fn((fn: (s: UpdaterState) => void) => {
      stateListener = fn;
      return () => { stateListener = null; };
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).updater = api;
  });

  it('初始状态 idle,订阅 onState', () => {
    const { result } = renderHook(() => useAutoUpdater());
    expect(result.current.state).toEqual({ state: 'idle' });
    expect(api.onState).toHaveBeenCalled();
  });

  it('收到 available 状态时更新', () => {
    const { result } = renderHook(() => useAutoUpdater());
    act(() => stateListener?.({ state: 'available', version: '0.5.0' }));
    expect(result.current.state).toEqual({ state: 'available', version: '0.5.0' });
  });

  it('download 透传给 window.updater.download', async () => {
    const { result } = renderHook(() => useAutoUpdater());
    await act(async () => { await result.current.download(); });
    expect(api.download).toHaveBeenCalled();
  });

  it('卸载时取消订阅', () => {
    const { unmount } = renderHook(() => useAutoUpdater());
    unmount();
    expect(stateListener).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/hooks/useAutoUpdater.test.ts`
Expected: FAIL(`useAutoUpdater` 未定义)

- [ ] **Step 3: 写实现 `src/hooks/useAutoUpdater.ts`**

```typescript
import { useEffect, useState } from 'react';
import type { UpdaterState } from '../types/updater';

const IDLE: UpdaterState = { state: 'idle' };

/**
 * 订阅 electron-updater 状态(经 preload 桥)。仅在 packaged 桌面模式有意义:
 * window.updater 由 preload.cjs 注入,isPackaged=false 时不存在。
 */
export const useAutoUpdater = () => {
  const [state, setState] = useState<UpdaterState>(IDLE);

  useEffect(() => {
    if (!window.updater) return;
    const unsubscribe = window.updater.onState(setState);
    return unsubscribe;
  }, []);

  return {
    state,
    check: () => window.updater?.check(),
    download: () => window.updater?.download(),
    quitInstall: () => window.updater?.quitInstall(),
  };
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/hooks/useAutoUpdater.test.ts`
Expected: PASS(4/4)

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAutoUpdater.ts src/hooks/useAutoUpdater.test.ts
git commit -m "feat(req011): useAutoUpdater hook (state subscription + IPC passthrough)"
```

---

## Task 3: UpdateNotification 组件(TDD)

**Files:**
- Create: `src/components/UpdateNotification.tsx`
- Test: `src/components/UpdateNotification.test.tsx`

- [ ] **Step 1: 写失败测试 `src/components/UpdateNotification.test.tsx`**

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { UpdateNotification } from './UpdateNotification';
import type { UpdaterState } from '../types/updater';

const renderWith = (state: UpdaterState, handlers = {}) =>
  render(<UpdateNotification state={state} {...handlers} />);

describe('UpdateNotification', () => {
  it('available 显示版本 + 下载按钮', () => {
    const onDownload = vi.fn();
    renderWith({ state: 'available', version: '0.5.0' }, { onDownload });
    expect(screen.getByText(/0\.5\.0/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/下载/));
    expect(onDownload).toHaveBeenCalled();
  });

  it('downloading 显示进度', () => {
    renderWith({ state: 'downloading', percent: 42 });
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });

  it('downloaded 显示重启安装按钮', () => {
    const onQuitInstall = vi.fn();
    renderWith({ state: 'downloaded' }, { onQuitInstall });
    fireEvent.click(screen.getByText(/重启安装/));
    expect(onQuitInstall).toHaveBeenCalled();
  });

  it('error 显示错误 + 重试', () => {
    const onDownload = vi.fn();
    renderWith({ state: 'error', message: '网络失败' }, { onDownload });
    expect(screen.getByText(/网络失败/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/重试/));
    expect(onDownload).toHaveBeenCalled();
  });

  it('idle/not-available 不渲染', () => {
    const { rerender } = render(<UpdateNotification state={{ state: 'idle' }} onDownload={vi.fn()} onQuitInstall={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByText(/新版本/)).toBeNull();
    rerender(<UpdateNotification state={{ state: 'not-available' }} onDownload={vi.fn()} onQuitInstall={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByText(/新版本/)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/components/UpdateNotification.test.tsx`
Expected: FAIL(组件未定义)

- [ ] **Step 3: 写实现 `src/components/UpdateNotification.tsx`**

```typescript
import type { UpdaterState } from '../types/updater';

interface Props {
  state: UpdaterState;
  onDownload: () => void;
  onQuitInstall: () => void;
  onClose: () => void;
}

export const UpdateNotification = ({ state, onDownload, onQuitInstall, onClose }: Props) => {
  if (state.state === 'idle' || state.state === 'checking' || state.state === 'not-available') {
    return null;
  }
  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-lg text-slate-100">
      {state.state === 'available' && (
        <>
          <div className="mb-2">新版本 {state.version} 可用</div>
          <button onClick={onDownload} className="rounded bg-blue-600 px-3 py-1 mr-2">下载</button>
          <button onClick={onClose} className="rounded border border-slate-600 px-3 py-1">稍后</button>
        </>
      )}
      {state.state === 'downloading' && (
        <div>
          <div className="mb-2">下载中… {state.percent}%</div>
          <div className="h-1.5 w-full rounded bg-slate-700">
            <div className="h-1.5 rounded bg-blue-500" style={{ width: `${state.percent}%` }} />
          </div>
        </div>
      )}
      {state.state === 'downloaded' && (
        <>
          <div className="mb-2">下载完成,重启安装?</div>
          <button onClick={onQuitInstall} className="rounded bg-blue-600 px-3 py-1 mr-2">重启安装</button>
          <button onClick={onClose} className="rounded border border-slate-600 px-3 py-1">稍后</button>
        </>
      )}
      {state.state === 'error' && (
        <>
          <div className="mb-2">更新失败:{state.message}</div>
          <button onClick={onDownload} className="rounded bg-blue-600 px-3 py-1 mr-2">重试</button>
          <button onClick={onClose} className="rounded border border-slate-600 px-3 py-1">关闭</button>
        </>
      )}
    </div>
  );
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/components/UpdateNotification.test.tsx`
Expected: PASS(5/5)

- [ ] **Step 5: Commit**

```bash
git add src/components/UpdateNotification.tsx src/components/UpdateNotification.test.tsx
git commit -m "feat(req011): UpdateNotification toast (available/downloading/downloaded/error)"
```

---

## Task 4: electron/updater.js main 模块

**Files:**
- Create: `electron/updater.js`

> main 进程模块,封装 electron-updater。无单元测试(依赖 electron 运行时);Task 9 集成验证。

- [ ] **Step 1: 写 `electron/updater.js`**

```javascript
// Electron main: electron-updater 封装。事件 → IPC push 'updater:state';
// IPC handlers: updater:check / :download / :quit-install。
import { ipcMain, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

const FEED_URL = process.env.PLANRLA_UPDATE_URL || 'https://updates.planrla.com/desktop';

let initialized = false;

export function initAutoUpdater(mainWindow) {
  if (initialized) return;
  initialized = true;

  autoUpdater.autoDownload = false;
  autoUpdater.setFeedURL({ provider: 'generic', url: FEED_URL });
  autoUpdater.logger = console;

  const send = (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:state', state);
    }
  };

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => send({
    state: 'available',
    version: info.version,
    releaseNotesUrl: `https://github.com/fucheng830/planrla/releases/tag/v${info.version}`,
  }));
  autoUpdater.on('update-not-available', () => send({ state: 'not-available' }));
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', () => send({ state: 'downloaded' }));
  autoUpdater.on('error', (err) => send({ state: 'error', message: err?.message || String(err) }));

  ipcMain.handle('updater:check', async () => {
    try { await autoUpdater.checkForUpdates(); } catch (e) { /* error 事件已 send */ }
  });
  ipcMain.handle('updater:download', async () => {
    try { await autoUpdater.downloadUpdate(); } catch (e) { /* error 事件已 send */ }
  });
  ipcMain.handle('updater:quit-install', () => autoUpdater.quitAndInstall());

  // 启动 silent 检测(失败不阻塞)
  autoUpdater.checkForUpdates().catch(() => {});
}
```

- [ ] **Step 2: typecheck / lint(电子端 JS,ESLint)**

Run: `npm run lint`
Expected: PASS(无新增错误)

- [ ] **Step 3: Commit**

```bash
git add electron/updater.js
git commit -m "feat(req011): main-side electron-updater module (IPC + event→state)"
```

---

## Task 5: main.js 集成 + preload.cjs 暴露

**Files:**
- Modify: `electron/main.js`(替换 `setupAutoUpdater`)
- Modify: `electron/preload.cjs`(暴露 `updater`)

- [ ] **Step 1: `electron/main.js` —— 删 `setupAutoUpdater`(31-55 行),import + 调用 `initAutoUpdater`**

替换原 `setupAutoUpdater` 调用点(`app.whenReady` 内 `if (!process.env.ELECTRON_DEV_URL) await startServer();` 之后):

```javascript
import { initAutoUpdater } from './updater.js';
// ...
app.whenReady().then(async () => {
  try {
    if (!process.env.ELECTRON_DEV_URL) await startServer();
    createWindow();
    if (!process.env.ELECTRON_DEV_URL) initAutoUpdater(mainWindow);
  } catch (e) {
    console.error('[desktop] failed to start:', e);
    app.quit();
  }
  // ... 保留 activate handler
});
```

删掉原文件里 `setupAutoUpdater` 函数定义(31-55 行)。

- [ ] **Step 2: `electron/preload.cjs` —— 暴露 `updater`**

在 `contextBridge.exposeInMainWorld` 区域加:

```javascript
contextBridge.exposeInMainWorld('updater', {
  check: () => ipcRenderer.invoke('updater:check'),
  download: () => ipcRenderer.invoke('updater:download'),
  quitInstall: () => ipcRenderer.invoke('updater:quit-install'),
  onState: (fn) => {
    const handler = (_e, payload) => fn(payload);
    ipcRenderer.on('updater:state', handler);
    return () => ipcRenderer.removeListener('updater:state', handler);
  },
});
```

- [ ] **Step 3: 手动冒烟(npm run desktop 不 crash)**

Run: `npm run desktop`(手动,确认窗口起来 + server ready + 无 updater 报错)
Expected: 窗口启动,console 无 updater error(更新源未部署,`update-not-available` 或 `error` 静默)

- [ ] **Step 4: Commit**

```bash
git add electron/main.js electron/preload.cjs
git commit -m "feat(req011): wire initAutoUpdater in main + expose updater in preload"
```

---

## Task 6: 挂载 UpdateNotification + SettingsPage 关于区

**Files:**
- Modify: App 根组件(实施时定位,如 `src/App.tsx`)
- Modify: SettingsPage 组件(实施时定位)

- [ ] **Step 1: App 根挂 `<UpdateNotification />`**

在 App 根(全局可见处)加:

```typescript
import { useAutoUpdater } from './hooks/useAutoUpdater';
import { UpdateNotification } from './components/UpdateNotification';

// 在 App 组件内:
const { state, download, quitInstall } = useAutoUpdater();
const [closed, setClosed] = useState(false);
// ... render:
{!closed && (
  <UpdateNotification
    state={state}
    onDownload={download}
    onQuitInstall={quitInstall}
    onClose={() => setClosed(true)}
  />
)}
```

- [ ] **Step 2: SettingsPage 加「关于/更新」区**

```typescript
import { useAutoUpdater } from '../hooks/useAutoUpdater';
import { version } from '../../package.json';

// 在 SettingsPage 内:
const { state, check, download, quitInstall } = useAutoUpdater();

// render「关于」区:
<div className="space-y-2">
  <div>当前版本:{version}</div>
  {state.state === 'available' && <div>新版本 {state.version} 可用 <button onClick={download}>下载</button></div>}
  {state.state === 'downloading' && <div>下载中 {state.percent}%</div>}
  {state.state === 'downloaded' && <button onClick={quitInstall}>重启安装</button>}
  {state.state === 'not-available' && <div>已是最新</div>}
  {state.state === 'error' && <div>更新失败:{state.message} <button onClick={check}>重试</button></div>}
  <button onClick={check}>检查更新</button>
</div>
```

- [ ] **Step 3: typecheck + build**

Run: `npm run typecheck && npm run build:client`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/components/SettingsPage*
git commit -m "feat(req011): mount UpdateNotification + Settings about/update section"
```

---

## Task 7: publish-r2.js 上传脚本(TDD)

**Files:**
- Create: `scripts/publish-r2.js`
- Test: `scripts/publish-r2.test.js`

- [ ] **Step 1: 写失败测试 `scripts/publish-r2.test.js`**

```javascript
import { describe, it, expect } from 'vitest';
import { buildR2Objects } from './publish-r2.js';

describe('buildR2Objects', () => {
  it('从 version + release/ 列出要上传的对象', () => {
    const objs = buildR2Objects({ version: '0.4.0', releaseDir: 'release', platform: 'win' });
    expect(objs).toEqual([
      { local: 'release/latest.yml', remote: 'desktop/latest.yml' },
      { local: 'release/planrla-0.4.0-x64.exe', remote: 'desktop/planrla-0.4.0-x64.exe' },
      { local: 'release/planrla-0.4.0-x64.exe.blockmap', remote: 'desktop/planrla-0.4.0-x64.exe.blockmap' },
      { local: 'release/planrla-0.4.0-x64.zip', remote: 'desktop/planrla-0.4.0-x64.zip' },
    ]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run scripts/publish-r2.test.js`
Expected: FAIL(`buildR2Objects` 未定义)

- [ ] **Step 3: 写实现 `scripts/publish-r2.js`**

```javascript
#!/usr/bin/env node
/**
 * 把 electron-builder 产物(latest.yml + exe + zip + blockmap)上传到 R2 更新源。
 * 用 wrangler r2 object put。凭据 env: CF_ACCOUNT_ID + CLOUDFLARE_API_TOKEN
 * (或 R2_ACCESS_KEY/R2_SECRET_KEY,wrangler 自动识别)。
 *
 * 用法: node scripts/publish-r2.js [--version <x.y.z>]
 * 版本默认读 package.json。
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const BUCKET = process.env.R2_BUCKET || 'planrla-updates';

export function buildR2Objects({ version, releaseDir, platform }) {
  const arch = 'x64';
  const base = `${releaseDir}/planrla-${version}-${arch}`;
  return [
    { local: `${releaseDir}/latest.yml`, remote: `desktop/latest.yml` },
    { local: `${base}.exe`, remote: `desktop/planrla-${version}-${arch}.exe` },
    { local: `${base}.exe.blockmap`, remote: `desktop/planrla-${version}-${arch}.exe.blockmap` },
    { local: `${base}.zip`, remote: `desktop/planrla-${version}-${arch}.zip` },
  ].filter((o) => fs.existsSync(o.local));
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) { acc.push([a.slice(2), arr[i + 1]]); }
    return acc;
  }, []));
  const version = args.version || require('../package.json').version;
  const releaseDir = 'release';
  const objs = buildR2Objects({ version, releaseDir, platform: 'win' });
  if (objs.length === 0) {
    console.error(`[publish-r2] release/ 无产物,先跑 npm run desktop:dist:win`);
    process.exit(1);
  }
  for (const { local, remote } of objs) {
    const cmd = `wrangler r2 object put ${BUCKET}/${remote} --file="${local}" --remote=true`;
    console.log(`[publish-r2] $ ${cmd}`);
    execSync(cmd, { stdio: 'inherit' });
  }
  console.log(`[publish-r2] ✓ Uploaded ${objs.length} objects to R2 bucket ${BUCKET}.`);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) main();
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run scripts/publish-r2.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/publish-r2.js scripts/publish-r2.test.js
git commit -m "feat(req011): publish-r2 script (wrangler upload latest.yml + exe + zip + blockmap)"
```

---

## Task 8: npm script + 文档更新

**Files:**
- Modify: `package.json`(加 `publish:update`)
- Modify: `docs/process/templates/release-checklist.md`(加第 ⑧ 步)
- Modify: `docs/commercial/RELEASE_CHECKLIST.md`(NOMAD→PLANRLA)

- [ ] **Step 1: `package.json` scripts 加 `publish:update`**

在 `sync:node` 后加:

```json
"publish:update": "node scripts/publish-r2.js"
```

- [ ] **Step 2: `docs/process/templates/release-checklist.md` 加第 ⑧ 步**

在 ⑥ 上传(GitHub Release)后加:

```markdown
## ⑧ R2 更新源(让打包版 electron-updater 能下载)
- [ ] `npm run publish:update`(上传 latest.yml + exe + zip + blockmap 到 R2 planrla-updates bucket)
- [ ] 确认 `https://updates.planrla.com/desktop/latest.yml` HTTP 200 + version 正确
```

- [ ] **Step 3: `docs/commercial/RELEASE_CHECKLIST.md` 命名修正**

把 `NOMAD_UPDATE_URL` → `PLANRLA_UPDATE_URL`、`NOMAD_UPDATE_CHECK_URL` → `PLANRLA_UPDATE_CHECK_URL`(Update Infrastructure 段);加一行说明"phase 1 暂不签名,phase 2 Azure Trusted Signing"。

- [ ] **Step 4: Commit**

```bash
git add package.json docs/process/templates/release-checklist.md docs/commercial/RELEASE_CHECKLIST.md
git commit -m "docs(req011): publish:update script + release-checklist R2 step + NOMAD→PLANRLA rename"
```

---

## Task 9: 集成验证(手动,验收)

> 本任务由人执行(打包 + R2 + 降版本测更新),非自动化。

- [ ] **Step 1: 建 R2 bucket + 绑定 updates.planrla.com**(一次性基建)

在 Cloudflare 控制台:建 R2 bucket `planrla-updates`;绑定自定义域名 `updates.planrla.com`(CDN)。设 R2 API token(env: `CF_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`)。

- [ ] **Step 2: 打包当前版 + 上传 R2**

```bash
npm run desktop:dist:win     # 含 sync:electron + build + electron-builder
gh release upload v0.4.0 release/planrla-0.4.0-x64.{exe,zip} --clobber
npm run publish:update       # 上传 latest.yml + exe + zip 到 R2
curl -s https://updates.planrla.com/desktop/latest.yml | head -2   # 验 HTTP 200 + version: 0.4.0
```

- [ ] **Step 3: 准备低版本(0.3.0)测试环境**

装一个旧版(0.3.0)的 Planrla(或临时改 package.json version 为 0.3.9 打包本地装,模拟"低于 0.4.0")。

- [ ] **Step 4: 启动旧版 → 验证检测**

启动旧版 → console 应见 `checking-for-update` → `update-available` v0.4.0 → 前端弹「新版本 0.4.0 可用 [下载]」。

- [ ] **Step 5: 下载 → 重启 → 验证升级**

点「下载」→ 进度条 → 「重启安装」→ 点 → 应用退出 + NSIS 升级 + 重启 → 版本应变为 0.4.0(关于页确认)。

- [ ] **Step 6: 错误场景**

断网启动 → 不 crash + 设置页「检查更新」报错 + 「重试」恢复。

- [ ] **Step 7: 验收记录**

确认上面 7 条验收标准(spec §目标)逐条通过,在 PR/验收点记录。

---

## Self-Review(写计划后自检)

**1. Spec coverage:**
- 验收 1(启动检测)→ Task 4(updater.js 启动 silent check)+ Task 5 集成 ✓
- 验收 2(通知 + 下载)→ Task 3 + Task 6 ✓
- 验收 3(进度 + 重启)→ Task 3 + Task 6 ✓
- 验收 4(重启为新版)→ Task 9 Step 5 ✓
- 验收 5(错误处理)→ Task 4(error→state)+ Task 3(重试)✓
- 验收 6(web/git 不变)→ 现状保留(useAutoUpdater 在 !window.updater 时 no-op)✓
- 验收 7(R2 + 上传脚本)→ Task 7 + Task 8 + Task 9 Step 1-2 ✓
- 范围 phase 1 各块 → main(T4-5)/ renderer(T2-3-6)/ R2(T7-8)/ latest.yml(electron-builder 既有)/ 签名(暂不,phase 2)/ 渠道(框架预留,phase 2)✓

**2. Placeholder scan:** 无 TBD/TODO;每步有完整代码或具体命令。

**3. Type consistency:** `UpdaterState` 联合在 Task 1 定义,Task 2(hook)+ Task 3(component)+ Task 4(main IPC push)一致使用 `state: 'available'|'downloading'|...`;`window.updater` 形状(Task 1 UpdaterApi)与 preload(Task 5)实现一致(check/download/quitInstall/onState)。

**4. 渠道框架预留**:phase 1 单 stable,SettingsPage channel dropdown 占位(disabled)留给 phase 2 —— 本 plan 未显式加占位 UI(避免 YAGNI),phase 2 spec 落地。

无 gap,plan 完整。

---

## Execution Handoff

Plan 完整保存于 `docs/superpowers/plans/2026-07-03-req011-auto-update.md`。
