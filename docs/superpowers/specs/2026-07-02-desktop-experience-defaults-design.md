# 桌面端体验默认值优化设计

> **状态**：设计待审
> **日期**：2026-07-02
> **范围**：planrla 桌面端（Electron + React + i18n），不含 Web/Android

## 背景

Archie 提出 4 个独立的桌面端体验优化需求，都是"默认值 / 样式"层面的打磨。代码调研后发现：

- 其中 2 个有明确代码级根因：语言 detection 配置缺失（首次直接 fallback 英文）、主题缺"跟随系统"三态（toggle 一次就锁死）。
- 1 个是窗口外观：标题栏现在用系统默认（Win11 原生），且 `backgroundColor` 写死暗色。
- 1 个是 AI Agent 的默认权限 / 默认模型：`permissionMode` 默认 `'default'`（需手动开不限权限），默认模型回退值硬编码。

## 目标

1. **主题**：三态 `system | light | dark`，默认 `system`，跟随系统亮暗实时变化；手动选择后记住。
2. **语言**：首次启动跟随系统语言（`navigator.language`），手动改过后记住；不加"始终跟随"强制模式。
3. **窗口标题栏**：方案 A —— 原生窗口按钮 + 自绘标题栏容器（背景融入应用、可承载标题 / Logo、可拖拽），跨平台现代化外观。
4. **默认权限 + 默认模型**：所有 provider 的新会话默认进入"不限权限"模式（带一次性风险确认）；每个 provider 的默认模型可在设置页配置（覆盖硬编码回退）。

## 非目标（YAGNI）

- ❌ 标题栏完全 frameless 自绘（方案 B / C）—— 未来需要自定义按钮形状再升级
- ❌ "始终跟随系统语言"（不允许手动覆盖）的强制模式
- ❌ 自定义主题色 / 语义主题
- ❌ 主题 / 语言的服务端同步（仅本地 localStorage）
- ❌ Web / Android 端的窗口标题栏改造（仅 Electron 桌面端）

---

## 设计

### 需求 1：主题三态（system / light / dark）

**数据模型**

- localStorage key `theme` 取值：`'system' | 'light' | 'dark'`，默认 `'system'`
- 向后兼容：旧值 `'dark'` / `'light'` 直接识别为对应固定态；无值视为 `'system'`

**组件改造 `src/contexts/ThemeContext.jsx`**

- 状态从 boolean `isDarkMode` 升级为三态 `themeMode: 'system' | 'light' | 'dark'`
- 派生 `effectiveDark`：`themeMode === 'system'` 时读 `prefers-color-scheme`，否则 `themeMode === 'dark'`
- `system` 模式下**始终**监听 `prefers-color-scheme` 变化（修复现在"toggle 一次就停止跟随"的锁死问题 —— 现有逻辑 `handleChange` 里 `if (!savedTheme)` 导致一旦有 localStorage 就不再跟系统）
- 暴露 `themeMode` + `setThemeMode(mode)`；保留 `toggleDarkMode` 与 `isDarkMode` 别名以兼容现有调用方（如 `DarkModeToggle`）
- 既有 `<meta name="theme-color">` / `apple-mobile-web-app-status-bar-style` 更新逻辑保留，改为基于 `effectiveDark`

**UI `src/components/settings/view/tabs/AppearanceSettingsTab.tsx`**

- 现 L35-44 的 `DarkModeToggle`（on/off 两态）替换为三态选择器（跟随系统 / 亮色 / 暗色，单选按钮组）
- 复用 `SettingsRow` / `SettingsCard` 容器
- i18n key 扩展：`appearanceSettings.themeMode.{label, system, light, dark}`，11 种语言全部补全
- 注意：L70-81 的"代码编辑器主题"也用了 `DarkModeToggle` —— 该处仍是亮/暗两态，保留 `DarkModeToggle` 组件不删，主外观主题改用新的三态选择器

**Electron 启动色 `electron/main.js:149`**

- `backgroundColor` 当前写死 `'#0b1120'`（暗色），亮色系统启动会闪一下暗色背景
- 改造：main 进程读 `app.getPath('userData')/theme-cache.json`（renderer 每次主题切换时同步写一份 `effectiveDark`），启动时据此选背景色；无缓存时用暗色
- 这是"消除启动闪屏"的可选优化，不阻塞核心功能

### 需求 2：语言首次跟随系统

