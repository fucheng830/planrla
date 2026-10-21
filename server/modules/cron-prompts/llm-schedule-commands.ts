export interface LlmScheduleInput {
  name: string;
  cronExpression: string;
  prompt: string;
  provider: string;
  projectPath: string;
  sessionMode?: 'new' | 'resume';
  boundSessionId?: string | null;
  permissionMode?: string;
  catchUp?: boolean;
  maxRuns?: number | null;
  notifyInbox?: boolean;
}

export interface NormalizedLlmScheduleInput {
  name: string;
  cronExpression: string;
  prompt: string;
  provider: string;
  projectPath: string;
  sessionMode: 'new' | 'resume';
  boundSessionId: string | null;
  permissionMode: string;
  catchUp: boolean;
  maxRuns: number | null;
  notifyInbox: boolean;
}

export function normalizeLlmScheduleInput(
  input: LlmScheduleInput,
  validateCron: (expression: string) => boolean,
): NormalizedLlmScheduleInput {
  const name = input.name.trim();
  const cronExpression = input.cronExpression.trim();
  const prompt = input.prompt.trim();
  const provider = input.provider.trim() || 'claude';
  const projectPath = input.projectPath.trim().replace(/[\\/]+/g, '/');
  const sessionMode = input.sessionMode === 'resume' ? 'resume' : 'new';
  const boundSessionId = sessionMode === 'resume'
    ? (input.boundSessionId?.trim() || null)
    : null;
  if (sessionMode === 'resume' && !boundSessionId) {
    throw new Error('boundSessionId is required when sessionMode is resume');
  }
  const permissionMode = input.permissionMode?.trim() || 'bypassPermissions';

  if (!name) throw new Error('name is required');
  if (!cronExpression || !validateCron(cronExpression)) {
    throw new Error(`invalid cron expression: ${cronExpression}`);
  }
  if (!prompt) throw new Error('prompt is required');

  return {
    name,
    cronExpression,
    prompt,
    provider,
    projectPath,
    sessionMode,
    boundSessionId,
    permissionMode,
    catchUp: input.catchUp !== false,
    maxRuns: typeof input.maxRuns === 'number' && Number.isInteger(input.maxRuns) && input.maxRuns > 0 ? input.maxRuns : null,
    notifyInbox: input.notifyInbox !== false,
  };
}
