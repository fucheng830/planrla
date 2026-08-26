import type { LucideIcon } from 'lucide-react';
import { Bot, CalendarClock, Headphones, KanbanSquare, MessagesSquare, Send, Slack, Users, Zap } from 'lucide-react';

export type MessageTone = 'cyan' | 'green' | 'yellow' | 'blue' | 'slate' | 'purple' | 'amber';

export type MessageChannel = {
  id: string;
  label: string;
  count: number;
  icon: LucideIcon;
  tone: MessageTone;
};

export type MessageStage = {
  id: string;
  label: string;
  state: 'complete' | 'running' | 'waiting';
  meta: string;
  ref?: string;
};

export type MessageBinding = {
  task?: string;
  stage?: string;
  priority?: string;
  status?: string;
};

export type MessageSession = {
  id: string;
  sender: string;
  source: string;
  category: string;
  preview: string;
  time: string;
  avatar: LucideIcon;
  tone: MessageTone;
  /** Rail channel id — sessions without one show under every channel. */
  channel?: string;
  unread?: number;
  /** Threads with approval render the AI-collaboration approval card. */
  approval?: boolean;
  /** Full body shown in the thread view (falls back to preview). */
  body?: string;
  statusLabel?: string;
  binding?: MessageBinding;
  stages?: MessageStage[];
};

// Sample data kept as the standalone/design fallback. The live 消息盒子 page
// injects real sessions derived from kanban tasks, running sessions and cron
// runs (see workbench/pages/InboxPage.tsx).
export const messageChannels: MessageChannel[] = [
  { id: 'wecom', label: '企业微信', count: 8, icon: MessagesSquare, tone: 'cyan' },
  { id: 'lark', label: '飞书', count: 5, icon: Send, tone: 'green' },
  { id: 'slack', label: 'Slack', count: 7, icon: Slack, tone: 'yellow' },
  { id: 'dingtalk', label: '钉钉', count: 6, icon: Zap, tone: 'blue' },
  { id: 'support', label: '客服渠道', count: 12, icon: Headphones, tone: 'slate' },
  { id: 'team', label: '团队成员', count: 18, icon: Users, tone: 'slate' },
  { id: 'agents', label: 'AI Agents', count: 9, icon: Bot, tone: 'purple' },
];

export const messageSessions: MessageSession[] = [
  { id: 'codex', sender: 'AI: Codex', source: 'AI Agents', category: 'AI 请求', preview: '请协助分析 Windows 打包失败...', time: '21:49', avatar: Bot, tone: 'purple', channel: 'agents', unread: 1, approval: true },
  { id: 'customer', sender: '客户: 王先生', source: '企业微信', category: '客户消息', preview: '请问最新的 Windows 打包问题...', time: '21:30', avatar: MessagesSquare, tone: 'cyan', channel: 'wecom', unread: 2 },
  { id: 'zhang', sender: '张三', source: 'Slack', category: '团队消息', preview: '已更新技术方案文档，请 review。', time: '20:58', avatar: Slack, tone: 'yellow', channel: 'slack' },
  { id: 'li', sender: '李四', source: '钉钉', category: '团队消息', preview: '测试环境部署完成，日志正常。', time: '20:41', avatar: Zap, tone: 'blue', channel: 'dingtalk' },
  { id: 'support', sender: '在线客服 #1024', source: '客服渠道', category: '客户消息', preview: '如何查看任务的开发进度？', time: '19:22', avatar: Headphones, tone: 'yellow', channel: 'support', unread: 3 },
  { id: 'planner', sender: 'AI: Planner', source: 'AI Agents', category: 'AI 请求', preview: '建议优化需求文档的验收标准。', time: '18:19', avatar: Bot, tone: 'purple', channel: 'agents', unread: 4 },
  { id: 'customer-2', sender: '客户: 张女士', source: '企业微信', category: '客户消息', preview: '给出错下版本太过时间？', time: '17:48', avatar: MessagesSquare, tone: 'cyan', channel: 'wecom' },
];

export const workflowStages: MessageStage[] = [
  { id: 'requirements', label: '需求设计', state: 'complete', meta: '完成 · 05-18 10:32', ref: 'PRD-4' },
  { id: 'architecture', label: '技术方案', state: 'complete', meta: '完成 · 05-18 15:20', ref: '方案-3' },
  { id: 'start', label: '开工', state: 'running', meta: '进行中 · 05-21 21:10', ref: 'Dev Agent' },
  { id: 'verify', label: '测试验证', state: 'waiting', meta: '待开始', ref: '测试-2' },
  { id: 'delivery', label: '交付', state: 'waiting', meta: '待开始', ref: '回顾-1' },
];

// Real-source channel presets shared by the live inbox mapping.
export const liveChannelIcons: Record<string, { icon: LucideIcon; tone: MessageTone }> = {
  kanban: { icon: KanbanSquare, tone: 'purple' },
  sessions: { icon: Bot, tone: 'blue' },
  cron: { icon: CalendarClock, tone: 'green' },
};
