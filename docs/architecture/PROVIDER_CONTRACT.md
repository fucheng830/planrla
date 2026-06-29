# Provider Contract 草案

## 目标

Provider Contract 用于统一 Claude、Cursor、Codex、Gemini、OpenCode 以及后续自定义 Provider 的接入方式。P0 阶段先定义能力边界和命名，后续再逐步迁移现有实现。

## Provider 基本信息

每个 Provider 必须声明：

```ts
type ProviderId = 'claude' | 'cursor' | 'codex' | 'gemini' | 'opencode' | string;

type ProviderDescriptor = {
  id: ProviderId;
  displayName: string;
  runtime: 'cli' | 'sdk' | 'http' | 'hybrid';
  capabilities: ProviderCapabilities;
};
```

## 能力声明

```ts
type ProviderCapabilities = {
  auth: boolean;
  models: boolean;
  sessions: boolean;
  streaming: boolean;
  abort: boolean;
  permissions: boolean;
  tools: boolean;
  mcp: boolean;
  skills: boolean;
  usage: boolean;
};
```

UI 必须优先读取能力声明，不应在组件里写大量 provider-specific 分支。

## 服务接口

### Auth

```ts
type ProviderAuthStatus = {
  authenticated: boolean;
  method?: 'oauth' | 'api_key' | 'local_cli' | 'unknown';
  email?: string;
  message?: string;
};
```

### Models

```ts
type ProviderModel = {
  id: string;
  label: string;
  description?: string;
  contextWindow?: number;
  isDefault?: boolean;
};
```

### Sessions

```ts
type ProviderSession = {
  sessionId: string;
  providerSessionId?: string | null;
  projectPath: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
  lastActivity?: string;
};
```

### Run

```ts
type ProviderRunRequest = {
  sessionId: string;
  projectPath: string;
  prompt: string;
  model?: string;
  permissionMode?: string;
  toolsSettings?: Record<string, unknown>;
};
```

Provider 运行时必须通过统一 writer 输出事件：

```ts
type ProviderRunEvent =
  | { kind: 'stream_delta'; sessionId: string; content: string }
  | { kind: 'stream_end'; sessionId: string }
  | { kind: 'text'; sessionId: string; role: 'user' | 'assistant'; content: string }
  | { kind: 'tool_use'; sessionId: string; toolName: string; toolInput: unknown; toolId: string }
  | { kind: 'tool_result'; sessionId: string; toolId: string; toolResult: unknown }
  | { kind: 'permission_request'; sessionId: string; requestId: string; toolName: string; input: unknown }
  | { kind: 'permission_cancelled'; sessionId: string; requestId: string }
  | { kind: 'status'; sessionId: string; text: string; canInterrupt?: boolean }
  | { kind: 'complete'; sessionId: string; success: boolean; aborted?: boolean; exitCode?: number };
```

## 状态映射

Provider 事件必须映射到统一任务状态：

| Provider 事件 | SessionTaskStatus |
|---|---|
| run started | `running` |
| `status` | `running` |
| `permission_request` | `waiting_for_input` |
| `complete` + `success !== false` | `completed` |
| `complete` + `success === false` | `failed` |
| protocol/runtime recoverable warning | `needs_attention` |

## 错误约定

所有 Provider 错误应归类：

- `not_installed`
- `not_authenticated`
- `model_unavailable`
- `permission_denied`
- `rate_limited`
- `network_error`
- `runtime_error`
- `protocol_error`

错误必须带恢复建议，方便 Web/Desktop/Android 一致展示。

## P0 落地方式

- 现有 Provider 暂不强制迁移目录。
- 新增能力和状态必须先符合本 contract。
- 前端新增 UI 时先判断 `capabilities`，再决定显示哪些操作。
- 后续将现有 Provider 服务逐个迁移为 adapter。

## 后续演进

- 将 contract 转为 TypeScript 接口并导出到共享包。
- 为每个 Provider 增加 contract compliance test。
- Provider 诊断面板直接读取 descriptor、auth、models、runtime health。
