# ZCode 源码研究与 planrla 借鉴分析

> 研究对象: [zai-org/ZCode](https://github.com/zai-org/ZCode) v3.14.0 (已克隆到本仓库 ZCode/)
> 架构图: [zcode-architecture.html](./zcode-architecture.html)
> 日期: 2026-09-21

## 一、ZCode 是什么

Z.ai 官方 AI 编程工作台，Apache-2.0 开源。一个 monorepo 同时交付三种形态：

| 形态 | 入口 | 技术 |
|---|---|---|
| Desktop | Electron | packages/desktop (main/host/preload/renderer) |
| Web | zcode --web | packages/web + packages/server (HTTP/WS) |
| TUI | zcode (无参) | apps/zcode-cli/packages/tui |

规模：应用侧 1346 个 TS/TSX 文件约 12.4MB（不含依赖）。Agent 核心（AgentRuntime、TurnMachine、工具调度、MCP、子代理、记忆、压缩）全部自研，位于 apps/zcode-cli/packages/core（19 个子包）。

## 二、最有借鉴价值的 7 个设计

### 1. 架构即代码：architecture-policy.yaml（强烈推荐，成本低收益大）

根目录 [architecture-policy.yaml](../../ZCode/architecture-policy.yaml) 声明每个模块的：

- requires（允许依赖谁）、publicEntrypoints（唯一公共入口）
- layers（domain/app/adapters 分层及顺序）、owner（负责人域）

全局约束：maxFileLines=400、maxContractLines=300、maxPublicMethods=12、forbidCycles、forbidDeepImports。配套 [architecture-check.mjs](../../ZCode/scripts/architecture/architecture-check.mjs) 在 CI 里强制执行：

- verify:pre-push = lint + architecture:check --changed（只查改动文件，反馈快）
- baseline 文件登记存量违规，新增违规才报错（渐进收紧不阻塞）
- architecture:context <module-id> 生成"模块阅读包"，直接喂给 AI 当上下文

**planrla 现状**：文件卫生只有约定（≤500 行）没有机器强制；server/ 14 个模块之间依赖靠自觉。
**可做**：把 server/modules 的模块边界写成 planrla 版 policy，先 --changed 模式接入 lint-staged；file hygiene 用现成脚本（如 max-lines 规则）挂进 eslint。预计 1-2 天。

### 2. 显式 Turn 状态机

core/src/agent/turn-state.ts 定义 TurnPhase 枚举 + canTransitionTo() 合法迁移表；turn-machine.ts 所有状态迁移走显式方法（startModelRequest / receiveModelResponse / scheduleTools / requestPermission / drainPendingInputs…）。

**对 planrla 的意义**：planrla 通过 stdio 包装多个 CLI，会话状态散落在各 provider 适配器里。把"一轮对话"的生命周期（输入准入→模型请求→工具审批→执行→汇总）抽成显式状态机，多 agent 并发时才有统一的可观测点和断点恢复能力。ZCode 的 turn-state.ts 可以直接参考其 phase 划分。

### 3. 输入准入：owner/lease + CommandInbox 串行化

AGENTS.md 原文："已接受的 busy/running 输入由 CLI/runtime CommandInbox 串行 admission；Renderer 只保留未提交草稿与 pending optimistic overlay"。运行时有 createRuntimeCommandQueue。

**对 planrla 的意义**：这正是"手机发消息时 agent 正在跑"的解法——planrla 的核心场景。现在 planrla 大概率是排队或拒绝；ZCode 的模型是：输入随时可交，runtime 串行准入，UI 层乐观显示 pending 态，owner/lease 决定路由。直接抄这套语义。

### 4. workspaceIdentity 与 workspacePath 分离

"身份 key 统一为 workspaceIdentity?.trim() || workspacePath，适用于去重、绑定、缓存、队列、持久化"；远程链路贯穿传递 workspaceIdentity + remoteSessionId，不得仅按路径匹配。

**对 planrla 的意义**：planrla 有 relay-client（手机远程）和 sync 模块，同样面临"同一目录多个远程会话"的标识问题。路径做身份会在远程/挂载场景碰撞。这个二字段模式成本极低，建议在会话/队列/持久化层立刻采用。

### 5. 三份 AI 协作文档体系

ZCode 把"给 AI 的上下文"当产品资产维护：

- AGENTS.md：行为规范（spec 先行、唯一状态所有者、协议改动同步类型、日志分级、禁 UI 直调实现）
- DESIGN.md：设计系统 + text-ui-* token 强制，违规视为缺陷
- CONTEXT.md：领域词汇表（术语 + Avoid 反例），如 "Restorable Builtin"、"Orphaned Installed Plugin"

**planrla 现状**：CLAUDE.md 偏流程管理，缺"改某模块前必读什么"的路由。
**可做**：给 server/modules 每个复杂域（relay、a2a、providers）写 CONTEXT 式词汇表；把"唯一状态所有者"写成硬规则。planrla 的 BACKLOG 流程已经是同类最佳实践，这一条是补齐技术侧。

### 6. Provider 层隔离与补丁策略

packages/provider 与 provider-node 分离（纯配置解析 vs Node 运行时）；对 @ai-sdk/openai-compatible 和 @ai-sdk/anthropic 用 pnpm patchedDependencies 打补丁（patches/ 目录）。

**对 planrla 的意义**：planrla 的 providers 模块如果遇到上游 SDK 行为不满足需求（如 tool call 流式格式差异），patchedDependencies 是比 fork 整个 SDK 更干净的做法。

### 7. 会话压缩（compact）是一等公民

core/src/compact/ 有独立体系：policy（何时压）、microcompact（工具结果级压缩）、rounds（轮次级）、prompt（压缩提示词）。长会话成本与上下文衰减是 agent 工作台的硬问题。

**对 planrla 的意义**：planrla 显示多 agent 长会话但压缩策略由各家 CLI 黑盒处理；对自研的 kanban/cron-prompts 等长任务编排，可以直接借鉴 microcompact 的"分层压缩"思路。

## 三、关于"planrla 支持 ZCode"的协议机会

planrla README 已列 ZCode (GLM) 为支持目标。现在 ZCode 协议层开源了：

- packages/shared/src/zcode-protocol（v4）+ zcode-protocol-v4：严格类型的进程间协议
- packages/server 有 entry-stdio / entry-http 双入口：ZCode 可以直接作为子进程或 HTTP 服务被驱动

**建议**：planrla 的 ZCode 适配从"包装 CLI 文本输出"升级为"直连 zcode-protocol"。runtime 事件（turn 状态、工具调用、权限请求、后台任务）都是结构化的，权限审批（planrla 核心卖点）可以精准映射到手机推送，而不是靠解析 TUI 文本猜。

## 四、不建议照搬的部分

- 自研 RPC / 协议全家桶：planrla 用 stdio + WebSocket 已够，再造 RPC 层是负资产
- 40 个 services 的服务化粒度：ZCode 是三形态共享才需要；planrla 当前规模 14 个模块直连即可
- formal-proof / zcode-cua：实验性模块，观望

## 五、行动清单（按优先级）

| # | 动作 | 工作量 | 来源灵感 |
|---|---|---|---|
| 1 | server 模块写 planrla 版 architecture-policy + eslint max-lines 强制 | 1-2 天 | architecture-policy.yaml |
| 2 | ZCode 适配改走 zcode-protocol v4（结构化权限请求→手机推送） | 3-5 天 | packages/shared/zcode-protocol |
| 3 | 输入准入改为 CommandInbox 串行模型（正在跑也能排队输入） | 2-3 天 | AGENTS.md + command-queue |
| 4 | 会话标识引入 workspaceIdentity || workspacePath 二字段 | 0.5 天 | AGENTS.md Workspace Identity |
| 5 | relay/a2a/providers 写 CONTEXT 式词汇表 | 1 天 | CONTEXT.md |
| 6 | 后台任务引入分层压缩思路 | 2 天 | core/src/compact |

## 六、研究方法备注

- 克隆: git clone --depth 1（shallow，仅最新提交）
- 通读: README / AGENTS.md / DESIGN.md / CONTEXT.md / architecture-policy.yaml / 各 package.json
- 深读: core runtime、turn-machine、tool registry、dynamic-workflow 目录结构、subagent runner、server remote、rpc、ui stores
- 未做: 运行时行为验证（未执行 pnpm bootstrap / dev），架构图基于静态阅读
