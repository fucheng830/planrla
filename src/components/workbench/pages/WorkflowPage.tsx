import { useMemo, useState, type ReactNode } from 'react';
import {
  Bot,
  CalendarClock,
  Check,
  ChevronRight,
  CircleDot,
  FileWarning,
  KanbanSquare,
  List,
  MessageCircle,
  Play,
  ShieldAlert,
  UserRound,
} from 'lucide-react';

import { useKanban } from '../../kanban';
import type { Task, TaskPriority } from '../../kanban/types';
import { WorkbenchStatus, type WorkbenchStatusState } from '../WorkbenchStatus';

import { FilterChip, PageShell, PageToolbar } from './PageShell';
import { WORKFLOW_AGENT_ROWS, WORKFLOW_STAGES, getWorkflowStageIndex } from './workflowModel';

const priorityLabel = (priority?: TaskPriority): string => (priority === 'high' ? '高' : priority === 'low' ? '低' : '中');

const taskStatus = (task: Task): { state: WorkbenchStatusState; label: string } => {
  if (task.status === 'success') return { state: 'complete', label: '已交付' };
  if (task.status === 'fail') return { state: 'failed', label: '验证失败' };
  if (task.status === 'waiting_user') return { state: 'waiting', label: '等待人工' };
  return { state: 'running', label: task.status === 'pending' ? '未开始' : 'AI 运行中' };
};

type DisplayTask = {
  id: string;
  taskNumber: number;
  stageIndex: number;
  title: string;
  detail: string;
  tags: string[];
  priority: string;
  status: WorkbenchStatusState;
  statusLabel: string;
  source?: Task;
};

const DEMO_TASKS: DisplayTask[] = [
  { id: 'demo-088', taskNumber: 88, stageIndex: 0, title: '统一消息盒子', detail: '企业微信、Slack 消息归一与人工确认', tags: ['PRD'], priority: '高', status: 'waiting', statusLabel: '等负责人' },
  { id: 'demo-092', taskNumber: 92, stageIndex: 0, title: '客服消息身份映射', detail: '小红书、抖音、咸鱼客服账号归一', tags: ['客户消息'], priority: '中', status: 'running', statusLabel: '规划中' },
  { id: 'demo-096', taskNumber: 96, stageIndex: 0, title: '团队协作消息', detail: '团队成员消息接入 AI 协作线程', tags: ['团队'], priority: '中', status: 'running', statusLabel: '规划中' },
  { id: 'demo-089', taskNumber: 89, stageIndex: 1, title: 'SDLC 流程引擎', detail: '需求、方案、开工、验证、交付状态机', tags: ['设计稿'], priority: '高', status: 'running', statusLabel: 'Codex 运行中' },
  { id: 'demo-090', taskNumber: 90, stageIndex: 1, title: 'AI 求助路由', detail: 'Agent 卡住时自动选择协作者和渠道', tags: ['Planner'], priority: '中', status: 'running', statusLabel: '方案评审' },
  { id: 'demo-081', taskNumber: 81, stageIndex: 2, title: '后台任务面板', detail: 'worktree: codex/req-081-bg-panel', tags: ['Dev Agent', '4 files'], priority: '中', status: 'running', statusLabel: '开工中' },
  { id: 'demo-043', taskNumber: 43, stageIndex: 2, title: 'goal stop hook', detail: '自主推进直到 task_complete', tags: ['Claude'], priority: '低', status: 'complete', statusLabel: '执行中' },
  { id: 'demo-076', taskNumber: 76, stageIndex: 3, title: 'Windows 打包健壮性', detail: 'npm run build 失败，需要工程师确认', tags: ['build fail', '需人'], priority: '高', status: 'failed', statusLabel: '验证失败' },
  { id: 'demo-078', taskNumber: 78, stageIndex: 3, title: 'WebSocket 回归', detail: 'typecheck 通过，测试待跑', tags: ['test'], priority: '中', status: 'waiting', statusLabel: '等待验证' },
  { id: 'demo-074', taskNumber: 74, stageIndex: 4, title: '移动端输入优化', detail: '等待 changelog 和交付说明', tags: ['release note'], priority: '中', status: 'complete', statusLabel: '已交付' },
  { id: 'demo-070', taskNumber: 70, stageIndex: 4, title: '插件设置清理', detail: '已验证，待归档回顾', tags: ['retro'], priority: '低', status: 'complete', statusLabel: '已交付' },
];

