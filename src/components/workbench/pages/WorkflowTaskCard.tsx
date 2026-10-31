import { Clock, MessageSquare, Paperclip, Play } from 'lucide-react';

import type { Task } from '@planrla/kanban';
import type { PendingAskUserQuestion } from '@planrla/kanban';
import { WorkbenchStatus } from '../WorkbenchStatus';

import { relativeTime, stageCtaLabel, type DisplayTask } from './workflowModel';

type WorkflowTaskCardProps = {
  task: DisplayTask;
  attachmentCount?: number;
  onAdvance?: () => void;
  onRetry?: (taskId: string, rootId: string) => void;
  onCancel?: (taskId: string, rootId: string) => void;
  onShowDeliverable?: (task: Task) => void;
  onOpenSession?: (task: Task) => void;
  onShowAttachments?: (task: Task) => void;
  onOpenAsk?: (task: Task) => void;
};

/** Kanban card with a single stage-aware primary CTA (确认需求 / 查看对话 /
 *  验收交付 …) and a relative-time footer — reference-board inspired. */
export function WorkflowTaskCard({ task, attachmentCount, onAdvance, onRetry, onCancel, onShowDeliverable, onOpenSession, onShowAttachments, onOpenAsk }: WorkflowTaskCardProps) {
  const pending = task.source?.auxFlags.pendingAskUser ?? null;
  const firstQuestion: PendingAskUserQuestion | undefined = pending?.questions?.questions?.[0];

  // One primary CTA per card, driven by status + stage. Secondary actions
  // (查看对话 / 取消) stay as quiet bordered buttons beside it.
  const cta = (() => {
    if (!task.source) return null;
    if (task.status === 'waiting') {
      const run = pending && onOpenAsk ? () => onOpenAsk(task.source!) : onAdvance;
      return run ? { label: stageCtaLabel(task.status, task.stageIndex), run, primary: true } : null;
    }
    if (task.status === 'failed' && onRetry) {
      return { label: '重试此阶段', run: () => onRetry(task.source!.id, task.source!.rootId), primary: true };
    }
    if (task.status === 'complete' && onShowDeliverable) {
      return { label: '验收交付', run: () => onShowDeliverable(task.source!), primary: true };
    }
    if (task.status === 'running' && onOpenSession && task.source.providerSessionId) {
      return { label: stageCtaLabel(task.status, task.stageIndex), run: () => onOpenSession(task.source!), primary: false };
    }
    if (task.status === 'running' && !task.source.providerSessionId && onAdvance) {
      return { label: '开始推进', run: onAdvance, primary: true };
    }
    return null;
  })();

  const ago = relativeTime(task.updatedAt);

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
      {pending && firstQuestion && onOpenAsk && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenAsk(task.source!); }}
          className="ds-focus-ring mt-2 w-full rounded border border-workbench-waiting/50 bg-workbench-waiting/10 px-2 py-1.5 text-left hover:bg-workbench-waiting/20"
        >
          <span className="block text-[11px] font-semibold text-workbench-waiting">AI 在等你回答</span>
          <span className="mt-0.5 line-clamp-2 block text-[11px] text-workbench-subtle">{firstQuestion.question ?? '点击查看并回答'}</span>
        </button>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {task.tags.map((tag) => <span key={tag} className="ds-label rounded bg-workbench-muted px-1.5 py-0.5 normal-case tracking-normal">{tag}</span>)}
        <span className="ml-auto text-[10px] text-workbench-subtle">优先级 {task.priority}</span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-workbench-border/60 pt-2.5">
        {ago ? (
          <span className="flex min-w-0 items-center gap-1 text-[10px] text-workbench-subtle" title={task.updatedAt}>
            <Clock className="size-3 flex-shrink-0" aria-hidden="true" />{ago}
          </span>
        ) : <span />}
        <span className="flex flex-shrink-0 items-center gap-1.5">
          {task.status === 'failed' && task.source && onCancel && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onCancel(task.source!.id, task.source!.rootId); }} className="ds-focus-ring inline-flex h-7 items-center rounded border border-workbench-border bg-workbench-surface px-2 text-[11px] text-workbench-subtle hover:bg-workbench-muted">取消</button>
          )}
          {cta && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); cta.run(); }}
              className={cta.primary
                ? 'ds-focus-ring inline-flex h-7 items-center gap-1 rounded bg-workbench-accent px-3 text-[11px] font-semibold text-white hover:brightness-95'
                : 'ds-focus-ring inline-flex h-7 items-center gap-1 rounded border border-workbench-border bg-workbench-surface px-2 text-[11px] font-medium text-workbench-ink hover:bg-workbench-muted'}
            >
              {cta.primary && task.status === 'failed' && <Play className="size-3" />}
              {!cta.primary && <MessageSquare className="size-3" />}
              {cta.label}
            </button>
          )}
        </span>
      </div>
    </article>
  );
}
