# REQ-016 设计草案 — 同主机 @引用 + 整段历史(L1 × C1+C2)

> 父需求:REQ-015 跨对话上下文共享(分阶段 L1→L2→L3 × C1→C4)。本草案是首切片。
> 来源:Archie 与 Claude 的对话产出(2026-07-05),录入 BACKLOG 后由 brainstorming 细化。

## 范围

同主机多 session:session B 用 `@` 引用 session A 的某条消息,或拉取整段历史。**Provider 无关**——本质是文本注入,Claude↔Codex 同样工作,不需要协议转换(协议转换是 L2,本切片不含)。

## UI

- session B 输入框:输入 `@` → 弹出 session 选择器 → 选 session A → 选消息(单条)或「拉整段历史」
- 选中内容作为 **context 预览**(可编辑/可截断)→ 随 B 的下一条消息一起发送

## 数据流

```
B 输入 @ → 前端选 A 的消息 → GET /api/sessions/:A_id/messages
  → 注入 B 的下一轮 prompt(作为 context / system 段)
  → B 的 Provider(Claude/Codex)正常发送
```

## 后端

- 扩展现有 session messages API(取 A 的消息)
- context 注入到 B 的 query(类似附件/引用机制,复用现有 attachment 或 system prompt 注入)

## 限制

- 整段历史可能超 token → UI 显示 token 估算 + 允许用户截断(选前 N 条 / 时间范围)
- **不做**自动同步、**不做**摘要、**不做**持久记忆

## 非目标(明确排除)

- C3 摘要(子项目 2/REQ- TBD)
- C4 记忆(子项目 3/REQ- TBD)
- L2 协议转换(本切片 Provider 无关已含跨 Provider 场景)
- L3 跨设备(子项目 5/REQ- TBD)

---

## 复用探查(2026-07-05 已 grep 确认,供 brainstorming 起点)

| 草案假设 | 探查结果 | 文件 |
|---|---|---|
| `GET /api/sessions/:id/messages` 可能已有 | 命中:session messages 的 API/store/UI 已存在 | `src/utils/api.js`、`src/stores/useSessionStore.ts`、`src/components/chat/view/subcomponents/ChatMessagesPane.tsx` |
| `@` 引用可复用 chat mentions 基建 | 命中:`useFileMentions` hooks 已存在(`@` 触发 → 选择器) | `src/components/chat/hooks/useFileMentions.tsx` |
| context 注入可复用 attachment 机制 | 待 brainstorming 确认(attachment 注入点) | `src/components/chat/view/subcomponents/ImageAttachment.tsx` 等附件链路 |

> brainstorming 阶段需细化的开放问题:
> 1. session 选择器的数据源(同主机 session 列表 API 是否已有?是否按 provider/project 过滤?)
> 2. 注入点:context 走 system prompt 段还是 user message 前缀?跨 Provider(Claude/Codex)的注入口径是否一致?
> 3. 单条消息引用 vs 整段历史:数据结构是否统一(token 估算 / 截断 UI 共用?)
> 4. 跨 Provider 的会话隔离(同主机 Claude session 引用 Codex session 是否允许?Provider 无关是否含此意?)