function displayTask(task: Task, stageCount: number): DisplayTask {
  const status = taskStatus(task);
  return {
    id: task.id,
    taskNumber: task.taskNumber,
    stageIndex: getWorkflowStageIndex(task.currentStageIndex, stageCount),
    title: task.taskTemplateName ?? `任务 #${task.taskNumber}`,
    detail: task.worktreeBranch ?? (task.auxFlags.sessionError ? '需要处理任务错误' : '当前项目研发任务'),
    tags: task.labels.length > 0 ? task.labels.slice(0, 3) : ['Kanban'],
    priority: priorityLabel(task.priority),
    status: status.state,
    statusLabel: status.label,
    source: task,
  };
}

function WorkflowTaskCard({ task, onAdvance }: { task: DisplayTask; onAdvance?: () => void }) {
  return (
    <article
      className={`ds-surface-raised group rounded-md p-3 transition-colors hover:border-workbench-accent/60 ${task.status === 'failed' ? 'border-workbench-danger/60' : task.status === 'waiting' ? 'border-workbench-waiting/60' : ''}`}
      onDoubleClick={onAdvance}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="ds-mono text-[10px] text-workbench-subtle">REQ-{String(task.taskNumber).padStart(3, '0')}</span>
        <WorkbenchStatus state={task.status} label={task.statusLabel} />
      </div>
      <h3 className="mt-1 text-sm font-semibold leading-snug text-workbench-ink">{task.title}</h3>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-workbench-subtle">{task.detail}</p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {task.tags.map((tag) => <span key={tag} className="ds-label rounded bg-workbench-muted px-1.5 py-0.5 normal-case tracking-normal">{tag}</span>)}
        <span className="ml-auto text-[10px] text-workbench-subtle">优先级 {task.priority}</span>
      </div>
      {onAdvance && <p className="mt-2 text-[10px] text-workbench-subtle opacity-0 transition-opacity group-hover:opacity-100">双击推进阶段</p>}
    </article>
  );
}

function ActionCard({ title, detail, status, tone, children }: { title: string; detail: string; status: string; tone: 'waiting' | 'failed'; children?: ReactNode }) {
  return (
    <article className={`rounded-md border p-3 ${tone === 'waiting' ? 'border-workbench-waiting/40 bg-workbench-waiting-soft/30' : 'border-workbench-danger/40 bg-workbench-danger-soft/30'}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-workbench-ink">{title}</h3>
        <WorkbenchStatus state={tone === 'waiting' ? 'waiting' : 'failed'} label={status} />
      </div>
      <p className="mt-2 text-xs leading-5 text-workbench-subtle">{detail}</p>
      {children}
    </article>
  );
}

function WorkflowRightRail({ schedules, nextTask, failedTask }: { schedules: ReturnType<typeof useKanban>['schedules']; nextTask: Task | null; failedTask: Task | null }) {
  const [resolvedAction, setResolvedAction] = useState<string | null>(null);
  const scheduleRows = schedules.length > 0
    ? schedules.slice(0, 3).map((schedule) => ({ title: schedule.cronExpression, detail: schedule.input || '当前项目定时任务', tone: 'run' }))
    : [
      { title: '22:00 自动跑 typecheck', detail: '每天，当前项目', tone: 'run' },
      { title: '明天交付节点提醒', detail: 'REQ-074, REQ-070', tone: 'info' },
      { title: '周五 客服消息汇总', detail: '微信 / 小红书 / 抖音', tone: 'wait' },
    ];

  return (
    <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start" aria-label="研发流程辅助信息">
      <section className="ds-panel p-3" aria-label="当前需要你处理">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-workbench-ink"><ShieldAlert className="size-4 text-workbench-waiting" aria-hidden="true" />当前需要你处理</h2>
          <span className="ds-mono rounded bg-workbench-waiting-soft px-1.5 py-0.5 text-[10px] text-workbench-waiting">{(nextTask ? 1 : 0) + (failedTask ? 1 : 0)}</span>
        </header>
        {nextTask ? (
          <ActionCard title={nextTask.taskTemplateName ?? `任务 #${nextTask.taskNumber}`} detail="AI 已暂停，等待你确认后继续推进任务。" status="待确认" tone="waiting">
            {resolvedAction === 'allow' ? <p className="mt-3 flex items-center gap-1.5 text-xs text-workbench-success"><Check className="size-3.5" />已允许继续</p> : (
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => setResolvedAction('allow')} className="ds-focus-ring inline-flex items-center gap-1 rounded bg-workbench-accent px-2 py-1 text-xs font-semibold text-white"><Play className="size-3" />允许</button>
                <button type="button" onClick={() => setResolvedAction('review')} className="ds-focus-ring inline-flex items-center gap-1 rounded border border-workbench-border px-2 py-1 text-xs text-workbench-subtle hover:bg-workbench-muted"><UserRound className="size-3" />先人工确认</button>
              </div>
            )}
          </ActionCard>
        ) : (
          <p className="rounded-md border border-workbench-border bg-workbench-muted/30 p-3 text-xs text-workbench-subtle">当前没有等待人工确认的任务</p>
        )}
        {failedTask && <div className="mt-2"><ActionCard title={failedTask.taskTemplateName ?? `任务 #${failedTask.taskNumber}`} detail="任务运行失败，需要工程师检查日志并决定是否重试。" status="转派" tone="failed"><button type="button" onClick={() => setResolvedAction('transfer')} className="ds-focus-ring mt-3 inline-flex items-center gap-1 rounded border border-workbench-danger/40 px-2 py-1 text-xs text-workbench-danger hover:bg-workbench-danger-soft"><MessageCircle className="size-3" />转给后端</button></ActionCard></div>}
      </section>

      <section className="ds-panel p-3" aria-label="日历与定时任务">
        <header className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-semibold text-workbench-ink"><CalendarClock className="size-4 text-workbench-accent" aria-hidden="true" />日历与定时任务</h2><ChevronRight className="size-4 text-workbench-subtle" aria-hidden="true" /></header>
        <div className="space-y-2">{scheduleRows.map((item) => <div key={`${item.title}-${item.detail}`} className="flex items-start gap-2 rounded-md border border-workbench-border bg-workbench-muted/20 p-2.5"><CircleDot className={`mt-0.5 size-3.5 ${item.tone === 'run' ? 'text-workbench-accent' : item.tone === 'wait' ? 'text-workbench-waiting' : 'text-workbench-subtle'}`} aria-hidden="true" /><div className="min-w-0"><p className="truncate text-xs font-semibold text-workbench-ink">{item.title}</p><p className="mt-1 truncate text-[11px] text-workbench-subtle">{item.detail}</p></div><span className="ml-auto text-[10px] text-workbench-subtle">{item.tone === 'run' ? 'run' : item.tone === 'wait' ? 'wait' : 'info'}</span></div>)}</div>
      </section>

      <section className="ds-panel p-3" aria-label="AI Agent 状态">
        <header className="mb-2 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-semibold text-workbench-ink"><Bot className="size-4 text-workbench-accent" aria-hidden="true" />AI Agent 状态</h2><span className="text-[10px] text-workbench-subtle">实时</span></header>
        <div className="divide-y divide-workbench-border">{WORKFLOW_AGENT_ROWS.map((agent) => <div key={agent.name} className="flex items-center gap-2 py-2.5"><span className={`size-2 rounded-full ${agent.state === 'running' ? 'bg-workbench-accent' : agent.state === 'waiting' ? 'bg-workbench-waiting' : 'bg-workbench-success'}`} aria-hidden="true" /><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-workbench-ink">{agent.name}</p><p className="truncate text-[11px] text-workbench-subtle">{agent.detail}</p></div><span className="text-xs text-workbench-subtle">{agent.label}</span></div>)}</div>
      </section>
    </aside>
  );
}

