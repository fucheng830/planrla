# Message Hub 组件存档(未接线)

来源:`codex/ui-light-implementation` worktree(2026-08-24 的消息协作中枢 React 实现)。

这套组件按「设计 Planrla 消息协作中枢」设计稿组件化,包含完整 UI 形态:

- 多渠道 Inbox(企业微信/飞书/Slack/钉钉/客服渠道/AI Agents)
- 消息线程详情 + AI 协作审批卡(批准/驳回/转交)
- 右侧上下文(项目/任务/会话绑定 + 研发流程五阶段)
- 手机预览面板、明暗主题(Radix Tabs + sonner)

**数据是 mock 的**(messageHubData.ts)。main 上的消息盒子走的是另一条路:
`src/components/workbench/pages/InboxPage.tsx`(真实数据:看板等待任务/运行会话/
cron 执行记录),但没有这套的渠道/审批/上下文形态。

将来做 Message Hub 后端(MessageEnvelope 模型 + 渠道 adapter)时,这套组件可作为
UI 蓝图直接捞出来接线;视觉基准见同目录 `../message-hub-prototype.html`。

依赖:组件用到 `@radix-ui/react-tabs`、`sonner`(main 尚未安装)。
