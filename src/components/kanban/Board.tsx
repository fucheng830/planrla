import { useTranslation } from 'react-i18next';
import { useKanban } from './KanbanContext';
import { StageColumn } from './StageColumn';
import { TaskCard } from './TaskCard';

export function Board() {
  const { t } = useTranslation('kanban');
  const { tasks, templatesById } = useKanban();

  if (tasks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('board.emptyTasks')}
      </div>
    );
  }
  // v1: single board uses the template of the most recent task (kanban is
  // single-template-per-board initially). Multi-template boards can union
  // columns later.
  const tplId = tasks[0].taskTemplateId;
  const tpl = templatesById.get(tplId);
  if (!tpl) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {t('board.templateNotFound')}
      </div>
    );
  }

  const stages = tpl.stages;
  const byStage: Record<number, typeof tasks> = {};
  for (const t of tasks) {
    const i = Math.max(0, Math.min(stages.length - 1, t.currentStageIndex));
    (byStage[i] ??= []).push(t);
  }

  return (
    <div className="flex h-full overflow-x-auto">
      {stages.map((s, i) => (
        <StageColumn key={s.id} stage={s.snapshot} index={i}>
          {(byStage[i] ?? []).map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
        </StageColumn>
      ))}
    </div>
  );
}