export function WorkflowPage({ projectName }: { projectName: string }) {
  const { tasks, templates, schedules, nextTask, loading, error, moveTask, createTask } = useKanban();
  const [view, setView] = useState<'board' | 'list'>('board');
  const [showRules, setShowRules] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createInput, setCreateInput] = useState('');

  const stageCount = templates[0]?.stages.length ?? WORKFLOW_STAGES.length;
  const liveTasks = useMemo(() => tasks.map((task) => displayTask(task, stageCount)), [stageCount, tasks]);
  const displayTasks = liveTasks.length > 0 ? liveTasks : DEMO_TASKS;
  const failedTask = tasks.find((task) => task.status === 'fail') ?? null;
  const columns = useMemo(() => WORKFLOW_STAGES.map((name, index) => ({ name, tasks: displayTasks.filter((task) => task.stageIndex === index) })), [displayTasks]);

  const handleCreateTask = async () => {
    const template = templates[0];
    if (!template) return;
    await createTask(template.id, createInput.trim() || '新的研发任务');
    setCreateInput('');
    setShowCreate(false);
  };

  return (
    <PageShell>
      <PageToolbar
        title="研发流程看板"
        description={`${projectName} · 每个任务必须沿着需求设计、技术方案设计、开工、测试验证、交付推进`}
        actions={
          <>
            <button type="button" onClick={() => setShowRules((value) => !value)} className="ds-focus-ring inline-flex h-8 items-center gap-1.5 rounded border border-workbench-border bg-workbench-surface px-3 text-xs font-semibold text-workbench-subtle hover:bg-workbench-muted"><FileWarning className="size-3.5" />流程规则</button>
            <button type="button" onClick={() => setShowCreate((value) => !value)} className="ds-focus-ring inline-flex h-8 items-center gap-1.5 rounded border border-workbench-accent bg-workbench-accent px-3 text-xs font-semibold text-white hover:brightness-95"><Play className="size-3.5" />创建任务</button>
          </>
        }
      />

      {showRules && <section className="ds-panel flex flex-wrap items-center gap-4 p-3 text-xs text-workbench-subtle" aria-label="流程规则"><span className="font-semibold text-workbench-ink">工程化约束</span><span>需求确认后才能进入技术方案</span><span>测试失败自动暂停并通知协作者</span><span>交付前必须生成验证记录</span></section>}
      {showCreate && <section className="ds-panel flex flex-wrap items-center gap-2 p-3" aria-label="创建任务"><input value={createInput} onChange={(event) => setCreateInput(event.target.value)} placeholder="输入新的研发任务" className="ds-focus-ring h-8 min-w-[240px] flex-1 rounded border border-workbench-border bg-workbench-surface px-3 text-sm text-workbench-ink" /><button type="button" onClick={() => void handleCreateTask()} disabled={templates.length === 0} className="ds-focus-ring h-8 rounded bg-workbench-accent px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">创建</button></section>}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <main className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2 text-xs text-workbench-subtle"><FilterChip label="看板" active={view === 'board'} onClick={() => setView('board')} /><FilterChip label="列表" active={view === 'list'} onClick={() => setView('list')} />{liveTasks.length === 0 && <span className="rounded bg-workbench-muted px-2 py-1">演示任务 · 接入真实 Kanban 后自动替换</span>}</div><div className="flex items-center gap-3 text-xs text-workbench-subtle"><span className="flex items-center gap-1"><CircleDot className="size-3 text-workbench-accent" />AI 运行中</span><span className="flex items-center gap-1"><CircleDot className="size-3 text-workbench-waiting" />等负责人</span><span className="flex items-center gap-1"><CircleDot className="size-3 text-workbench-danger" />验证失败</span><span className="flex items-center gap-1"><CircleDot className="size-3 text-workbench-success" />已交付</span></div></div>
          {error && <p className="mb-3 rounded-md border border-workbench-danger/30 bg-workbench-danger-soft/30 p-3 text-sm text-workbench-danger">加载任务失败：{error}</p>}
          {loading && <p className="mb-3 text-sm text-workbench-subtle">正在加载看板数据…</p>}
          {view === 'board' ? <div className="grid gap-3 lg:grid-cols-5">{columns.map((column) => <section key={column.name} className="ds-panel flex min-h-[520px] min-w-0 flex-col" aria-label={column.name}><header className="ds-panel-header"><h2 className="flex-1 text-sm font-semibold text-workbench-ink">{column.name}</h2><span className="ds-mono rounded bg-workbench-muted px-1.5 py-0.5 text-[10px] text-workbench-subtle">{column.tasks.length}</span></header><div className="flex-1 space-y-2 overflow-auto p-2">{column.tasks.length === 0 ? <p className="py-8 text-center text-xs text-workbench-subtle">暂无任务</p> : column.tasks.map((task) => <WorkflowTaskCard key={task.id} task={task} onAdvance={task.source ? () => void moveTask(task.source!.id, 'advance') : undefined} />)}</div></section>)}</div> : <section className="ds-panel overflow-hidden" aria-label="任务列表"><table className="w-full text-left text-sm"><thead className="border-b border-workbench-border bg-workbench-muted/50 text-xs text-workbench-subtle"><tr><th className="px-3 py-2 font-medium">编号</th><th className="px-3 py-2 font-medium">任务</th><th className="px-3 py-2 font-medium">阶段</th><th className="px-3 py-2 font-medium">优先级</th><th className="px-3 py-2 font-medium">状态</th></tr></thead><tbody>{displayTasks.map((task) => <tr key={task.id} className="border-b border-workbench-border/60 last:border-0 hover:bg-workbench-muted/50"><td className="ds-mono px-3 py-2 text-workbench-subtle">REQ-{String(task.taskNumber).padStart(3, '0')}</td><td className="max-w-md truncate px-3 py-2 text-workbench-ink">{task.title}</td><td className="px-3 py-2 text-workbench-subtle">{WORKFLOW_STAGES[task.stageIndex]}</td><td className="px-3 py-2 text-workbench-subtle">{task.priority}</td><td className="px-3 py-2"><WorkbenchStatus state={task.status} label={task.statusLabel} /></td></tr>)}</tbody></table></section>}
          <div className="mt-3 flex items-center gap-4 text-xs text-workbench-subtle"><span className="flex items-center gap-1.5"><KanbanSquare className="size-3.5" aria-hidden="true" />任务按工程阶段推进</span><span className="flex items-center gap-1.5"><List className="size-3.5" aria-hidden="true" />列表视图用于快速扫描全量任务</span></div>
        </main>
        <WorkflowRightRail schedules={schedules} nextTask={nextTask} failedTask={failedTask} />
      </div>
    </PageShell>
  );
}
