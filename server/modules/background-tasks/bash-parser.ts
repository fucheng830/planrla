// server/modules/background-tasks/bash-parser.ts
//
// REQ-046 §13 ⑤ — **纯函数**解析 SDK message → registry op。
//
// 设计约束:
// - 无时钟、无副作用、无 registry 引用 → 可独立单测。
// - 乐观 start:tool_use(Bash, run_in_background:true) 即 start(占位 bashTaskId = tool_use_id)。
// - 主生命周期源 = SDK `task_*` system message(比 BashOutput 权威,带明确 status/end_time/error)。
// - BashOutput tool_result 作补充(output tail + return-code 语义)。
// - stale / 挂死超时**不进 parser**(无时钟),进 registry TTL sweeper。
// - 格式异常 → noop + warn(单坏 event 不崩)。
//
// 归一化 message 来源:`server/modules/providers/list/claude/claude-sessions.provider.ts`
// 的 `normalizeMessage('claude', rawMsg, sid)`。本 parser 接收那条归一化产物
// (NormalizedMessage[])的单条,加上 ctx(priorTaskIds 用于 reconcile)。

import type { NormalizedMessage } from '@/shared/types.js';

/** parser 输出的 registry 操作(纯数据,registry.apply 消费)。 */
export type BashRegistryOp =
  | {
      kind: 'start';
      /** 占位 = tool_use_id;reconcile 前用这个。 */
      bashTaskId: string;
      cmd: string;
      initialOutput: string[];
      appSessionId: string;
      /** tool_use 块的 id,用于后续 reconcile 替换为 SDK 真 task_id。 */
      toolUseId: string;
    }
  | {
      kind: 'update';
      bashTaskId: string;
      outputTail: string[];
      exitCode?: number;
      appSessionId: string;
    }
  | {
      kind: 'complete';
      bashTaskId: string;
      status: 'completed' | 'failed' | 'killed';
      exitCode?: number;
      error?: string;
      appSessionId: string;
    }
  | {
      kind: 'reconcile';
      /** 之前的占位 id(tool_use_id)。 */
      placeholderBashTaskId: string;
      /** SDK 给的真 task_id。 */
      realBashTaskId: string;
      appSessionId: string;
    }
  | { kind: 'noop' };

/** parser 上下文:已知的 bash task id 集合(占位 + 真),用于 reconcile 判定。 */
export interface BashParserContext {
  priorTaskIds: Set<string>;
}

/** SDK task_updated.patch.status 的可能值。 */
type SdkTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'killed'
  | 'paused';

const MAX_OUTPUT_TAIL_LINES = 50;

function safeStringLines(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === 'string') return value.split(/\r?\n/).slice(-MAX_OUTPUT_TAIL_LINES);
  if (Array.isArray(value)) {
    const lines: string[] = [];
    for (const item of value) {
      if (typeof item === 'string') lines.push(...item.split(/\r?\n/));
      else if (item && typeof item === 'object' && 'text' in item && typeof (item as any).text === 'string') {
        lines.push(...(item as any).text.split(/\r?\n/));
      }
    }
    return lines.slice(-MAX_OUTPUT_TAIL_LINES);
  }
  return [];
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * 从 BashOutput tool_result 的 returnCodeInterpretation 推 exit code 语义。
 * SDK 给语义串(如 "success" / "failure"),这里尽力转 0/非 0。
 */
function interpretReturnCode(text: unknown): number | undefined {
  if (typeof text !== 'string') return undefined;
  const t = text.trim().toLowerCase();
  if (t === 'success' || t === 'exit_success' || t === '0') return 0;
  if (t === 'failure' || t === 'error' || t === 'exit_failure' || t === 'nonzero') return 1;
  return undefined;
}

/**
 * 解析单条归一化 SDK message,产出 BashRegistryOp(或 noop)。
 *
 * 输入约定:`normalized[i]` 来自 `claude-sessions.provider.ts` 的 normalizeMessage。
 * 同时识别 SDK system message 的 `subtype` 字段(task_started/task_updated/task_notification),
 * 这些在归一化后保留在 message 的 `subtype` 字段(归一化对未知 system 不丢字段)。
 *
 * @param msg 归一化后的单条 message
 * @param ctx priorTaskIds 集合
 */
