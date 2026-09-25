# 2026-09-22 · 手机客户端推送(zcode/claude/codex 完成通知)

## 背景

用户要求 zcode、claude code、codex 三种 provider 的任务完成后通知到**手机客户端**(非手机浏览器 Web Push)。排查发现:

1. 三个 provider 的完成钩子已存在(claude:895 / codex:367 / zcode:619),但 **zcode 是空调用**(`notifyRunStopped()` 无任何参数,通知永远进不了通道)。
2. cron/定时路径 `userId=null`,`notifyUserIfEnabled` 第一行就丢弃——定时任务完成永远通知不到任何人。
3. 手机客户端的完成通知依赖「手机上该会话的 ChatViewModel 活着」:桌面端发起的 run、定时任务 run 结束时,手机 app 里没有对应会话在监听,永远收不到。App 被杀后更是完全静默。

## 方案:双通道

### 服务端(单一事件源)

`chat-run-registry.service.ts` 的 `decorateAndRecordEvent` 在 `kind === 'complete'` 处挂 `notifyRunFinished` 钩子——这是所有 provider run 终点的唯一汇聚点(桌面发起、手机发起、cron 触发全部经过)。按 exitCode/aborted 映射 stopReason(completed/failed/aborted)。

- Web Push 通道:notifyRunStopped → 手机浏览器订阅(此前已修好的链路)
- WS 广播通道:`background-task-updated`(registry 已有)→ 手机客户端常驻服务监听

### Android 客户端(PushSocketService)

新增 `apps/android/data/PushSocketService.kt`:dataSync 前台服务,App 冷启动即启动(MainActivity.onCreate)。自带 WS 重连循环(2s 起指数退避至 30s,ping 30s),复用 `App.resolveBaseUrl()`(LAN 直连优先,回落 relay)。收到 `background-task-updated` 且 `task.type==='chat'`、状态终态、`App.isForeground===false` 时,复用 `RunNotification.finished` 发本地通知(带深链回会话)。

**为什么不用 FCM**:planrla 是自托管桌面产品,不引入 Google 服务依赖;手机已通过 LAN/relay 与桌面通信,前台服务 + WS 常挂在现代 Android 上是可靠形态(与 RunForegroundService 同模式)。

## 关键修复明细

1. `zcode-cli.js`:三处通知调用补全参数(userId/provider/sessionId),`sendComplete(0)` 成功路径新增完成通知
2. `notification-orchestrator.js`:`resolveLocalUserId` 回退——userId 为空时取 `userDb.getFirstUser()`(本地单用户语义)
3. `chat-run-registry.service.ts`:complete 事件挂通知钩子(需 JSDoc 标注 notifyRunStopped 参数类型,否则 allowJs 下 sessionId 被推断为 null|undefined 编译失败)

## 验证(2026-09-23 真机完成)

- 服务端:签名 token 连 /ws,runNow 触发后实时收到 `background-task-updated`(running→idle),终态事件确认
- 客户端:`gradle assembleDebug` BUILD SUCCESSFUL,真机安装成功
- **真机通知收到**:退后台后触发日报任务,3 分钟后手机通知栏出现「claude 任务已完成 — 点击查看结果」(vision 确认),共 2 条(实时 + REST 兜底补的断线期间那条)
- 通知带「回复」action(RemoteInput)与 contentIntent 深链

## 真机调试发现并修复的两个 bug

1. **手机配置端口过期**:手机 DataStore 存的直连地址是 `192.168.0.27:3001`,而服务跑在 5199。临时解法:PC 上补起一个 3001 实例(生产应统一端口或在手机端改配置)。
2. **PushSocketService 读旧 token(401 循环)**:`resolveBaseUrl()` 把新 LAN JWT 写进 TokenHolder(内存),但 PushSocketService 读的是 DataStore 的 `token`(旧值,可能是上一个服务实例签的)→ WS 升级 401、连接反复 TIME_WAIT。修复:优先读 TokenHolder,DataStore 只做冷启动后备。
3. **断线窗口漏通知**:`background-task-updated` 是一次性广播,WS 重连期间完成的 run 永远错过。修复:`onOpen` 时 REST 拉 `/api/background-tasks` 列表,对终态 chat 任务跑同一 handler 补通知(notified 去重集合防重复)。真机验证:两条完成通知里有一条正是兜底补上的。

## 遗留

- 荣耀手机 adb 安装需手动指纹确认,自动化受阻(2026-09-23 后续安装未再触发,可能系统策略变化)
- PushSocketService 常驻通知目前 IMPORTANCE_LOW 常显,后续可加设置开关
- cron run 的 summary 首行未带上(通知只有 provider 名),可从 complete 前最后一条 assistant 文本取

## 后续:冷启动"退出账号"修复(2026-09-23)

用户反馈手机重启后回到连接页。根因两个,均已修:

1. **直连设备没有恢复路径**:`ConnectViewModel.autoLogin()` 只认两种凭据——云账号 JWT(要求 api.planrla.com 可达且 devices 非空)或 DataStore 里的 `jwt`/`relay_token` 键。纯 LAN 直连设备(扫码/手填账密)两项都没有:登录后 JWT 只进内存 TokenHolder,DataStore 的 `token` 键从不写入,`relay_token` 也空 → autoLogin 直接 return false,永远停连接页。修复:autoLogin 最前面加直连分支——current device 带 `lan+ccUser` 就直接 `applyDeviceSelection`(它会用账密换新 JWT),成功即进;失败(桌面不在线)再回落账号路径,relay 配置的手机不受影响。
2. **NomadNav 恢复竞态**:跳过 connect 页的条件含 `nav.currentBackStackEntry == null`,LaunchedEffect 与 NavHost 初始化时序不定,部分冷启动序下 entry 已建好 → 条件恒 false,恢复静默失效。修复:去掉该条件,`hasDevice` 单独决定。

真机验证:杀进程冷启动直接落「新会话」聊天页,服务端日志两条 login+WS authenticated(UI+PushSocket 各一),手机到 3001 的连接建立。
