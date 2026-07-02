# 桌面端体验默认值 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 4 个桌面端体验默认值优化 —— 主题三态（默认跟随系统）、语言首次跟随系统、现代化窗口标题栏（方案 A）、新会话默认不限权限 + 默认模型可配置。

**Architecture:** 4 组互相独立的改动。主题/语言/默认权限的核心逻辑抽成纯函数（node:test 测）+ Context/i18n 集成；标题栏走 Electron `titleBarStyle` + `titleBarOverlay`（原生按钮）+ React 自绘容器；UI 集成与窗口行为用手动验证。

**Tech Stack:** Electron 38（titleBarOverlay）、React、TypeScript、i18next、node:test（纯函数测试，`npx tsx --test`）。

**Spec:** `docs/superpowers/specs/2026-07-02-desktop-experience-defaults-design.md`

---

## 文件结构

**Create:**
- `src/shared/theme/themeMode.ts` — 主题三态纯函数（parseStoredTheme / resolveEffectiveDark / 默认值）+ 测试
- `src/shared/view/ui/ThemeModeSelector.tsx` — 三态主题选择器（跟随系统 / 亮 / 暗）
- `src/components/chrome/TitleBar.tsx` — 桌面端自绘标题栏容器（仅 Electron 渲染）
- `electron/themeCache.cjs` — main 进程读写 `userData/theme-cache.json`
- `src/shared/defaults/permissionDefaults.ts` — 默认权限映射 + 解析纯函数 + 测试
- `src/shared/defaults/modelDefaults.ts` — 默认模型三级读取链纯函数 + 测试
- `src/components/settings/view/tabs/agents-settings/sections/content/DefaultModeContent.tsx` — 新会话默认权限 + 默认模型配置 UI

**Modify:**
- `src/contexts/ThemeContext.jsx` — 三态 + system 模式始终监听 + 写 theme-cache（IPC）
- `src/components/settings/view/tabs/AppearanceSettingsTab.tsx` — 主外观主题换 ThemeModeSelector
- `src/i18n/config.js` — detection order 加 navigator
- `src/i18n/locales/*/settings.json` — 11 语言补 themeMode + defaults key
- `electron/main.js` — BrowserWindow titleBarStyle/titleBarOverlay + backgroundColor 跟 cache + IPC handler
- `electron/preload.cjs` — 暴露 `electronAPI.themeCache.set`
- `src/App.tsx` — 桌面端顶部挂载 TitleBar
- `src/components/chat/hooks/useChatProviderState.ts` — permissionMode 初始值链 + 默认模型读取链 + 首次确认 flag
- `src/components/chat/view/ChatInterface.tsx` — 首次不限权限确认弹窗
- `src/components/chat/view/subcomponents/ChatComposer.tsx` — yolo 徽标警示色
- `src/components/settings/view/tabs/agents-settings/types.ts` — AgentCategory 加 'defaults'
- `src/components/settings/view/tabs/agents-settings/AgentsSettingsTab.tsx` — visibleCategories 加 defaults + 传 props
- `src/components/settings/view/tabs/agents-settings/sections/AgentCategoryContentSection.tsx` — 渲染 DefaultModeContent
- `src/components/settings/hooks/useSettingsController.ts` — 默认权限/模型状态 + 持久化

**环境约束:**
- 项目无 vitest/jest；纯函数用 `node:test`（node 22 内置，`npx tsx --test <file>`）
- better-sqlite3 native 与 Electron 版本冲突 —— 本 plan 不碰 db，无此问题
- 前端纯 TS 模块（无 JSX）可被 tsx --test 直接跑；含 JSX 的组件手动验证
- 提交前确认根目录无 `nul` 文件（CLAUDE.md 规范）

---

# Group A: 主题三态（system / light / dark）

## Task A1: 主题纯函数 + 测试

**Files:**
- Create: `src/shared/theme/themeMode.ts`
- Test: `src/shared/theme/themeMode.test.ts`

- [ ] **Step 1: 写失败测试**

`src/shared/theme/themeMode.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStoredTheme, resolveEffectiveDark, DEFAULT_THEME_MODE } from './themeMode.ts';

test('parseStoredTheme: null/空 → 默认 system', () => {
  assert.equal(parseStoredTheme(null), 'system');
  assert.equal(parseStoredTheme(''), 'system');
  assert.equal(parseStoredTheme(undefined as any), 'system');
});

test('parseStoredTheme: 旧值 dark/light 向后兼容', () => {
  assert.equal(parseStoredTheme('dark'), 'dark');
  assert.equal(parseStoredTheme('light'), 'light');
});

test('parseStoredTheme: system 原样识别', () => {
  assert.equal(parseStoredTheme('system'), 'system');
});

test('parseStoredTheme: 非法值 fallback system', () => {
  assert.equal(parseStoredTheme('auto'), 'system');
  assert.equal(parseStoredTheme('DARK'), 'system'); // 大小写敏感，非法
});

test('resolveEffectiveDark: system 模式跟随 prefersDark', () => {
  assert.equal(resolveEffectiveDark('system', true), true);
  assert.equal(resolveEffectiveDark('system', false), false);
});

test('resolveEffectiveDark: light/dark 固定不受系统影响', () => {
  assert.equal(resolveEffectiveDark('dark', false), true);
  assert.equal(resolveEffectiveDark('light', true), false);
});

test('DEFAULT_THEME_MODE 是 system', () => {
  assert.equal(DEFAULT_THEME_MODE, 'system');
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd D:/workspace/projects/ai/apps/planrla
npx tsx --test src/shared/theme/themeMode.test.ts
```
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现纯函数**

`src/shared/theme/themeMode.ts`：

