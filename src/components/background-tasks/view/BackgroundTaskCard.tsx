// src/components/background-tasks/view/BackgroundTaskCard.tsx
// REQ-046 — 单卡片:type 标签 + 标题 + 进度 + 耗时 + 状态 + 控制按钮(stop/dismiss)。
import type { BackgroundTask, BackgroundTaskStatus, BackgroundTaskType } from '../types';

import { Button } from '@/shared/view/ui';
import { cn } from '@/lib/utils';

const TYPE_LABEL: Record<BackgroundTaskType, string> = {
  kanban: 'kanban',
  a2a: 'a2a',
  chat: 'chat',
  bash: 'bash',
};

const TYPE_COLOR: Record<BackgroundTaskType, string> = {
  kanban: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  a2a: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  chat: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  bash: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
};

function StatusBadge({ status }: { status: BackgroundTaskStatus }) {
  const map: Record<BackgroundTaskStatus, { label: string; cls: string }> = {
    running: { label: 'running', cls: 'bg-green-500/10 text-green-600 dark:text-green-400' },
    idle: { label: '无活动', cls: 'bg-orange-500/10 text-orange-600 dark:text-orange-400' },
    completed: { label: 'completed', cls: 'bg-muted text-muted-foreground' },
    failed: { label: 'failed', cls: 'bg-red-500/10 text-red-600 dark:text-red-400' },
    killed: { label: 'killed', cls: 'bg-muted text-muted-foreground' },
  };
  const s = map[status];
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', s.cls)}>{s.label}</span>
  );
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h${min % 60}m`;
}

interface Props {
  task: BackgroundTask;
  onStop: (taskId: string) => void;
  onDismiss: (taskId: string) => void;
  stopping?: boolean;
}

export function BackgroundTaskCard({ task, onStop, onDismiss, stopping }: Props) {
  const now = Date.now();
  const elapsed = (task.finishedAt ?? now) - task.startedAt;
  const stoppable = task.status === 'running' || task.status === 'idle';
  const terminal = task.status === 'completed' || task.status === 'failed' || task.status === 'killed';

  return (
    <div className="rounded-lg border border-border bg-card p-3 text-card-foreground">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', TYPE_COLOR[task.type])}>
              {TYPE_LABEL[task.type]}
            </span>
            <StatusBadge status={task.status} />
            <span className="text-[10px] text-muted-foreground">{formatDuration(elapsed)}</span>
          </div>
          <div className="mt-1 truncate text-sm font-medium" title={task.title}>{task.title}</div>
          {task.subtitle && (
            <div className="truncate text-xs text-muted-foreground">{task.subtitle}</div>
          )}
          {task.error && (
            <div className="mt-1 line-clamp-2 text-xs text-destructive" title={task.error}>
              {task.error}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {stoppable && (
            <Button
              size="sm"
              variant="destructive"
              disabled={stopping}
              onClick={() => onStop(task.id)}
            >
              {stopping ? '…' : '停止'}
            </Button>
          )}
          {terminal && (
            <Button size="sm" variant="ghost" onClick={() => onDismiss(task.id)}>
              关闭
            </Button>
          )}
        </div>
      </div>
      {typeof task.progress === 'number' && task.progress >= 0 && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded bg-muted">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${Math.min(100, Math.max(0, task.progress))}%` }}
          />
        </div>
      )}
      {task.type === 'bash' && task.detail.type === 'bash' && task.detail.outputTail.length > 0 && (
        <pre className="mt-2 max-h-32 overflow-auto rounded bg-muted/50 p-2 text-[11px] leading-tight text-muted-foreground">
          {task.detail.outputTail.slice(-8).join('\n')}
        </pre>
      )}
    </div>
  );
}
