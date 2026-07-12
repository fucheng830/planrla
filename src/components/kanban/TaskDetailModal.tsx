import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogTitle, Button } from '@/shared/view/ui';
import { useKanban } from './KanbanContext';
import { AuxBadges, statusStyle } from './badges';
import type { Task } from './types';

export function TaskDetailModal({
  task,
  onClose,
}: {
  task: Task;
  onClose: () => void;
}) {
  const { t } = useTranslation('kanban');
  const { templatesById, moveTask, jumpTask } = useKanban();
  const tpl = templatesById.get(task.taskTemplateId);
  const s = statusStyle(task.status);
  const isTerminal =
    task.status === 'success' ||
    task.status === 'fail' ||
    task.status === 'cancelled';
  const stage = tpl?.stages[task.currentStageIndex]?.snapshot;

  const onMove = (action: string) => {
    void moveTask(task.id, action);
  };
  const onJump = (target: number) => {
    void jumpTask(task.id, target);
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
          <div className="text-sm text-muted-foreground">
            {task.taskTemplateName ?? task.taskTemplateId}
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
