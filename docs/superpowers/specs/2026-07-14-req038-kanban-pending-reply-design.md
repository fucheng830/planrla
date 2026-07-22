---
REQ-ID: REQ-038
标题: 看板"待答复"inline 介入(agent AskUserQuestion 看板内答题)
日期: 2026-07-14
状态: spec(设计已批准,转入 writing-plans)
类型: feat
---

# REQ-038 看板"待答复"inline 介入

## 1. 背景

看板 agent 自驱时,agent 可能调 `AskUserQuestion`(或 `ExitPlanMode`)需要用户输入。`aux-bridge.ts` 捕获 `permission_request(AskUserQuestion)` 设 `task.auxFlags.askUserWaiting=true`,卡片亮紫徽章。**但**:① `TaskDetailModal` 无答题入口(只有移动按钮);② `askUserWaiting` 只 set 不 clear(答完不灭);③ 用户无处下手——只能自己去会话列表找 agent 会话。

## 2. 设计(方案 B,已批准 — 见 mockup)

> Mockup:`.tmp/kanban_pending_reply_mockup.html`(交互式,Archie 已批准)

**核心**:把 AskUserQuestion 的问题内容存到任务上 → `TaskDetailModal` 顶部 render 答题面板(复用 `AskUserQuestionPanel` 样式)→ 提交走 server 端 `resolveToolApproval` → 清 flag。**全程不离开看板。**

## 3. 数据流

```
① 捕获:aux-bridge 收到 permission_request(AskUserQuestion)
   msg = { kind:'permission_request', toolName:'AskUserQuestion', requestId, input:{questions:[...]} }
   改:不只 set 布尔,把 requestId + input 存进任务
   → task.pendingAskUser = { requestId, questions: input.questions }

② 持久:kanban store 加列 pending_ask_user(JSON)+ types 加字段
   API GET / 随 task 返回 pendingAskUser

③ 渲染:TaskDetailModal 检测 task.pendingAskUser
   → 顶部 render 答题区(问题 + 选项 + 选中态,复用 AskUserQuestionPanel 交互)
   待答复时答题区为主操作,移动按钮降为次要

④ 提交:看板前端 POST /api/.../tasks/:taskId/answer { answers }
   → kanban route 调 resolveToolApproval(requestId, { allow:true, updatedInput: answers })
   (resolveToolApproval 在 claude-sdk.js,server 内存里的 pendingToolApprovals map)
   → agent 收到答案、继续执行

⑤ 清除:
   - 提交后:updateAuxFlags({ askUserWaiting:false, pendingAskUser:null })
   - 兜底:阶段推进 / 任务取消 / 超时 → 同样清(避免幽灵"待答复")
```

## 4. 影响面 / 文件

| 文件 | 改动 |
|---|---|
| `server/modules/kanban/aux-bridge.ts` | ① 捕获 requestId + input.questions;不只 set 布尔 |
| `server/modules/kanban/types.ts` | `Task.pendingAskUser?: { requestId: string; questions: unknown[] }` |
| `server/modules/kanban/store.ts` | 加 `pending_ask_user` 列(JSON)+ read/write/clear |
| `server/modules/kanban/service.ts` | 清除兜底(advance/cancel 时 reset pendingAskUser) |
| `server/modules/kanban/kanban.routes.ts` | 新端点 `POST /:taskId/answer` → resolveToolApproval |
| `src/components/kanban/TaskDetailModal.tsx` | ③ 检测 pendingAskUser → 顶部 render 答题区;④ submit 调 answer API |
| `src/components/kanban/TaskCard.tsx` | 待答复卡 CTA 增强("💬 agent 在等你定 → 点击处理") |
| `src/components/kanban/api.ts` | 加 `answerTask(taskId, answers)` 调新端点 |
| **不改** | AskUserQuestionPanel(复用其渲染/交互逻辑)、runner、scheduler、chat WS 协议 |

## 5. 验收标准

1. agent 阶段调 AskUserQuestion → 卡片亮"待答复"+ 显示"💬 点击处理"CTA。
2. 点开卡片 → TaskDetailModal 顶部显示**问题 + 选项**(从 pendingAskUser 渲染)。
3. 选择 + 提交 → agent 收到答案、继续执行(toast 确认)。
4. 提交后紫徽章灭、答题区收起。
5. 阶段推进/取消/超时 → pendingAskUser 清除,无幽灵"待答复"。
6. `npm run test:kanban` 全过 + 新增 answer 端点单测。
7. `npm run typecheck && npm run build` 干净。

## 6. 风险

| 风险 | 对策 |
|---|---|
| resolveToolApproval 在 claude-sdk.js 内存里(pendingToolApprovals),kanban route 要拿到它 | DI 注入(参考 runner.ts 的 spawnFns DI 模式),或从 claude-sdk 导出 resolveToolApproval |
| AskUserQuestion 的 input.questions shape 与 AskUserQuestionPanel 期望不完全一致 | spec 阶段核实 shape(已从 claude-sdk 确认 input 是 tool input);plan 阶段在 TaskDetailModal 里加防御性渲染 |
| 非 Claude provider(codex/gemini)不发 permission_request | 本次只覆盖 Claude(plan 注明);非 Claude 的待答复暂走 fallback(A 跳会话,后续) |
