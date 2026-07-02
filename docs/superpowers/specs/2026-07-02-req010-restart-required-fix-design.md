# REQ-010:桌面打包模式禁用 restartRequired 误报 — 设计

> **日期**:2026-07-02
> **状态**:Draft(待 Archie 审阅)
> **REQ-ID**:REQ-010
> **类型**:fix
> **目标版本**:v0.2.1(patch)
> **关联**:`docs/process/BACKLOG.md`、`src/hooks/useVersionCheck.ts`、`server/index.js`、`electron/main.js`

## 1. 背景(根因)

v0.2.0 桌面安装后,主界面底部持续显示黄色 Toast「已安装更新 — 请重启服务器以生效」,重启应用/服务器也消不掉。

根因在 `src/hooks/useVersionCheck.ts:49`:
```ts
setRestartRequired(data.version !== version);
```
- `data.version`:server `/health` 返回的 `RUNNING_VERSION`,进程启动时读一次 package.json 并固化(`server/index.js:91-97`)
- `version`:vite **构建时**把 `import { version } from '../../package.json'` 内联进前端 bundle

**设计意图**(代码注释写明):给 npm/git **源码自更新**模式用 —— 用户更新磁盘代码 + 重建前端后,若 server 进程没重启(还在跑旧代码),前端检测到 version 不一致,提示「重启 server」。对源码自更新场景合理。

**v0.2.0 误报根因(双轨制副产品)**:
| 来源 | v0.2.0 值 | 原因 |
|------|----------|------|
| 前端 bundle `version` | 1.34.0 | vite build 读源码 package.json(双轨=1.34.0),固化进 bundle |
| server `RUNNING_VERSION` | 0.2.0 | electron-builder `-c.extraMetadata.version=0.2.0` 注入 asar 内 package.json,server 启动读到 0.2.0 |

→ 永久 mismatch → `restartRequired` 永真 → Toast 永存。重启 server 进程无效(重启后两值不变)。

## 2. 目标与非目标

### 目标
- 消除桌面打包模式的误报 Toast
- 保留 npm/git 源码模式的「server 已更新需重启」提示(对源码用户仍有价值)
- 防御未来任何 version 不一致再误报桌面用户

### 非目标(YAGNI)
- 不做桌面 auto-update(单独立项 REQ-011)
- 不改 i18n 文案
- 不改 Sidebar 其他组件
- 不处理已发出的 v0.2.0 安装包(只能等 v0.2.1)

## 3. 修复设计

### 层次 1:单轨化(已完成,2026-07-02)
`package.json` version `1.34.0 → 0.2.0`,去掉命令行 `-c.extraMetadata.version`。下次打包:前端 bundle 读源码=0.2.0,server 读 asar=0.2.0,一致 → 不误报。无需改代码。

### 层次 2:桌面打包模式禁用检测(本 spec 核心)
桌面打包应用,Electron 每次启动都重启 server 进程,server 永远跑最新代码,不存在「server 跑旧代码」场景。该检测对桌面打包**逻辑上无意义**,应禁用。

**数据流**:
```
electron/main.js (app.isPackaged = true)
  └─ spawn server 时 env 加 PLANRLA_PACKAGED=1
      └─ server /health 返回 { isPackaged: true, version, installMode, ... }
          └─ useVersionCheck: restartRequired = !isPackaged && (data.version !== version)
              ├─ 桌面打包 → 永远 false → Toast 不显示
              └─ npm/git 源码 → 保留原检测(自更新提示仍有用)
```

## 4. 改动清单(3 个文件,极小)

| 文件 | 改动 |
|------|------|
| `electron/main.js` | `startServer()` 的 spawn env 块(main.js:129-138)加 `PLANRLA_PACKAGED: app.isPackaged ? '1' : '0'` |
| `server/index.js` | `/health` handler 返回值加 `isPackaged: process.env.PLANRLA_PACKAGED === '1'` |
| `src/hooks/useVersionCheck.ts` | 第 49 行改为 `setRestartRequired(!data.isPackaged && data.version !== version)` |

## 5. 关键设计选择

**为什么用 `isPackaged` 而非 `installMode`?**
`installMode`(`server/index.js:84`)= `fs.existsSync(.git) ? 'git' : 'npm'`。桌面打包 asar 内无 .git → 'npm',与「npm 源码模式」(用户 `npm install planrla` 跑源码)混淆。npm 源码模式仍需要重启提示(用户 `npm update` 后 server 没重启),用 installMode 会误伤。`isPackaged` 由 Electron 主进程的 `app.isPackaged` 显式传入,是「打包桌面应用」的精确信号。

**为什么不直接移除 restartRequired?**
源码模式(开发 + 极少数 npm 源码用户)下,该提示能防「server 跑旧代码导致 DB-backed actions 静默失败」(注释提及)。对源码模式有真实价值,保留。

## 6. 测试

### 单测 `useVersionCheck`(沿用项目 node:test 惯例)
mock `/health` fetch,3 个 case:
- ① `isPackaged=true` + `version` mismatch → `restartRequired === false`(桌面不误报)
- ② `isPackaged=false` + mismatch → `restartRequired === true`(源码模式保留)
- ③ `isPackaged=false` + match → `restartRequired === false`

### 手动验收
- v0.2.1 打包安装 → 主界面底部无「已安装更新」Toast
- `npm run desktop`(开发模式,isPackaged=false)→ 正常(有 version 差异仍提示,无差异不提示)

## 7. 验收标准(三道门)

- **预检门**:`npm run typecheck && npm run build && git diff --check` 全过
- **功能门**:① 打包安装无 Toast;② 源码模式检测逻辑未坏;③ `/health` 返回 `isPackaged` 字段
- **回归门**:Sidebar 折叠/展开态、版本号显示、`updateAvailable` 提示均正常

## 8. 发版

**v0.2.1(patch)** —— 首个单轨发版,顺带验证 `docs/process/templates/release-checklist.md` 7 步。
- 走 `release-it patch` → tag v0.2.1 → electron-builder(读 package.json 0.2.1)→ `gh release upload`
- 发版记录:`docs/process/releases/v0.2.1.md`

## 9. 后续(writing-plans 拆任务)

spec 批准后,由 `writing-plans` 拆成实施计划,预计:
- **Task 1**:`electron/main.js` 传 `PLANRLA_PACKAGED` env
- **Task 2**:`server/index.js` `/health` 返回 `isPackaged`
- **Task 3**:`useVersionCheck.ts` 改 `restartRequired` 条件
- **Task 4**:单测 `useVersionCheck`(3 case)
- **Task 5**:三道门验收 + 打包验证
- **Task 6**(发版):走 `release-checklist.md` 发 v0.2.1
