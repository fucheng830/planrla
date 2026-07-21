---
REQ-ID: REQ-042
title: 系统通知 + reply input 实施计划
date: 2026-07-21
status: plan
spec: docs/superpowers/specs/2026-07-21-req042-system-notification-reply-design.md
---

# REQ-042 系统通知 + Reply Input Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans.

**Goal**:任务完成/permission 时系统通知(Windows Toast,hasReply + actions),失焦才弹,reply/批准/拒绝回调到 WS。

**Architecture**:Electron main `Notification({hasReply})` + appIdentity(package.json shortcutName + main.js setAppUserModelId)+ IPC(renderer↔main)。0.13 打包安装后 Windows 才认(reply input dev 看不到)。

**执行**: worktree req042-notification + subagent-driven。0.13 打包验证(dev 看不到 reply input)。

---

## Task 1: electron/main.js Notification + ipcMain + appIdentity

**Files**: `electron/main.js` + `package.json`(build.win shortcutName)

- [ ] **main.js**:
  - `app.setAppUserModelId('cc.planrla.desktop')`(AUMID,与 appId 一致)
  - `ipcMain.on('show-notification', (_e, { type, title, body, sessionId, requestId }) => { ... })`:
    - `new Notification({ title, body, icon: logo-512.png, hasReply: type==='permission', replyPlaceholder:'回复(可选)...', actions: type==='permission' ? [{type:'button',text:'批准'},{type:'button',text:'拒绝'}] : [] })`
    - `n.on('reply', (e, reply) => mainWindow.webContents.send('notification-callback', { type:'reply', reply, requestId, sessionId }))`
    - `n.on('action', (e, idx) => mainWindow.webContents.send('notification-callback', { type:'action', action: idx===0?'allow':'deny', requestId, sessionId }))`
    - `n.on('click', () => { mainWindow.show(); mainWindow.focus(); mainWindow.webContents.send('notification-callback', { type:'click', sessionId }) })`
    - `n.show()`
- [ ] **package.json** build.win 加 `"shortcutName": "Planrla"`(electron-builder 创建 Start Menu shortcut → Windows 认 app identity)
- [ ] typecheck + commit `feat(notify): main ipcMain Notification hasReply + appIdentity(REQ-042)`

## Task 2: preload.cjs 暴露 systemNotify + callback

**Files**: `electron/preload.cjs`

- [ ] contextBridge.exposeInMainWorld('systemNotify', { show(opts) { ipcRenderer.send('show-notification', opts) } })
- [ ] contextBridge.exposeInMainWorld('onNotificationCallback', (cb) => ipcRenderer.on('notification-callback', (_e, data) => cb(data)))
- [ ] typecheck + commit `feat(notify): preload systemNotify + callback 桥(REQ-042)`

## Task 3: renderer 触发 + 回调

**Files**: `src/components/chat/hooks/useChatRealtimeHandlers.ts` + `src/components/chat/view/ChatInterface.tsx`(或 composer)

- [ ] **useChatRealtimeHandlers**(onSessionCompleted):
  - session complete → `if (!document.hasFocus() || document.hidden) window.systemNotify?.show({ type:'task-complete', title:'任务完成', body: summary||'一个会话已完成', sessionId: sid })`
- [ ] **permission_request**(useChatRealtimeHandlers permission 分支):
  - → `if (!document.hasFocus() || document.hidden) window.systemNotify?.show({ type:'permission', title:'需要确认', body: toolName, requestId, sessionId })`
- [ ] **ChatInterface**(或顶层)挂载 `window.onNotificationCallback`:
  - `{ type:'reply', reply, requestId }` → 发 permission_response(复用 handlePermissionDecision,带 customReply:reply)
  - `{ type:'action', action:'allow'|'deny', requestId }` → handlePermissionDecision(allow/deny)
  - `{ type:'click', sessionId }` → navigate 到该 session(onNavigateToSession)
- [ ] typecheck + commit `feat(notify): renderer 触发 + reply/action 回调(REQ-042)`

## Task 4: 0.13 打包 + 安装验证

- [ ] 0.13 SSH + 拷代码/node_modules + `desktop:dist:win`(含 shortcutName)
- [ ] 安装本机(Start Menu "Planrla" shortcut 创建 + AUMID 注册)
- [ ] 验证:planrla 失焦 → session permission_request → **系统通知弹(reply 输入框 + 批准/拒绝按钮)** ✓
- [ ] reply 输入 → permission_response 回传 ✓;点批准/拒绝 → WS ✓
- [ ] task-complete 通知 + click 切 session ✓
- [ ] 前台聚焦不通知 ✓

---

## Self-Review(spec 覆盖)

- spec §任务完成通知 → Task 3(onSessionCompleted)✓
- spec §permission 通知 + reply + 批准/拒绝 → Task 1(Notification hasReply/actions) + Task 3(触发/回调)✓
- spec §app identity → Task 1(package.json shortcutName + setAppUserModelId)✓
- spec §失焦才通知 → Task 3(document.hasFocus/hidden 检查)✓
- spec §打包验证 → Task 4 ✓
- spec §验收 7 条 → Task 4 ✓
