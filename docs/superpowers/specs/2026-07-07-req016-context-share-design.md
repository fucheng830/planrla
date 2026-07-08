---
REQ-ID: REQ-016
title: 跨会话 @引用 + 整段历史(L1 × C1+C2)
date: 2026-07-07
status: spec
owner: Archie
---

# REQ-016:跨会话 @引用 + 整段历史(L1 × C1+C2)

## 背景

父需求 REQ-015(跨对话上下文共享,分阶段 L1 同主机 → L2 协议转换 → L3 跨设备 × C1 @单条 → C2 整段历史 → C3 摘要 → C4 持久记忆)。本切片 = **L1 × C1+C2**。

痛点:同主机多 session 间无法引用彼此内容。例如 session B(Claude)想基于 session A(Codex)的讨论继续,目前只能手动复制粘贴。

**Provider 无关**:本质是文本注入,Claude↔Codex 同样工作,不需要协议转换(L2 才做)。

## 复用探查(2026-07-07 已确认)

| 假设 | 探查结果 | 文件 |
|---|---|---|
| session 列表数据源已有 | 命中:sidebar 的 sessions 数据(useSidebarController / projects) | `src/components/sidebar/hooks/useSidebarController.ts` |
| `GET /api/sessions/:id/messages` 已有 | 命中:session messages 的 API/store/UI 已存在 | `src/utils/api.js`、`src/stores/useSessionStore.ts` |
| `useFileMentions`(@→picker)可复用 | **不复用** —— 现有 `@` 是文件 mention,本需求改用按钮触发(避冲突,见 §1) | `src/components/chat/hooks/useFileMentions.tsx` |
| send 路径注入点 | 命中:`useChatComposerState.handleSubmit` → `sendMessage({type:'chat.send', content, options})`,`content` = 用户文本 | `src/components/chat/hooks/useChatComposerState.ts:532-735` |
| 现有 file mention 注入机制 | 澄清:file mention **纯文本**(路径插输入框,LLM 看到路径自己读),非 server 注入 —— 本需求走"客户端拼接 content"对齐这个模式 | 同上 |

## 设计

### §1 触发与入口

- 输入框前缀区加**链式/引用图标按钮**(挨着现有图片附件 paperclip)→ 点击弹 session picker
- 键盘快捷键:**`Ctrl+L`**(Win)/ **`Cmd+L`**(Mac)—— 与现有 `Tab`(切权限模式)、`/`(slash command)、`@`(文件 mention)不冲突
- 不复用 `@`(避免改现有 file mention 行为,零回归)

### §2 session picker(范围 = brainstorm Q1=C)

- 默认列**当前 project 的所有 session**(跨 provider),按 lastActivity 倒序
- 顶部 search 框:输入关键词 → 切到**全部同主机 session**(跨 project,跨 provider)
- 每行:session 标题 + provider 标签 + 相对时间 + messageCount
- 键盘导航(↑↓ + Enter,Esc 关),与现有 file dropdown 一致

### §3 选择流程

1. 点按钮/快捷键 → session picker
2. 选 session A → 弹**模式选择**:「单条消息」/「整段历史」
3. 单条 → A 的消息列表(role + 文本 snippet + 时间,可滚,点选一条)
4. 整段 → 直接进引用 chip
5. 选中后 chip 挂在输入框上方

### §4 引用 chip(预览/编辑/截断/多叠)

- chip 显示:`📎 引自「<session 标题>」· <单条|整段> · <Xk tok> · ×(删除)`
- 点 chip 展开**编辑面板**:
  - textarea(可直接编辑引用内容文本)
  - role 标注(user/assistant)
  - token 估算实时显示
- **截断**(整段历史模式):「前 N 条」选择器 + 手动编辑;单条消息无需截断
- **多引用**:可叠多个 chip 并排(无硬上限,总 token 超阈值给软警告)
- 删除:每个 chip 自带 ×;编辑面板内也可清空

### §5 注入(client-side prepend,brainstorm Q2=A)

发送时(`handleSubmit`),客户端把每个引用格式化为文本块,**prepend 到 `content`**:

```
[引自会话「Codex 重构讨论」(codex, 2026-07-05)]

[user] 怎么拆 auth?
[assistant] 用 middleware...
[user] 测试呢?

---

那这套怎么套到现有路由?   ← 用户实际打的问题
```

