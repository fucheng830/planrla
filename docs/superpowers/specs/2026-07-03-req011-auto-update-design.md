---
REQ-ID: REQ-011
title: 桌面端自动更新(auto-update 全流程)设计
date: 2026-07-03
status: spec
---

# REQ-011 桌面端自动更新设计

## 背景

`npm run desktop` 打包版没有可用的自动更新通道。现状:
- `electron/main.js` 的 `setupAutoUpdater` 已挂 `electron-updater` 6.8.9,但 `autoDownload=false`、只 `checkForUpdates()` + `console.log`,无下载/安装/重启、无前端联动。
- 前端 `src/hooks/useVersionCheck.ts` 是另一套(web/git 模式,调 `/api/version/latest` 对比 GitHub release,提示 server 重启),与 electron-updater 脱节。
- 更新源 `updates.planrla.com` 配在 `package.json` publish,但**域名未部署(HTTP 000)**。
- **无代码签名证书**。
- 无渠道机制。

## 目标 / 验收标准

打包版用户能**半自动**完成「检测 → 下载 → 安装 → 重启」更新到最新版:

1. 打包版启动后台 silent 检测更新(失败不阻塞 UI)。
2. 有新版本 → 前端通知(版本号 +「下载」按钮)。
3. 用户点「下载」→ 显示进度 → 完成 → 通知变「重启安装」。
4. 用户点「重启安装」→ 应用退出 + NSIS 升级 + 重启为新版本。
5. 错误(网络 / sha512 校验)→ 友好提示 + 可重试,不 crash。
6. `isPackaged=false`(web/git dev)继续用 `useVersionCheck`,不变。
7. 更新源 R2 部署 + 一键上传脚本(`publish:update`),发版后 latest.yml + exe + zip 上传到 R2。

## 范围(全 6 块,分阶段)

| 块 | phase 1 MVP | phase 2(后续 spec) |
|----|-------------|---------------------|
| electron-updater 全流程 | ✓ 检测/下载/安装/重启 | — |
| 前端 UI | ✓ 通知 + 设置页「关于」区 | changelog / 动画 / 重启倒计时 |
| 更新源 | ✓ R2 + 上传脚本 | — |
| latest.yml | ✓ electron-builder 生成 + 上传 | — |
| 代码签名 | 暂不(electron-updater 不强制校验) | Azure Trusted Signing |
| 渠道 | 单 stable + 预留 channel 框架 | stable/beta/internal 启用 |

本 spec 覆盖**全 6 块设计**,实施聚焦 phase 1;phase 2 在后续 spec 细化。

## 架构

```
┌─ main (electron/main.js + 新 electron/updater.js) ──────────┐
│  autoUpdater (electron-updater 6.8.9)                        │
│    provider=generic, url=updates.planrla.com/desktop         │
│    autoDownload=false                                        │
│  autoUpdater 事件 → IPC push 'updater:state'                 │
│  IPC handlers: updater:check / :download / :quit-install     │
└──────────────────────────────────────────────────────────────┘
                  ↕  ipcRenderer ↔ ipcMain(preload 桥)
┌─ renderer (src/) ────────────────────────────────────────────┐
│  useAutoUpdater()  ← 订阅 'updater:state' + 调 IPC           │
│  <UpdateNotification />  全局 toast                           │
│  SettingsPage「关于」区:当前版本 / 检查 / 进度 / 重启        │
└──────────────────────────────────────────────────────────────┘
                  ↕  HTTPS
┌─ R2: updates.planrla.com/desktop/ ───────────────────────────┐
│  latest.yml + planrla-X.Y.Z-x64.exe(+ .zip)                  │
└──────────────────────────────────────────────────────────────┘
```

**半自动数据流**:
1. app 启动 → `autoUpdater.checkForUpdates()`(silent)
2. `update-available` → IPC push `{state:'available', info:{version}}` → renderer 弹通知
3. 用户点「下载」→ `window.updater.download()` → IPC → `autoUpdater.downloadUpdate()`
4. `download-progress` → IPC push `{state:'downloading', percent}` → 进度条
5. `update-downloaded` → IPC push `{state:'downloaded'}` → 「重启安装」
6. 用户点「重启安装」→ `window.updater.quitInstall()` → `autoUpdater.quitAndInstall()`
7. 错误:`error` 事件 → `{state:'error', message}` → 通知 + 重试

