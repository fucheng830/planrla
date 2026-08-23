import { useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/shared/view/ui';
import type { Task } from './types';
import { AuxBadges, statusStyle } from './badges';
import { TaskDetailModal } from './TaskDetailModal';
import { useKanban } from './KanbanContext';

export function TaskCard({ task }: { task: Task }) {
  const { t } = useTranslation('kanban');
  const { moveTask, templatesById, tasksById } = useKanban();
  const [open, setOpen] = useState(false);
  const s = statusStyle(task.status);
  const isDone = task.status === 'success' || task.status === 'cancelled';
  const tpl = templatesById.get(task.taskTemplateId);
  const totalStages = tpl?.stages.length ?? 0;
  // TaskMaster-style blocked indicator: dependencies that haven't succeeded
  // yet. Derived client-side from the synced board (the server gates
  // scheduling on the same rule), so it updates live via WebSocket.
  const blockers = (task.dependencies ?? [])
    .map((id) => tasksById.get(id))
    .filter((dep): dep is Task => Boolean(dep) && dep!.status !== 'success');
  const isTerminal = task.status === 'success' || task.status === 'fail' || task.status === 'cancelled';
  const blockedBy = !isTerminal ? blockers : [];

  const handleMove = (e: MouseEvent, action: string) => {
    e.stopPropagation();
    void moveTask(task.id, action);
  };

  return (
    <>
      <Card
        className={`group relative cursor-pointer rounded-md border border-workbench-border bg-workbench-surface p-2.5 text-xs transition-colors hover:border-workbench-accent/50 ${isDone ? 'opacity-50' : ''}`}
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
          <span className="ds-status ds-status-waiting absolute right-2.5 top-2.5">
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
        <div className="mt-1 line-clamp-2 font-medium text-workbench-ink">
          {task.taskTemplateName || `#${task.taskNumber}`}
        </div>

        {/* Row 3: template chip + stage progress + priority */}
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {task.taskTemplateName && (
            <span className="rounded bg-muted px-1 py-0.5">{task.taskTemplateName}</span>
          )}
          {totalStages > 0 && (
            <span>{task.currentStageIndex + 1}/{totalStages}</span>
          )}
          {task.priority && task.priority !== 'medium' && (
            <span
              className={`rounded px-1 py-0.5 font-medium ${
                task.priority === 'high'
                  ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                  : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
              }`}
            >
              {t(`priority.${task.priority}`)}
            </span>
          )}
          {blockedBy.length > 0 && (
            <span
              className="rounded bg-amber-500/10 px-1 py-0.5 font-medium text-amber-600 dark:text-amber-400"
              title={blockedBy.map((b) => `#${b.taskNumber}`).join(', ')}
            >
              {t('blocked.badge', { ids: blockedBy.map((b) => `#${b.taskNumber}`).join(', ') })}
            </span>
          )}
        </div>

        {/* 待答复 CTA (REQ-038) */}
        {task.auxFlags.askUserWaiting && (
          <div className="mt-1 text-[11px] font-medium text-workbench-waiting">
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
