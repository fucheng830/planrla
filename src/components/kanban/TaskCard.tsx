import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/shared/view/ui';
import type { Task } from './types';
import { AuxBadges, statusStyle } from './badges';
import { TaskDetailModal } from './TaskDetailModal';

export function TaskCard({ task }: { task: Task }) {
  const { t } = useTranslation('kanban');
  const [open, setOpen] = useState(false);
  const s = statusStyle(task.status);
  return (
    <>
      <Card
        className="relative cursor-pointer rounded-[10px] p-2.5 text-xs hover:border-primary/40"
        onClick={() => setOpen(true)}
      >
        {task.auxFlags.askUserWaiting && (
          <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-purple-600 dark:text-purple-400">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-purple-500" />
            {t('aux.asking')}
          </span>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono font-semibold">#{task.taskNumber}</span>
          <span className={`flex items-center gap-1 ${s.text}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot}`} />
            {t(`status.${s.labelKey}`)}
          </span>
        </div>
        <div className="mt-1 truncate text-muted-foreground">
          {task.taskTemplateName ?? task.taskTemplateId}
        </div>
        <div className="mt-1">
          <AuxBadges flags={task.auxFlags} />
        </div>
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
