export type SessionTaskStatus =
  | 'idle'
  | 'running'
  | 'waiting_for_input'
  | 'completed'
  | 'failed'
  | 'needs_attention';

export type SessionTaskStatusTone = 'muted' | 'info' | 'warning' | 'success' | 'danger';

export type SessionTaskStatusView = {
  status: SessionTaskStatus;
  label: string;
  tone: SessionTaskStatusTone;
  isTerminal: boolean;
  isActionable: boolean;
};

export const SESSION_TASK_STATUSES: SessionTaskStatus[] = [
  'idle',
  'running',
  'waiting_for_input',
  'completed',
  'failed',
  'needs_attention',
];

export function getSessionTaskStatusView(status: SessionTaskStatus): SessionTaskStatusView {
  switch (status) {
    case 'running':
      return {
        status,
        label: 'Running',
        tone: 'info',
        isTerminal: false,
        isActionable: false,
      };
    case 'waiting_for_input':
      return {
        status,
        label: 'Needs input',
        tone: 'warning',
        isTerminal: false,
        isActionable: true,
      };
    case 'completed':
      return {
        status,
        label: 'Done',
        tone: 'success',
        isTerminal: true,
        isActionable: false,
      };
    case 'failed':
      return {
        status,
        label: 'Failed',
        tone: 'danger',
        isTerminal: true,
        isActionable: true,
      };
    case 'needs_attention':
      return {
        status,
        label: 'Needs attention',
        tone: 'warning',
        isTerminal: true,
        isActionable: true,
      };
    case 'idle':
    default:
      return {
        status: 'idle',
        label: 'Idle',
        tone: 'muted',
        isTerminal: false,
        isActionable: false,
      };
  }
}
