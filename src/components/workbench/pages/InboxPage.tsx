import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot as BotIcon, CalendarClock as ClockIcon, KanbanSquare as KanbanIcon, Users as UsersIcon } from 'lucide-react';
import { toast } from 'sonner';

import type { Project } from '../../../types/app';
import { api } from '../../../utils/api';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import { useKanban } from '../../kanban';
import { kanbanApi } from '../../kanban/api';
import { MessageHubPage, messageSessions  } from '../../message-hub';
import type { MessageSession, MessageStage } from '../../message-hub';
import type { Task, TaskTemplate } from '../../kanban/types';

import { buildInboxThreads, formatRelativeTime, type CronRunInfo, type RunningSessionInfo } from './inboxThreads';

export interface TeamMessageInfo {
  id: string;
  rootId?: string;
  /** 'team' = 同事协作;'customer' = 客户咨询(带联系人/渠道/会话线程)。 */
  kind?: 'team' | 'customer';
  channel?: string | null;
  threadId?: string | null;
  sender: string;
  content: string;
  taskId: string | null;
  createdAt: string;
}

/** Live background-task registry rows (a2a / chat / bash; kanban rows are
 *  already covered by the kanban threads). */
export interface BackgroundTaskInfo {
  id: string;
  type: string;
  title: string;
  status: string;
  lastActivityAt?: string;
  detail?: { type?: string; appSessionId?: string; provider?: string };
}

/** A direct-chat session waiting on a tool approval (server-side registry). */
export interface ChatApprovalInfo {
  requestId: string;
  sessionId: string | null;
  toolName: string;
  question: string;
  options?: string[];
  receivedAt: string;
}

const EVENT_LABELS: Record<string, string> = {
  task_created: '任务创建',
  agent_stage_started: 'Agent 阶段启动',
  stage_approved: '阶段确认',
  task_completed: '任务完成',
  task_cancelled: '任务取消',
  task_failed: '任务失败',
};

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
  backgroundTasks: BackgroundTaskInfo[];
  chatApprovals: ChatApprovalInfo[];
  error: string | null;
} {
  const { subscribe } = useWebSocket();
  const [state, setState] = useState<{
    runningSessions: RunningSessionInfo[];
    cronTasks: CronRunInfo[];
    teamMessages: TeamMessageInfo[];
    backgroundTasks: BackgroundTaskInfo[];
    chatApprovals: ChatApprovalInfo[];
    error: string | null;
  }>({
    runningSessions: [],
    cronTasks: [],
    teamMessages: [],
    backgroundTasks: [],
    chatApprovals: [],
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
      api.get('/background-tasks').then(async (res) => {
        if (!res.ok) return []; // registry is best-effort
        const data = (await res.json()) as { tasks?: BackgroundTaskInfo[] };
        return data.tasks ?? [];
      }),
      api.get('/providers/chat-approvals').then(async (res) => {
        if (!res.ok) return []; // no pending approvals is normal
        const data = (await res.json()) as { approvals?: ChatApprovalInfo[] };
        return data.approvals ?? [];
      }),
    ])
      .then(([runningSessions, cronTasks, teamMessages, backgroundTasks, chatApprovals]) => {
        if (!cancelled) setState({ runningSessions, cronTasks, teamMessages, backgroundTasks, chatApprovals, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ runningSessions: [], cronTasks: [], teamMessages: [], backgroundTasks: [], chatApprovals: [], error: e instanceof Error ? e.message : String(e) });
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
      if (event.type === 'chat-approval-updated') {
        setReloadNonce((n) => n + 1);
      }
    });
  }, [projectId, subscribe]);

  return state;
}

