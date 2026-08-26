import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot as BotIcon, CalendarClock as ClockIcon, KanbanSquare as KanbanIcon, Users as UsersIcon } from 'lucide-react';
import { toast } from 'sonner';

import type { Project } from '../../../types/app';
import { api } from '../../../utils/api';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import { useKanban } from '../../kanban';
import { kanbanApi } from '../../kanban/api';
import { MessageHubPage } from '../../message-hub';
import type { MessageSession, MessageStage } from '../../message-hub';
import type { Task, TaskTemplate } from '../../kanban/types';

import { buildInboxThreads, formatRelativeTime, type CronRunInfo, type RunningSessionInfo } from './inboxThreads';

export interface TeamMessageInfo {
  id: string;
  sender: string;
  content: string;
  taskId: string | null;
  createdAt: string;
}

const priorityLabel = (priority?: string): string => (priority === 'high' ? '高' : priority === 'low' ? '低' : '中');

const CHANNEL_PRESETS = {
  kanban: { icon: KanbanIcon, tone: 'purple' as const },
  sessions: { icon: BotIcon, tone: 'blue' as const },
  cron: { icon: ClockIcon, tone: 'green' as const },
};
type LiveChannelId = keyof typeof CHANNEL_PRESETS;

function findTaskForThread(threadId: string, tasks: Task[]): Task | undefined {
  const taskId = /^kanban-(?:waiting|running|fail)-(.+)$/.exec(threadId)?.[1];
  return taskId ? tasks.find((task) => task.id === taskId) : undefined;
}

function taskStages(task: Task, templates: TaskTemplate[]): MessageStage[] {
  const names = templates.find((t) => t.id === task.taskTemplateId)?.stages.map((s) => s.snapshot.name) ?? [];
  return names.map((label, index) => ({
    id: `${task.id}-stage-${index}`,
    label,
    state: index < task.currentStageIndex ? 'complete' : index === task.currentStageIndex ? 'running' : 'waiting',
    meta: index < task.currentStageIndex ? '已完成' : index === task.currentStageIndex ? (task.status === 'waiting_user' ? '等待确认' : '进行中') : '待开始',
  }));
}

/** Fetch running provider sessions + cron prompts + team messages, and
 *  refetch when a team message lands over the WebSocket. */
