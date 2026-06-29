# Android 工作区与联调说明

## 目录定位

Android 客户端已经纳入当前产品工作区：

```text
apps/android/
```

当前阶段保留 Android 原有 Gradle 工程结构，不强行改成完整 monorepo。这样可以先完成一体化联调、协议对齐和体验统一，避免在 v1 P0 阶段引入过大的目录迁移风险。

## 本地启动

### 后端与 Web

在仓库根目录运行：

```bash
npm run dev
```

默认服务：

- API：`http://127.0.0.1:3001`
- Web：`http://127.0.0.1:5173`
- WebSocket：同 API 服务端口

### Android

在 Android Studio 中打开：

```text
apps/android/
```

或在命令行进入：

```powershell
.\apps\android\build.bat
```

当前 Android 工程沿用原项目的 Gradle 8.14 分发路径，`build.bat` 会自动切换到 `apps/android`，并设置 Android Studio 自带 JDK 与本机 Android SDK。

## Android 连接后端

Android 模拟器访问宿主机后端时通常使用：

```text
http://10.0.2.2:3001
```

真机访问本机后端时使用电脑局域网 IP，例如：

```text
http://192.168.x.x:3001
```

确保后端 `HOST=0.0.0.0`，并允许防火墙访问 `SERVER_PORT`。

## P0 对齐范围

Android 纳入工作区后，P0 阶段先对齐以下能力：

- 登录与 token 存储。
- 项目列表与项目选择。
- 会话列表倒序。
- 会话任务状态：`idle`、`running`、`waiting_for_input`、`completed`、`failed`、`needs_attention`。
- 新完成任务提醒，用户点击会话后取消提醒。
- WebSocket 消息协议和错误状态。

## 开发原则

- Android 不照搬桌面端复杂面板，优先覆盖查看、提醒、接管、轻量审批。
- 多端共享的状态、错误码、WebSocket 事件必须先写入协议文档。
- 后端接口变更必须评估 Web、Desktop、Android 三端影响。
- Android 本地配置和构建产物不进入 Git，包括 `local.properties`、`.gradle/`、`build/`、`*.apk`。

## 下一步

1. 将 Android 当前 API 调用点整理到 `docs/architecture/API_CONTRACT.md`。
2. 将任务状态模型同步到 Android UI。
3. 将完成提醒与移动端通知通道打通。
4. 为 Android 增加后端地址配置和连接诊断。
