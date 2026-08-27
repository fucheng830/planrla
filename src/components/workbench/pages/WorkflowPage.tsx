import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { kanbanApi } from '../../kanban/api';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import type { Task, TaskPriority } from '../../kanban/types';
import type { Project } from '../../../types/app';
import { toast } from 'sonner';
import { WorkbenchStatus, type WorkbenchStatusState } from '../WorkbenchStatus';

import { FilterChip, PageShell, PageToolbar } from './PageShell';
import { WORKFLOW_STAGES } from './workflowModel';

type AgentRow = { name: string; detail: string; state: 'running' | 'idle' | 'waiting'; label: string };

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
  projectName?: string;
  source?: Task;
};

function displayTask(task: Task, stageCount: number, projects: Project[]): DisplayTask {
  const status = taskStatus(task);
  return {
    id: task.id,
    taskNumber: task.taskNumber,
    stageIndex: Math.min(task.currentStageIndex, Math.max(0, stageCount - 1)),
    title: task.input?.trim() || task.taskTemplateName || `任务 #${task.taskNumber}`,
    detail: task.worktreeBranch
      ? `worktree: ${task.worktreeBranch}`
      : task.auxFlags.sessionError
        ? '需要处理任务错误'
        : (task.labels[0] ?? task.taskTemplateName ?? '研发任务'),
    tags: task.labels.length > 0 ? task.labels.slice(0, 3) : ['Kanban'],
    priority: priorityLabel(task.priority),
    status: status.state,
    statusLabel: status.label,
    projectName: projects.find((p) => p.projectId === task.rootId)?.displayName,
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
          {task.projectName && <span className="truncate rounded bg-workbench-muted px-1 py-0.5 text-[10px] text-workbench-subtle">{task.projectName}</span>}
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

function WorkflowRightRail({ schedules, agentRows, nextTask, failedTask }: { schedules: ReturnType<typeof useKanban>['schedules']; agentRows: AgentRow[]; nextTask: Task | null; failedTask: Task | null }) {
  const [resolvedAction, setResolvedAction] = useState<string | null>(null);

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
        <div className="space-y-2">{schedules.length === 0 ? <p className="rounded-md border border-dashed border-workbench-border p-3 text-center text-xs text-workbench-subtle">暂无定时任务,可在日历页创建</p> : schedules.slice(0, 3).map((schedule) => <div key={schedule.id} className="flex items-start gap-2 rounded-md border border-workbench-border bg-workbench-muted/20 p-2.5"><CircleDot className="mt-0.5 size-3.5 text-workbench-accent" aria-hidden="true" /><div className="min-w-0"><p className="truncate text-xs font-semibold text-workbench-ink">{schedule.cronExpression}</p><p className="mt-1 truncate text-[11px] text-workbench-subtle">{schedule.input || '当前项目定时任务'}</p></div><span className="ml-auto text-[10px] text-workbench-subtle">run</span></div>)}</div>
      </section>

      <section className="ds-panel p-3" aria-label="AI Agent 状态">
        <header className="mb-2 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-semibold text-workbench-ink"><Bot className="size-4 text-workbench-accent" aria-hidden="true" />AI Agent 状态</h2><span className="text-[10px] text-workbench-subtle">实时</span></header>
        <div className="divide-y divide-workbench-border">{agentRows.map((agent) => <div key={agent.name} className="flex items-center gap-2 py-2.5"><span className={`size-2 rounded-full ${agent.state === 'running' ? 'bg-workbench-accent' : agent.state === 'waiting' ? 'bg-workbench-waiting' : 'bg-workbench-success'}`} aria-hidden="true" /><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-workbench-ink">{agent.name}</p><p className="truncate text-[11px] text-workbench-subtle">{agent.detail}</p></div><span className="text-xs text-workbench-subtle">{agent.label}</span></div>)}</div>
      </section>
    </aside>
  );
}

export function WorkflowPage({ projectName, projects = [] }: { projectName: string; projects?: Project[] }) {
  // 排除 kanban worktree 假项目(历史污染),任务不允许直接挂到 worktree
  const selectableProjects = projects.filter((p) => !(p.fullPath || p.path || '').includes('.worktree'));
  const { templates, schedules, createTask } = useKanban();
  const { subscribe } = useWebSocket();
  // 全局看板:跨项目聚合所有任务(每个任务自带 rootId/项目);mutation
  // 用任务自己的 root,避免 provider 的当前项目作用域限制。
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshAll = useCallback(async () => {
    try {
      setAllTasks(await kanbanApi.listAllTasks());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refreshAll(); }, [refreshAll]);
  useEffect(() => subscribe((event) => {
    if (event.type === 'kanban-task-updated' || event.type === 'kanban-task-deleted' || event.kind === 'websocket_reconnected') void refreshAll();
  }), [refreshAll, subscribe]);
  const moveTask = useCallback(async (taskId: string, action: string, rootId: string) => {
    await kanbanApi.move(taskId, rootId, action);
  }, []);
  const tasks = allTasks;
  const [view, setView] = useState<'board' | 'list'>('board');
  const [showRules, setShowRules] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createInput, setCreateInput] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  // 每个需求必须关联一个项目:默认当前项目,可切换到其它项目(任务落到
  // 该项目的看板/工作树)。rootId 决定 agent 的工作目录。
  const targetProjectId = selectedProjectId || (selectableProjects[0]?.projectId ?? '');
  const targetProject = selectableProjects.find((p) => p.projectId === targetProjectId);
  const createTargetLabel = targetProject
    ? (targetProject.displayName || targetProject.fullPath || targetProject.path || targetProjectId)
    : projectName;

  // Columns follow the active template's real stages; WORKFLOW_STAGES is only
  // a fallback for the brief window before templates load.
  const activeTemplate = templates.find((t) => t.id === selectedTemplateId) ?? templates[0] ?? null;
  const stageNames = useMemo(
    () => activeTemplate?.stages.map((s) => s.snapshot.name) ?? [...WORKFLOW_STAGES],
    [activeTemplate],
  );
  const liveTasks = useMemo(() => tasks.filter((task) => task.status !== 'cancelled').map((task) => displayTask(task, stageNames.length, projects)), [projects, stageNames, tasks]);
  const failedTask = tasks.find((task) => task.status === 'fail') ?? null;
  const nextTask = tasks.find((task) => task.status === 'waiting_user') ?? null;
  const columns = useMemo(() => stageNames.map((name, index) => ({ name, tasks: liveTasks.filter((task) => task.stageIndex === index) })), [stageNames, liveTasks]);

  // Agent rows derive from the template stages + live task states — no fake data.
  const agentRows = useMemo<AgentRow[]>(() => {
    const agentOf = (task: Task) => templates.find((t) => t.id === task.taskTemplateId)?.stages[task.currentStageIndex]?.snapshot;
    const names = new Set<string>();
    templates.forEach((t) => t.stages.forEach((s) => { if (s.snapshot.role === 'agent' && s.snapshot.agent) names.add(s.snapshot.agent); }));
    if (names.size === 0) names.add('claude');
    return [...names].map((name) => {
      const occupied = tasks.find((t) => agentOf(t)?.agent === name && (t.status === 'running' || t.status === 'waiting_user'));
      const stage = occupied ? agentOf(occupied) : null;
      const state = occupied?.status === 'running' ? 'running' : occupied ? 'waiting' : 'idle';
      return { name, detail: stage ? `${stage.name} · REQ-${String(occupied!.taskNumber).padStart(3, '0')}` : '空闲', state, label: state === 'running' ? '运行中' : state === 'waiting' ? '等待' : '空闲' };
    });
  }, [templates, tasks]);

  const handleCreateTask = async () => {
    if (!activeTemplate || !targetProjectId) return;
    // 跨项目创建:rootId 决定任务归属与 agent 的 worktree 位置
    await createTask(activeTemplate.id, createInput.trim() || '新的研发任务', { rootId: targetProjectId });
    toast.success(`任务已创建到「${createTargetLabel === projectName ? '当前项目' : createTargetLabel}」的看板`);
    setCreateInput('');
    setShowCreate(false);
  };

  return (
    <PageShell>
      <PageToolbar
        title="研发流程看板"
        description={`全部项目 · 每个任务必须沿着需求设计、技术方案设计、开工、测试验证、交付推进`}
        actions={
          <>
            <button type="button" onClick={() => setShowRules((value) => !value)} className="ds-focus-ring inline-flex h-8 items-center gap-1.5 rounded border border-workbench-border bg-workbench-surface px-3 text-xs font-semibold text-workbench-subtle hover:bg-workbench-muted"><FileWarning className="size-3.5" />流程规则</button>
            <button type="button" onClick={() => setShowCreate((value) => !value)} className="ds-focus-ring inline-flex h-8 items-center gap-1.5 rounded border border-workbench-accent bg-workbench-accent px-3 text-xs font-semibold text-white hover:brightness-95"><Play className="size-3.5" />创建任务</button>
          </>
        }
      />

      {showRules && <section className="ds-panel flex flex-wrap items-center gap-4 p-3 text-xs text-workbench-subtle" aria-label="流程规则"><span className="font-semibold text-workbench-ink">工程化约束</span><span>需求确认后才能进入技术方案</span><span>测试失败自动暂停并通知协作者</span><span>交付前必须生成验证记录</span></section>}
      {showCreate && <section className="ds-panel flex flex-wrap items-center gap-2 p-3" aria-label="创建任务"><select value={targetProjectId} onChange={(event) => setSelectedProjectId(event.target.value)} className="ds-focus-ring h-8 rounded border border-workbench-border bg-workbench-surface px-2 text-xs text-workbench-ink" aria-label="关联项目">{selectableProjects.map((p) => <option key={p.projectId} value={p.projectId}>{p.displayName || p.fullPath || p.path || p.projectId.slice(0, 8)}</option>)}</select>
          {templates.length > 1 && <select value={activeTemplate?.id ?? ''} onChange={(event) => setSelectedTemplateId(event.target.value)} className="ds-focus-ring h-8 rounded border border-workbench-border bg-workbench-surface px-2 text-xs text-workbench-ink" aria-label="选择模板">{templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}</select>}<input value={createInput} onChange={(event) => setCreateInput(event.target.value)} placeholder="输入需求描述,回车创建" onKeyDown={(event) => { if (event.key === 'Enter') void handleCreateTask(); }} className="ds-focus-ring h-8 min-w-[240px] flex-1 rounded border border-workbench-border bg-workbench-surface px-3 text-sm text-workbench-ink" /><button type="button" onClick={() => void handleCreateTask()} disabled={!activeTemplate || !targetProjectId} className="ds-focus-ring h-8 rounded bg-workbench-accent px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">创建</button></section>}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <main className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2 text-xs text-workbench-subtle"><FilterChip label="看板" active={view === 'board'} onClick={() => setView('board')} /><FilterChip label="列表" active={view === 'list'} onClick={() => setView('list')} />{liveTasks.length === 0 && !loading && <span className="rounded bg-workbench-muted px-2 py-1">还没有任务 · 点右上角「创建任务」开始</span>}</div><div className="flex items-center gap-3 text-xs text-workbench-subtle"><span className="flex items-center gap-1"><CircleDot className="size-3 text-workbench-accent" />AI 运行中</span><span className="flex items-center gap-1"><CircleDot className="size-3 text-workbench-waiting" />等负责人</span><span className="flex items-center gap-1"><CircleDot className="size-3 text-workbench-danger" />验证失败</span><span className="flex items-center gap-1"><CircleDot className="size-3 text-workbench-success" />已交付</span></div></div>
          {error && <p className="mb-3 rounded-md border border-workbench-danger/30 bg-workbench-danger-soft/30 p-3 text-sm text-workbench-danger">加载任务失败：{error}</p>}
          {loading && <p className="mb-3 text-sm text-workbench-subtle">正在加载看板数据…</p>}
          {view === 'board' ? <div className="flex gap-3 overflow-x-auto pb-1">{columns.map((column) => <section key={column.name} className="ds-panel flex min-h-[520px] w-56 shrink-0 grow flex-col" aria-label={column.name}><header className="ds-panel-header"><h2 className="flex-1 text-sm font-semibold text-workbench-ink">{column.name}</h2><span className="ds-mono rounded bg-workbench-muted px-1.5 py-0.5 text-[10px] text-workbench-subtle">{column.tasks.length}</span></header><div className="flex-1 space-y-2 overflow-auto p-2">{column.tasks.length === 0 ? <p className="py-8 text-center text-xs text-workbench-subtle">暂无任务</p> : column.tasks.map((task) => <WorkflowTaskCard key={task.id} task={task} onAdvance={task.source ? () => void moveTask(task.source!.id, 'next', task.source!.rootId).then(refreshAll) : undefined} />)}</div></section>)}</div> : <section className="ds-panel overflow-hidden" aria-label="任务列表"><table className="w-full text-left text-sm"><thead className="border-b border-workbench-border bg-workbench-muted/50 text-xs text-workbench-subtle"><tr><th className="px-3 py-2 font-medium">编号</th><th className="px-3 py-2 font-medium">任务</th><th className="px-3 py-2 font-medium">阶段</th><th className="px-3 py-2 font-medium">优先级</th><th className="px-3 py-2 font-medium">状态</th></tr></thead><tbody>{liveTasks.map((task) => <tr key={task.id} className="border-b border-workbench-border/60 last:border-0 hover:bg-workbench-muted/50"><td className="ds-mono px-3 py-2 text-workbench-subtle">REQ-{String(task.taskNumber).padStart(3, '0')}</td><td className="max-w-md truncate px-3 py-2 text-workbench-ink">{task.title}</td><td className="px-3 py-2 text-workbench-subtle">{stageNames[task.stageIndex] ?? task.stageIndex}</td><td className="px-3 py-2 text-workbench-subtle">{task.priority}</td><td className="px-3 py-2"><WorkbenchStatus state={task.status} label={task.statusLabel} /></td></tr>)}</tbody></table></section>}
          <div className="mt-3 flex items-center gap-4 text-xs text-workbench-subtle"><span className="flex items-center gap-1.5"><KanbanSquare className="size-3.5" aria-hidden="true" />任务按工程阶段推进</span><span className="flex items-center gap-1.5"><List className="size-3.5" aria-hidden="true" />列表视图用于快速扫描全量任务</span></div>
        </main>
        <WorkflowRightRail schedules={schedules} agentRows={agentRows} nextTask={nextTask} failedTask={failedTask} />
      </div>
    </PageShell>
  );
}