**`src/i18n/config.js` detection 改造（L236-245）**

- `order: ['localStorage']` → `order: ['localStorage', 'navigator']`
- `caches: ['localStorage']` 保持（手动改后写 localStorage 覆盖，不会回退到 navigator）
- `getSavedLanguage()` (L100-111) 改为：saved 命中则返回；否则**返回 null / 不设 lng**，让 i18next 走 detection 链（navigator），而不是现在直接返回 `'en'`

**效果**

- 首次启动无 localStorage → 用 `navigator.language`（Electron 中 = 系统 locale，中文系统 → `zh-CN`）
- 不支持的语言（如系统是 `ar`）→ 经 `fallbackLng: 'en'` 兜底
- 设置页 `LanguageSelector` 选了 → 写 localStorage，之后不再跟随系统

**非目标**：不加显式"跟随系统"语言选项 —— 手动改过即视为用户固定选择（符合 Archie 选定的方案）

### 需求 3：窗口标题栏（方案 A：原生按钮 + 自绘容器）

**`electron/main.js` createWindow 改造（L144-155）**

```js
// macOS 保留原生红黄绿圆点（hiddenInset）；Win/Linux 隐藏标题区、按钮仍由系统原生绘制
const titleBarStyle = process.platform === 'darwin' ? 'hiddenInset' : 'hidden';
const themeCache = readThemeCache(); // 见需求 1 的 theme-cache.json
const titlebarBg = themeCache?.effectiveDark ? '#0b1120' : '#ffffff';
const symbolColor = themeCache?.effectiveDark ? '#e5e7eb' : '#374151';

mainWindow = new BrowserWindow({
  title: APP_NAME,
  width: 1280,
  height: 840,
  icon: resolveAppIcon(),
  backgroundColor: titlebarBg,
  titleBarStyle,
  // Win/Linux: 控制系统按钮的颜色与高度（Electron 15+ 支持，38 完整支持）
  titleBarOverlay: process.platform !== 'darwin'
    ? { color: titlebarBg, symbolColor, height: 40 }
    : undefined,
  webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.cjs') },
});
```

- Electron 38 完整支持 `titleBarOverlay`（15+）与 `hiddenInset`（mac）
- macOS：`hiddenInset` 保留原生红黄绿圆点，仅隐藏标题文字
- Windows / Linux：`hidden` + `titleBarOverlay`，系统画方角按钮，颜色 / 高度随主题
- `Menu.setApplicationMenu(null)`（L143）保留

**React 标题栏容器层（新组件 `TitleBar.tsx`）**

- 顶部 40px 高，与 `titleBarOverlay.height` 对齐
- 左侧：app Logo + 名称（可选）；中部：留空作拖拽区；右侧：预留系统按钮区（按钮由系统画，容器用 CSS env 变量 `env(titlebar-area-x)` 等避让）
- CSS：标题栏容器 `-webkit-app-region: drag`（整条可拖拽移动窗口）；其内交互元素（如下拉、菜单触发器）标记 `-webkit-app-region: no-drag`
- 背景色用主题 token，与 `titleBarOverlay.color` 协调，避免按钮区与容器色阶不一致
- 双击标题栏最大化：`titleBarOverlay` 模式下系统自动处理，无需自写 IPC

**preload.cjs**：方案 A 不需要新增 minimize / maximize / close IPC（按钮原生）。仅当未来要在标题栏放额外控件（如设置齿轮）才扩展 IPC —— 本需求不含。

### 需求 4：默认权限 + 默认模型

**现状关键发现**

- `permissionMode` 是 **per-session** 持久化：`localStorage.getItem('permissionMode-${session.id}')`（`useChatProviderState.ts:332`）
- 初始值 `'default'`（L76）；切 session 时若该 session 无记录也回 `'default'`
- 各 provider 支持的模式（`FALLBACK_PERMISSION_MODES` L26-30）：
  - claude / cursor / gemini：`default, auto, acceptEdits, bypassPermissions, plan`
  - codex：`default, acceptEdits, bypassPermissions`
- **UI 显示名与状态机值不一致**（实现时需处理映射）：
  - `PermissionsContent.tsx` 里 gemini 显示 `default / auto_edit / yolo`，但状态机列的是 `bypassPermissions` 等
  - Claude 另有独立于 permissionMode 的 `skipPermissions` checkbox（旧机制，存 `claude-settings`）

**设计：统一用 permissionMode 的"不限权限"值作为新会话默认**

