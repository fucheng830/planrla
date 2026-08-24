import { useMemo } from 'react';
import { AlertTriangle, ArrowRight, Bot, CheckCircle2, Clock, Users } from 'lucide-react';

import type { Project } from '../../../types/app';
import { useKanban } from '../../kanban';
import { WorkbenchStatus } from '../WorkbenchStatus';

import { FilterChip, MetricCard, PageShell, PageToolbar } from './PageShell';

const DELIVERY_STAGES = ['需求设计', '技术方案', '开工', '测试验证', '交付'] as const;

type StageStat = {
  name: string;
  total: number;
  done: number;
  waiting: number;
};

function mapTaskToStage(taskCurrentStage: number, stageCount: number): number {
  if (stageCount <= 0) return 0;
  const ratio = taskCurrentStage / Math.max(1, stageCount - 1);
  return Math.min(DELIVERY_STAGES.length - 1, Math.floor(ratio * DELIVERY_STAGES.length));
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

  const stats = useMemo(() => {
    const running = tasks.filter((t) => t.status === 'running' || t.status === 'queued');
    const waiting = tasks.filter((t) => t.status === 'waiting_user');
    const failed = tasks.filter((t) => t.status === 'fail');
    const done = tasks.filter((t) => t.status === 'success');
    const progress = tasks.length > 0 ? Math.round((done.length / tasks.length) * 100) : 0;
    const aiShare = tasks.length > 0 ? Math.round(((running.length + done.length) / tasks.length) * 100) : 0;

    const primaryTemplate = templates[0];
    const stageCount = primaryTemplate?.stages.length ?? 0;
    const stageStats: StageStat[] = DELIVERY_STAGES.map((name) => ({ name, total: 0, done: 0, waiting: 0 }));
    for (const task of tasks) {
      const stageIndex = mapTaskToStage(task.currentStageIndex, stageCount);
      const stat = stageStats[stageIndex];
      stat.total += 1;
      if (task.status === 'success') stat.done += 1;
      if (task.status === 'waiting_user') stat.waiting += 1;
    }

    return { running, waiting, failed, done, progress, aiShare, stageStats };
  }, [tasks, templates]);

  const risks = [
    ...stats.waiting.slice(0, 3).map((t) => ({
      id: t.id,
      title: t.taskTemplateName ?? `Task #${t.taskNumber}`,
      kind: 'waiting' as const,
      detail: '等待人工确认后继续推进',
      updatedAt: t.updatedAt,
    })),
    ...stats.failed.slice(0, 2).map((t) => ({
      id: t.id,
      title: t.taskTemplateName ?? `Task #${t.taskNumber}`,
      kind: 'blocked' as const,
      detail: '任务失败，需要人工介入',
      updatedAt: t.updatedAt,
    })),
  ];

  return (
    <PageShell>
      <PageToolbar
        title={project.displayName}
        description="项目目标、AI 推进状态与交付风险的总览"
        actions={
          <>
            <FilterChip label="进入研发流程" onClick={onOpenWorkflow} />
            <FilterChip label="查看待处理消息" onClick={onOpenInbox} />
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="总体进度" value={`${stats.progress}%`} progress={stats.progress} hint={`${stats.done.length}/${tasks.length} 个交付项完成`} />
        <MetricCard label="AI 处理占比" value={`${stats.aiShare}%`} progress={stats.aiShare} hint={`${stats.running.length} 个智能体运行中`} />
        <MetricCard label="等待人工" value={String(stats.waiting.length)} hint="AI 已暂停，等待你的确认" />
        <MetricCard label="阻塞/失败" value={String(stats.failed.length)} hint={stats.failed.length > 0 ? '存在需要处理的风险' : '当前无阻塞'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <section className="ds-panel p-4" aria-label="研发流程">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-workbench-ink">研发流程推进</h2>
            <button type="button" onClick={onOpenWorkflow} className="ds-focus-ring inline-flex items-center gap-1 text-xs font-medium text-workbench-accent hover:underline">
              查看看板 <ArrowRight className="size-3" aria-hidden="true" />
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-5">
            {stats.stageStats.map((stage, index) => {
              const isCurrent = stats.running.length > 0 && index === stats.stageStats.findIndex((s) => s.total > 0 && s.done < s.total);
              const percent = stage.total > 0 ? Math.round((stage.done / stage.total) * 100) : 0;
              return (
                <div
                  key={stage.name}
                  className={`rounded-md border p-3 ${isCurrent ? 'border-workbench-accent/50 bg-workbench-accent/5' : 'border-workbench-border bg-workbench-surface'}`}
                >
                  <p className="text-xs font-medium text-workbench-subtle">{stage.name}</p>
                  <p className="mt-1.5 text-lg font-semibold text-workbench-ink">{stage.done}/{stage.total}</p>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-workbench-muted">
                    <div className="h-full rounded-full bg-workbench-accent" style={{ width: `${percent}%` }} />
                  </div>
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
          <p className="py-6 text-center text-sm text-workbench-danger">加载失败：{error}</p>
        ) : stats.running.length === 0 ? (
          <p className="py-6 text-center text-sm text-workbench-subtle">当前没有运行中的智能体任务</p>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {stats.running.slice(0, 6).map((task) => (
              <li key={task.id} className="rounded-md border border-workbench-border bg-workbench-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium text-workbench-ink">{task.taskTemplateName ?? `Task #${task.taskNumber}`}</span>
                  <WorkbenchStatus state="running" label="运行中" />
                </div>
                <p className="mt-1.5 text-xs text-workbench-subtle">
                  阶段 {task.currentStageIndex + 1} · 优先级 {task.priority ?? 'medium'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
