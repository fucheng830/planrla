export const WORKFLOW_STAGES = ['需求设计', '技术方案', '开工', '测试验证', '交付'] as const;

export type WorkflowAgentState = 'running' | 'idle' | 'waiting';

export const WORKFLOW_AGENT_ROWS: ReadonlyArray<{
  name: string;
  detail: string;
  state: WorkflowAgentState;
  label: string;
}> = [
  { name: 'Codex', detail: '技术方案设计', state: 'running', label: '运行中' },
  { name: 'Claude', detail: '看板任务推进', state: 'idle', label: '空闲' },
  { name: 'Gemini', detail: '方案审查', state: 'waiting', label: '等待' },
  { name: 'Cursor', detail: '文件修改', state: 'idle', label: '空闲' },
];

export function getWorkflowStageIndex(taskCurrentStage: number, stageCount: number): number {
  if (stageCount <= 1) return 0;
  const ratio = taskCurrentStage / Math.max(1, stageCount - 1);
  return Math.min(WORKFLOW_STAGES.length - 1, Math.max(0, Math.floor(ratio * WORKFLOW_STAGES.length)));
}