**模式分流**(两套并存,不合并):`isPackaged=true` 跑 electron-updater,前端显示 updater UI;`isPackaged=false` `setupAutoUpdater` 早 return(已有逻辑),前端继续 `useVersionCheck`,不显示 updater UI。

## main 进程设计

新文件 `electron/updater.js`:
- `initAutoUpdater(mainWindow)`:
  - 读 `process.env.PLANRLA_UPDATE_URL` 或默认 `https://updates.planrla.com/desktop`
  - `autoUpdater.autoDownload = false`
  - `autoUpdater.setFeedURL({ provider:'generic', url })`
  - 绑定事件:`checking-for-update` / `update-available` / `update-not-available` / `download-progress` / `update-downloaded` / `error`,各自 → `mainWindow.webContents.send('updater:state', {state, ...})`
  - state 枚举:`idle | checking | available | not-available | downloading | downloaded | error`
- `ipcMain.handle('updater:check', () => autoUpdater.checkForUpdates())`
- `ipcMain.handle('updater:download', () => autoUpdater.downloadUpdate())`
- `ipcMain.handle('updater:quit-install', () => autoUpdater.quitAndInstall())`
- 导出 `initAutoUpdater`,`app.whenReady` 后(且非 dev url)调用

`electron/main.js` 改动:删除内联 `setupAutoUpdater`,改 `import { initAutoUpdater } from './updater.js'`,`app.whenReady` 调用。

## preload 设计

`electron/preload.cjs`:`contextBridge.exposeInMainWorld('updater', { check, download, quitInstall, onState })`
- `check/download/quitInstall` → `ipcRenderer.invoke('updater:check'|'updater:download'|'updater:quit-install')`
- `onState(fn)` → `ipcRenderer.on('updater:state', (_e, payload) => fn(payload))`,返回 unsubscribe

类型声明:新增 `src/types/updater.ts`(`UpdaterState` 联合类型),`window.updater` 加到 global d.ts。

## renderer 设计

新文件 `src/hooks/useAutoUpdater.ts`:
- `useState<UpdaterState>({state:'idle'})`
- `useEffect`:`window.updater.onState(setState)`(仅 `isPackaged`,从 `/health` 拿)
- return `{ state, check, download, quitInstall }`(后三个透传 window.updater)

新文件 `src/components/UpdateNotification.tsx`:
- 全局 toast(挂 App 根,positioned bottom-right)
- `available` → "新版本 X.Y.Z 可用 [下载] [稍后]"
- `downloading` → 进度条(percent)
- `downloaded` → "下载完成 [重启安装] [稍后]"
- `error` → "更新失败:msg [重试]"
- `not-available` → 不显示(设置页显示「已是最新」)
- `idle/checking` → 不显示

`SettingsPage`(已有)加「关于/更新」区:
- 当前版本(`package.json` version)
- 「检查更新」按钮 → `check()`
- 进度(downloading 时)
- 「重启安装」(downloaded 时)
- 最新版本号 + release notes 链接(链 GitHub Release;latest.yml 无 changelog,只做版本检测)

## 更新源 R2 设计

- R2 bucket:`planrla-updates`
- 自定义域名:`updates.planrla.com` → R2 bucket(Cloudflare CDN)
- 对象路径:`/desktop/latest.yml` + `/desktop/planrla-X.Y.Z-x64.exe`(+ `.zip` + `.exe.blockmap` 增量更新用)

