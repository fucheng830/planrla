import { useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/shared/view/ui';
import type { Task } from './types';
import { AuxBadges, statusStyle } from './badges';
import { TaskDetailModal } from './TaskDetailModal';
import { useKanban } from './KanbanContext';

export function TaskCard({ task }: { task: Task }) {
  const { t } = useTranslation('kanban');
  const { moveTask, templatesById } = useKanban();
  const [open, setOpen] = useState(false);
  const s = statusStyle(task.status);
  const isDone = task.status === 'success' || task.status === 'cancelled';
  const tpl = templatesById.get(task.taskTemplateId);
  const totalStages = tpl?.stages.length ?? 0;

  const handleMove = (e: MouseEvent, action: string) => {
    e.stopPropagation();
    void moveTask(task.id, action);
  };

  return (
    <>
      <Card
        className={`group relative cursor-pointer rounded-[10px] p-2.5 text-xs transition-all hover:border-primary/40 ${isDone ? 'opacity-50' : ''}`}
        onClick={() => setOpen(true)}
      >
        {/* Hover quick-move buttons (no modal needed) */}
        {!isDone && (
          <div className="absolute right-1 top-1 z-10 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            {task.currentStageIndex > 0 && (
              <button
                type="button"
                onClick={(e) => handleMove(e, 'prev')}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-primary/15 hover:text-primary"
                title={t('detail.prev')}
              >‹</button>
            )}
            <button
              type="button"
              onClick={(e) => handleMove(e, 'next')}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-primary/15 hover:text-primary"
              title={t('detail.next')}
            >›</button>
          </div>
        )}

        {/* 待答复 badge */}
        {task.auxFlags.askUserWaiting && (
          <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-purple-600 dark:text-purple-400">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-purple-500" />
            {t('aux.asking')}
          </span>
        )}

        {/* Row 1: #number + status */}
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono font-semibold">#{task.taskNumber}</span>
          <span className={`flex items-center gap-1 ${s.text}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot}`} />
            {t(`status.${s.labelKey}`)}
          </span>
        </div>

        {/* Row 2: TASK CONTENT (input, not template name) */}
        <div className="mt-1 line-clamp-2 font-medium text-foreground">
          {task.taskTemplateName || `#${task.taskNumber}`}
        </div>

        {/* Row 3: template chip + stage progress */}
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {task.taskTemplateName && (
            <span className="rounded bg-muted px-1 py-0.5">{task.taskTemplateName}</span>
          )}
          {totalStages > 0 && (
            <span>{task.currentStageIndex + 1}/{totalStages}</span>
          )}
        </div>

        {/* 待答复 CTA (REQ-038) */}
        {task.auxFlags.askUserWaiting && (
          <div className="mt-1 text-[11px] font-medium text-purple-600 dark:text-purple-400">
            {t('answer.cta')}
          </div>
        )}

        {/* AuxBadges */}
        <div className="mt-1">
          <AuxBadges flags={task.auxFlags} />
        </div>

        {/* sessionError */}
        {task.auxFlags.sessionError && (
          <div
            className="mt-1.5 truncate rounded border border-destructive/20 bg-destructive/10 px-1.5 py-0.5 font-mono text-destructive"
            title={task.auxFlags.sessionError}
          >
            {task.auxFlags.sessionError}
          </div>
        )}
      </Card>
      {open && <TaskDetailModal task={task} onClose={() => setOpen(false)} />}
    </>
  );
}
