---
REQ-ID: REQ-042
title: 系统通知 + reply input(任务完成/permission 系统通知,带 reply 输入 + 批准/拒绝按钮)
date: 2026-07-21
status: spec
关联: spike(electron/spike-reply.cjs 验证 Electron hasReply 机制 + dev 无 app identity 不显示输入框)
---

# REQ-042 系统通知 + Reply Input 设计

## 背景

任务完成 / ask question(permission_request)时,用户切走 planrla 窗口就不知道状态。要在**系统右侧通知栏**弹原生通知(Windows Toast),带:
- **reply 输入框**(hasReply)—— 用户在通知里直接打字回复
- **批准/拒绝按钮**(actions)—— permission 场景一键决策

## spike 验证(已完成)

- ✅ Electron 原生 `Notification({hasReply:true})` 机制对(通知弹出 + click 工作)
- ✅ dev 模式无输入框 = **Windows 要 app identity(AUMID + CLSID + shortcut)才显示交互元素**。planrla 之前从没配 app identity,所以连基础交互 toast 都没归到 planrla
- ✅ **无 native build**(Electron 38 内置,不碰 felixrieseberg/dotnet/edge-js/Win SDK 2015)

## 目标

1. 任务完成(session A agent done) → 窗口失焦时系统通知(标题/摘要 + click 聚焦切 session)
2. permission_request(ask question) → 窗口失焦时系统通知(reply 输入 + 批准/拒绝按钮)
3. 用户 reply / 点按钮 → 回调到 main → IPC → renderer → WS(permission_response)
4. 打包后安装(Start Menu shortcut + AUMID)Windows 才认交互元素

## 非目标

- macOS/Linux 通知(本切片 Windows-only;Mac/Linux 用 Electron Notification 基础,无 reply)
- Web Push 替代(保留,系统通知管前台失焦提醒,Web Push 管后台推送)
- 通知历史/持久化(Action Center 系统自带)

## 架构

**Electron main 进程 Notification** + **app identity(electron-builder shortcutName + AUMID)** + **IPC(renderer↔main)**。

### 触发数据流(任务完成)

```
renderer(useChatRealtimeHandlers onSessionCompleted,WS kind:complete)
  → 检查 document.hasFocus()/document.hidden(失焦才通知,避免前台打扰)
  → ipcRenderer.send('show-notification', { type:'task-complete', title, body, sessionId })
  → main: new Notification({ title, body, icon, hasReply:false, actions:[] })  // 任务完成无 reply,只 click
  → n.on('click') → mainWindow.show() + webContents.send('navigate-session', sessionId)
```

### 触发数据流(permission_request)

```
renderer(useChatRealtimeHandlers WS kind:permission_request)
  → 检查失焦
  → ipcRenderer.send('show-notification', { type:'permission', title:'需要确认', body:toolName, requestId, sessionId })
  → main: new Notification({ title, body, icon, hasReply:true, replyPlaceholder:'回复(可选)...', actions:[{type:'button',text:'批准'},{type:'button',text:'拒绝'}] })
  → n.on('reply', (e, reply) → IPC → renderer → WS permission_response { decision:'allow', customReply:reply })
  → n.on('action', (e, idx) → idx=0 批准/idx=1 拒绝 → IPC → renderer → WS permission_response { decision: allow/deny })
  → n.on('click') → mainWindow.show() + navigate session(用户进 app 手动确认)
```

## 组件改动

| 文件 | 改动 |
|---|---|
| `electron/main.js` | app.setAppUserModelId('cc.planrla.desktop');ipcMain.on('show-notification',...) → new Notification(hasReply/actions);回调 IPC webContents.send('notification-reply/action/click') |
| `electron/preload.cjs` | contextBridge 暴露 window.systemNotify(opts) + ipcRenderer.on('notification-callback') |
| `src/components/chat/hooks/useChatRealtimeHandlers.ts` | onSessionCompleted + permission_request → 失焦检查 + window.systemNotify |
| `src/components/chat/view/ChatInterface.tsx`(或 composer) | 监听 notification-callback IPC → 发 WS permission_response(复用 handlePermissionDecision) |
| `package.json` build.win | `shortcutName: "Planrla"`(electron-builder 创建 Start Menu shortcut → Windows 认 app identity) |

## app identity 配置(electron-builder)

```json
"win": {
  "icon": "public/favicon.ico",
  "target": ["nsis", "zip"],
  "shortcutName": "Planrla"
}
```
+ `electron/main.js`:`app.setAppUserModelId('cc.planrla.desktop')`(固定 AUMID,与 build.appId 一致)。

**ToastActivatorCLSID**:Electron 内置 Toast activator(shell/browser/notifications/win),setAppUserModelId + shortcutName(shortcut)应足够。若打包后 reply input 仍不显示,再深挖 CLSID 注册(installer 注册表)。

## 安全/体验

| 项 | 决策 |
|---|---|
| 触发时机 | **窗口失焦/最小化才通知**(document.hasFocus()/hidden,避免前台打扰) |
| reply 内容 | 用户输入文本,经 WS permission_response 回传 server(不经 sanitize,本地输入) |
| 批准/拒绝 | 复用现有 handlePermissionDecision(WS permission-response),通知只是触发器 |
| 通知频率 | 复用现有(permission_request 每次一个;task-complete 每个 session) |
| app identity | shortcutName + AUMID(electron-builder 打包 + installer shortcut) |

## 验收标准

1. **打包安装后**(0.13 desktop:dist:win + 安装,创建 Start Menu shortcut)
2. planrla 窗口失焦 → session A agent 任务完成 → 系统通知弹(标题/摘要)→ click 聚焦 + 切 session ✓
3. session A permission_request → 系统通知弹(**reply 输入框 + 批准/拒绝按钮**)✓
4. 通知里输入 reply → permission_response 回传(WS,server 收 customReply)✓
5. 点"批准" → permission allow(WS)✓;点"拒绝" → deny ✓
6. 前台聚焦时**不通知**(不打扰)✓
7. `npm run typecheck && npm run build` 干净

## 风险/未决

- **ToastActivatorCLSID**:Electron 内置 activator + shortcutName 是否足够让 reply input 显示?spike(dev 无 shortcut)看不到输入框;**打包安装后要验证**。若不显示,要注册 CLSID(installer reg 表)。
- **打包流程**:0.13 跑 desktop:dist:win(含 shortcutName)+ 安装本机验证。dev 模式永远看不到 reply input。
- **Mac/Linux**:Windows-only(reply input);Mac/Linux 用基础 Notification(无 reply,click 聚焦)。
- **reply 回调链路**:main → IPC → renderer → WS,要确认 permission_response 复用现有(handlePermissionDecision)。

## 下一步

spec Archie 确认 → writing-plans → worktree 实施(electron/main.js + preload + renderer + package.json)→ 0.13 打包 desktop:dist:win → 安装验收(reply input)。