- per-provider 默认权限目标值：
  - claude → `'bypassPermissions'`
  - codex → `'bypassPermissions'`
  - cursor → `'bypassPermissions'`
  - gemini → `'yolo'`（UI 名）—— 实现时确认它与状态机 `'bypassPermissions'` 的映射（writing-plans 阶段细化）
- 新增 localStorage `default-permission-mode`：JSON `{ claude, codex, cursor, gemini }`
- `useChatProviderState.ts` 新建 / 切换 session 时，permissionMode 初始值链：
  `permissionMode-${session.id}`（该 session 记忆）→ `default-permission-mode[provider]`（全局默认）→ `'default'`
- **首次启用一次性确认**：用 `default-permission-ack` flag 标记是否确认过；首次新建会话时弹窗明确告知"不限权限 = AI 可直接执行任意命令，无需逐条确认"，确认后才生效

**默认模型可配置**

- 现状：`localStorage('claude-model')` 记上次选择，无则 `FALLBACK_DEFAULT_MODEL.claude`（硬编码 `useChatProviderState.ts:12`）
- 新增 per-provider "配置的默认模型" key：`claude-default-model` / `codex-default-model` / `gemini-default-model` / `cursor-default-model` / `opencode-default-model`
- 读取链改为三级：`<provider>-model`（上次选择）→ `<provider>-default-model`（用户配置的默认）→ `FALLBACK_DEFAULT_MODEL[provider]`（硬编码回退）
- **UI**：`agents-settings`（与默认权限同区，按 provider 分组）新增"默认模型"，每个 provider 一个下拉（选项来自现有可用模型列表 + 手动输入），写入 `<provider>-default-model`

**风险可见性（保留 + 强化）**

- 现有 `cyclePermissionMode`（Tab 键切换 + 聊天框当前模式徽标）保留 —— 用户随时能看到自己在不限权限下
- 徽标在 `bypassPermissions` / `yolo` 时用警示色（橙 / 红），强化感知

---

## 测试

**需求 1 主题**
- 三态切换：`system` 跟随系统变化（切系统亮暗，app 即时变）；`light` / `dark` 固定不受系统影响
- 向后兼容：localStorage 旧值 `'dark'` 升级后识别为 dark 固定态
- 启动闪屏：theme-cache 命中时背景色正确

**需求 2 语言**
- 首次启动（清 localStorage）→ `navigator.language` 生效（模拟中文系统 → zh-CN）
- 设置页改语言 → 写 localStorage，重启仍是所选语言
- 不支持的语言（模拟系统 `ar`）→ fallback `'en'`

**需求 3 标题栏**
- Windows：三按钮可点（最小 / 最大 / 关闭）、双击最大化、拖拽移动、Aero Snap 正常、颜色随主题
- macOS：红黄绿圆点在、可拖拽
- 背景色跟主题（亮 / 暗切换无错位）

**需求 4 权限 + 模型**
- 新会话默认 `bypassPermissions`（各 provider 映射正确，gemini 显示 yolo）
- 首次启用一次性确认弹窗出现，确认前不生效
- per-session 记忆优先于全局默认
- 默认模型配置后，新会话 / 重置 selection 用配置值
- 徽标警示色正确

## 风险与约束

- **不限权限默认开启的安全风险**：AI 可静默执行任意命令（`--dangerously-skip-permissions` 等价）。缓解：一次性确认 + 始终可见的警示徽标 + 设置页可随时改回。README / 设置页文案注明风险。
- **UI 权限模式名与状态机值不一致**（gemini `yolo` / `bypassPermissions`、Claude `skipPermissions` vs `permissionMode`）：实现时必须建立统一映射表；writing-plans 阶段细化。
- **Electron `backgroundColor` 启动期无法读 renderer localStorage**：用 main 进程级 `theme-cache.json` 缓解；未命中则接受单帧闪屏。
- **i18n 新增 key 要补全 11 种语言**：否则部分语言下显示 key 本身（`appearanceSettings.themeMode.*`）。
- **`DarkModeToggle` 仍是两态**：代码编辑器主题仍用它，主外观主题改用三态选择器，两者并存。

## 范围

4 块互相独立，单个 spec 可覆盖。建议 writing-plans 拆成 4 个独立 task 组（主题 / 语言 / 标题栏 / 默认权限 + 模型），可并行实现、独立 commit 与验证。