```ts
export type ThemeMode = 'system' | 'light' | 'dark';

export const DEFAULT_THEME_MODE: ThemeMode = 'system';

const VALID_MODES: ReadonlySet<ThemeMode> = new Set(['system', 'light', 'dark']);

/**
 * 解析 localStorage 存的 theme 值。旧值 'dark'/'light' 直接兼容；
 * null/空/非法值回落到默认 'system'。大小写敏感。
 */
export function parseStoredTheme(raw: string | null | undefined): ThemeMode {
  if (raw && VALID_MODES.has(raw as ThemeMode)) return raw as ThemeMode;
  return DEFAULT_THEME_MODE;
}

/**
 * 由 themeMode + 系统偏好派生实际的亮暗。system 跟随系统；light/dark 固定。
 */
export function resolveEffectiveDark(mode: ThemeMode, prefersDark: boolean): boolean {
  if (mode === 'system') return prefersDark;
  return mode === 'dark';
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx tsx --test src/shared/theme/themeMode.test.ts
```
Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/theme/themeMode.ts src/shared/theme/themeMode.test.ts
git commit -m "feat(theme): theme mode pure fns (system/light/dark)"
```

---

## Task A2: ThemeContext 三态改造

**Files:**
- Modify: `src/contexts/ThemeContext.jsx`

- [ ] **Step 1: 改 ThemeContext 用三态 + system 始终监听**

把 `src/contexts/ThemeContext.jsx` 整体替换为：

```jsx
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { parseStoredTheme, resolveEffectiveDark, type ThemeMode } from '../shared/theme/themeMode.ts';

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
};

const prefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;

