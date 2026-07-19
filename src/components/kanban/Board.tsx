import { useTranslation } from 'react-i18next';

import { useKanban } from './KanbanContext';
import { StageColumn } from './StageColumn';
import { TaskCard } from './TaskCard';
import type { Task, TaskTemplate } from './types';

function TemplateSection({ tpl, tasks }: { tpl: TaskTemplate; tasks: Task[] }) {
  const { t } = useTranslation('kanban');
  const stages = tpl.stages;
  const byStage: Record<number, Task[]> = {};
  for (const task of tasks) {
    const i = Math.max(0, Math.min(stages.length - 1, task.currentStageIndex));
    (byStage[i] ??= []).push(task);
  }

  return (
    <section className="flex h-full flex-col">
      <header className="px-3 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {tpl.name}
      </header>
      <div className="flex min-h-0 flex-1 overflow-x-auto">
        {stages.map((s, i) => {
          const colTasks = byStage[i] ?? [];
          return (
            <StageColumn key={s.id} stage={s.snapshot} index={i}>
              {colTasks.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/50 py-4 text-center text-[11px] text-muted-foreground/50">
                  {t('board.emptyColumn')}
                </div>
              ) : (
                colTasks.map((tk) => <TaskCard key={tk.id} task={tk} />)
              )}
            </StageColumn>
          );
        })}
      </div>
    </section>
  );
}

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

  // Multi-template board: group tasks by template and render one stage-column
  // section per template (columns are template-specific, so a union view would
  // be misleading). Group order follows the task list (most recently updated
  // template first).
  const groups: { tplId: string; tasks: Task[] }[] = [];
  const groupIndexByTplId = new Map<string, number>();
  for (const task of tasks) {
    const existing = groupIndexByTplId.get(task.taskTemplateId);
    if (existing === undefined) {
      groupIndexByTplId.set(task.taskTemplateId, groups.length);
      groups.push({ tplId: task.taskTemplateId, tasks: [task] });
    } else {
      groups[existing].tasks.push(task);
    }
  }

  const resolved = groups.filter((g) => templatesById.get(g.tplId));
  const missing = groups.filter((g) => !templatesById.get(g.tplId));

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-1">
      {resolved.map((g) => (
        <TemplateSection key={g.tplId} tpl={templatesById.get(g.tplId)!} tasks={g.tasks} />
      ))}
      {missing.length > 0 && (
        <div className="p-4 text-sm text-muted-foreground">
          {t('board.templateNotFound')}
          {missing.map((g) => (
            <div key={g.tplId} className="mt-2 flex flex-wrap gap-2">
              {g.tasks.map((tk) => (
                <TaskCard key={tk.id} task={tk} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
