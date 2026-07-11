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

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-xl p-6">
        <DialogTitle className="sr-only">Task #{task.taskNumber}</DialogTitle>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Task #{task.taskNumber}</h2>
            <span className={`flex items-center gap-1 ${s.text}`}>
              <span
                className={`inline-block h-2 w-2 rounded-full ${s.dot}`}
              />
              {s.label}
            </span>
          </div>
          <div className="text-sm text-muted-foreground">
            {task.taskTemplateName ?? task.taskTemplateId}
          </div>
          <div className="text-xs text-muted-foreground">
            Stage {task.currentStageIndex}
            {stage
              ? ` · ${stage.name} (${stage.role}${
                  stage.agent ? `/${stage.agent}` : ''
                })`
              : ''}
          </div>
          <AuxBadges flags={task.auxFlags} />
          {task.auxFlags.sessionError && (
            <div className="rounded bg-destructive/10 p-2 text-xs text-destructive">
              {task.auxFlags.sessionError}
            </div>
          )}
          {task.worktreePath && (
            <div
              className="truncate text-[11px] text-muted-foreground"
              title={task.worktreePath}
            >
              wt: {task.worktreePath}
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            <MoveBtn
              action="prev"
              label="← Prev"
              disabled={task.currentStageIndex <= 0}
            />
            <MoveBtn action="next" label="Next →" />
            <MoveBtn
              action="pause"
              label="Pause"
              disabled={
                task.status !== 'running' && task.status !== 'queued'
              }
            />
            <MoveBtn
              action="resume"
              label="Resume"
              disabled={task.status !== 'paused'}
            />
            <MoveBtn action="complete" label="Complete" />
            <MoveBtn action="cancel" label="Cancel" />
          </div>
          {tpl && (
            <div className="pt-2">
              <div className="mb-1 text-xs font-medium">Jump to stage</div>
              <div className="flex flex-wrap gap-1">
                {tpl.stages.map((st, i) => (
                  <Button
                    key={st.id}
                    size="sm"
                    variant={i === task.currentStageIndex ? 'default' : 'ghost'}
                    disabled={i === task.currentStageIndex || isTerminal}
                    onClick={() => onJump(i)}
                  >
                    {i}: {st.snapshot.name}
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
