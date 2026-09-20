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

export function buildScheduleConfirmation(input: NormalizedLlmScheduleInput): string {
  return [
    `创建 LLM 定时任务「${input.name}」`,
    `时间规则: ${input.cronExpression}`,
    `Provider: ${input.provider}`,
    `项目: ${input.projectPath || '未指定'}`,
    `任务内容: ${input.prompt}`,
    '确认后，每次触发都会创建一个新的 LLM 会话执行这段任务。',
  ].join('\n');
}
