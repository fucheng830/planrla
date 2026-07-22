import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useKanban } from './KanbanContext';
import { AuxBadges, statusStyle } from './badges';
import { kanbanApi } from './api';
import GitDiffViewer from '../git-panel/view/shared/GitDiffViewer';
import type { PendingAskUserQuestion, StageRun, Task, TaskDiffResult, TaskEvent } from './types';

import { Dialog, DialogContent, DialogTitle, Button } from '@/shared/view/ui';

export function TaskDetailModal({
  task,
  onClose,
}: {
  task: Task;
  onClose: () => void;
}) {
  const { t } = useTranslation('kanban');
  const { templatesById, moveTask, jumpTask, deleteTask, rootId, refresh } = useKanban();
  const tpl = templatesById.get(task.taskTemplateId);
  const s = statusStyle(task.status);
  const isTerminal =
    task.status === 'success' ||
    task.status === 'fail' ||
    task.status === 'cancelled';
  const stage = tpl?.stages[task.currentStageIndex]?.snapshot;
  const isAgentStage = stage?.role === 'agent';

  // Review loop: worktree diff view + reviewer comment back to the agent.
  const [showDiff, setShowDiff] = useState(false);
  const [diff, setDiff] = useState<TaskDiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSent, setReviewSent] = useState(false);

  // TaskMaster expand_task analogue: two-step button, decomposes this task
  // into follow-up tasks that replace it (original is cancelled server-side).
  const [expandState, setExpandState] = useState<'idle' | 'confirm' | 'running' | 'done' | 'error'>('idle');
  const [expandInfo, setExpandInfo] = useState<string | null>(null);
  const onExpand = async () => {
    if (!rootId || isTerminal) return;
    if (expandState === 'idle') {
      setExpandState('confirm');
      return;
    }
    setExpandState('running');
    setExpandInfo(null);
    try {
      const { created } = await kanbanApi.expandTask(task.id, rootId);
      setExpandState('done');
      setExpandInfo(t('expand.done', { ids: created.map((c) => `#${c.taskNumber}`).join(', ') }));
      await refresh();
    } catch (e: unknown) {
      setExpandState('error');
      setExpandInfo(e instanceof Error ? e.message : String(e));
    }
  };
  const [showTimeline, setShowTimeline] = useState(false);
  const [timeline, setTimeline] = useState<{ runs: StageRun[]; events: TaskEvent[] } | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const onToggleTimeline = async () => {
    if (showTimeline) {
      setShowTimeline(false);
      return;
    }
    setShowTimeline(true);
    if (timeline || timelineLoading || !rootId) return;
    setTimelineLoading(true);
    try {
      setTimeline(await kanbanApi.getTaskTimeline(task.id, rootId));
    } catch {
      // 失败时保持空态,下次展开重试
    } finally {
      setTimelineLoading(false);
    }
  };

  const onToggleDiff = async () => {
    if (showDiff) {
      setShowDiff(false);
      return;
    }
    setShowDiff(true);
    if (diff || diffLoading || !rootId) return;
    setDiffLoading(true);
    setDiffError(null);
    try {
      setDiff(await kanbanApi.getTaskDiff(task.id, rootId));
    } catch (e: unknown) {
      setDiffError(e instanceof Error ? e.message : String(e));
    } finally {
      setDiffLoading(false);
    }
  };

  const onSubmitReview = async () => {
    if (!rootId || !comment.trim() || reviewSubmitting) return;
    setReviewSubmitting(true);
    setReviewError(null);
    try {
      await kanbanApi.submitReview(task.id, rootId, comment.trim());
      setReviewSent(true);
      setComment('');
    } catch (e: unknown) {
      setReviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setReviewSubmitting(false);
    }
  };

  // REQ-038: inline AskUserQuestion answering.
  const pending = task.auxFlags.pendingAskUser ?? null;
  const questions: PendingAskUserQuestion[] = useMemo(
    () => pending?.questions?.questions ?? [],
    [pending],
  );
  // first question only (AskUserQuestion commonly carries one); multi-select
  // picks a Set of labels, single-select picks one label.
  const q0 = questions[0];
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const toggle = (label: string) => {
    if (!q0?.multiSelect) {
      setSelected([label]);
      return;
    }
    setSelected((prev) =>
      prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label],
    );
  };

  const onSubmitAnswer = async () => {
    if (!rootId || !pending || !q0) return;
    setSubmitting(true);
    try {
      await kanbanApi.answerTask(task.id, rootId, { answers: selected });
      await refresh();
      onClose();
    } catch {
      // refresh surfaces the error via context; keep modal open on failure
    } finally {
      setSubmitting(false);
    }
  };

  const onMove = (action: string) => {
    void moveTask(task.id, action);
  };
  const onJump = (target: number) => {
    void jumpTask(task.id, target);
  };
  const onDelete = async () => {
    if (!window.confirm(t('detail.deleteConfirm', { number: task.taskNumber }))) {
      return;
    }
    await deleteTask(task.id);
    onClose();
  };

  const MoveBtn = ({
    action,
    label,
    disabled,
  }: {
    action: string;
    label: string;
    disabled?: boolean;
  }) => (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled || isTerminal}
      onClick={() => onMove(action)}
    >
      {label}
    </Button>
  );

  const stageLabel = stage
    ? stage.agent
      ? t('detail.stageLabel', {
          i: task.currentStageIndex,
          name: stage.name,
          role: t(`role.${stage.role}`),
          agent: stage.agent,
        })
      : t('detail.stageLabelNoAgent', {
          i: task.currentStageIndex,
          name: stage.name,
          role: t(`role.${stage.role}`),
        })
    : '';

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-xl p-6">
        <DialogTitle className="sr-only">
          {t('detail.task')} #{task.taskNumber}
        </DialogTitle>
        <div className="space-y-3">
          {pending && q0 && (
            <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-400">
                {t('answer.title')}
              </div>
              {q0.header && (
                <div className="text-sm font-medium">{q0.header}</div>
              )}
              {q0.question && (
                <div className="text-sm text-muted-foreground">{q0.question}</div>
              )}
              {q0.options && q0.options.length > 0 ? (
                <div className="mt-2 space-y-1">
                  {q0.options.map((opt, i) => {
                    const label = opt.label ?? String(i);
                    const active = selected.includes(label);
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => toggle(label)}
                        className={`w-full rounded border px-2 py-1 text-left text-xs transition-colors ${
                          active
                            ? 'border-purple-500 bg-purple-500/10 text-purple-700 dark:text-purple-300'
                            : 'border-border hover:border-purple-500/40'
                        }`}
                      >
                        <span className="font-medium">{label}</span>
                        {opt.description && (
                          <span className="ml-1 text-muted-foreground">
                            — {opt.description}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-1 text-xs italic text-muted-foreground">
                  {t('answer.noOptions')}
                </div>
              )}
              <div className="mt-2">
                <Button
                  size="sm"
                  onClick={onSubmitAnswer}
                  disabled={submitting || selected.length === 0}
                >
                  {submitting ? t('answer.submitting') : t('answer.submit')}
                </Button>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">
              {t('detail.task')} #{task.taskNumber}
            </h2>
            <span className={`flex items-center gap-1 ${s.text}`}>
              <span
                className={`inline-block h-2 w-2 rounded-full ${s.dot}`}
              />
              {t(`status.${s.labelKey}`)}
            </span>
          </div>
          <div className="text-sm font-medium text-foreground">
            {task.taskTemplateName || `#${task.taskNumber}`}
          </div>
          {stageLabel && (
            <div className="text-xs text-muted-foreground">{stageLabel}</div>
          )}
          <AuxBadges flags={task.auxFlags} />
          {task.auxFlags.sessionError && (
            <div className="rounded bg-destructive/10 p-2 font-mono text-xs text-destructive">
              {task.auxFlags.sessionError}
            </div>
          )}
          {task.worktreePath && (
            <div
              className="truncate rounded border border-border bg-card p-1.5 font-mono text-[11px] text-muted-foreground"
              title={task.worktreePath}
            >
              {task.worktreePath}
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            <MoveBtn
              action="prev"
              label={`← ${t('detail.prev')}`}
              disabled={task.currentStageIndex <= 0}
            />
            <MoveBtn action="next" label={`${t('detail.next')} →`} />
            <MoveBtn
              action="pause"
              label={t('detail.pause')}
              disabled={
                task.status !== 'running' && task.status !== 'queued'
              }
            />
            <MoveBtn
              action="resume"
              label={t('detail.resume')}
              disabled={task.status !== 'paused'}
            />
            <MoveBtn action="complete" label={`✓ ${t('detail.complete')}`} />
            <MoveBtn action="cancel" label={t('detail.cancel')} />
            {!isTerminal && (
              <Button
                size="sm"
                variant="outline"
                disabled={expandState === 'running'}
                onClick={() => void onExpand()}
                title={t('expand.hint')}
              >
                {expandState === 'confirm'
                  ? t('expand.confirm')
                  : expandState === 'running'
                    ? t('expand.running')
                    : t('expand.button')}
              </Button>
            )}
            <Button size="sm" variant="destructive" onClick={() => void onDelete()}>
              {t('detail.delete')}
            </Button>
          </div>
          {expandInfo && (
            <div className={`text-xs ${expandState === 'error' ? 'text-destructive' : 'text-green-600 dark:text-green-400'}`}>
              {expandInfo}
            </div>
          )}
          {(task.worktreePath || (isAgentStage && !isTerminal)) && (
            <div className="space-y-2 border-t border-border pt-3">
              {task.worktreePath && (
                <div>
                  <Button size="sm" variant="outline" onClick={() => void onToggleDiff()}>
                    {showDiff ? t('review.hideDiff') : t('review.showDiff')}
                  </Button>
                  {showDiff && (
                    <div className="mt-2 max-h-72 overflow-y-auto rounded border border-border">
                      {diffLoading && (
                        <div className="p-3 text-xs text-muted-foreground">
                          {t('review.diffLoading')}
                        </div>
                      )}
                      {diffError && (
                        <div className="p-3 text-xs text-destructive">{diffError}</div>
                      )}
                      {diff && (
                        <>
                          {diff.files.length > 0 && (
                            <div className="border-b border-border p-2 text-[11px] text-muted-foreground">
                              {diff.files
                                .map((f) => `${f.path} +${f.additions}/-${f.deletions}`)
                                .join(' · ')}
                            </div>
                          )}
                          {diff.patch ? (
                            <GitDiffViewer diff={diff.patch} isMobile={false} wrapText={false} />
                          ) : (
                            <div className="p-3 text-xs text-muted-foreground">
                              {t('review.diffEmpty')}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
              {isAgentStage && !isTerminal && (
                <div className="space-y-2">
                  <textarea
                    className="h-20 w-full resize-none rounded border border-border bg-background p-2 text-xs"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder={t('review.placeholder')}
                    disabled={reviewSubmitting}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      disabled={!comment.trim() || reviewSubmitting}
                      onClick={() => void onSubmitReview()}
                    >
                      {reviewSubmitting ? t('review.submitting') : t('review.submit')}
                    </Button>
                    {reviewSent && !reviewError && (
                      <span className="text-xs text-green-600 dark:text-green-400">
                        {t('review.sent')}
                      </span>
                    )}
                    {reviewError && (
                      <span className="text-xs text-destructive">{reviewError}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="border-t border-border pt-3">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => void onToggleTimeline()}
            >
              {showTimeline ? '▾ ' : '▸ '}
              {t('timeline.title')}
            </button>
            {showTimeline && (
              <div className="mt-2 max-h-48 space-y-1 overflow-y-auto text-[11px]">
                {timelineLoading && (
                  <div className="text-muted-foreground">{t('timeline.loading')}</div>
                )}
                {!timelineLoading && timeline && timeline.runs.length === 0 && (
                  <div className="text-muted-foreground">{t('timeline.empty')}</div>
                )}
                {!timelineLoading &&
                  timeline?.runs.map((run) => (
                    <div key={run.id} className="flex items-center gap-2">
                      <span className="font-mono text-muted-foreground">{run.stageIndex}</span>
                      <span className="font-medium">{run.stageName}</span>
                      <span className="text-muted-foreground">{t(`role.${run.role}`)}</span>
                      <span>{t(`status.${run.status}`)}</span>
                      <span className="ml-auto text-muted-foreground">
                        {run.startedAt ? new Date(run.startedAt).toLocaleTimeString() : ''}
                        {run.finishedAt ? ` → ${new Date(run.finishedAt).toLocaleTimeString()}` : ''}
                      </span>
                    </div>
                  ))}
                {!timelineLoading && timeline && timeline.events.length > 0 && (
                  <>
                    <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('timeline.events')}
                    </div>
                    {timeline.events.map((ev) => (
                      <div key={ev.id} className="flex items-center gap-2">
                        <span>{t(`events.${ev.type}`, { defaultValue: ev.type })}</span>
                        <span className="ml-auto text-muted-foreground">
                          {new Date(ev.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
          {tpl && (
            <div className="border-t border-border pt-3">
              <div className="mb-2 text-xs text-muted-foreground">
                {t('detail.jumpToStage')}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tpl.stages.map((st, i) => (
                  <Button
                    key={st.id}
                    size="sm"
                    variant={i === task.currentStageIndex ? 'default' : 'outline'}
                    disabled={i === task.currentStageIndex || isTerminal}
                    onClick={() => onJump(i)}
                  >
                    <span className="mr-1 font-mono text-[10px] opacity-70">
                      {i}
                    </span>
                    {st.snapshot.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
