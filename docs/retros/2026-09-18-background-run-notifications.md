# 2026-09-18 · Android 后台运行通知 + 深链

## 背景

对标 Ekko Studio 的「后台任务 + 通知进度 + 完成提醒」前瞻视频（x_video/2100789831483994114.mp4），补齐 Planrla Mobile 的三项差距：通知无进度、通知点击无跳转、退后台后 WS 无保活锚点。

## 交付（commit 204033e）

1. `RunForegroundService`：dataSync 前台服务。退后台且有活跃 run 时由 MainActivity.onStop 启动，锚定持续通知（进度条 + chronometer 计时），回前台或 run 结束即停。
2. `RunNotification`：进度/完成两类通知构建器，均带 PendingIntent 深链到对应会话。
3. 深链导航：MainActivity 从通知 intent 读 sessionId，作为 NavHost startDestination 直接进 chat 路由。
4. `ChatViewModel.setWorking()`：working 状态唯一出口，同步 App.activeRun + 工具步骤实时刷新通知文案；onCleared 清理 activeRun 防止陈旧通知。
5. 新通知渠道 `planrla_run_active`（IMPORTANCE_LOW，不打扰），完成通知仍走原 `planrla_run`。

## 关键决策

- **单 run 模型**：导航替换 chat 路由，同屏只有一个 ChatViewModel，服务伴生对象镜像其状态即可，不做多 run 注册表。
- **保活定位**：run 真正在桌面端执行，服务只保护手机侧 WS 重连（ping 30s + 指数退避已有），不做额外逻辑。
- **工具步骤直显**：ToolUse 事件把 toolName 写进通知文案，近似 Ekko 的「当前步骤」展示。

## 踩坑

- 仓库根 `apps/android/build.bat` 的 JAVA_HOME（Android Studio jbr）和 gradle-8.14-bin 路径在本机已失效；实际可用组合：Adoptium JDK 17（C:\Program Files\Eclipse Adoptium\jdk-17.0.20.8-hotspot）+ gradle-8.14.3-all + C:\Android\Sdk。
- when 分支中途插语句会被 Kotlin 当成同一分支的悬空表达式，吞掉后续分支导致 8 个编译错误；多语句必须用块语法。

## 验证

`gradle :app:assembleDebug` BUILD SUCCESSFUL（1m11s），APK 20.9MB。真机待装：`adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk`。

## 后续

- Android 16 的 Live Updates 可做真正的灵动岛对标形态（当前 targetSdk 34 用不了）。
- 完成通知可附带结果摘要首行（需服务端 Complete 事件带文本）。
