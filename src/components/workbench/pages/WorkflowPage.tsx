import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  CalendarClock,
  ChevronRight,
  CircleDot,
  Download,
  FileWarning,
  MessageSquare,
  Plus,
  KanbanSquare,
  List,
  Paperclip,
  Play,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

import { useKanban } from '../../kanban';
import { kanbanApi } from '../../kanban/api';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import type { Task, TaskAttachment, TaskPriority, TaskDiffResult } from '../../kanban/types';
import type { Project } from '../../../types/app';
import { WorkbenchStatus, type WorkbenchStatusState } from '../WorkbenchStatus';

import { FilterChip, PageShell, PageToolbar } from './PageShell';
import { CreateTaskCard } from './CreateTaskCard';
import { Markdown } from '../../chat/view/subcomponents/Markdown';
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
  isBug?: boolean;
  attachments?: number;
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
    isBug: task.taskType === 'bug',
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

/** 交付物面板:worktree 分支 + 相对主仓的 diff 统计/文件/补丁摘要 + 验收动作。 */
function DeliverablePanel({ task, onClose, onChanged }: { task: Task; onClose: () => void; onChanged?: () => void }) {
  const [diff, setDiff] = useState<TaskDiffResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deliveryDoc, setDeliveryDoc] = useState<string | null>(null);
  const [deliverySummary, setDeliverySummary] = useState<string | null>(null);
  const [mode, setMode] = useState<'idle' | 'confirm-merge' | 'rework'>('idle');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    kanbanApi.getDeliveryDoc(task.id, task.rootId).then((c) => { if (!cancelled) setDeliveryDoc(c); });
    kanbanApi.getDeliverySummary(task.id, task.rootId).then((c) => { if (!cancelled) setDeliverySummary(c); });
    return () => { cancelled = true; };
  }, [task.id, task.rootId]);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    kanbanApi.getTaskDiff(task.id, task.rootId)
      .then((d) => { if (!cancelled) setDiff(d); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [task.id, task.rootId, reloadTick]);
  const additions = diff?.files.reduce((sum: number, f: TaskDiffResult["files"][number]) => sum + f.additions, 0) ?? 0;
  const deletions = diff?.files.reduce((sum: number, f: TaskDiffResult["files"][number]) => sum + f.deletions, 0) ?? 0;

  const canAct = task.status === 'success' && Boolean(task.worktreeBranch);
  const alreadyMerged = Boolean(diff?.mergedIntoRoot);

  const handleMerge = async () => {
    setBusy(true);
    try {
      const out = await kanbanApi.acceptDelivery(task.id, task.rootId);
      toast.success(out.alreadyMerged ? '该分支已并入主仓,无需重复合并' : `验收通过,已合并进主仓${out.commit ? `(提交 ${out.commit})` : ''}`);
      setMode('idle');
      setReloadTick((t) => t + 1);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRework = async () => {
    if (!feedback.trim()) {
      toast.error('请填写验收反馈,agent 需要知道要改什么');
      return;
    }
    setBusy(true);
    try {
      await kanbanApi.reworkDelivery(task.id, task.rootId, feedback.trim());
      toast.success('已按反馈重新排队,agent 正在返工');
      onChanged?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="ds-panel flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-workbench-border p-3">
          <div className="min-w-0"><h2 className="truncate text-sm font-semibold text-workbench-ink">交付物 · REQ-{String(task.taskNumber).padStart(3, '0')}</h2>
          <p className="ds-mono mt-0.5 text-[10px] text-workbench-subtle">分支 {task.worktreeBranch}</p></div>
          <button type="button" onClick={onClose} className="ds-focus-ring rounded px-2 py-1 text-xs text-workbench-subtle hover:bg-workbench-muted">关闭</button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-4 text-sm">
          {error && <p className="rounded border border-workbench-danger/30 bg-workbench-danger/10 p-3 text-xs text-workbench-danger">{error}(worktree 可能已被清理)</p>}
          {deliverySummary && (
            <div className="mb-3 rounded-md border border-workbench-accent/40 bg-white p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-workbench-ink">交付说明</p>
              <Markdown className="prose prose-sm max-w-none text-xs">{deliverySummary}</Markdown>
            </div>
          )}
          {!error && !diff && !deliverySummary && <p className="text-xs text-workbench-subtle">正在加载交付物…</p>}
          {diff && (<>
            <p className="text-xs text-workbench-subtle">{diff.files.length} 个文件改动 · <span className="text-workbench-success">+{additions}</span> / <span className="text-workbench-danger">-{deletions}</span>{diff.truncated && ' (已截断)'} · worktree {diff.worktreePath}</p>
            {diff.mergedIntoRoot && <p className="mb-3 rounded border border-workbench-success/30 bg-workbench-success/10 p-3 text-xs text-workbench-success">交付物已全部合并进主仓,无未合并改动。</p>}
            {deliveryDoc && <pre className="mb-3 whitespace-pre-wrap rounded border border-workbench-accent/30 bg-workbench-accent/5 p-3 text-xs leading-5 text-workbench-ink">{deliveryDoc}</pre>}
            <ul className="mt-3 space-y-1">
              {diff.files.map((f: TaskDiffResult["files"][number]) => (
                <li key={f.path} className="flex items-center justify-between gap-2 rounded border border-workbench-border bg-workbench-surface px-2 py-1.5 text-xs">
                  <span className="min-w-0 truncate text-workbench-ink">{f.path}</span>
                  <span className="ds-mono flex-shrink-0 text-[10px] text-workbench-subtle"><span className="text-workbench-success">+{f.additions}</span> <span className="text-workbench-danger">-{f.deletions}</span></span>
                </li>
              ))}
            </ul>
            <pre className="ds-mono mt-3 max-h-72 overflow-auto rounded border border-workbench-border bg-workbench-surface p-2 text-[10px] leading-4 text-workbench-subtle">{diff.patch.slice(0, 20000)}</pre>
          </>)}
        </div>
        {canAct && (
          <footer className="border-t border-workbench-border p-3">
            {mode === 'idle' && (
              <div className="flex items-center justify-end gap-2">
                {busy && <span className="mr-auto text-xs text-workbench-subtle">处理中…</span>}
                {!alreadyMerged && <button type="button" disabled={busy} onClick={() => setMode('rework')} className="ds-focus-ring inline-flex h-8 items-center rounded border border-workbench-border bg-workbench-surface px-3 text-xs font-semibold text-workbench-ink hover:bg-workbench-muted disabled:opacity-50">需要返工</button>}
                {!alreadyMerged
                  ? <button type="button" disabled={busy} onClick={() => setMode('confirm-merge')} className="ds-focus-ring inline-flex h-8 items-center rounded bg-workbench-accent px-3 text-xs font-semibold text-white hover:brightness-95 disabled:opacity-50">验收通过并合并</button>
                  : <button type="button" disabled={busy} onClick={() => setMode('rework')} className="ds-focus-ring inline-flex h-8 items-center rounded border border-workbench-border bg-workbench-surface px-3 text-xs font-semibold text-workbench-ink hover:bg-workbench-muted disabled:opacity-50">需要返工</button>}
              </div>
            )}
            {mode === 'confirm-merge' && (
              <div className="rounded-md border border-workbench-waiting/40 bg-white p-3">
                <p className="text-xs leading-5 text-workbench-ink">确认验收通过?将把分支 <span className="ds-mono text-workbench-accent">{task.worktreeBranch}</span> 以 merge commit 合并进项目主仓当前分支。主仓需无未提交改动;冲突会自动恢复原状并提示人工处理。</p>
                <div className="mt-2.5 flex justify-end gap-2">
                  <button type="button" disabled={busy} onClick={() => setMode('idle')} className="ds-focus-ring inline-flex h-7 items-center rounded border border-workbench-border px-2.5 text-xs text-workbench-subtle hover:bg-workbench-muted disabled:opacity-50">取消</button>
                  <button type="button" disabled={busy} onClick={() => void handleMerge()} className="ds-focus-ring inline-flex h-7 items-center rounded bg-workbench-accent px-2.5 text-xs font-semibold text-white hover:brightness-95 disabled:opacity-50">{busy ? '合并中…' : '确认合并'}</button>
                </div>
              </div>
            )}
            {mode === 'rework' && (
              <div className="rounded-md border border-workbench-waiting/40 bg-white p-3">
                <p className="mb-2 text-xs font-semibold text-workbench-ink">哪里不满意?agent 将带着这条反馈在原会话里返工</p>
                <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={3} autoFocus placeholder="例如:登录按钮在移动端溢出屏幕,请修复布局并补充回归测试" className="ds-focus-ring w-full resize-y rounded border border-workbench-border bg-workbench-surface p-2 text-xs leading-5 text-workbench-ink placeholder:text-workbench-subtle/70" />
                <div className="mt-2.5 flex justify-end gap-2">
                  <button type="button" disabled={busy} onClick={() => { setMode('idle'); setFeedback(''); }} className="ds-focus-ring inline-flex h-7 items-center rounded border border-workbench-border px-2.5 text-xs text-workbench-subtle hover:bg-workbench-muted disabled:opacity-50">取消</button>
                  <button type="button" disabled={busy || !feedback.trim()} onClick={() => void handleRework()} className="ds-focus-ring inline-flex h-7 items-center rounded bg-workbench-accent px-2.5 text-xs font-semibold text-white hover:brightness-95 disabled:opacity-50">{busy ? '提交中…' : '提交返工'}</button>
                </div>
              </div>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}
function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/** 任务卡回形针徽章的展开面板:列出附件,可下载/删除。 */
function TaskAttachmentsModal({ task, onClose, onChanged }: { task: Task; onClose: () => void; onChanged?: () => void }) {
  const [items, setItems] = useState<TaskAttachment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    kanbanApi.listAttachments(task.id)
      .then((list) => { if (alive) setItems(list); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [task.id]);

  const handleDelete = async (attachmentId: string) => {
    setBusyId(attachmentId);
    try {
      await kanbanApi.deleteAttachment(task.id, attachmentId);
      setItems((prev) => (prev ? prev.filter((a) => a.id !== attachmentId) : prev));
      toast.success('附件已删除');
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="ds-panel flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-workbench-border p-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-workbench-ink">附件 · REQ-{String(task.taskNumber).padStart(3, '0')}</h2>
            <p className="mt-0.5 truncate text-[10px] text-workbench-subtle" title={task.input ?? undefined}>{task.input?.trim() || task.taskTemplateName || `任务 #${task.taskNumber}`}</p>
          </div>
          <button type="button" onClick={onClose} className="ds-focus-ring rounded px-2 py-1 text-xs text-workbench-subtle hover:bg-workbench-muted">关闭</button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {error && <p className="rounded border border-workbench-danger/30 bg-workbench-danger/10 p-3 text-xs text-workbench-danger">{error}</p>}
          {!error && items === null && <p className="text-xs text-workbench-subtle">正在加载附件…</p>}
          {items?.length === 0 && <p className="rounded border border-dashed border-workbench-border p-4 text-center text-xs text-workbench-subtle">该任务还没有附件</p>}
          <ul className="space-y-1.5">
            {items?.map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded border border-workbench-border bg-workbench-surface px-2.5 py-2">
                <Paperclip className="size-3.5 flex-shrink-0 text-workbench-subtle" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-workbench-ink" title={a.filename}>{a.filename}</p>
                  <p className="ds-mono mt-0.5 text-[10px] text-workbench-subtle">{formatBytes(a.size)} · {new Date(a.createdAt).toLocaleString()}</p>
                </div>
                {(() => {
                  // 非 platform 模式下 <a> 直链带不了 Authorization,补 query token(SSE 同款通道)
                  const token = localStorage.getItem('auth-token');
                  const href = kanbanApi.attachmentDownloadUrl(task.id, a.id) + (token ? `?token=${encodeURIComponent(token)}` : '');
                  return <a href={href} download={a.filename} className="ds-focus-ring inline-flex h-7 flex-shrink-0 items-center gap-1 rounded border border-workbench-border bg-workbench-surface px-2 text-[11px] font-medium text-workbench-ink hover:bg-workbench-muted"><Download className="size-3" aria-hidden="true" />下载</a>;
                })()}
                <button type="button" disabled={busyId === a.id} onClick={() => void handleDelete(a.id)} title="删除附件" className="ds-focus-ring inline-flex size-7 flex-shrink-0 items-center justify-center rounded border border-transparent text-workbench-subtle hover:border-workbench-danger/30 hover:bg-workbench-danger/10 hover:text-workbench-danger disabled:opacity-50"><Trash2 className="size-3.5" aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function WorkflowTaskCard({ task, attachmentCount, onAdvance, onRetry, onCancel, onShowDeliverable, onOpenSession, onShowAttachments }: { task: DisplayTask; attachmentCount?: number; onAdvance?: () => void; onRetry?: (taskId: string, rootId: string) => void; onCancel?: (taskId: string, rootId: string) => void; onShowDeliverable?: (task: Task) => void; onOpenSession?: (task: Task) => void; onShowAttachments?: (task: Task) => void }) {
  return (
    <article
      className={`ds-surface-raised group rounded-md p-3 transition-colors hover:border-workbench-accent/60 ${task.status === 'failed' ? 'border-workbench-danger/60' : task.status === 'waiting' ? 'border-workbench-waiting/60' : ''}`}
      onDoubleClick={onAdvance}
    >
      <div className="flex items-center gap-1.5 overflow-hidden">
        <span className="ds-mono flex-shrink-0 text-[10px] text-workbench-subtle">REQ-{String(task.taskNumber).padStart(3, '0')}</span>
          <span className={`flex-shrink-0 rounded px-1 py-0.5 text-[10px] font-medium ${task.isBug ? 'bg-workbench-danger-soft text-workbench-danger' : 'bg-workbench-accent/10 text-workbench-accent'}`}>{task.isBug ? 'Bug' : '需求'}</span>
          {(attachmentCount ?? 0) > 0 && (onShowAttachments && task.source
            ? <button type="button" onClick={(e) => { e.stopPropagation(); onShowAttachments(task.source!); }} title="查看附件" className="ds-focus-ring flex flex-shrink-0 items-center gap-0.5 rounded bg-workbench-muted px-1 py-0.5 text-[10px] text-workbench-subtle transition-colors hover:bg-workbench-accent/10 hover:text-workbench-accent"><Paperclip className="size-3" aria-hidden="true" />{attachmentCount}</button>
            : <span className="flex flex-shrink-0 items-center gap-0.5 rounded bg-workbench-muted px-1 py-0.5 text-[10px] text-workbench-subtle" title="附件数"><Paperclip className="size-3" aria-hidden="true" />{attachmentCount}</span>)}
          {task.projectName && <span className="truncate rounded bg-workbench-muted px-1 py-0.5 text-[10px] text-workbench-subtle">{task.projectName}</span>}
        <WorkbenchStatus state={task.status} label={task.statusLabel} />
      </div>
      <h3 className="mt-1 line-clamp-2 break-all text-sm font-semibold leading-snug text-workbench-ink">{task.title}</h3>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-workbench-subtle">{task.detail}</p>
      {task.status === 'failed' && task.source?.auxFlags?.sessionError && <p className="mt-1 text-[11px] leading-4 text-workbench-danger">原因:{task.source.auxFlags.sessionError}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {task.tags.map((tag) => <span key={tag} className="ds-label rounded bg-workbench-muted px-1.5 py-0.5 normal-case tracking-normal">{tag}</span>)}
        <span className="ml-auto text-[10px] text-workbench-subtle">优先级 {task.priority}</span>
      </div>
      {task.status === 'complete' && task.source?.worktreeBranch && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onShowDeliverable?.(task.source!); }} className="ds-focus-ring mt-2 inline-flex h-7 items-center gap-1 rounded border border-workbench-border bg-workbench-surface px-2 text-[11px] font-medium text-workbench-ink hover:bg-workbench-muted">查看交付物</button>
      )}
      {task.status === 'running' && task.source?.providerSessionId && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onOpenSession?.(task.source!); }} className="ds-focus-ring mt-2 inline-flex h-7 items-center gap-1 rounded border border-workbench-border bg-workbench-surface px-2 text-[11px] font-medium text-workbench-ink hover:bg-workbench-muted"><MessageSquare className="size-3" />查看对话</button>
      )}
      {task.status === 'failed' && task.source && (
        <div className="mt-2 flex gap-1.5">
          <button type="button" onClick={(e) => { e.stopPropagation(); onRetry?.(task.source!.id, task.source!.rootId); }} className="ds-focus-ring inline-flex h-7 items-center gap-1 rounded border border-workbench-border bg-workbench-surface px-2 text-[11px] font-medium text-workbench-ink hover:bg-workbench-muted"><Play className="size-3" />重试此阶段</button>
          <button type="button" onClick={(e) => { e.stopPropagation(); onCancel?.(task.source!.id, task.source!.rootId); }} className="ds-focus-ring inline-flex h-7 items-center gap-1 rounded border border-workbench-border bg-workbench-surface px-2 text-[11px] text-workbench-subtle hover:bg-workbench-muted">取消</button>
        </div>
      )}
      {onAdvance && <p className="mt-2 text-[10px] text-workbench-subtle opacity-0 transition-opacity group-hover:opacity-100">双击推进阶段</p>}
    </article>
  );
}

function WorkflowRightRail({ schedules, agentRows }: { schedules: ReturnType<typeof useKanban>['schedules']; agentRows: AgentRow[] }) {
  return (
    <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start" aria-label="研发流程辅助信息">
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
  const navigate = useNavigate();
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
      // 附件计数(按任务聚合),失败不打扰看板
      fetch('/api/tasks/attachments-summary', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d) setAttachmentCounts(d.counts ?? {}); })
        .catch(() => {});
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
  /** 任务卡「查看对话」:解析任务的 agent 会话并跳到 /session/:id 实时观看。 */
  const openTaskSession = useCallback(async (task: Task) => {
    try {
      const session = await kanbanApi.getTaskSession(task.id, task.rootId);
      if (session?.appSessionId) {
        navigate(`/session/${session.appSessionId}`);
      } else {
        toast.error('还没找到该任务的对话会话(可能尚未建档)');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [navigate]);
  const tasks = allTasks;
  const [view, setView] = useState<'board' | 'list'>('board');
  const [showRules, setShowRules] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTemplateId] = useState<string>('');
  const [selectedProjectId] = useState<string>('');
  const [deliverableTask, setDeliverableTask] = useState<Task | null>(null);
  const [attachmentsTask, setAttachmentsTask] = useState<Task | null>(null);
  const [attachmentCounts, setAttachmentCounts] = useState<Record<string, number>>({});

  // 每个需求必须关联一个项目:默认当前项目,可切换到其它项目(任务落到
  // 该项目的看板/工作树)。rootId 决定 agent 的工作目录。
  const targetProjectId = selectedProjectId || (selectableProjects[0]?.projectId ?? '');

  // Columns follow the active template's real stages; WORKFLOW_STAGES is only
  // a fallback for the brief window before templates load.
  const activeTemplate = templates.find((t) => t.id === selectedTemplateId) ?? templates[0] ?? null;
  const stageNames = useMemo(
    () => activeTemplate?.stages.map((s) => s.snapshot.name) ?? [...WORKFLOW_STAGES],
    [activeTemplate],
  );
  const liveTasks = useMemo(() => tasks.filter((task) => task.status !== 'cancelled').map((task) => displayTask(task, stageNames.length, projects)), [projects, stageNames, tasks]);
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
      {showCreate && (
        <CreateTaskCard
          projects={selectableProjects}
          templates={templates}
          defaultProjectId={targetProjectId}
          onClose={() => setShowCreate(false)}
          onCreate={async (input, projectId, templateId, priority, taskType, files) => {
            const created = await createTask(templateId, input, { rootId: projectId, priority, taskType });
            if (created && files && files.length > 0) {
              for (const file of files) {
                try {
                  await kanbanApi.uploadAttachment(created.id, file.name, file);
                  toast.success(`附件已上传:${file.name}`);
                } catch (e) {
                  toast.error(`附件上传失败:${file.name} — ${e instanceof Error ? e.message : String(e)}`);
                }
              }
            }
            const label = selectableProjects.find((p) => p.projectId === projectId)?.displayName ?? '';
            toast.success(taskType === 'bug'
              ? `Bug 已创建到「${label || projectName}」,agent 开始复现排查`
              : `已创建到「${label || projectName}」的需求设计列`);
            await refreshAll();
          }}
        />
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <main className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2 text-xs text-workbench-subtle"><FilterChip label="看板" active={view === 'board'} onClick={() => setView('board')} /><FilterChip label="列表" active={view === 'list'} onClick={() => setView('list')} />{liveTasks.length === 0 && !loading && <span className="rounded bg-workbench-muted px-2 py-1">还没有任务 · 点右上角「创建任务」开始</span>}</div><div className="flex items-center gap-3 text-xs text-workbench-subtle"><span className="flex items-center gap-1"><CircleDot className="size-3 text-workbench-accent" />AI 运行中</span><span className="flex items-center gap-1"><CircleDot className="size-3 text-workbench-waiting" />等负责人</span><span className="flex items-center gap-1"><CircleDot className="size-3 text-workbench-danger" />验证失败</span><span className="flex items-center gap-1"><CircleDot className="size-3 text-workbench-success" />已交付</span></div></div>
          {error && <p className="bg-workbench-danger-soft/30 mb-3 rounded-md border border-workbench-danger/30 p-3 text-sm text-workbench-danger">加载任务失败：{error}</p>}
          {loading && <p className="mb-3 text-sm text-workbench-subtle">正在加载看板数据…</p>}
          {view === 'board' ? (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {columns.map((column, index0) => (
                <section key={column.name} className="ds-panel flex min-h-[520px] w-56 shrink-0 grow flex-col" aria-label={column.name}>
                  <header className="ds-panel-header"><h2 className="flex-1 text-sm font-semibold text-workbench-ink">{column.name}</h2><span className="ds-mono rounded bg-workbench-muted px-1.5 py-0.5 text-[10px] text-workbench-subtle">{column.tasks.length}</span></header>
                  <div className="flex flex-1 flex-col space-y-2 overflow-auto p-2">
                    {column.tasks.length === 0 ? (
                      <p className="py-8 text-center text-xs text-workbench-subtle">暂无任务</p>
                    ) : (
                      <>
                        {column.tasks.map((task) => (
                          <WorkflowTaskCard key={task.id} task={task} onAdvance={task.source ? () => void moveTask(task.source!.id, 'next', task.source!.rootId).then(refreshAll) : undefined} onRetry={task.source ? (id, rid) => { void kanbanApi.retryTask(id, rid).then(refreshAll).then(() => toast.success('已重试，任务重新排队')).catch((e) => toast.error(e instanceof Error ? e.message : String(e))); } : undefined} onShowDeliverable={task.source ? (src) => setDeliverableTask(src) : undefined} onOpenSession={task.source ? (src) => void openTaskSession(src) : undefined} onShowAttachments={task.source ? (src) => setAttachmentsTask(src) : undefined} onCancel={task.source ? (id, rid) => { void kanbanApi.move(id, rid, 'cancel').then(refreshAll).then(() => toast.success('任务已取消')).catch((e) => toast.error(e instanceof Error ? e.message : String(e))); } : undefined} attachmentCount={attachmentCounts[task.id]} />
                        ))}
                      </>
                    )}
                    {(index0 === 0 && column.name === stageNames[0]) && (
                      <button type="button" onClick={() => setShowCreate(true)} className="ds-focus-ring mt-auto flex w-full flex-col items-center gap-1 rounded-md border border-dashed border-workbench-border py-3 text-xs text-workbench-subtle transition-colors hover:border-workbench-accent/60 hover:text-workbench-accent">
                        <Plus className="size-4" aria-hidden="true" />新建需求
                      </button>
                    )}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <section className="ds-panel overflow-hidden" aria-label="任务列表">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-workbench-border bg-workbench-muted/50 text-xs text-workbench-subtle"><tr><th className="px-3 py-2 font-medium">编号</th><th className="px-3 py-2 font-medium">任务</th><th className="px-3 py-2 font-medium">阶段</th><th className="px-3 py-2 font-medium">优先级</th><th className="px-3 py-2 font-medium">状态</th></tr></thead>
                <tbody>
                  {liveTasks.map((task) => (
                    <tr key={task.id} className="border-b border-workbench-border/60 last:border-0 hover:bg-workbench-muted/50">
                      <td className="ds-mono px-3 py-2 text-workbench-subtle">REQ-{String(task.taskNumber).padStart(3, '0')}</td>
                      <td className="max-w-md truncate px-3 py-2 text-workbench-ink">{task.title}</td>
                      <td className="px-3 py-2 text-workbench-subtle">{stageNames[task.stageIndex] ?? task.stageIndex}</td>
                      <td className="px-3 py-2 text-workbench-subtle">{task.priority}</td>
                      <td className="px-3 py-2"><WorkbenchStatus state={task.status} label={task.statusLabel} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          <div className="mt-3 flex items-center gap-4 text-xs text-workbench-subtle"><span className="flex items-center gap-1.5"><KanbanSquare className="size-3.5" aria-hidden="true" />任务按工程阶段推进</span><span className="flex items-center gap-1.5"><List className="size-3.5" aria-hidden="true" />列表视图用于快速扫描全量任务</span></div>
        </main>
        <WorkflowRightRail schedules={schedules} agentRows={agentRows} />
      </div>
      {deliverableTask && <DeliverablePanel task={deliverableTask} onClose={() => setDeliverableTask(null)} onChanged={() => void refreshAll()} />}
      {attachmentsTask && <TaskAttachmentsModal task={attachmentsTask} onClose={() => setAttachmentsTask(null)} onChanged={() => void refreshAll()} />}
    </PageShell>
  );
}
