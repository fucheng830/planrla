import { useMemo, useState } from 'react';
import { KanbanSquare, List } from 'lucide-react';

import { useKanban } from '../../kanban';
import type { Task, TaskPriority } from '../../kanban/types';
import { WorkbenchStatus } from '../WorkbenchStatus';

import { FilterChip, PageShell, PageToolbar } from './PageShell';

const DELIVERY_STAGES = ['需求设计', '技术方案', '开工', '测试验证', '交付'] as const;

const statusState = (task: Task): 'running' | 'waiting' | 'complete' | 'failed' => {
  if (task.status === 'success') return 'complete';
  if (task.status === 'fail') return 'failed';
  if (task.status === 'waiting_user') return 'waiting';
  return 'running';
};

const statusLabel = (task: Task): string => {
  if (task.status === 'success') return '已完成';
  if (task.status === 'fail') return '失败';
  if (task.status === 'waiting_user') return '待确认';
  if (task.status === 'running') return '进行中';
  return '未开始';
};

const priorityLabel = (p?: TaskPriority): string => (p === 'high' ? '高' : p === 'low' ? '低' : '中');

function WorkflowTaskCard({ task }: { task: Task }) {
  return (
    <article className="ds-surface rounded-md p-3 transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 text-sm font-medium leading-snug text-workbench-ink">{task.taskTemplateName ?? `Task #${task.taskNumber}`}</h3>
        <WorkbenchStatus state={statusState(task)} label={statusLabel(task)} />
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs text-workbench-subtle">
        <div>
          <dt className="sr-only">优先级</dt>
          <dd>优先级 {priorityLabel(task.priority)}</dd>
        </div>
        <div>
          <dt className="sr-only">阶段</dt>
          <dd>阶段 {task.currentStageIndex + 1}</dd>
        </div>
        <div>
          <dt className="sr-only">编号</dt>
          <dd className="ds-mono">#{task.taskNumber}</dd>
        </div>
      </dl>
    </article>
  );
}

export function WorkflowPage({ projectName }: { projectName: string }) {
  const { tasks, templates, loading, error, moveTask } = useKanban();
  const [view, setView] = useState<'board' | 'list'>('board');

  const columns = useMemo(() => {
    const stageCount = templates[0]?.stages.length ?? 0;
    const cols = DELIVERY_STAGES.map((name) => ({ name, tasks: [] as Task[] }));
    for (const task of tasks) {
      const ratio = stageCount > 1 ? task.currentStageIndex / (stageCount - 1) : 0;
      const colIndex = Math.min(DELIVERY_STAGES.length - 1, Math.floor(ratio * DELIVERY_STAGES.length));
      cols[colIndex].tasks.push(task);
    }
    return cols;
  }, [tasks, templates]);

  return (
    <PageShell>
      <PageToolbar
        title="研发流程"
        description={`${projectName} · 需求设计 → 技术方案 → 开工 → 测试验证 → 交付`}
        actions={
          <>
            <FilterChip label="看板视图" active={view === 'board'} onClick={() => setView('board')} />
            <FilterChip label="列表视图" active={view === 'list'} onClick={() => setView('list')} />
          </>
        }
      />

      {error && <p className="rounded-md border border-workbench-danger/30 bg-workbench-danger/5 p-3 text-sm text-workbench-danger">{error}</p>}
      {loading && <p className="text-sm text-workbench-subtle">正在加载看板数据…</p>}

      {view === 'board' ? (
        <div className="grid gap-3 lg:grid-cols-5">
          {columns.map((col) => {
            const done = col.tasks.filter((t) => t.status === 'success').length;
            return (
              <section key={col.name} className="ds-panel flex min-h-[320px] flex-col" aria-label={col.name}>
                <header className="ds-panel-header">
                  <h2 className="flex-1 text-sm font-semibold text-workbench-ink">{col.name}</h2>
                  <span className="ds-mono text-xs text-workbench-subtle">{done}/{col.tasks.length}</span>
                </header>
                <div className="flex-1 space-y-2 overflow-auto p-2">
                  {col.tasks.length === 0 ? (
                    <p className="py-8 text-center text-xs text-workbench-subtle">暂无任务</p>
                  ) : (
                    col.tasks.map((task) => (
                      <div key={task.id} onDoubleClick={() => void moveTask(task.id, 'advance')}>
                        <WorkflowTaskCard task={task} />
                      </div>
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <section className="ds-panel overflow-hidden" aria-label="任务列表">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-workbench-border bg-workbench-muted/50 text-xs text-workbench-subtle">
              <tr>
                <th className="px-3 py-2 font-medium">编号</th>
                <th className="px-3 py-2 font-medium">任务</th>
                <th className="px-3 py-2 font-medium">阶段</th>
                <th className="px-3 py-2 font-medium">优先级</th>
                <th className="px-3 py-2 font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id} className="border-b border-workbench-border/60 last:border-0 hover:bg-workbench-muted/50">
                  <td className="ds-mono px-3 py-2 text-workbench-subtle">#{task.taskNumber}</td>
                  <td className="max-w-md truncate px-3 py-2 text-workbench-ink">{task.taskTemplateName ?? `Task #${task.taskNumber}`}</td>
                  <td className="px-3 py-2 text-workbench-subtle">{task.currentStageIndex + 1}</td>
                  <td className="px-3 py-2 text-workbench-subtle">{priorityLabel(task.priority)}</td>
                  <td className="px-3 py-2"><WorkbenchStatus state={statusState(task)} label={statusLabel(task)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {tasks.length === 0 && !loading && <p className="py-8 text-center text-sm text-workbench-subtle">暂无任务</p>}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-4 text-xs text-workbench-subtle">
        <span className="flex items-center gap-1.5"><KanbanSquare className="size-3.5" aria-hidden="true" /> 双击任务卡可推进到下一阶段</span>
        <span className="flex items-center gap-1.5"><List className="size-3.5" aria-hidden="true" /> 列表视图用于快速扫描全量任务</span>
      </div>
    </PageShell>
  );
}
