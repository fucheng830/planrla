import type { StageTemplate } from '@/modules/kanban/types.js';

export interface PromptContext {
  taskId: string;
  taskNumber: number;
  stageName: string;
  stageIndex: number;
  rootPath: string | null;
  input: string;
}

/** Replace `{{key}}` placeholders. Unknown keys → ''. Numbers coerced to string. */
export function substitute(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

/** Build the kanban self-drive preamble telling the agent how to advance via MCP. */
export function buildMcpPreamble(ctx: PromptContext, opts: { enabled: boolean }): string {
  if (!opts.enabled) return '';
  return [
    '',
    '--- planrla kanban ---',
    `You are executing stage "${ctx.stageName}" (#${ctx.stageIndex}) of kanban task #${ctx.taskNumber} (id: ${ctx.taskId}).`,
    `Project root: ${ctx.rootPath ?? '(unknown)'}.`,
    `When this stage is complete, advance by calling the MCP tool task_next with {"taskId": "${ctx.taskId}"}.`,
    'Use task_status with the same taskId to inspect current state; task_prev to go back.',
    '--- end planrla kanban ---',
    '',
  ].join('\n');
}

export interface RenderStagePromptArgs {
  stage: StageTemplate;
  ctx: PromptContext;
}

/** Render a stage's prompt template (variable substitution) + optional MCP self-drive preamble. */
export function renderStagePrompt({ stage, ctx }: RenderStagePromptArgs): string {
  const base = substitute(stage.promptTemplate ?? '', {
    input: ctx.input,
    task_id: ctx.taskId,
    task_number: ctx.taskNumber,
    stage_name: ctx.stageName,
    stage_index: ctx.stageIndex,
    project_path: ctx.rootPath ?? '',
  });
  const preamble = buildMcpPreamble(ctx, { enabled: stage.agentCanControlStage !== false });
  if (!base) return preamble.replace(/^\n/, '');
  return base + preamble;
}
