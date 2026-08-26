import { useEffect, useMemo, useState } from 'react';
import { Bot as BotIcon, CalendarClock as ClockIcon, KanbanSquare as KanbanIcon } from 'lucide-react';

import type { Project } from '../../../types/app';
import { api } from '../../../utils/api';
import { useKanban } from '../../kanban';
import { MessageHubPage } from '../../message-hub';
import type { MessageSession, MessageStage } from '../../message-hub';
import type { Task, TaskTemplate } from '../../kanban/types';

import { buildInboxThreads, type CronRunInfo, type RunningSessionInfo } from './inboxThreads';

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

/** Fetch running provider sessions + cron prompts once per project. */
function useInboxSources(projectId: string): { runningSessions: RunningSessionInfo[]; cronTasks: CronRunInfo[]; error: string | null } {
  const [state, setState] = useState<{ runningSessions: RunningSessionInfo[]; cronTasks: CronRunInfo[]; error: string | null }>({
    runningSessions: [],
    cronTasks: [],
    error: null,
  });
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
    ])
      .then(([runningSessions, cronTasks]) => {
        if (!cancelled) setState({ runningSessions, cronTasks, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ runningSessions: [], cronTasks: [], error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  return state;
}

export function InboxPage({ project }: { project: Project }) {
  const { tasks, templates, loading: kanbanLoading, error: kanbanError } = useKanban();
  const { runningSessions, cronTasks, error: sourcesError } = useInboxSources(project.projectId);

  // Map real inbox threads (kanban tasks, running sessions, cron runs) into
  // the message-hub session model. Kanban threads additionally carry their
  // workflow stages + binding so the thread/inspector panels show live state.
  const sessions = useMemo<MessageSession[]>(() => {
    const threads = buildInboxThreads({ projectName: project.displayName, tasks, runningSessions, cronTasks });
    return threads.map((thread): MessageSession => {
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
  }, [cronTasks, project.displayName, runningSessions, tasks, templates]);

  return (
    <MessageHubPage
      sessions={sessions}
      loadingHint={kanbanLoading ? '正在加载消息数据…' : null}
      errorHint={sourcesError ? `部分数据源加载失败:${sourcesError}` : kanbanError ? `看板数据加载失败:${kanbanError}` : null}
    />
  );
}
