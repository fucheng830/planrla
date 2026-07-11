import type { ReactNode } from 'react';
import { AlertCircle, ClipboardList, ListChecks, GitBranch } from 'lucide-react';
import type { TaskStatus, TaskAuxFlags } from './types';

export function statusStyle(status: TaskStatus): { label: string; dot: string; text: string } {
  switch (status) {
    case 'running':
      return { label: 'Running', dot: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-400' };
    case 'queued':
      return { label: 'Queued', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' };
    case 'waiting_user':
      return { label: 'Waiting', dot: 'bg-purple-500', text: 'text-purple-600 dark:text-purple-400' };
    case 'paused':
      return { label: 'Paused', dot: 'bg-gray-400', text: 'text-gray-500 dark:text-gray-400' };
    case 'success':
      return { label: 'Done', dot: 'bg-green-500', text: 'text-green-600 dark:text-green-400' };
    case 'fail':
      return { label: 'Failed', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' };
    case 'cancelled':
      return { label: 'Cancelled', dot: 'bg-gray-300', text: 'text-gray-400 dark:text-gray-500' };
    default:
      return { label: 'Pending', dot: 'bg-gray-300', text: 'text-muted-foreground' };
  }
}

export function AuxBadges({ flags }: { flags: TaskAuxFlags }) {
  const any = flags.askUserWaiting || flags.hasPlan || flags.hasTodos || flags.hasTask || flags.sessionError;
  return (
    <div className="flex items-center gap-1">
      {flags.askUserWaiting && (
        <Icon title="Awaiting your answer">
          <AlertCircle className="h-3 w-3 text-purple-500" />
        </Icon>
      )}
      {flags.hasPlan && (
        <Icon title="Has plan">
          <ClipboardList className="h-3 w-3 text-blue-500" />
        </Icon>
      )}
      {flags.hasTodos && (
        <Icon title="Has TODOs">
          <ListChecks className="h-3 w-3 text-green-500" />
        </Icon>
      )}
      {flags.hasTask && (
        <Icon title="Has subtasks">
          <GitBranch className="h-3 w-3 text-indigo-500" />
        </Icon>
      )}
      {flags.sessionError && (
        <Icon title={flags.sessionError}>
          <AlertCircle className="h-3 w-3 text-destructive" />
        </Icon>
      )}
      {!any && <span className="text-[10px] text-muted-foreground">—</span>}
    </div>
  );
}

function Icon({ title, children }: { title: string; children: ReactNode }) {
  return (
    <span title={title} className="inline-flex">
      {children}
    </span>
  );
}