export function InboxPage({ project }: { project: Project }) {
  // 设计还原校准开关已验收(2026-08-26),保留开关便于日后比对。
  const MOCK_MODE = false;
  const { tasks, templates, loading: kanbanLoading, error: kanbanError, refresh } = useKanban();
  const { sendMessage } = useWebSocket();
  const { runningSessions, cronTasks, teamMessages, backgroundTasks, chatApprovals, error: sourcesError } = useInboxSources(project.projectId);
  const handleApprovalAction = useApprovalAction(tasks, refresh, sendMessage, chatApprovals);
  // Team threads send as team kind; customer threads append to their thread.
  const handleSendMessage = useCallback(async (session: MessageSession | undefined, text: string): Promise<boolean> => {
    if (!session) return false;
    if (session.source === '客户消息') {
      const threadId = session.id.replace(/^team-customer-/, '');
      const res = await api.post('/team-messages', { rootId: project.projectId, content: text, kind: 'customer', asMember: true, channel: session.channel ?? null, threadId });
      if (!res.ok) throw new Error(`team-messages failed: ${res.status}`);
      toast.success('已回复客户');
      return true;
    }
    if (session.source !== '团队消息') return false;
    const res = await api.post('/team-messages', { rootId: project.projectId, content: text });
    if (!res.ok) throw new Error(`team-messages failed: ${res.status}`);
    toast.success('已发送到团队');
    return true;
  }, [project.displayName, project.projectId]);

  /** Real agent execution history for the active kanban thread — stage runs
   *  + audit events from the timeline API, rendered as thread body lines. */
  const loadSessionDetail = useCallback(async (session: MessageSession): Promise<{ bodyAppend?: string } | undefined> => {
    const task = findTaskForThread(session.id, tasks);
    if (!task) return undefined;
    const { runs, events } = await kanbanApi.getTaskTimeline(task.id, task.rootId);
    const runLines = runs.slice(-6).map((run) => `· ${run.stageName} — ${run.status}${run.finishedAt ? ` · ${formatRelativeTime(run.finishedAt)}` : ''}`);
    const eventLines = events.slice(-6).map((event) => `· ${EVENT_LABELS[event.type] ?? event.type} · ${formatRelativeTime(event.createdAt)}`);
    return { bodyAppend: ['—— 执行动态 ——', ...runLines, ...eventLines].join('\n') };
  }, [tasks]);

  // Map real inbox threads (kanban tasks, running sessions, cron runs) into
  // the message-hub session model. Kanban threads additionally carry their
  // workflow stages + binding so the thread/inspector panels show live state.
  const sessions = useMemo<MessageSession[]>(() => {
    const threads = buildInboxThreads({ projectName: project.displayName, tasks, runningSessions, cronTasks });
    const mapped = threads.map((thread): MessageSession => {
      const task = findTaskForThread(thread.id, tasks);
      const kind: LiveChannelId = thread.source === '运行会话' ? 'sessions' : thread.source === '定时任务' ? 'cron' : 'kanban';
      const preset = CHANNEL_PRESETS[kind];
      const stageName = task
        ? templates.find((tpl) => tpl.id === task.taskTemplateId)?.stages[task.currentStageIndex]?.snapshot.name
        : undefined;
      const question = task?.auxFlags?.pendingAskUser?.questions?.questions?.[0]?.question;
      // Running-session threads pull the real session title/summary from the
      // project's session list so the preview says what the agent is doing.
      const liveSession = thread.source === '运行会话'
        ? project.sessions?.find((s) => thread.id === `session-running-${s.id}`)
        : undefined;
      // Rich multi-line body for kanban threads — newline-split paragraphs in
      // the thread view, matching the design mock's density.
      const body = task
        ? [
          task.input?.trim() ? `需求:${task.input.trim()}` : null,
          `当前阶段:${stageName ?? task.currentStageIndex + 1} · ${thread.stateLabel}`,
          task.worktreeBranch ? `worktree:${task.worktreeBranch}` : null,
          question ? `待确认问题:${question}` : null,
        ].filter((line): line is string => line !== null).join('\n')
        : (liveSession
          ? [liveSession.title, liveSession.summary].filter((line): line is string => Boolean(line)).join('\n')
          : thread.preview);
      const options = (task?.auxFlags?.pendingAskUser?.questions?.questions?.[0]?.options ?? [])
        .map((option) => option.label)
        .filter((label): label is string => typeof label === 'string');
      return {
        id: thread.id,
        sender: thread.source === '运行会话' && liveSession ? `AI:${thread.sender}` : thread.sender,
        source: thread.source,
        category: thread.state === 'waiting' ? '待处理' : thread.state === 'running' ? 'AI 请求' : '通知',
        preview: thread.preview,
        time: thread.time,
        avatar: preset.icon,
        tone: preset.tone,
        channel: kind,
        unread: thread.unread ? 1 : undefined,
        approval: thread.state === 'waiting',
        body,
        question,
        options: options.length > 0 ? options : undefined,
        statusLabel: thread.stateLabel,
        binding: task
          ? {
            task: `REQ-${String(task.taskNumber).padStart(3, '0')} ${task.input?.trim().slice(0, 30) || task.taskTemplateName || ''}`.trim(),
            stage: stageName,
            priority: priorityLabel(task.priority),
            status: thread.stateLabel,
            worktree: task.worktreeBranch,
            session: task.providerSessionId?.slice(0, 8),
            created: formatRelativeTime(task.createdAt),
          }
          : undefined,
        stages: task ? taskStages(task, templates) : undefined,
      };
    });

    // Customer conversations: group messages by threadId (fallback id),
    // newest thread first. Body renders the dialogue flow.
    const groups = new Map<string, TeamMessageInfo[]>();
      for (const message of teamMessages) {
        if (message.kind !== 'customer') continue;
        const key = message.threadId ?? message.id;
        const bucket = groups.get(key) ?? [];
        bucket.push(message);
        groups.set(key, bucket);
      }
      const customerThreads = [...groups.entries()]
        .map(([threadId, items]) => ({
          threadId,
          items: [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        }))
        .sort((a, b) => b.items[b.items.length - 1].createdAt.localeCompare(a.items[a.items.length - 1].createdAt));

    const customerSessions = customerThreads.map(({ threadId, items }): MessageSession => {
      const last = items[items.length - 1];
      const contact = items.find((m) => m.channel)?.sender ?? items[0].sender;
      const channel = items.find((m) => m.channel)?.channel;
      const dialogue = items
        .slice(-8)
        .map((m) => `${m.sender}:${m.content.length > 40 ? `${m.content.slice(0, 40)}…` : m.content}`)
        .join('\n');
      return {
        id: `team-customer-${threadId}`,
        sender: contact,
        source: '客户消息',
        category: '客户消息',
        preview: `${contact}:${last.content}`.slice(0, 60),
        time: formatRelativeTime(last.createdAt),
        avatar: UsersIcon,
        tone: 'cyan',
        body: dialogue || last.content,
        statusLabel: `沟通中 · ${channel ?? '未标记渠道'}`,
        binding: { status: channel ?? undefined, created: formatRelativeTime(items[0].createdAt) },
      };
    });
    const teamSessions = teamMessages
      .filter((message) => (message.kind ?? 'team') === 'team')
      .map((message): MessageSession => {
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
    // Background-task registry rows (a2a/chat/bash — kanban already covered).
    // Chat rows carry a raw session id as title — resolve the real session
    // title/summary from the project list so threads show actual content.
    const bgSessions = backgroundTasks
      // kanban rows are covered by kanban threads; chat rows duplicate the
      // running-session threads (same session, richer content there).
      .filter((bt) => bt.type !== 'kanban' && bt.type !== 'chat')
      .map((bt): MessageSession => {
        const appSessionId = bt.detail?.appSessionId;
        const liveSession = appSessionId ? project.sessions?.find((s) => s.id === appSessionId) : undefined;
        const content = liveSession?.summary || liveSession?.title || bt.title;
        return {
          id: `bg-${bt.id}`,
          sender: liveSession?.title?.slice(0, 24) || (bt.type === 'a2a' ? 'A2A 任务' : bt.type === 'chat' ? '聊天任务' : '命令任务'),
          source: 'AI 协作',
          category: bt.status === 'running' || bt.status === 'idle' ? 'AI 请求' : '通知',
          preview: content,
          time: formatRelativeTime(bt.lastActivityAt ?? null),
          avatar: bt.type === 'bash' ? ClockIcon : BotIcon,
          tone: 'cyan',
          body: [content, appSessionId ? `会话:${appSessionId.slice(0, 8)}` : null].filter((line): line is string => Boolean(line)).join('\n'),
          statusLabel: bt.status === 'idle' ? '空闲' : bt.status === 'running' ? '运行中' : bt.status,
          binding: appSessionId ? { session: appSessionId.slice(0, 8), status: bt.status } : undefined,
        };
      });
    // Direct-chat tool approvals — 待处理 threads with a real approval card.
    const approvalSessions = chatApprovals.map((approval): MessageSession => ({
      id: `approval-${approval.requestId}`,
      sender: `会话 ${approval.sessionId?.slice(0, 8) ?? '??'}`,
      source: 'AI 协作',
      category: '待处理',
      preview: approval.question,
      time: formatRelativeTime(approval.receivedAt),
      avatar: BotIcon,
      tone: 'yellow',
      unread: 1,
      approval: true,
      body: approval.toolName === 'AskUserQuestion'
        ? `AI 在直接对话中提问,等待你的选择:\n${approval.question}`
        : `AI 请求执行工具「${approval.toolName}」,等待你的批准。`,
      question: approval.question,
      options: approval.options,
      statusLabel: '等待确认',
      binding: { session: approval.sessionId?.slice(0, 8), status: '等待批准' },
    }));
    return [...mapped, ...customerSessions, ...teamSessions, ...bgSessions, ...approvalSessions];
  }, [backgroundTasks, chatApprovals, cronTasks, project.displayName, project.sessions, runningSessions, tasks, teamMessages, templates]);

  const [registerOpen, setRegisterOpen] = useState(false);
  const [contactName, setContactName] = useState('');
  const [customerChannel, setCustomerChannel] = useState('企业微信');
  const [inquiryText, setInquiryText] = useState('');
  const [submittingInquiry, setSubmittingInquiry] = useState(false);

  const submitCustomerInquiry = async () => {
    if (!contactName.trim() || !inquiryText.trim()) {
      toast.error('请填写客户称呼和咨询内容');
      return;
    }
    setSubmittingInquiry(true);
    try {
      const res = await api.post('/team-messages', {
        rootId: project.projectId,
        kind: 'customer',
        sender: contactName.trim(),
        channel: customerChannel,
        content: inquiryText.trim(),
      });
      if (!res.ok) throw new Error(`team-messages failed: ${res.status}`);
      toast.success('客户咨询已登记');
      setContactName('');
      setInquiryText('');
      setRegisterOpen(false);
    } catch (e) {
      toast.error(`登记失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSubmittingInquiry(false);
    }
  };

  return (
    <MessageHubPage
      sessions={MOCK_MODE ? messageSessions : sessions}
      loadingHint={!MOCK_MODE && kanbanLoading ? '正在加载消息数据…' : null}
      errorHint={!MOCK_MODE && sourcesError ? `部分数据源加载失败:${sourcesError}` : !MOCK_MODE && kanbanError ? `看板数据加载失败:${kanbanError}` : null}
      onApprovalAction={MOCK_MODE ? undefined : handleApprovalAction}
      onSendMessage={MOCK_MODE ? undefined : handleSendMessage}
      loadSessionDetail={MOCK_MODE ? undefined : loadSessionDetail}
      inboxAction={MOCK_MODE ? undefined : (
        <button
          type="button"
          onClick={() => setRegisterOpen(true)}
          className="ds-focus-ring inline-flex h-6 items-center rounded-full border border-workbench-border bg-workbench-surface px-2.5 text-[11px] font-medium text-workbench-subtle transition-colors hover:border-workbench-accent/60 hover:text-workbench-ink"
        >
          登记客户咨询
        </button>
      )}
    >
      {registerOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40"
          role="dialog"
          aria-label="登记客户咨询"
          onClick={(event) => {
            if (event.target === event.currentTarget) setRegisterOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-lg border border-workbench-border bg-white p-5 shadow-xl">
            <h3 className="text-sm font-semibold text-workbench-ink">登记客户咨询</h3>
            <p className="mt-1 text-xs text-workbench-subtle">记录外部客户的咨询,沟通往来在客户消息线程中追踪。</p>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-workbench-subtle">客户称呼 *</span>
                <input
                  value={contactName}
                  onChange={(event) => setContactName(event.target.value)}
                  placeholder="例如:王先生"
                  autoFocus
                  className="ds-focus-ring h-8 w-full rounded border border-workbench-border bg-white px-2.5 text-sm text-workbench-ink"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-workbench-subtle">渠道</span>
                <select
                  value={customerChannel}
                  onChange={(event) => setCustomerChannel(event.target.value)}
                  className="ds-focus-ring h-8 w-full rounded border border-workbench-border bg-white px-2 text-sm text-workbench-ink"
                >
                  {['企业微信', '飞书', 'Slack', '钉钉', '电话', '官网', '其他'].map((channelOption) => (
                    <option key={channelOption} value={channelOption}>{channelOption}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-workbench-subtle">咨询内容 *</span>
                <textarea
                  value={inquiryText}
                  onChange={(event) => setInquiryText(event.target.value)}
                  rows={4}
                  placeholder="客户的问题或诉求…"
                  className="ds-focus-ring w-full resize-none rounded border border-workbench-border bg-white p-2.5 text-sm text-workbench-ink"
                />
              </label>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setRegisterOpen(false)} className="ds-focus-ring h-8 rounded border border-workbench-border px-3 text-xs text-workbench-subtle hover:bg-workbench-muted hover:text-workbench-ink">取消</button>
              <button
                type="button"
                disabled={submittingInquiry}
                onClick={() => void submitCustomerInquiry()}
                className="ds-focus-ring h-8 rounded bg-workbench-accent px-4 text-xs font-semibold text-white disabled:opacity-50"
              >
                {submittingInquiry ? '提交中…' : '登记'}
              </button>
            </div>
          </div>
        </div>
      )}
    </MessageHubPage>
  );
}

/** Real approval actions against the kanban engine:
 *  approve → advance the stage (spawns the agent session) or answer a
 *  pending AskUserQuestion; reject → cancel the task; transfer → pause.
 *  Direct-chat tool approvals are answered over the chat WS instead. */
function useApprovalAction(
  tasks: Task[],
  refresh: () => Promise<void>,
  sendMessage: (message: unknown) => void,
  chatApprovals: ChatApprovalInfo[],
) {
  return useCallback(async (session: { id: string }, action: 'approve' | 'reject' | 'transfer') => {
    // Direct-chat tool approval → chat.permission-response over WS.
    if (session.id.startsWith('approval-')) {
      const approval = chatApprovals.find((a) => session.id === `approval-${a.requestId}`);
      if (!approval) throw new Error('该审批已不存在(可能已被处理)');
      if (action === 'transfer') {
        toast.info('聊天审批暂不支持转交,请在会话页处理');
        throw new Error('unsupported');
      }
      sendMessage({
        type: 'chat.permission-response',
        requestId: approval.requestId,
        allow: action === 'approve',
        updatedInput: action === 'approve' && approval.options?.length
          ? { answers: [approval.options[0]] }
          : undefined,
      });
      toast.success(action === 'approve' ? '已批准,会话将继续执行' : '已驳回该工具请求');
      return;
    }

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
  }, [chatApprovals, refresh, sendMessage, tasks]);
}
