import { useState } from 'react';
import { Card } from '@/shared/view/ui';
import type { Task } from './types';
import { AuxBadges, statusStyle } from './badges';
import { TaskDetailModal } from './TaskDetailModal';

export function TaskCard({ task }: { task: Task }) {
  const [open, setOpen] = useState(false);
  const s = statusStyle(task.status);
  return (
    <>
      <Card
        className="cursor-pointer p-2 text-xs hover:border-primary/40"
        onClick={() => setOpen(true)}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">#{task.taskNumber}</span>
          <span className={`flex items-center gap-1 ${s.text}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot}`} />
            {s.label}
          </span>
        </div>
        <div className="mt-1 text-muted-foreground">
          {task.taskTemplateName ?? task.taskTemplateId}
        </div>
        <div className="mt-1">
          <AuxBadges flags={task.auxFlags} />
        </div>
        {task.auxFlags.sessionError && (
          <div
            className="mt-1 truncate text-destructive"
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