export const ThemeProvider = ({ children }) => {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() =>
    parseStoredTheme(typeof window !== 'undefined' ? localStorage.getItem('theme') : null),
  );
  // system 模式下跟踪系统亮暗；变化时 setSystemDark 触发重渲染，派生 isDarkMode 自动更新
  const [systemDark, setSystemDark] = useState<boolean>(() => prefersDark());

  const isDarkMode = resolveEffectiveDark(themeMode, systemDark);

  // 写 document class + localStorage + theme-color meta + 桌面端 theme-cache
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', themeMode);

    const statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (statusBarMeta) statusBarMeta.setAttribute('content', isDarkMode ? 'black-translucent' : 'default');

    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) themeColorMeta.setAttribute('content', isDarkMode ? '#0c1117' : '#ffffff');

    // 桌面端：同步主题到 main 进程缓存（消除下次启动闪屏）。Web/Android 下无此 API，忽略。
    if (typeof window !== 'undefined' && window.electronAPI?.themeCache?.set) {
      try { window.electronAPI.themeCache.set(isDarkMode); } catch {}
    }
  }, [themeMode, isDarkMode]);

  // system 模式下始终监听系统亮暗（修复旧逻辑"toggle 一次就锁死不再跟系统"）
  useEffect(() => {
    if (themeMode !== 'system' || typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setSystemDark(mediaQuery.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [themeMode]);

  const setThemeMode = useCallback((mode) => setThemeModeState(mode), []);

  // 向后兼容旧调用方（DarkModeToggle 仍用 isDarkMode + toggleDarkMode）
  const toggleDarkMode = useCallback(() => {
    setThemeModeState((prev) => {
      const effective = resolveEffectiveDark(prev, prefersDark());
      return effective ? 'light' : 'dark';
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ themeMode, setThemeMode, isDarkMode, toggleDarkMode }}>
      {children}
    </ThemeContext.Provider>
  );
};
```

> 注：`systemDark` state 是关键 —— system 模式下系统亮暗变化触发它的 setState，从而重渲染让派生 `isDarkMode` 更新，DOM class / theme-color 由上面的 effect 同步。

- [ ] **Step 2: typecheck（typecheck 是项目脚本）**

```bash
cd D:/workspace/projects/ai/apps/planrla
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "ThemeContext\|themeMode" || echo "ThemeContext 无类型错误"
```
Expected: 无 ThemeContext 相关错误

- [ ] **Step 3: Commit**

```bash
git add src/contexts/ThemeContext.jsx
git commit -m "feat(theme): ThemeContext three-state (system/light/dark)"
```

---

## Task A3: ThemeModeSelector 组件

**Files:**
- Create: `src/shared/view/ui/ThemeModeSelector.tsx`

- [ ] **Step 1: 实现三态选择器**

`src/shared/view/ui/ThemeModeSelector.tsx`：

```tsx
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../../contexts/ThemeContext';
import type { ThemeMode } from '../../../shared/theme/themeMode';
import { cn } from '../../../lib/utils';

const OPTIONS: Array<{ value: ThemeMode; icon: typeof Monitor; labelKey: string }> = [
  { value: 'system', icon: Monitor, labelKey: 'appearanceSettings.themeMode.system' },
  { value: 'light', icon: Sun, labelKey: 'appearanceSettings.themeMode.light' },
  { value: 'dark', icon: Moon, labelKey: 'appearanceSettings.themeMode.dark' },
];

export default function ThemeModeSelector({ ariaLabel }: { ariaLabel?: string }) {
  const { themeMode, setThemeMode } = useTheme();
  const { t } = useTranslation('settings');

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel ?? t('appearanceSettings.themeMode.label')}
      className="inline-flex items-center gap-1 rounded-lg border border-input bg-card p-1"
    >
      {OPTIONS.map(({ value, icon: Icon, labelKey }) => {
        const active = themeMode === value;
        return (
          <button
            key={value}
            role="radio"
            aria-checked={active}
            onClick={() => setThemeMode(value)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{t(labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: 在 shared/view/ui/index.ts 导出**

找到 `src/shared/view/ui/index.ts`，加：

```ts
export { default as ThemeModeSelector } from './ThemeModeSelector';
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/view/ui/ThemeModeSelector.tsx src/shared/view/ui/index.ts
git commit -m "feat(theme): ThemeModeSelector three-state segmented control"
```

---

## Task A4: AppearanceSettingsTab 接入 + i18n

**Files:**
- Modify: `src/components/settings/view/tabs/AppearanceSettingsTab.tsx`
- Modify: `src/i18n/locales/*/settings.json`（11 语言）

- [ ] **Step 1: 主外观主题那处换 ThemeModeSelector**

`src/components/settings/view/tabs/AppearanceSettingsTab.tsx`：

1. import 区加：
```tsx
import { ThemeModeSelector } from '../../../../shared/view/ui';
```
（与现有 `DarkModeToggle` 同路径导出）

2. 把 L35-44 的 `<SettingsSection title={t('appearanceSettings.darkMode.label')}>...DarkModeToggle...</SettingsSection>` 整块替换为：
```tsx
      <SettingsSection title={t('appearanceSettings.themeMode.label')}>
        <SettingsCard>
          <SettingsRow
            label={t('appearanceSettings.themeMode.label')}
            description={t('appearanceSettings.themeMode.description')}
          >
            <ThemeModeSelector ariaLabel={t('appearanceSettings.themeMode.label')} />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
```

3. **保留** L70-137 的代码编辑器主题区（它仍用 `DarkModeToggle` 两态，不改）。

- [ ] **Step 2: 补 i18n key（11 语言）**

对 `src/i18n/locales/{en,zh-CN,zh-TW,ja,ko,ru,de,tr,it,fr}` 每个目录的 `settings.json`，在 `appearanceSettings` 对象内加（en 和 zh-CN 给完整文案，其余语言复制 en 文案占位、由翻译流程后续补全 —— 同一 key 结构）：

en/settings.json（在 `appearanceSettings` 内）：
```json
"themeMode": {
  "label": "Theme",
  "description": "Follow system, or force light/dark",
  "system": "System",
  "light": "Light",
  "dark": "Dark"
}
```

zh-CN/settings.json：
```json
"themeMode": {
  "label": "主题",
  "description": "跟随系统，或固定亮色/暗色",
  "system": "跟随系统",
  "light": "亮色",
  "dark": "暗色"
}
```

其余 9 语言：复制 en 结构（key 不缺失即可，文案可暂用 en，翻译流程后续覆盖）。

- [ ] **Step 3: build client 确认无报错**

```bash
cd D:/workspace/projects/ai/apps/planrla
npm run build:client 2>&1 | tail -5
```
Expected: build 成功（无 unresolved import / missing key 不阻塞 build）

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/view/tabs/AppearanceSettingsTab.tsx src/i18n/locales
git commit -m "feat(theme): appearance tab uses ThemeModeSelector + i18n"
```

---

# Group B: 语言首次跟随系统

## Task B1: i18n detection order

**Files:**
- Modify: `src/i18n/config.js:100-111, 236-245`

- [ ] **Step 1: getSavedLanguage 不再强制 'en'，让 detection 链生效**

`src/i18n/config.js` L99-111 替换为：

```js
// 读 localStorage 已保存的语言偏好；未设置时返回 null，让 detection 链（navigator）兜底
const getSavedLanguage = () => {
  try {
    const saved = localStorage.getItem('userLanguage');
    if (saved && languages.some((lang) => lang.value === saved)) {
      return saved;
    }
    return null;
  } catch {
    return null;
  }
};
```

- [ ] **Step 2: detection order 加 navigator**

L236-245 的 `detection` 块替换为：

```js
    // Detection options
    detection: {
      // localStorage 优先（用户手动选过的覆盖系统）；其次用 navigator（系统语言，首次启动生效）
      order: ['localStorage', 'navigator'],

      // Keys to look for in localStorage
      lookupLocalStorage: 'userLanguage',

      // Cache user language（手动选过后写入 localStorage，之后不再跟随系统）
      caches: ['localStorage'],
    },
```

- [ ] **Step 3: 验证（清 localStorage 模拟首次，看是否随系统）**

```bash
cd D:/workspace/projects/ai/apps/planrla
npm run build:client
# 启动 web 端验证（或 desktop）
npm run dev &
sleep 6
# 在浏览器 devtools console 跑：
#   localStorage.removeItem('userLanguage'); location.reload();
# 确认 UI 语言 = navigator.language（中文系统→中文）
kill %1
```
Expected: 清掉 userLanguage 后 reload，UI 跟随浏览器/系统语言

- [ ] **Step 4: Commit**

```bash
git add src/i18n/config.js
git commit -m "feat(i18n): detect system language on first launch (navigator)"
```

---

# Group C: 窗口标题栏（方案 A）

## Task C1: main 进程 theme-cache + 标题栏配置

**Files:**
- Create: `electron/themeCache.cjs`
- Modify: `electron/main.js`
- Modify: `electron/preload.cjs`

- [ ] **Step 1: 实现 themeCache 读写模块**

`electron/themeCache.cjs`：

```js
// Main 进程主题缓存：renderer 每次主题变化时写入 effectiveDark，
// 启动时 main 读它来选 BrowserWindow.backgroundColor 与 titleBarOverlay 颜色，
// 消除"亮色系统启动瞬间暗色闪屏"。
const fs = require('fs');
const path = require('path');

/** @returns {{ effectiveDark: boolean } | null} */
function readThemeCache(userDataDir) {
  try {
    const p = path.join(userDataDir, 'theme-cache.json');
    if (!fs.existsSync(p)) return null;
    const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (typeof obj?.effectiveDark === 'boolean') return obj;
    return null;
  } catch {
    return null;
  }
}

/** @param {string} userDataDir @param {boolean} effectiveDark */
function writeThemeCache(userDataDir, effectiveDark) {
  try {
    fs.writeFileSync(
      path.join(userDataDir, 'theme-cache.json'),
      JSON.stringify({ effectiveDark }),
    );
  } catch (e) {
    console.error('[desktop:themeCache] write failed:', e?.message);
  }
}

module.exports = { readThemeCache, writeThemeCache };
```

- [ ] **Step 2: main.js 引入 cache + 改 createWindow**

`electron/main.js`：

1. 顶部 import 区（L10 后）加：
```js
import { readThemeCache, writeThemeCache } from './themeCache.cjs';
```

2. `createWindow()`（L141-164）整体替换为：
```js
function createWindow() {
  // Drop the default menu bar (File/Edit/View/Window/Help) for a cleaner chrome.
  Menu.setApplicationMenu(null);

  // 启动期主题色（消除闪屏）：读上次 effectiveDark 缓存；无则暗色（历史默认）
  const cache = readThemeCache(app.getPath('userData'));
  const effectiveDark = cache ? cache.effectiveDark : true;
  const titlebarBg = effectiveDark ? '#0b1120' : '#ffffff';
  const symbolColor = effectiveDark ? '#e5e7eb' : '#374151';
  const titleBarStyle = process.platform === 'darwin' ? 'hiddenInset' : 'hidden';

  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1280,
    height: 840,
    icon: resolveAppIcon(),
    backgroundColor: titlebarBg,
    titleBarStyle,
    // Win/Linux: 系统绘制 minimize/maximize/close 按钮，颜色/高度可控（Electron 15+，38 完整支持）
    titleBarOverlay: process.platform !== 'darwin'
      ? { color: titlebarBg, symbolColor, height: 40 }
      : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  const devUrl = process.env.ELECTRON_DEV_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadURL(`http://127.0.0.1:${serverPort}/`);
  }
  mainWindow.on('closed', () => { mainWindow = null; });
}
```

3. 在 ipcMain handler 区（L77-79 附近，cloud-auth 那组之后）加：
```js
// Renderer 主题变化时同步缓存，供下次启动选背景色（见 createWindow）
ipcMain.on('theme-cache:set', (_e, effectiveDark) => {
  if (typeof effectiveDark === 'boolean') writeThemeCache(app.getPath('userData'), effectiveDark);
});
```

- [ ] **Step 3: preload 暴露 themeCache API**

`electron/preload.cjs` 找到现有 `contextBridge.exposeInWorld` 调用（cloudAuth 那块），在暴露的 api 对象里加：

```js
    themeCache: {
      // main 进程经 ipc 同步写 theme-cache.json（renderer 无法直接写 userData）
      set: (effectiveDark) => ipcRenderer.send('theme-cache:set', effectiveDark),
    },
```

> 若 preload 没有现成 exposeInWorld 结构，则新增：
> ```js
> const { contextBridge, ipcRenderer } = require('electron');
> contextBridge.exposeInWorld('electronAPI', {
>   themeCache: { set: (effectiveDark) => ipcRenderer.send('theme-cache:set', effectiveDark) },
> });
> ```
> 并保留原有 cloudAuth 暴露。

- [ ] **Step 4: Commit**

```bash
git add electron/themeCache.cjs electron/main.js electron/preload.cjs
git commit -m "feat(desktop): theme cache + titleBarOverlay (plan A chrome)"
```

---

## Task C2: React TitleBar 组件

**Files:**
- Create: `src/components/chrome/TitleBar.tsx`

- [ ] **Step 1: 实现 TitleBar**

`src/components/chrome/TitleBar.tsx`：

```tsx
import { useTheme } from '../../contexts/ThemeContext';

/**
 * 桌面端自绘标题栏（仅 Electron）。方案 A：系统按钮原生，容器自绘。
 *  - 顶部 40px，与 main.js titleBarOverlay.height 对齐
 *  - 整条 drag（移动窗口）；内部交互元素标 no-drag
 *  - 背景跟主题 token；右侧用 CSS env 避让系统按钮区
 *  - macOS 不渲染（hiddenInset 保留原生 traffic lights，左上角已有控件）
 */
export default function TitleBar() {
  const { isDarkMode } = useTheme();

  if (typeof window === 'undefined' || !window.electronAPI) return null;
  if (process.platform === 'darwin') return null; // mac 保留原生 traffic lights

  return (
    <div
      className="flex h-10 items-center justify-between border-b border-border bg-background select-none"
      style={{ WebkitAppRegion: 'drag', paddingRight: 'env(titlebar-area-x, 138px)' }}
    >
      <div className="flex items-center gap-2 pl-3">
        <span className="text-sm font-semibold text-foreground">Planrla</span>
      </div>
      {/* 交互元素需 no-drag（当前无；预留） */}
    </div>
  );
}
```

> 注：`process.platform` 在 renderer 需通过 preload 注入；若未注入，改用 `navigator.userAgent` 含 'Mac' 判断，或 preload 暴露 `electronAPI.platform`。下方 Step 2 给 fallback。

- [ ] **Step 2: preload 暴露 platform（如尚无）**

`electron/preload.cjs` 的 electronAPI 对象内加：
```js
    platform: process.platform,
```

TitleBar.tsx 顶部 `process.platform === 'darwin'` 改为：
```tsx
if (window.electronAPI?.platform === 'darwin') return null;
```

- [ ] **Step 3: Commit**

```bash
git add src/components/chrome/TitleBar.tsx electron/preload.cjs
git commit -m "feat(desktop): TitleBar component (self-drawn container)"
```

---

## Task C3: TitleBar 挂载 + 手动验证

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: App.tsx 顶部挂载 TitleBar**

找到 `src/App.tsx` 的根 layout（`<Router>` 或 `<AuthProvider>` 之内的最外层 layout）。在主布局最顶部加：

```tsx
import TitleBar from './components/chrome/TitleBar';
// ... 在布局最顶部：
<TitleBar />
```

> 具体插入点：App.tsx 当前返回结构的第一个子元素位置（在 ThemeProvider 内、主内容外）。`TitleBar` 内部已判断非 Electron 时返回 null，所以 Web/Android 安全。

- [ ] **Step 2: build + desktop 手动验证**

```bash
cd D:/workspace/projects/ai/apps/planrla
npm run build:client
npm run desktop &
# 观察窗口：
#  - 标题栏背景融入应用（无系统标题文字）
#  - 右上角最小/最大/关闭按钮可用（系统原生方角）
#  - 标题栏可拖拽移动窗口
#  - 双击标题栏 → 最大化/还原
#  - 主题切换（设置页）→ 标题栏背景跟随
#  - 重启 desktop → 背景色与上次主题一致（无闪屏）
sleep 10
kill %1
```
Expected: 上述行为全部正常

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(desktop): mount TitleBar at app root"
```

---

# Group D: 默认权限 + 默认模型

## Task D1: 默认权限纯函数 + 测试

**Files:**
- Create: `src/shared/defaults/permissionDefaults.ts`
- Test: `src/shared/defaults/permissionDefaults.test.ts`

- [ ] **Step 1: 写失败测试**

`src/shared/defaults/permissionDefaults.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BYPASS_MODE_BY_PROVIDER,
  resolveSessionPermissionMode,
  getDefaultPermissionModes,
  setDefaultPermissionMode,
  DEFAULT_PERMISSION_ACK_KEY,
  isPermissionAcked,
  setPermissionAcked,
} from './permissionDefaults.ts';

// 用一个内存 mock localStorage
const store = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
(Object as any).globalThis.localStorage = localStorageMock;

test('BYPASS_MODE_BY_PROVIDER: gemini=yolo，其他=bypassPermissions', () => {
  assert.equal(BYPASS_MODE_BY_PROVIDER.claude, 'bypassPermissions');
  assert.equal(BYPASS_MODE_BY_PROVIDER.codex, 'bypassPermissions');
  assert.equal(BYPASS_MODE_BY_PROVIDER.cursor, 'bypassPermissions');
  assert.equal(BYPASS_MODE_BY_PROVIDER.gemini, 'yolo');
});

test('resolveSessionPermissionMode: session 记忆优先', () => {
  store.clear();
  store.set('permissionMode-s1', 'acceptEdits');
  assert.equal(resolveSessionPermissionMode('claude', 's1'), 'acceptEdits');
});

test('resolveSessionPermissionMode: 无 session 记忆 → 全局默认', () => {
  store.clear();
  setDefaultPermissionMode('codex', 'bypassPermissions');
  assert.equal(resolveSessionPermissionMode('codex', 's2'), 'bypassPermissions');
});

test('resolveSessionPermissionMode: 无记忆无全局 → default', () => {
  store.clear();
  assert.equal(resolveSessionPermissionMode('claude', 's3'), 'default');
});

test('resolveSessionPermissionMode: gemini 全局默认是 yolo', () => {
  store.clear();
  setDefaultPermissionMode('gemini', BYPASS_MODE_BY_PROVIDER.gemini);
  assert.equal(resolveSessionPermissionMode('gemini', 's4'), 'yolo');
});

test('isPermissionAcked / setPermissionAcked', () => {
  store.clear();
  assert.equal(isPermissionAcked(), false);
  setPermissionAcked();
  assert.equal(isPermissionAcked(), true);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd D:/workspace/projects/ai/apps/planrla
npx tsx --test src/shared/defaults/permissionDefaults.test.ts
```
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`src/shared/defaults/permissionDefaults.ts`：

```ts
import type { LLMProvider } from '../../types/app';

export type PermissionMode = 'default' | 'auto' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'yolo' | 'auto_edit';

/**
 * 各 provider "不限权限" 的目标值。后端只认这些值：
 *  - claude/codex/cursor → 'bypassPermissions'（claude-sdk.js / openai-codex.js / capabilities 一致）
 *  - gemini → 'yolo'（gemini-cli.js:261 仅认 yolo / auto_edit，不认 bypassPermissions）
 * opencode 只支持 'default'，不参与。
 */
export const BYPASS_MODE_BY_PROVIDER: Partial<Record<LLMProvider, PermissionMode>> = {
  claude: 'bypassPermissions',
  codex: 'bypassPermissions',
  cursor: 'bypassPermissions',
  gemini: 'yolo',
};

const STORAGE_KEY = 'default-permission-mode';
export const DEFAULT_PERMISSION_ACK_KEY = 'default-permission-ack';

/** 读取 per-provider 默认权限模式（整张表）。 */
export function getDefaultPermissionModes(): Partial<Record<LLMProvider, PermissionMode>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** 设置某 provider 的默认权限模式（持久化）。 */
export function setDefaultPermissionMode(provider: LLMProvider, mode: PermissionMode): void {
  const all = getDefaultPermissionModes();
  all[provider] = mode;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

/**
 * 解析某 session 应使用的权限模式，优先级：
 *   1. permissionMode-${sessionId}（该 session 记忆）
 *   2. 全局默认 default-permission-mode[provider]
 *   3. 'default'
 * sessionId 为 null/空（新会话首次还没建）时只走 2、3。
 */
export function resolveSessionPermissionMode(
  provider: LLMProvider,
  sessionId: string | null | undefined,
): PermissionMode {
  if (sessionId) {
    const saved = localStorage.getItem(`permissionMode-${sessionId}`) as PermissionMode | null;
    if (saved) return saved;
  }
  const globalDefault = getDefaultPermissionModes()[provider];
  if (globalDefault) return globalDefault;
  return 'default';
}

/** 用户是否已确认"默认不限权限"风险（一次性确认）。 */
export function isPermissionAcked(): boolean {
  return localStorage.getItem(DEFAULT_PERMISSION_ACK_KEY) === '1';
}

export function setPermissionAcked(): void {
  localStorage.setItem(DEFAULT_PERMISSION_ACK_KEY, '1');
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx tsx --test src/shared/defaults/permissionDefaults.test.ts
```
Expected: 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/defaults/permissionDefaults.ts src/shared/defaults/permissionDefaults.test.ts
git commit -m "feat(defaults): permission default resolve fns + bypass map"
```

---

## Task D2: useChatProviderState 接入默认权限

**Files:**
- Modify: `src/components/chat/hooks/useChatProviderState.ts`

- [ ] **Step 1: 初始 permissionMode 读全局默认**

L3 import 改为：
```ts
import { resolveSessionPermissionMode } from '../../../shared/defaults/permissionDefaults';
```

L76 的 `useState<PermissionMode>('default')` 改为：
```ts
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() =>
    resolveSessionPermissionMode(
      (localStorage.getItem('selected-provider') as LLMProvider) || 'claude',
      null, // 启动期无 session，走全局默认
    ),
  );
```

- [ ] **Step 2: 切 session 时用新解析链**

L327-335 的 effect 替换为：
```ts
  useEffect(() => {
    // 优先 per-session 记忆，其次全局默认 default-permission-mode[provider]，最后 'default'
    setPermissionMode(resolveSessionPermissionMode(provider, selectedSession?.id));
  }, [selectedSession?.id, provider]);
```

- [ ] **Step 3: typecheck**

```bash
cd D:/workspace/projects/ai/apps/planrla
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "useChatProviderState" || echo "无类型错误"
```
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/hooks/useChatProviderState.ts
git commit -m "feat(defaults): new session uses global default permission mode"
```

---

## Task D3: 默认模型读取链纯函数 + 接入

**Files:**
- Create: `src/shared/defaults/modelDefaults.ts`
- Test: `src/shared/defaults/modelDefaults.test.ts`
- Modify: `src/components/chat/hooks/useChatProviderState.ts`

- [ ] **Step 1: 写失败测试**

`src/shared/defaults/modelDefaults.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveInitialModel } from './modelDefaults.ts';

const store = new Map<string, string>();
(Object as any).globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

test('resolveInitialModel: 上次选择优先', () => {
  store.clear();
  store.setItem('claude-model', 'sonnet');
  store.setItem('claude-default-model', 'opus');
  assert.equal(resolveInitialModel('claude', 'opus'), 'sonnet');
});

test('resolveInitialModel: 无上次 → 用户配置的默认', () => {
  store.clear();
  store.setItem('claude-default-model', 'opus');
  assert.equal(resolveInitialModel('claude', 'opus'), 'opus');
});

test('resolveInitialModel: 全无 → 硬编码 fallback', () => {
  store.clear();
  assert.equal(resolveInitialModel('claude', 'opus'), 'opus');
});
```

- [ ] **Step 2: 跑确认失败 + 实现**

```bash
npx tsx --test src/shared/defaults/modelDefaults.test.ts
```
Expected: FAIL

`src/shared/defaults/modelDefaults.ts`：

```ts
import type { LLMProvider } from '../../types/app';

/**
 * 三级读取链：
 *   1. <provider>-model（上次选择，记 session 切换）
 *   2. <provider>-default-model（用户在设置页配置的默认）
 *   3. fallback（调用方传入的硬编码 FALLBACK_DEFAULT_MODEL[provider]）
 */
export function resolveInitialModel(provider: LLMProvider, fallback: string): string {
  try {
    const last = localStorage.getItem(`${provider}-model`);
    if (last) return last;
    const configured = localStorage.getItem(`${provider}-default-model`);
    if (configured) return configured;
  } catch {}
  return fallback;
}

/** 设置某 provider 的默认模型（设置页调用）。 */
export function setDefaultModel(provider: LLMProvider, model: string): void {
  localStorage.setItem(`${provider}-default-model`, model);
}

/** 读某 provider 的默认模型（设置页回显）。 */
export function getDefaultModel(provider: LLMProvider): string | null {
  try {
    return localStorage.getItem(`${provider}-default-model`);
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: 跑测试确认通过**

```bash
npx tsx --test src/shared/defaults/modelDefaults.test.ts
```
Expected: 3 tests PASS

- [ ] **Step 4: useChatProviderState 5 处模型初始值接入**

`src/components/chat/hooks/useChatProviderState.ts` 顶部 import：
```ts
import { resolveInitialModel } from '../../../shared/defaults/modelDefaults';
```

L81-95 的 5 个 provider model useState 初始值，把 `|| FALLBACK_DEFAULT_MODEL.x` 改为 `resolveInitialModel('x', FALLBACK_DEFAULT_MODEL.x)`：

```ts
  const [cursorModel, setCursorModel] = useState<string>(() =>
    resolveInitialModel('cursor', FALLBACK_DEFAULT_MODEL.cursor));
  const [claudeModel, setClaudeModel] = useState<string>(() =>
    resolveInitialModel('claude', FALLBACK_DEFAULT_MODEL.claude));
  const [codexModel, setCodexModel] = useState<string>(() =>
    resolveInitialModel('codex', FALLBACK_DEFAULT_MODEL.codex));
  const [geminiModel, setGeminiModel] = useState<string>(() =>
    resolveInitialModel('gemini', FALLBACK_DEFAULT_MODEL.gemini));
  const [opencodeModel, setOpenCodeModel] = useState<string>(() =>
    resolveInitialModel('opencode', FALLBACK_DEFAULT_MODEL.opencode));
```

- [ ] **Step 5: Commit**

```bash
git add src/shared/defaults/modelDefaults.ts src/shared/defaults/modelDefaults.test.ts src/components/chat/hooks/useChatProviderState.ts
git commit -m "feat(defaults): configurable default model per provider"
```

---

## Task D4: 首次不限权限一次性确认

**Files:**
- Modify: `src/components/chat/view/ChatInterface.tsx`

- [ ] **Step 1: 首次发消息前确认**

`src/components/chat/view/ChatInterface.tsx` 顶部 import：
```tsx
import { useEffect, useState } from 'react';
import { isPermissionAcked, setPermissionAcked } from '../../../shared/defaults/permissionDefaults';
import { Confirmation } from '../../../shared/view/ui';
```

在组件内（其他 useState 附近）加：
```tsx
  const [showPermissionAck, setShowPermissionAck] = useState(false);

  // 首次启用"默认不限权限"时一次性风险确认（确认前不发消息）
  useEffect(() => {
    if (!isPermissionAcked() && permissionMode !== 'default') {
      setShowPermissionAck(true);
    }
  }, [permissionMode]);
```

ChatInterface 把 `useChatComposerState` 返回的 `handleSubmit` 传给 ChatComposer。包一层守卫，使首次（未确认）且默认非 default 时不发消息。在 ChatInterface 内加：
```tsx
  const guardedSubmit = (e: any) => {
    if (!isPermissionAcked() && permissionMode !== 'default') {
      setShowPermissionAck(true);
      return;
    }
    handleSubmitRef.current?.(e); // 或现有提交调用
  };
```

> 注：ChatInterface 现有传给 ChatComposer 的 submit prop 名称需对应（看 L330 setClaudeModel 那片传给 ChatComposer 的 prop，把 submit 改为 guardedSubmit）。

在 JSX 根部加确认弹窗：
```tsx
      {showPermissionAck && (
        <Confirmation
          title={t('chat:defaults.permission.ackTitle')}
          message={t('chat:defaults.permission.ackMessage')}
          confirmLabel={t('chat:defaults.permission.ackConfirm')}
          cancelLabel={t('chat:defaults.permission.ackCancel')}
          onConfirm={() => { setPermissionAcked(); setShowPermissionAck(false); }}
          onCancel={() => { setShowPermissionAck(false); }}
        />
      )}
```

- [ ] **Step 2: 补 i18n key（chat namespace，en + zh-CN + 其他同步）**

`src/i18n/locales/en/chat.json` 加：
```json
"defaults": {
  "permission": {
    "ackTitle": "Default: unrestricted permissions",
    "ackMessage": "New sessions default to unrestricted permission mode. The AI can execute any command (including shell, file write, delete) without per-step confirmation. Continue?",
    "ackConfirm": "I understand, enable by default",
    "ackCancel": "Cancel"
  }
}
```
`zh-CN/chat.json` 加：
```json
"defaults": {
  "permission": {
    "ackTitle": "默认：不限权限",
    "ackMessage": "新会话默认使用不限权限模式。AI 可直接执行任意命令（含终端、写文件、删除），无需逐条确认。是否继续？",
    "ackConfirm": "我已了解，设为默认",
    "ackCancel": "取消"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/view/ChatInterface.tsx src/i18n/locales
git commit -m "feat(defaults): one-time ack before default unrestricted permissions"
```

---

## Task D5: 默认权限 / 模型设置页 UI + yolo 徽标

**Files:**
- Create: `src/components/settings/view/tabs/agents-settings/sections/content/DefaultModeContent.tsx`
- Modify: `src/components/settings/view/tabs/agents-settings/types.ts`
- Modify: `src/components/settings/view/tabs/agents-settings/AgentsSettingsTab.tsx`
- Modify: `src/components/settings/view/tabs/agents-settings/sections/AgentCategoryContentSection.tsx`
- Modify: `src/components/chat/view/subcomponents/ChatComposer.tsx`

- [ ] **Step 1: types.ts 加 'defaults' category**

`src/components/settings/view/tabs/agents-settings/types.ts` 找到 `AgentCategory` 类型，把字面量加 `'defaults'`：

```ts
export type AgentCategory = 'account' | 'permissions' | 'mcp' | 'skills' | 'defaults';
```

- [ ] **Step 2: AgentsSettingsTab visibleCategories 加 defaults**

`src/components/settings/view/tabs/agents-settings/AgentsSettingsTab.tsx` L25-29 替换：

```ts
  const visibleCategories = useMemo<AgentCategory[]>(() => (
    selectedAgent === 'opencode'
      ? ['account', 'permissions', 'mcp', 'defaults']
      : ['account', 'permissions', 'mcp', 'skills', 'defaults']
  ), [selectedAgent]);
```

并在 AgentCategoryTabsSection 的 category 标签映射处（看该组件 i18n key）确保 `defaults` 有标签 —— 在 `src/i18n/locales/en/settings.json` 的 agents category 文案处加 `defaults: "Defaults"`（zh-CN: `defaults: "默认值"`）。

- [ ] **Step 3: 实现 DefaultModeContent**

`src/components/settings/view/tabs/agents-settings/sections/content/DefaultModeContent.tsx`：

```tsx
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { AgentProvider } from '../../../../../types/types';
import type { LLMProvider } from '../../../../../../types/app';
import {
  BYPASS_MODE_BY_PROVIDER,
  getDefaultPermissionModes,
  setDefaultPermissionMode,
} from '../../../../../../shared/defaults/permissionDefaults';
import { getDefaultModel, setDefaultModel } from '../../../../../../shared/defaults/modelDefaults';
import SettingsCard from '../../../SettingsCard';
import SettingsRow from '../../../SettingsRow';
import SettingsSection from '../../../SettingsSection';

// agents-settings 的 AgentProvider 与 chat LLMProvider 对齐
const AGENT_TO_LLM: Record<AgentProvider, LLMProvider> = {
  claude: 'claude',
  cursor: 'cursor',
  codex: 'codex',
  gemini: 'gemini',
  opencode: 'opencode',
};

type DefaultModeContentProps = {
  selectedAgent: AgentProvider;
};

export default function DefaultModeContent({ selectedAgent }: DefaultModeContentProps) {
  const { t } = useTranslation(['settings', 'chat']);
  const provider = AGENT_TO_LLM[selectedAgent];
  const bypass = BYPASS_MODE_BY_PROVIDER[provider];

  const [defaultMode, setDefaultMode] = useState<string>(() =>
    getDefaultPermissionModes()[provider] ?? 'default',
  );
  const [defaultModel, setDefaultModelInput] = useState<string>(() =>
    getDefaultModel(provider) ?? '',
  );

  const onModeChange = (mode: string) => {
    setDefaultMode(mode);
    setDefaultPermissionMode(provider, mode as any);
  };

  const onModelChange = (model: string) => {
    setDefaultModelInput(model);
    setDefaultModel(provider, model);
  };

  return (
    <div className="space-y-6 p-4">
      <SettingsSection title={t('settings:defaults.permission.title')}>
        <SettingsCard>
          <SettingsRow
            label={t('settings:defaults.permission.label')}
            description={t('settings:defaults.permission.description')}
          >
            <select
              value={defaultMode}
              onChange={(e) => onModeChange(e.target.value)}
              className="w-full rounded-lg border border-input bg-card p-2.5 text-sm text-foreground sm:w-48"
            >
              <option value="default">{t('settings:defaults.permission.modeDefault')}</option>
              {bypass && (
                <option value={bypass}>
                  {t('settings:defaults.permission.modeBypass')} ({bypass})
                </option>
              )}
            </select>
          </SettingsRow>
          {defaultMode !== 'default' && (
            <div className="flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3 text-xs text-orange-800 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{t('chat:defaults.permission.ackMessage')}</span>
            </div>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('settings:defaults.model.title')}>
        <SettingsCard>
          <SettingsRow
            label={t('settings:defaults.model.label')}
            description={t('settings:defaults.model.description')}
          >
            <input
              value={defaultModel}
              onChange={(e) => onModelChange(e.target.value)}
              placeholder={t('settings:defaults.model.placeholder')}
              className="w-full rounded-lg border border-input bg-card p-2.5 text-sm text-foreground sm:w-64"
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
```

- [ ] **Step 4: AgentCategoryContentSection 渲染 DefaultModeContent**

`src/components/settings/view/tabs/agents-settings/sections/AgentCategoryContentSection.tsx` 顶部 import：
```tsx
import DefaultModeContent from './content/DefaultModeContent';
```

在该组件的 category 路由（现有 `selectedCategory === 'permissions'` 那组条件里）加：
```tsx
  if (selectedCategory === 'defaults') {
    return <DefaultModeContent selectedAgent={selectedAgent} />;
  }
```

- [ ] **Step 5: 补 settings i18n keys（en + zh-CN + 其他同步）**

`src/i18n/locales/en/settings.json` 加：
```json
"defaults": {
  "permission": {
    "title": "New session defaults",
    "label": "Default permission mode",
    "description": "What permission mode new sessions start in",
    "modeDefault": "Default (prompt each action)",
    "modeBypass": "Unrestricted"
  },
  "model": {
    "title": "Default model",
    "label": "Default model",
    "description": "Used when you haven't picked a model this session",
    "placeholder": "e.g. opus, sonnet, gpt-5.4"
  }
}
```
`zh-CN/settings.json` 加：
```json
"defaults": {
  "permission": {
    "title": "新会话默认值",
    "label": "默认权限模式",
    "description": "新会话启动时使用的权限模式",
    "modeDefault": "默认（逐操作确认）",
    "modeBypass": "不限权限"
  },
  "model": {
    "title": "默认模型",
    "label": "默认模型",
    "description": "本会话未手动选模型时使用",
    "placeholder": "如 opus、sonnet、gpt-5.4"
  }
}
```

- [ ] **Step 6: ChatComposer yolo 徽标警示色**

`src/components/chat/view/subcomponents/ChatComposer.tsx` L344-369 的权限按钮 className 条件，把 `yolo` 与 `bypassPermissions` 合并到同一橙色警示分支。把：

```tsx
                permissionMode === 'bypassPermissions'
                  ? 'border-orange-300/60 bg-orange-50 text-orange-700 ...'
                  : 'border-primary/20 bg-primary/5 text-primary ...'
```

改为（`bypassPermissions` 或 `yolo` 都走橙色）：
```tsx
                (permissionMode === 'bypassPermissions' || permissionMode === 'yolo')
                  ? 'border-orange-300/60 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-600/40 dark:bg-orange-900/15 dark:text-orange-300 dark:hover:bg-orange-900/25'
                  : 'border-primary/20 bg-primary/5 text-primary hover:bg-primary/10'
```

同样，圆点 className（L361-369 那段 `bg-orange-500` 条件）把 `bypassPermissions` 分支扩展为 `(permissionMode === 'bypassPermissions' || permissionMode === 'yolo')`，保持 `bg-orange-500`。

- [ ] **Step 7: build + 手动验证**

```bash
cd D:/workspace/projects/ai/apps/planrla
npm run build:client
npm run desktop &
# 验证：
#  - 设置 → Agents → 选某 provider → "默认值" tab → 改默认权限为"不限权限"
#  - 新建会话 → 徽标直接显示不限权限（橙）；首次弹确认
#  - 设置页填默认模型 → 清掉 <provider>-model → 重启 → 模型用配置的默认值
sleep 10
kill %1
```
Expected: 默认权限/模型设置生效，徽标 yolo/bypassPermissions 均橙色

- [ ] **Step 8: Commit**

```bash
git add src/components/settings/view/tabs/agents-settings src/components/chat/view/subcomponents/ChatComposer.tsx src/i18n/locales
git commit -m "feat(defaults): settings UI for default permission/model + yolo badge"
```

---

## 验收清单

**Group A 主题**
- [ ] `npx tsx --test src/shared/theme/themeMode.test.ts` 全绿
- [ ] 设置页主题三态可选，选"跟随系统"后切系统亮暗 → app 即时跟随
- [ ] 旧 localStorage `theme='dark'` 升级后仍识别为暗色固定
- [ ] desktop 重启背景色与上次主题一致（无闪屏）

**Group B 语言**
- [ ] 清 `userLanguage` 后 reload，UI 跟随系统/浏览器语言
- [ ] 设置页改语言后重启仍保持

**Group C 标题栏**
- [ ] Win：最小/最大/关闭按钮可用、双击最大化、拖拽、Aero Snap 正常
- [ ] 标题栏背景跟主题切换
- [ ] macOS 保留原生红黄绿（hiddenInset）

**Group D 默认权限 + 模型**
- [ ] `npx tsx --test src/shared/defaults/*.test.ts` 全绿
- [ ] 新会话默认不限权限（claude/codex/cursor→bypassPermissions，gemini→yolo）
- [ ] 首次启用弹一次性确认，确认前不发消息
- [ ] per-session 记忆优先于全局默认
- [ ] 默认模型设置后生效（三级读取链）
- [ ] yolo / bypassPermissions 徽标均为橙色警示

## 风险与回退

- **不限权限默认开启的安全风险**：一次性确认 + 始终可见的橙色徽标 + 设置页可改回 `default`
- **titleBarOverlay 与 macOS hiddenInset 不兼容**：已按平台分支处理（mac 不传 overlay）
- **i18n key 缺失**：9 语言先复制 en 文案占位，由翻译流程覆盖；缺失 key 不会崩，最多显示 key 名
- **ChatInterface 提交守卫插入点**：D4 Step 1 的 `guardedSubmit` 需对应 ChatComposer 实际 submit prop 名；若 prop 名不同，调整即可（plan 给的是模式，不是死绑定）