function useInboxSources(projectId: string): {
  runningSessions: RunningSessionInfo[];
  cronTasks: CronRunInfo[];
  teamMessages: TeamMessageInfo[];
  error: string | null;
} {
  const { subscribe } = useWebSocket();
  const [state, setState] = useState<{ runningSessions: RunningSessionInfo[]; cronTasks: CronRunInfo[]; teamMessages: TeamMessageInfo[]; error: string | null }>({
    runningSessions: [],
    cronTasks: [],
    teamMessages: [],
    error: null,
  });
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get('/providers/sessions/running').then(async (res) => {
        if (!res.ok) throw new Error(`running sessions failed: ${res.status}`);
        const data = (await res.json()) as { sessions?: RunningSessionInfo[] };
        return data.sessions ?? [];
      }),
      api.get('/cron-prompts').then(async (res) => {
        if (!res.ok) throw new Error(`cron-prompts failed: ${res.status}`);
        const data = (await res.json()) as { data?: CronRunInfo[] };
        return data.data ?? [];
      }),
      api.get(`/team-messages?rootId=${encodeURIComponent(projectId)}`).then(async (res) => {
        if (!res.ok) throw new Error(`team-messages failed: ${res.status}`);
        const data = (await res.json()) as { messages?: TeamMessageInfo[] };
        return data.messages ?? [];
      }),
    ])
      .then(([runningSessions, cronTasks, teamMessages]) => {
        if (!cancelled) setState({ runningSessions, cronTasks, teamMessages, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ runningSessions: [], cronTasks: [], teamMessages: [], error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadNonce]);

  useEffect(() => {
    return subscribe((event) => {
      if (event.type === 'team-message-created' && (event as { rootId?: string }).rootId === projectId) {
        setReloadNonce((n) => n + 1);
      }
    });
  }, [projectId, subscribe]);

  return state;
}

export function InboxPage({ project }: { project: Project }) {
  const { tasks, templates, loading: kanbanLoading, error: kanbanError, refresh } = useKanban();
  const { runningSessions, cronTasks, teamMessages, error: sourcesError } = useInboxSources(project.projectId);
  const handleApprovalAction = useApprovalAction(tasks, refresh);

  // Team threads send for real (persisted + WS-broadcast); other threads keep
  // the local echo. The WS event refreshes the feed.
  const handleSendMessage = useCallback(async (session: MessageSession | undefined, text: string): Promise<boolean> => {
    if (session && session.source !== '团队消息') return false;
    const res = await api.post('/team-messages', { rootId: project.projectId, content: text });
    if (!res.ok) throw new Error(`team-messages failed: ${res.status}`);
    toast.success('已发送到团队');
    return true;
  }, [project.projectId]);

  // Map real inbox threads (kanban tasks, running sessions, cron runs) into
  // the message-hub session model. Kanban threads additionally carry their
  // workflow stages + binding so the thread/inspector panels show live state.
  const sessions = useMemo<MessageSession[]>(() => {
    const threads = buildInboxThreads({ projectName: project.displayName, tasks, runningSessions, cronTasks });
    const mapped = threads.map((thread): MessageSession => {
      const task = findTaskForThread(thread.id, tasks);
      const kind: LiveChannelId = thread.source === '运行会话' ? 'sessions' : thread.source === '定时任务' ? 'cron' : 'kanban';
      const preset = CHANNEL_PRESETS[kind];
      return {
        id: thread.id,
        sender: thread.sender,
        source: thread.source,
        category: thread.state === 'waiting' ? '待处理' : thread.state === 'running' ? 'AI 请求' : '通知',
        preview: thread.preview,
        time: thread.time,
        avatar: preset.icon,
        tone: preset.tone,
        channel: kind,
        unread: thread.unread ? 1 : undefined,
        approval: thread.state === 'waiting',
        body: thread.preview,
        statusLabel: thread.stateLabel,
        binding: task
          ? {
            task: `REQ-${String(task.taskNumber).padStart(3, '0')} ${task.input?.trim().slice(0, 30) || task.taskTemplateName || ''}`.trim(),
            stage: templates.find((tpl) => tpl.id === task.taskTemplateId)?.stages[task.currentStageIndex]?.snapshot.name,
            priority: priorityLabel(task.priority),
            status: thread.stateLabel,
          }
          : undefined,
        stages: task ? taskStages(task, templates) : undefined,
      };
    });

    // Team messages render as their own threads (团队消息 category).
    const teamSessions = teamMessages.map((message): MessageSession => {
      const task = message.taskId ? tasks.find((t) => t.id === message.taskId) : undefined;
      return {
        id: `team-${message.id}`,
        sender: message.sender,
        source: '团队消息',
        category: '团队消息',
        preview: message.content,
        time: formatRelativeTime(message.createdAt),
        avatar: UsersIcon,
        tone: 'blue',
        body: message.content,
        binding: task
          ? { task: `REQ-${String(task.taskNumber).padStart(3, '0')}`, status: task.status }
          : undefined,
      };
    });
    return [...mapped, ...teamSessions];
  }, [cronTasks, project.displayName, runningSessions, tasks, teamMessages, templates]);

  return (
    <MessageHubPage
      sessions={sessions}
      loadingHint={kanbanLoading ? '正在加载消息数据…' : null}
      errorHint={sourcesError ? `部分数据源加载失败:${sourcesError}` : kanbanError ? `看板数据加载失败:${kanbanError}` : null}
      onApprovalAction={handleApprovalAction}
      onSendMessage={handleSendMessage}
    />
  );
}

/** Real approval actions against the kanban engine:
 *  approve → advance the stage (spawns the agent session) or answer a
 *  pending AskUserQuestion; reject → cancel the task; transfer → pause. */
function useApprovalAction(tasks: Task[], refresh: () => Promise<void>) {
  return useCallback(async (session: { id: string }, action: 'approve' | 'reject' | 'transfer') => {
    const task = findTaskForThread(session.id, tasks);
    if (!task) throw new Error('此消息未绑定看板任务');
    try {
      if (action === 'approve') {
        const pending = task.auxFlags?.pendingAskUser;
        if (pending?.questions?.questions?.[0]) {
          const first = pending.questions.questions[0].options?.[0]?.label;
          await kanbanApi.answerTask(task.id, task.rootId, { answers: first ? [first] : [] });
          toast.success(`已答复:${first ?? '默认选项'}`);
        } else {
          await kanbanApi.move(task.id, task.rootId, 'next');
          toast.success('已批准:任务推进到下一阶段,AI Agent 即将启动');
        }
      } else if (action === 'reject') {
        await kanbanApi.move(task.id, task.rootId, 'cancel');
        toast.success('已驳回:任务已取消');
      } else {
        await kanbanApi.move(task.id, task.rootId, 'pause');
        toast.success('已转交:任务已暂停等待处理');
      }
    } finally {
      await refresh();
    }
  }, [refresh, tasks]);
}