- 格式规则:每个引用块 = `[引自会话「<标题>」(<provider>, <日期>)]` 头 + role 标注的消息行 + 空行;多引用按顺序拼;最后用 `---` 分隔引用区与用户问题
- **LLM 收到** = 引用块 + 用户问题(纯文本 user turn,跨 Provider 一致)
- **聊天记录显示**:用户消息组件渲染**折叠引用块**(点开看全文)+ 下方用户问题文本
- **零 server 改动**:现有 `chat.send` 的 `content` 字段承载拼接后的全文

### §6 token 预算(软约束,YAGNI)

- chip 实时显示 token 估算(**首切片用粗估:总字符数 / 4**,YAGNI,不引入 tiktoken 依赖;后续需要精确再换)
- **>4k tokens 软警告**(chip 转 amber + 提示"引用较大,考虑截断")
- **无硬上限**:用户自负,超 provider 限制由 provider 端报错(provider 错误已有 UI 展示)
- 截断靠 §4 的「前 N 条」+ 手动编辑

### §7 数据 / API(零 server 改动)

- session 列表:复用 sidebar 已有数据(`useSidebarController` 暴露的 sessions / projects)
- session A 消息:`GET /api/sessions/:A_id/messages`(已存在,客户端 fetch)
- 全程客户端解析 + 拼接,server 只看到更长的 `content`

## 验收标准

1. **触发**:输入框旁有「引用会话」按钮 + `Ctrl/Cmd+L` 快捷键,均能弹 session picker。
2. **picker 范围**:默认当前 project 的所有 session(跨 provider);search 切全部同主机。
3. **两种模式**:单条消息(消息列表选一条)、整段历史,均能生成引用 chip。
4. **chip 操作**:可编辑、可截断(整段的「前 N 条」)、可删除、可叠多个。
5. **注入正确**:发送后,LLM 收到的 user turn 含引用块 + 用户问题(纯文本);聊天记录显示折叠引用块 + 问题。
6. **跨 Provider**:Claude session 引用 Codex session 内容正常(纯文本,无协议转换)。
7. **token 显示**:chip 显示估算;>4k 软警告。
8. **零 server 改动**:`chat.send` payload 结构不变(仅 `content` 文本变长);无新 API。
9. **预检三件套过**:typecheck + build + git diff --check。
10. **回归**:现有 file mention(`@`)、slash command(`/`)、图片附件、权限 `Tab` 切换 —— 不受影响。

## 非目标(明确排除,留后续阶段)

- ❌ **C3 摘要**(引用内容自动摘要)→ 后续
- ❌ **C4 持久记忆**(跨 session 记忆)→ 后续
- ❌ **L2 协议转换**(本切片纯文本已含跨 Provider 场景,L2 才做消息格式协议转换)→ 后续
- ❌ **L3 跨设备**(需 relay/同步层)→ 后续
- ❌ **自动同步**(A 变化不自动更新 B 的引用)
- ❌ **服务端注入 / `references` 字段**(留到 L2,需要 server 注入点时再做)
- ❌ **`@` 触发**(避文件 mention 冲突,本切片用按钮 + 快捷键)

## 影响文件(预估)

| 文件 | 动作 |
|---|---|
| `src/components/chat/hooks/useChatComposerState.ts` | 改:加 session-reference 状态 + 注入逻辑(prepend 到 content);handleSubmit 接入 |
| `src/components/chat/hooks/useSessionReferences.ts`(新) | 新:管理引用 chip 状态(add/edit/trim/remove)+ token 估算 |
| `src/components/chat/view/subcomponents/SessionReferencePicker.tsx`(新) | 新:session picker + 模式选择 + 消息选择器 |
| `src/components/chat/view/subcomponents/SessionReferenceChip.tsx`(新) | 新:chip + 编辑面板 |
| `src/components/chat/view/subcomponents/ChatInput*.tsx`(找具体输入框组件) | 改:输入框前缀区加「引用会话」按钮 |
| `src/components/chat/view/subcomponents/ChatMessagesPane.tsx`(或用户消息渲染处) | 改:渲染折叠引用块 |

(精确文件路径在 writing-plans 阶段核对。)
