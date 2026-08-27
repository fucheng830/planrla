import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Bot, CheckCircle2, Clock, MessageSquare, Plus, Users } from 'lucide-react';

import type { Project } from '../../../types/app';
import { api } from '../../../utils/api';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import { useKanban } from '../../kanban';
import { WorkbenchStatus } from '../WorkbenchStatus';

import { FilterChip, MetricCard, PageShell, PageToolbar } from './PageShell';
import type { ChatApprovalInfo } from './InboxPage';
import type { RunningSessionInfo } from './inboxThreads';
import { formatRelativeTime } from './inboxThreads';

const FALLBACK_STAGES = ['需求设计', '技术方案', '开工', '测试验证', '交付'] as const;

type StageStat = { name: string; total: number; done: number; active: number; waiting: number };

function taskTitle(input?: string, name?: string, number?: number): string {
  const text = input?.trim();
  if (text) return text.length > 24 ? `${text.slice(0, 24)}…` : text;
  return name ?? `任务 #${number ?? '?'}`;
}

/** Live side sources for the overview: running chat sessions + pending chat
 *  tool approvals. Kanban state comes from useKanban. */
function useOverviewSources(): { runningSessions: RunningSessionInfo[]; chatApprovals: ChatApprovalInfo[] } {
  const { subscribe } = useWebSocket();
  const [state, setState] = useState<{ runningSessions: RunningSessionInfo[]; chatApprovals: ChatApprovalInfo[] }>({
    runningSessions: [],
    chatApprovals: [],
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get('/providers/sessions/running').then(async (res) => {
        const data = (await res.json()) as { data?: { sessions?: RunningSessionInfo[] }; sessions?: RunningSessionInfo[] };
        return (data as { sessions?: RunningSessionInfo[] }).sessions ?? data.data?.sessions ?? [];
      }).catch(() => []),
      api.get('/providers/chat-approvals').then(async (res) => {
        if (!res.ok) return [];
        const data = (await res.json()) as { approvals?: ChatApprovalInfo[] };
        return data.approvals ?? [];
      }).catch(() => []),
    ]).then(([runningSessions, chatApprovals]) => {
      if (!cancelled) setState({ runningSessions, chatApprovals });
    });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  useEffect(() => subscribe((event) => {
    if (event.type === 'chat-approval-updated' || event.type === 'kanban-task-updated') setNonce((n) => n + 1);
  }), [subscribe]);

  return state;
}