export function parseBashTaskEvent(
  msg: NormalizedMessage,
  ctx: BashParserContext,
): BashRegistryOp {
  if (!msg || typeof msg !== 'object') return { kind: 'noop' };

  const appSessionId = msg.sessionId ?? '';
  const subtype = (msg as any).subtype as string | undefined;

  // ===== 1. SDK system message: task_started / task_updated / task_notification =====
  // 这是主生命周期源(比 BashOutput 权威)。
  //
  // 注意:provider 的 normalizeMessage 对 `type:'system'` 的 task_* 消息**不产
  // 出归一化项**(只识别 content_block_delta / role:user|assistant / tool_use 等),
  // 所以 task_* 会在归一化时被丢。claude-sdk.js 的接入层须为 task_* system
  // 消息**合成**一个伪 NormalizedMessage(带 subtype + task_id + patch + status)
  // 再喂给本 parser。合成 shape 见 claude-sdk.js `synthesizeTaskSystemMsg`。
  //
  // 识别条件:有 `subtype` 且属于 task_* 三者之一(不依赖 kind==='system',
  // 因为 MessageKind 无 'system';合成消息用 kind='task_notification' 占位)。
  if (subtype === 'task_started') {
    const taskId = (msg as any).task_id as string | undefined;
    const toolUseId = (msg as any).tool_use_id as string | undefined;
    if (taskId && toolUseId) {
      if (ctx.priorTaskIds.has(toolUseId) && !ctx.priorTaskIds.has(taskId)) {
        return {
          kind: 'reconcile',
          placeholderBashTaskId: toolUseId,
          realBashTaskId: taskId,
          appSessionId,
        };
      }
    }
    return { kind: 'noop' };
  }

  if (subtype === 'task_updated') {
    const taskId = (msg as any).task_id as string | undefined;
    const patch = (msg as any).patch as
      | { status?: SdkTaskStatus; error?: string; end_time?: string }
      | undefined;
    if (!taskId) return { kind: 'noop' };
    if (!ctx.priorTaskIds.has(taskId)) return { kind: 'noop' };
    const status = patch?.status;
    if (status === 'completed') {
      return { kind: 'complete', bashTaskId: taskId, status: 'completed', appSessionId };
    }
    if (status === 'failed') {
      return {
        kind: 'complete',
        bashTaskId: taskId,
        status: 'failed',
        error: patch?.error,
        appSessionId,
      };
    }
    if (status === 'killed') {
      return { kind: 'complete', bashTaskId: taskId, status: 'killed', appSessionId };
    }
    // pending / running / paused → update(刷 lastActivityAt)
    return { kind: 'update', bashTaskId: taskId, outputTail: [], appSessionId };
  }

  if (subtype === 'task_notification') {
    const taskId = (msg as any).task_id as string | undefined;
    const status = (msg as any).status as
      | 'completed'
      | 'failed'
      | 'stopped'
      | undefined;
    if (!taskId || !status) return { kind: 'noop' };
    if (!ctx.priorTaskIds.has(taskId)) return { kind: 'noop' };
    if (status === 'completed') {
      return { kind: 'complete', bashTaskId: taskId, status: 'completed', appSessionId };
    }
    if (status === 'failed') {
      return { kind: 'complete', bashTaskId: taskId, status: 'failed', appSessionId };
    }
    if (status === 'stopped') {
      return { kind: 'complete', bashTaskId: taskId, status: 'killed', appSessionId };
    }
  }

  // ===== 2. tool_use: Bash run_in_background:true → 乐观 start =====
  if (msg.kind === 'tool_use' && msg.toolName === 'Bash') {
    const input = (msg.toolInput ?? {}) as { run_in_background?: unknown; command?: unknown };
    if (input.run_in_background === true) {
      const cmd = typeof input.command === 'string' ? input.command : '(unknown command)';
      const toolUseId = msg.toolId ?? '';
      if (!toolUseId) return { kind: 'noop' };
      return {
        kind: 'start',
        bashTaskId: toolUseId, // 占位;reconcile 后替换
        cmd,
        initialOutput: [],
        appSessionId,
        toolUseId,
      };
    }
    return { kind: 'noop' };
  }

  // ===== 3. tool_use: KillBash / TaskStop → killed =====
  if (msg.kind === 'tool_use' && (msg.toolName === 'KillBash' || msg.toolName === 'TaskStop')) {
    const input = (msg.toolInput ?? {}) as { task_id?: unknown; bash_id?: unknown };
    const taskId =
      (typeof input.task_id === 'string' && input.task_id) ||
      (typeof input.bash_id === 'string' && input.bash_id) ||
      '';
    if (!taskId) return { kind: 'noop' };
    if (!ctx.priorTaskIds.has(taskId)) return { kind: 'noop' };
    return { kind: 'complete', bashTaskId: taskId, status: 'killed', appSessionId };
  }

  // ===== 4. tool_result: BashOutput / Bash background → update 或 complete =====
  if (msg.kind === 'tool_result') {
    const toolResult = msg.toolResult ?? {};
    const toolUseResult = msg.toolUseResult as
      | {
          backgroundTaskId?: string;
          stdout?: unknown;
          stderr?: unknown;
          output?: unknown;
          returnCodeInterpretation?: string;
          interrupted?: boolean;
        }
      | undefined;

    const bashTaskId =
      toolUseResult?.backgroundTaskId ?? (toolResult as any)?.backgroundTaskId ?? '';
    if (!bashTaskId) return { kind: 'noop' };
    if (!ctx.priorTaskIds.has(bashTaskId)) return { kind: 'noop' };

    const outputTail = [
      ...safeStringLines(toolUseResult?.stdout),
      ...safeStringLines(toolUseResult?.stderr),
      ...safeStringLines(toolUseResult?.output),
    ];

    if (toolUseResult?.interrupted === true) {
      return { kind: 'complete', bashTaskId, status: 'killed', appSessionId };
    }

    const exitCode = interpretReturnCode(toolUseResult?.returnCodeInterpretation);
    if (exitCode === 0) {
      return {
        kind: 'complete',
        bashTaskId,
        status: 'completed',
        exitCode: 0,
        appSessionId,
      };
    }
    if (exitCode !== undefined && exitCode !== 0) {
      return {
        kind: 'complete',
        bashTaskId,
        status: 'failed',
        exitCode,
        appSessionId,
      };
    }

    // 无明确退出码 → update(刷 output + lastActivityAt)
    return { kind: 'update', bashTaskId, outputTail, appSessionId };
  }

  return { kind: 'noop' };
}
