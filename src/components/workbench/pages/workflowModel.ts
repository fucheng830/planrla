import type { Task, TaskPriority } from '../../kanban/types';
import type { Project } from '../../../types/app';
import type { WorkbenchStatusState } from '../WorkbenchStatus';

export const WORKFLOW_STAGES = ['需求设计', '技术方案', '开工', '测试验证', '交付'] as const;

/** Column accent dot per stage index (falls back to accent for custom templates). */
export const STAGE_DOT_CLASS: readonly string[] = [
  'text-workbench-subtle',
  'text-workbench-info',
  'text-workbench-accent',
  'text-workbench-waiting',
  'text-workbench-success',
];

/** Contextual empty-state copy per stage name (falls back to 暂无任务). */
export const STAGE_EMPTY_COPY: Record<string, string> = {
  需求设计: '没有待设计的需求',
  技术方案: '没有等你确认的方案',
  开工: '没有进行中的开发任务',
  测试验证: '没有验证中的任务',
  交付: '还没有交付物',
};

export type DisplayTask = {
  id: string;
  isBug?: boolean;
  attachments?: number;
  taskNumber: number;
  stageIndex: number;
  title: string;
  detail: string;
  tags: string[];
  priority: string;
  status: WorkbenchStatusState;
  statusLabel: string;
  projectName?: string;
  updatedAt?: string;
  source?: Task;
};

export const priorityLabel = (priority?: TaskPriority): string =>
  priority === 'high' ? '高' : priority === 'low' ? '低' : '中';

export const taskStatus = (task: Task): { state: WorkbenchStatusState; label: string } => {
  if (task.status === 'success') return { state: 'complete', label: '已交付' };
  if (task.status === 'fail') return { state: 'failed', label: '验证失败' };
  if (task.status === 'waiting_user') return { state: 'waiting', label: '等待人工' };
  return { state: 'running', label: task.status === 'pending' ? '未开始' : 'AI 运行中' };
};

export function displayTask(task: Task, stageCount: number, projects: Project[]): DisplayTask {
  const status = taskStatus(task);
  return {
    id: task.id,
    isBug: task.taskType === 'bug',
    taskNumber: task.taskNumber,
    stageIndex: Math.min(task.currentStageIndex, Math.max(0, stageCount - 1)),
    title: task.input?.trim() || task.taskTemplateName || `任务 #${task.taskNumber}`,
    detail: task.worktreeBranch
      ? `worktree: ${task.worktreeBranch}`
      : task.auxFlags.sessionError
        ? '需要处理任务错误'
        : (task.labels[0] ?? task.taskTemplateName ?? '研发任务'),
    tags: task.labels.length > 0 ? task.labels.slice(0, 3) : ['Kanban'],
    priority: priorityLabel(task.priority),
    status: status.state,
    statusLabel: status.label,
    projectName: projects.find((p) => p.projectId === task.rootId)?.displayName,
    updatedAt: task.updatedAt,
    source: task,
  };
}

/** Compact Chinese relative time for card footers (刚刚 / N 分钟前 / 昨天…). */
export function relativeTime(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '昨天';
  return `${days} 天前`;
}

/** Stage-aware CTA label for the card's primary action. */
export function stageCtaLabel(status: WorkbenchStatusState, stageIndex: number): string {
  if (status === 'waiting') {
    return stageIndex === 0 ? '确认需求' : stageIndex === 1 ? '确认方案' : '确认并继续';
  }
  if (status === 'failed') return '重试此阶段';
  if (status === 'complete') return '验收交付';
  if (status === 'running') return stageIndex === 2 ? '查看进展' : stageIndex === 3 ? '查看验证' : '查看对话';
  return '开始推进';
}

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
