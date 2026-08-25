// Real inbox threads for the 消息盒子 page. Until the Message Hub backend
// (MessageEnvelope persistence + channel adapters) lands, threads are derived
// from live app state: kanban tasks, running provider sessions, and cron
// prompt runs. No sample data — an empty project shows an empty inbox.

import type { Task } from '../../kanban/types';

import type { InboxThread } from './inboxModel';

export interface RunningSessionInfo {
  sessionId: string;
  provider: string;
  startedAt: number;
}

export interface CronRunInfo {
  id: string;
  name: string;
  provider: string;
  cronExpression: string;
  lastRunAt: string | null;
  runCount: number;
}

/** '刚刚' / 'N 分钟前' / 'N 小时前' / 'N 天前' from a timestamp. */
export function formatRelativeTime(timestamp: number | string | null): string {
  if (timestamp === null) return '—';
  const time = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
  if (!Number.isFinite(time)) return '—';
  const diffMs = Date.now() - time;
  if (diffMs < 60_000) return '刚刚';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

function taskPreview(task: Task): string {
  const question = task.auxFlags?.pendingAskUser?.questions?.questions?.[0]?.question;
  if (question) return question;
  if (task.auxFlags?.sessionError) return task.auxFlags.sessionError;
  const template = task.taskTemplateName ? ` · ${task.taskTemplateName}` : '';
  const labels = task.labels?.length ? ` · ${task.labels.join('/')}` : '';
  return `看板任务${template}${labels} · 阶段 ${task.currentStageIndex + 1}`;
}

export function buildInboxThreads(options: {
  projectName: string;
  tasks: Task[];
  runningSessions: RunningSessionInfo[];
  cronTasks: CronRunInfo[];
}): InboxThread[] {
  const threads: InboxThread[] = [];

  for (const task of options.tasks) {
    if (task.status === 'waiting_user') {
      threads.push({
        id: `kanban-waiting-${task.id}`,
        title: `任务 #${task.taskNumber} 等待确认`,
        sender: 'Planrla Agent',
        source: 'AI 协作 · 看板',
        channel: 'ai',
        preview: taskPreview(task),
        time: formatRelativeTime(task.updatedAt ?? task.createdAt ?? null),
        unread: true,
        starred: true,
        state: 'waiting',
        stateLabel: '等待确认',
      });
    } else if (task.status === 'running' || task.status === 'queued') {
      threads.push({
        id: `kanban-running-${task.id}`,
        title: `任务 #${task.taskNumber} ${task.status === 'queued' ? '排队中' : '执行中'}`,
        sender: 'Planrla Agent',
        source: 'AI 协作 · 看板',
        channel: 'ai',
        preview: taskPreview(task),
        time: formatRelativeTime(task.updatedAt ?? task.createdAt ?? null),
        unread: false,
        starred: false,
        state: 'running',
        stateLabel: task.status === 'queued' ? '排队中' : '执行中',
      });
    } else if (task.status === 'fail') {
      threads.push({
        id: `kanban-fail-${task.id}`,
        title: `任务 #${task.taskNumber} 执行失败`,
        sender: 'Planrla Agent',
        source: 'AI 协作 · 看板',
        channel: 'ai',
        preview: taskPreview(task),
        time: formatRelativeTime(task.updatedAt ?? task.createdAt ?? null),
        unread: true,
        starred: false,
        state: 'complete',
        stateLabel: '失败',
      });
    }
  }

  for (const session of options.runningSessions) {
    threads.push({
      id: `session-running-${session.sessionId}`,
      title: `${session.provider} 会话运行中`,
      sender: session.provider,
      source: '运行会话',
      channel: 'ai',
      preview: `会话 ${session.sessionId.slice(0, 8)}… 正在执行,完成后可回到会话查看结果。`,
      time: formatRelativeTime(session.startedAt),
      unread: false,
      starred: false,
      state: 'running',
      stateLabel: '运行中',
    });
  }

  for (const cron of options.cronTasks) {
    if (!cron.lastRunAt || cron.runCount === 0) continue;
    threads.push({
      id: `cron-run-${cron.id}`,
      title: `定时任务已执行:${cron.name}`,
      sender: '系统',
      source: '定时任务',
      channel: 'system',
      preview: `第 ${cron.runCount} 次触发(${cron.cronExpression}),由 ${cron.provider} 执行。`,
      time: formatRelativeTime(cron.lastRunAt),
      unread: false,
      starred: false,
      state: 'complete',
      stateLabel: '已执行',
    });
  }

  // Waiting threads first, then running, then everything else; newest first.
  const rank = { waiting: 0, running: 1, complete: 2 } as const;
  return threads.sort((a, b) => rank[a.state] - rank[b.state] || a.time.localeCompare(b.time));
}
