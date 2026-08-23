// src/components/background-tasks/view/BackgroundTasksPanel.tsx
// REQ-046 — 后台任务面板(方案 A 统一列表)。镜像 Settings.tsx modal 模式。
import { useEffect, useState } from 'react';

import { useBackgroundTasks } from '../hooks/useBackgroundTasks';
import type { BackgroundTaskType } from '../types';

import { BackgroundTaskCard } from './BackgroundTaskCard';

import { Button } from '@/shared/view/ui';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const FILTERS: Array<{ key: 'all' | BackgroundTaskType; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'kanban', label: 'kanban' },
  { key: 'a2a', label: 'a2a' },
  { key: 'chat', label: 'chat' },
  { key: 'bash', label: 'bash' },
];

export function BackgroundTasksPanel({ isOpen, onClose }: Props) {
  const { tasks, loading, error, refresh, stopTask, dismissTask } = useBackgroundTasks();
  const [filter, setFilter] = useState<'all' | BackgroundTaskType>('all');
  const [stoppingId, setStoppingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const visible = filter === 'all' ? tasks : tasks.filter((t) => t.type === filter);
  const runningCount = tasks.filter((t) => t.status === 'running' || t.status === 'idle').length;

  const handleStop = async (taskId: string) => {
    setStoppingId(taskId);
    try {
      await stopTask(taskId);
    } catch {
      // 错误已在 hook 里不弹;这里静默(可加 toast)
    } finally {
      setStoppingId(null);
    }
  };

  return (
    <div
      className="modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center bg-workbench-canvas/80 p-4"
      onClick={onClose}
    >
      <div
        className="ds-surface-raised flex h-[80vh] w-full max-w-2xl flex-col rounded-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ds-panel-header px-4">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">后台任务</h2>
            {runningCount > 0 && (
              <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
                {runningCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => void refresh()}>
              刷新
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              关闭
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`rounded-md px-2 py-1 text-xs transition-colors ${
                filter === f.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              }`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              加载中…
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center text-sm text-destructive">
              {error}
            </div>
          ) : visible.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              暂无后台任务
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {visible.map((task) => (
                <BackgroundTaskCard
                  key={task.id}
                  task={task}
                  onStop={handleStop}
                  onDismiss={(id) => void dismissTask(id)}
                  stopping={stoppingId === task.id}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