export function OverviewPage({
  project,
  onOpenWorkflow,
  onOpenInbox,
}: {
  project: Project;
  onOpenWorkflow: () => void;
  onOpenInbox: () => void;
}) {
  const { tasks, templates, loading, error } = useKanban();
  const { runningSessions, chatApprovals } = useOverviewSources();

  const stageNames = useMemo(
    () => templates[0]?.stages.map((s) => s.snapshot.name) ?? [...FALLBACK_STAGES],
    [templates],
  );

  const stats = useMemo(() => {
    const live = tasks.filter((t) => t.status !== 'cancelled');
    const running = live.filter((t) => t.status === 'running' || t.status === 'queued');
    const waiting = live.filter((t) => t.status === 'waiting_user');
    const failed = live.filter((t) => t.status === 'fail');
    const done = live.filter((t) => t.status === 'success');
    const progress = live.length > 0 ? Math.round((done.length / live.length) * 100) : 0;
    // AI 处理占比:AI 正在处理/已完成的任务占全部任务的比例。
    const aiShare = live.length > 0 ? Math.round(((running.length + done.length) / live.length) * 100) : 0;

    // Stage flow against the real template stages: a task "reaches" stage i
    // once currentStageIndex >= i (success counts as all stages passed).
    const stageCount = stageNames.length;
    const stageStats: StageStat[] = stageNames.map((name) => ({ name, total: 0, done: 0, active: 0, waiting: 0 }));
    for (const task of live) {
      const reached = task.status === 'success' ? stageCount : task.currentStageIndex;
      for (let i = 0; i < stageCount; i += 1) {
        if (reached < i) break;
        const stat = stageStats[i];
        stat.total += 1;
        if (reached > i || task.status === 'success') stat.done += 1;
        else {
          stat.active += 1;
          if (task.status === 'waiting_user') stat.waiting += 1;
        }
      }
    }
    return { running, waiting, failed, done, progress, aiShare, stageStats };
  }, [stageNames, tasks]);

  const waitingTotal = stats.waiting.length + chatApprovals.length;
  const agentsRunning = stats.running.length + runningSessions.length;
  const hasNothing = !loading && tasks.length === 0 && runningSessions.length === 0 && chatApprovals.length === 0;

  const risks = [
    ...chatApprovals.slice(0, 3).map((approval) => ({
      id: approval.requestId,
      title: approval.question,
      kind: 'waiting' as const,
      detail: `会话 ${approval.sessionId?.slice(0, 8) ?? '??'} 等待批准 · ${formatRelativeTime(approval.receivedAt)}`,
    })),
    ...stats.waiting.slice(0, 3).map((t) => {
      const question = t.auxFlags?.pendingAskUser?.questions?.questions?.[0]?.question;
      return {
        id: t.id,
        title: `REQ-${String(t.taskNumber).padStart(3, '0')} ${taskTitle(t.input, t.taskTemplateName, t.taskNumber)}`,
        kind: 'waiting' as const,
        detail: question ?? '看板任务等待确认后继续推进',
      };
    }),
    ...stats.failed.slice(0, 2).map((t) => ({
      id: t.id,
      title: `REQ-${String(t.taskNumber).padStart(3, '0')} ${taskTitle(t.input, t.taskTemplateName, t.taskNumber)}`,
      kind: 'blocked' as const,
      detail: t.auxFlags?.sessionError ?? '任务执行失败,需要人工介入',
    })),
  ];

  const sessionById = (id: string) => project.sessions?.find((s) => s.id === id);

  return (
    <PageShell>
      <PageToolbar
        title="项目总览"
        description="全部项目的目标、AI 推进状态与交付风险的总览"
        actions={
          <>
            <FilterChip label="进入研发流程" onClick={onOpenWorkflow} />
            <FilterChip label="查看待处理消息" onClick={onOpenInbox} />
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="总体进度" value={`${stats.progress}%`} progress={stats.progress} hint={`${stats.done.length}/${tasks.filter((t) => t.status !== 'cancelled').length} 个交付项完成`} />
        <MetricCard label="AI 处理占比" value={`${stats.aiShare}%`} progress={stats.aiShare} hint={`${agentsRunning} 个智能体运行中`} />
        <MetricCard label="等待人工" value={String(waitingTotal)} hint={waitingTotal > 0 ? 'AI 已暂停,等待你的确认' : '当前没有待确认事项'} />
        <MetricCard label="阻塞/失败" value={String(stats.failed.length)} hint={stats.failed.length > 0 ? '存在需要处理的风险' : '当前无阻塞'} />
      </div>

      {hasNothing && (
        <section className="ds-panel flex flex-col items-center gap-3 p-8 text-center" aria-label="开始引导">
          <span className="flex size-10 items-center justify-center rounded-full bg-workbench-accent/10 text-workbench-accent"><Plus className="size-5" aria-hidden="true" /></span>
          <div>
            <h2 className="text-sm font-semibold text-workbench-ink">还没有研发任务</h2>
            <p className="mt-1 text-sm text-workbench-subtle">在研发流程页创建第一个任务,AI 会按 需求设计 → 交付 五个阶段推进,所有动态实时回流到这里。</p>
          </div>
          <FilterChip label="创建第一个任务" onClick={onOpenWorkflow} />
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <section className="ds-panel p-4" aria-label="研发流程">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-workbench-ink">研发流程推进</h2>
            <button type="button" onClick={onOpenWorkflow} className="ds-focus-ring inline-flex items-center gap-1 text-xs font-medium text-workbench-accent hover:underline">
              查看看板 <ArrowRight className="size-3" aria-hidden="true" />
            </button>
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(stageNames.length, 5)}, minmax(0, 1fr))` }}>
            {stats.stageStats.map((stage, index) => {
              const isCurrent = stage.active > 0;
              const percent = stage.total > 0 ? Math.round((stage.done / stage.total) * 100) : 0;
              return (
                <div
                  key={`${stage.name}-${index}`}
                  className={`rounded-md border p-3 ${isCurrent ? 'border-workbench-accent/50 bg-workbench-accent/5' : 'border-workbench-border bg-workbench-surface'}`}
                >
                  <p className="truncate text-xs font-medium text-workbench-subtle">{stage.name}</p>
                  <p className="mt-1.5 text-lg font-semibold text-workbench-ink">{stage.done}/{stage.total}</p>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-workbench-muted">
                    <div className="h-full rounded-full bg-workbench-accent" style={{ width: `${percent}%` }} />
                  </div>
                  {stage.waiting > 0 && <p className="mt-1.5 text-[10px] text-workbench-waiting">{stage.waiting} 项等待确认</p>}
                </div>
              );
            })}
          </div>
        </section>

        <section className="ds-panel p-4" aria-label="风险与待处理">
          <h2 className="mb-3 text-sm font-semibold text-workbench-ink">风险与待处理</h2>
          {risks.length === 0 ? (
            <div className="flex items-center gap-2 rounded-md border border-workbench-border bg-workbench-muted/50 p-3 text-sm text-workbench-subtle">
              <CheckCircle2 className="size-4 text-workbench-success" aria-hidden="true" /> 当前没有阻塞项
            </div>
          ) : (
            <ul className="space-y-2">
              {risks.map((risk) => (
                <li key={`${risk.kind}-${risk.id}`}>
                  <button
                    type="button"
                    onClick={risk.kind === 'waiting' ? onOpenInbox : onOpenWorkflow}
                    className="ds-focus-ring flex w-full items-start gap-2 rounded-md border border-workbench-border bg-workbench-surface p-3 text-left transition-colors hover:bg-workbench-muted"
                  >
                    {risk.kind === 'waiting' ? (
                      <Clock className="mt-0.5 size-4 flex-shrink-0 text-workbench-waiting" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="mt-0.5 size-4 flex-shrink-0 text-workbench-danger" aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-workbench-ink">{risk.title}</span>
                      <span className="mt-0.5 block text-xs text-workbench-subtle">{risk.detail}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="ds-panel p-4" aria-label="运行中的智能体">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-workbench-ink">
            <Bot className="size-4" aria-hidden="true" /> 运行中的智能体
          </h2>
          <span className="flex items-center gap-1.5 text-xs text-workbench-subtle">
            <Users className="size-3.5" aria-hidden="true" /> 协作者与 AI 共同推进
          </span>
        </div>
        {loading ? (
          <p className="py-6 text-center text-sm text-workbench-subtle">正在加载任务数据…</p>
        ) : error ? (
          <p className="py-6 text-center text-sm text-workbench-danger">加载失败:{error}</p>
        ) : agentsRunning === 0 ? (
          <p className="py-6 text-center text-sm text-workbench-subtle">当前没有运行中的智能体任务</p>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {stats.running.slice(0, 6).map((task) => (
              <li key={task.id} className="rounded-md border border-workbench-border bg-workbench-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium text-workbench-ink">REQ-{String(task.taskNumber).padStart(3, '0')} {taskTitle(task.input, task.taskTemplateName, task.taskNumber)}</span>
                  <WorkbenchStatus state="running" label={task.status === 'queued' ? '排队中' : '运行中'} />
                </div>
                <p className="mt-1.5 truncate text-xs text-workbench-subtle">
                  {templates.find((tpl) => tpl.id === task.taskTemplateId)?.stages[task.currentStageIndex]?.snapshot.name ?? `阶段 ${task.currentStageIndex + 1}`} · 更新 {formatRelativeTime(task.updatedAt)}
                </p>
              </li>
            ))}
            {runningSessions.slice(0, 6).map((session) => {
              const live = sessionById(session.sessionId);
              return (
                <li key={session.sessionId} className="rounded-md border border-workbench-border bg-workbench-surface p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium text-workbench-ink">AI:{session.provider}</span>
                    <WorkbenchStatus state="running" label="会话运行中" />
                  </div>
                  <p className="mt-1.5 truncate text-xs text-workbench-subtle">
                    {live?.title || live?.summary || `会话 ${session.sessionId.slice(0, 8)}…`} · {formatRelativeTime(session.startedAt)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {chatApprovals.length > 0 && (
        <section className="ds-panel flex flex-wrap items-center justify-between gap-3 p-4" aria-label="待批准提醒">
          <p className="flex items-center gap-2 text-sm text-workbench-ink">
            <MessageSquare className="size-4 text-workbench-waiting" aria-hidden="true" />
            {chatApprovals.length} 条 AI 决策请求等待你的批准
          </p>
          <FilterChip label="去消息盒子处理" onClick={onOpenInbox} />
        </section>
      )}
    </PageShell>
  );
}
