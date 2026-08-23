import { cn } from '../../lib/utils';

export type WorkbenchStatusState = 'running' | 'waiting' | 'complete' | 'failed';

type WorkbenchStatusProps = {
  state: WorkbenchStatusState;
  label: string;
  className?: string;
};

const stateClasses: Record<WorkbenchStatusState, string> = {
  running: 'ds-status-running',
  waiting: 'ds-status-waiting',
  complete: 'ds-status-complete',
  failed: 'ds-status-failed',
};

export function WorkbenchStatus({ state, label, className }: WorkbenchStatusProps) {
  return <span className={cn('ds-status', stateClasses[state], className)} data-state={state}>{label}</span>;
}
