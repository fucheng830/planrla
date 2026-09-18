# @planrla/chat

planrla 对话界面的独立包形态：同一份源码，planrla 主应用与万象等宿主应用共享消费。

## 当前状态

**第 1 步 ✅ 依赖边界审计**（75 个文件）：内核自包含度高、零 `defaultProps`。

**第 2 步 ✅ 包体落地**（192 文件，包级 tsc 通过 EXIT=0）：

- 源码镜像复制进 `packages/chat/src/`，目录结构与 planrla src 一致，相对 import 零改写
- 完全自包含（scripts/verify-package-selfcontained.mjs：无包外逃逸 import）
- 配置注入点：`configureChatApi({baseUrl})`、`WebSocketProvider config={{wsUrl,token}}`
- 移除 AuthContext 硬依赖（token 改注入）；删除 chat 未用的 DarkModeToggle/ThemeModeSelector
- i18n 自包含：`initChatI18n()` 幂等初始化（语言包内置）
- 注意：当前为复制而非迁移，planrla 应用仍用原文件；M3 后删原文件消除双份

## 边界依赖处置表（第 1 步审计结论）

| 依赖 | 次数 | 处置 |
|------|------|------|
| shared/view/ui（UI 原语） | 15 | 已随包复制 |
| types/app | 14 | 已随包复制 |
| stores/useSessionStore | 8 | 已随包复制（chat 专用） |
| utils/api | 8 | 已注入 configureChatApi |
| hooks/useSessionProtection | 6 | 已随包复制 |
| contexts/WebSocketContext | 2 | 已注入 config（wsUrl/token） |
| contexts/ComposerContext / PermissionContext | 4 | 已随包复制（无 Provider 时返回 null，宿主可不包） |
| utils/clipboard、analytics、lib/utils | 6 | 已随包复制 |
| shared/defaults/* | 3 | 已随包复制 |
| components/llm-logo-provider | 2 | 已随包复制 |
| lib/voice*、useVoice* | 4 | 已随包复制（可选能力） |
| utils/notificationSound、pageTitleNotification | 2 | 已随包复制 |
| shared/perf/timing、view/sessionDrag | 3 | 已随包复制 |

## 入口

```tsx
import { ChatInterface, WebSocketProvider, configureChatApi, initChatI18n } from "@planrla/chat";

await initChatI18n();
configureChatApi({ baseUrl: "http://localhost:3201" });

<WebSocketProvider config={{ wsUrl: "ws://localhost:3201/ws", token }}>
  <ChatInterface /* planrla ChatInterface 的既有 props */ />
</WebSocketProvider>
```

## 会话级积木

`ChatSession` 是对完整会话面的稳定封装：宿主仍控制项目、会话和传输，组件负责消息流、工具卡、权限提示和输入区。

```tsx
import { ChatSession, configureChatApi, initChatI18n } from '@planrla/chat';

await initChatI18n();
configureChatApi({ baseUrl: '/api' });

<ChatSession
  selectedProject={project}
  selectedSession={session}
  ws={ws}
  sendMessage={sendMessage}
  onFileOpen={openFile}
  className="h-full"
/>
```

需要更细粒度组合时，可从包入口直接使用 `ChatMessagesPane`、`ChatComposer`、`MessageComponent`、`PermissionRequestsBanner` 和 `ToolRenderer`，对应 props 类型也已导出。

## 迁移步骤

- M2 ✅ 包体落地（本目录）
- M3（未开始）：planrla 主应用改从 @planrla/chat 引用（dogfood），删除 src 内原文件
- M4（未开始）：万象消费：vite alias + React 单副本 + tailwind 扫描包源文件，删除其手工移植的 planrla-chat 目录

## 构建形态

- 短期：源码直出（main 指 src/index.ts），宿主 bundler 编译，peer 单一 React 副本
- 长期：tsup 产出 d.ts + esm/cjs 双产物
