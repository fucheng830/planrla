import { Card } from '@/shared/view/ui';
import type { Task } from './types';
import { AuxBadges, statusStyle } from './badges';

// MINIMAL version — T5 will enhance with onClick modal + more detail.
export function TaskCard({ task }: { task: Task }) {
  const s = statusStyle(task.status);
  return (
    <Card className="p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">#{task.taskNumber}</span>
        <span className={`flex items-center gap-1 ${s.text}`}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot}`} />
          {s.label}
        </span>
      </div>
      <div className="mt-1 text-muted-foreground">{task.taskTemplateName ?? task.taskTemplateId}</div>
      <div className="mt-1">
        <AuxBadges flags={task.auxFlags} />
      </div>
    </Card>
  );
}
