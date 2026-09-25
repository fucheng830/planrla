import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { cn } from '../../../../lib/utils';

export type ToolStatus = 'running' | 'completed' | 'error' | 'denied';

const STATUS_CONFIG: Record<ToolStatus, { label: string; className: string }> = {
  running: {
    label: 'Running',
    className: 'bg-blue-100 text-primary dark:bg-blue-900/30',
  },
  completed: {
    label: 'Completed',
    className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  },
  error: {
    label: 'Error',
    className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  },
  denied: {
    label: 'Denied',
    className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  },
};

interface ToolStatusBadgeProps {
  status: ToolStatus;
  className?: string;
}

function formatElapsed(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export function ToolStatusBadge({ status, className }: ToolStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const isRunning = status === 'running';

  // 长耗时工具调用（MCP 图片分析等可达 2min+）下，静态 "Running" 徽标
  // 会被误认为会话卡死。这里用挂载时间做起点每秒跳动，直观传达"仍在执行"。
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    if (!isRunning) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [isRunning]);

  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-px text-[10px] font-medium',
        config.className,
        className,
      )}
    >
      {isRunning && <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" aria-hidden />}
      {config.label}
      {isRunning && elapsedSeconds >= 3 ? ` · ${formatElapsed(elapsedSeconds)}` : ''}
    </span>
  );
}
