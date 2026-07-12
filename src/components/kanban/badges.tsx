import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ClipboardList, ListChecks, GitBranch } from 'lucide-react';
import type { TaskStatus, TaskAuxFlags } from './types';

/**
 * Per-status visual style. `labelKey` is an i18n key under `status.*` in the
 * `kanban` namespace; the rendering component is responsible for translating
 * it (so status colors stay here as data, while labels follow the user's
 * language).
 */
export function statusStyle(
  status: TaskStatus,
): { labelKey: string; dot: string; text: string } {
  switch (status) {
    case 'running':
      return { labelKey: 'running', dot: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-400' };
    case 'queued':
      return { labelKey: 'queued', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' };
    case 'waiting_user':
      return { labelKey: 'waiting', dot: 'bg-purple-500', text: 'text-purple-600 dark:text-purple-400' };
    case 'paused':
      return { labelKey: 'paused', dot: 'bg-gray-400', text: 'text-gray-500 dark:text-gray-400' };
    case 'success':
      return { labelKey: 'success', dot: 'bg-green-500', text: 'text-green-600 dark:text-green-400' };
    case 'fail':
      return { labelKey: 'fail', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' };
    case 'cancelled':
      return { labelKey: 'cancelled', dot: 'bg-gray-300', text: 'text-gray-400 dark:text-gray-500' };
    default:
      return { labelKey: 'pending', dot: 'bg-gray-300', text: 'text-muted-foreground' };
  }
}

export function AuxBadges({ flags }: { flags: TaskAuxFlags }) {
  const { t } = useTranslation('kanban');
  const any = flags.askUserWaiting || flags.hasPlan || flags.hasTodos || flags.hasTask || flags.sessionError;
  return (
    <div className="flex items-center gap-1">
      {flags.askUserWaiting && (
        <Icon title={t('aux.ask')}>
          <AlertCircle className="h-3 w-3 text-purple-500" />
        </Icon>
      )}
      {flags.hasPlan && (
        <Icon title={t('aux.plan')}>
          <ClipboardList className="h-3 w-3 text-blue-500" />
        </Icon>
      )}
      {flags.hasTodos && (
        <Icon title={t('aux.todo')}>
          <ListChecks className="h-3 w-3 text-green-500" />
        </Icon>
      )}
      {flags.hasTask && (
        <Icon title={t('aux.task')}>
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
