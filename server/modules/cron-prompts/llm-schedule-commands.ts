export interface LlmScheduleInput {
  name: string;
  cronExpression: string;
  prompt: string;
  provider: string;
  projectPath: string;
  notifyInbox?: boolean;
}

export interface NormalizedLlmScheduleInput {
  name: string;
  cronExpression: string;
  prompt: string;
  provider: string;
  projectPath: string;
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
    notifyInbox: input.notifyInbox !== false,
  };
}