新文件 `scripts/publish-r2.js`:
- 用 `wrangler r2 object put`(wrangler 已在 landing 部署用,统一工具链;R2 兼容 S3,必要时也可换 AWS S3 SDK,但默认 wrangler)
- 上传 `release/latest.yml` + `release/planrla-<ver>-x64.exe` + `.zip` + `.blockmap`
- 凭据 env:`CF_ACCOUNT_ID` + `R2_ACCESS_KEY` + `R2_SECRET_KEY`(或 `CLOUDFLARE_API_TOKEN`)
- `--force` 覆盖

`package.json` 加 `"publish:update": "node scripts/publish-r2.js"`。

发版流程(`docs/process/templates/release-checklist.md` 加第 ⑧ 步):
release-it(tag + GitHub Release)→ `desktop:dist:win`(打包)→ `gh release upload`(GitHub assets)→ **`publish:update`(R2 更新源)**。

## 错误处理

| 场景 | 行为 |
|------|------|
| 检测时网络失败 | `error` → 通知"更新检测失败,稍后重试" + [重试];启动 silent 失败不弹(只 console) |
| 下载中断/失败 | `error` → 通知"下载失败" + [重试];electron-updater 内部 resume 由它管 |
| sha512 校验失败 | `error` → 同上 |
| downloaded 但用户不重启 | 保留 installer,下次启动通知"已下载,重启安装" |
| 签名(暂不) | 打包不签 + 更新不签,publisher 都为空,electron-updater 不强制校验,通过;phase 2 签名后启用校验 |

## 测试策略

**单元**:
- `useAutoUpdater` 状态机:各 state 转换、onState 订阅/取消
- `UpdateNotification` 渲染:各 state 下显示对应文案/按钮
- `computeRestartRequired`(已有,useVersionCheck)不受影响

**集成(手动,验收脚本)**:
1. 打包 v0.4.0 → `publish:update` 上传 R2
2. 本地装 v0.3.0(或更低)
3. 启动 → 后台检测到 v0.4.0 → 弹通知
4. 点「下载」→ 进度 → 「重启安装」
5. 重启 → 验证版本 v0.4.0

**错误场景**:断网启动 → 不 crash + 设置页「检查更新」报错 + 重试恢复。

## 文件改动清单

新增:
- `electron/updater.js`(main updater 模块)
- `src/hooks/useAutoUpdater.ts`
- `src/components/UpdateNotification.tsx`
- `src/types/updater.ts`
- `scripts/publish-r2.js`

修改:
- `electron/main.js`(用 `initAutoUpdater` 替代内联)
- `electron/preload.cjs`(暴露 `updater`)
- `src/types/global.d.ts` 或同等(`window.updater` 类型)
- `SettingsPage`(加「关于/更新」区)
- `package.json`(加 `publish:update` script)
- `docs/process/templates/release-checklist.md`(加第 ⑧ 步 publish:update)
- `docs/commercial/RELEASE_CHECKLIST.md`(NOMAD_ → PLANRLA_ 命名修正 + R2/Azure 更新)

## 已知风险

- **SmartScreen 警告**(未签名):phase 2 签名解决;MVP 接受(用户首次安装/更新可能见警告,Electron 应用常见)。
- **R2 大文件下载**(exe 240MB):CDN 加速 + 进度条缓解;首次下载耗时。
- **electron-updater 跨大版本升级**(0.x → 1.x 将来):暂不考虑(早期版本)。
- **渠道框架预留**:phase 1 单 stable,SettingsPage channel dropdown 先占位(disabled),phase 2 启用 latest-<channel>.yml + electron-updater.channel。

## 决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| spec 范围 | 全 6 块 | Archie 选;一个 spec 统揽,分阶段实施 |
| 更新源 | Cloudflare R2 + 自有域名 | 大文件 OK + CDN + 出口免费 + 专业 |
| 代码签名 | 暂不,phase 2 Azure Trusted Signing | 不阻塞 MVP;Azure 性价比 + SmartScreen 友好 |
| 更新触发 | 半自动(autoDownload=false) | 透明 + 可控 + 不打断 |
| 渠道 | 单 stable MVP + 预留框架 | 早期产品,渠道需求不急 |
| 两套版本检查 | 并存(desktop updater / web useVersionCheck) | 各管一摊,不强行合并 |
