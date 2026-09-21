# 2026-09-20 · 移动端功能补齐冲刺（对标 Ekko Studio）

## 背景
用户提供 Ekko Studio 的「后台任务 + 进度同步」宣传视频，要求对比 Planrla Mobile 差距并全部实现。后续演变为完整的移动端功能冲刺。

## 交付清单（全部真机验证）

1. 后台任务通知体系：前台服务锚定持续通知（进度条 + 秒表 + 工具步骤），停止/查看双按钮，完成/失败终态通知带结果预览与深链回会话。
2. 扫码配对：桌面端「连接手机」标签页生成一次性配对令牌二维码（5 分钟单次有效、不含密码），手机扫码自动交换 JWT 免密添加。
3. 可操作通知：完成/失败通知内嵌 RemoteInput 回复框，权限审批通知带 允许/拒绝 双按钮，等待输入通知带回复框 —— 全部在通知上直接操作，WS 直达桌面端。
4. 连接健壮性：直连地址自动补 http:// 协议头；全角标点归一化；新会话空 projectPath 回退到首个项目。
5. 重启恢复：已登录时冷启动直接回聊天页，不再回登录页（SessionCreated 时序修复 + auth-aware 导航）。
6. UI 去 emoji 化：全部改 Material 矢量图标（主题着色）。

## 关键 bug 与修复

- 进度通知不出现：新会话流程中 setWorking(true) 时 currentSessionId 还是 null（REST 创建会话未返回），activeRun 未建立。修复：SessionCreated 事件到达时若 working 为 true 则重新 setWorking(true)。
- 秒表重置：工具步骤更新重建通知时 setWhen(now) 刷新了 chronometer。修复：记录 startedAtMs 锚点，更新时复用。
- Unexpected token < ：旧后端对未知 API 走 SPA fallback 返回 HTML。修复：前端检查 content-type，给出人话错误。
- require is not defined：配对接口在 ESM 文件里误用 require 导入 crypto。修复：改 import。

## 踩坑记录

- 荣耀手机对 adb/PC 工具安装的 APK 每次都要指纹/密码确认 + 勾选风险提示，自动化测试会被卡住。
- 中文输入法会把 ASCII 冒号自动转全角（：），adb input text 也受影响；绕过方式是扫描填充或 keyevent 逐键。
- lint-staged 16.3.2 在脏工作区下 stash 备份会失败报 Needed a single revision。升级 17.5.1 后消失。
- vite 代理目标是 SERVER_PORT，.env.local 与旧进程环境不一致会导致前端打到不存在的端口。

## 验证方法沉淀

- 通知验证：dumpsys notification --noredact 查记录，cmd statusbar expand-notifications 展开截图 + 视觉模型确认。
- 服务验证：本地 curl health/login/pair 全链路脚本化。
- 导航验证：force-stop 后冷启动看落地页。

## 遗留

- Android 16 Live Updates（灵动岛对标）需升 targetSdk 36。
- POST /api/auth/login 经云中转返回 500（GET 正常），影响仅远端首次配对，待查 Worker。
- .24 桌面端待升级到含配对接口的版本。
- 测试账号 planrla.test@outlook.com 留在云端中转，无风险可留。
