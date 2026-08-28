import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/utils';
import { getSessionTaskStatusView } from './taskStatus';
import type { SessionTaskStatus, SessionTaskStatusTone } from './taskStatus';

const taskStatusBadgeClassNames: Record<SessionTaskStatusTone, string> = {
  muted: 'bg-muted text-muted-foreground',
  info: 'bg-primary/10 text-primary',
  warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  success: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  danger: 'bg-red-500/10 text-red-700 dark:text-red-300',
};

type SessionTaskStatusBadgeProps = {
  status: SessionTaskStatus;
  className?: string;
};

/**
 * 全 sidebar 唯一的 session 状态视图。idle → 不渲染;其余 → tone 胶囊。
 * 三处(顶层 Sessions 列表 / Projects 内 session 行 / 搜索结果)共用此组件。
 * 详见 docs/superpowers/specs/2026-07-07-req025-sidebar-status-ui-unify-design.md
 */
export default function SessionTaskStatusBadge({ status, className }: SessionTaskStatusBadgeProps) {
  const { t } = useTranslation();
  const statusView = getSessionTaskStatusView(status);

  if (statusView.status === 'idle') {
    return null;
  }

  const Icon = statusView.status === 'running'
    ? Loader2
    : statusView.status === 'completed'
      ? Check
      : AlertCircle;

  const label = t(`taskStatus.${statusView.status}`, statusView.label);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none',
        taskStatusBadgeClassNames[statusView.tone],
        className,
      )}
      title={label}
    >
      <Icon className={cn('h-2.5 w-2.5', statusView.status === 'running' && 'animate-spin')} />
      {label}
    </span>
  );
}
