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

/** REQ-043: goal stage 的 preamble——告诉 agent 目标 + 完成时调 task_complete。 */
export function buildGoalPreamble(stage: StageTemplate, ctx: PromptContext): string {
  if (!stage.goalCondition) return '';
  return [
    '',
    '--- goal ---',
    `你的目标:${stage.goalCondition}`,
    `持续工作直到目标完成。完成后必须调用 MCP 工具 task_complete(taskId: "${ctx.taskId}", summary: "...") 声明完成,summary 简述成果。`,
    '未完成时不要停止;中途可调 task_status 查看。',
    '--- end goal ---',
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
  const goal = buildGoalPreamble(stage, ctx);
  const tail = preamble + goal;
  if (!base) return tail.replace(/^\n/, '');
  return base + tail;
}
