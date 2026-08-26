// server/modules/kanban/claude-hooks.ts
//
// Claude Agent SDK function-hook factory, wired into queryClaudeSDK
// (server/claude-sdk.js). Two responsibilities:
//
//   1. REQ-038 (bypassPermissions fix): intercept AskUserQuestion in a
//      PreToolUse hook. The SDK's canUseTool callback is skipped entirely in
//      bypassPermissions mode (the kanban default), so without this hook the
//      tool is auto-answered and the question never reaches a human. A
//      PreToolUse hook runs BEFORE the permission-mode check, sees the full
//      questions payload, and can block the call. We forward a standard
//      `permission_request` message (the kanban aux-bridge and the chat UI
//      already render that kind), wait for the user's answer via the existing
//      waitForToolApproval plumbing, then DENY the tool with the answer
//      formatted into permissionDecisionReason — the model reads the denial
//      reason and continues with the user's choice (spike-verified against
//      claude-agent-sdk 0.3.165: debug/spike-sdk-hooks.mjs).
//
//   2. REQ-037 (liveness foundation): emit `hook_event` messages on
//      UserPromptSubmit / Stop. These fire regardless of permission mode and
//      give the kanban runner an authoritative activity signal that is
//      independent of the SDK message stream. Gated behind `emitHookEvents`
//      (kanban runner only): the chat frontend persists unknown kinds into
//      the conversation store, so chat sessions must not receive them.
//
// Hook payloads arrive with session_id / cwd / transcript_path /
// permission_mode (see BaseHookInput in the SDK typings); permission_mode is
// read from the event itself rather than the spawn options so resumed
// sessions behave correctly.

import { createNormalizedMessage } from '@/shared/utils.js';

/** Decision shape returned by claude-sdk.js waitForToolApproval. */
export interface HookApprovalDecision {
  allow?: boolean;
  cancelled?: boolean;
  updatedInput?: unknown;
  message?: string;
}

export interface KanbanClaudeHooksDeps {
  /** Forward a normalized message through the provider writer (RunnerWriter on the kanban path). */
  send: (msg: unknown) => void;
  /** claude-sdk.js waitForToolApproval — resolves when the user answers or the run aborts. */
  waitForToolApproval: (
    requestId: string,
    options: { timeoutMs: number; signal?: AbortSignal; metadata?: Record<string, unknown> },
  ) => Promise<HookApprovalDecision | null>;
  createRequestId: () => string;
  /** Late-binding session id (the run may not have captured one when the hook is built). */
  getSessionId?: () => string | null;
  /** Emit UserPromptSubmit/Stop `hook_event` messages. Kanban runner only — see header. */
  emitHookEvents?: boolean;
  /** Optional side-channel for the notification orchestrator (parity with canUseTool). */
  onActionRequired?: (info: { requestId: string; toolName: string; sessionId: string | null }) => void;
  /** REQ-043: 有值 = goal stage。挂 PostToolUse[task_complete] flag + Stop goalBlock。 */
  goalCondition?: string;
  /** Seconds before the SDK kills a pending interactive hook. Default 24h — a user may answer much later. */
  interactiveHookTimeoutSec?: number;
  /**
   * Auto-continue on AskUserQuestion timeout (bypassPermissions / kanban path).
   * When true, the hook waits `askUserQuestionAutoContinueTimeoutMs` instead of
   * indefinitely; on timeout the model is told to proceed on its own.
   */
  askUserQuestionAutoContinue?: boolean;
  askUserQuestionAutoContinueTimeoutMs?: number;
  log?: (msg: string) => void;
}

interface HookMatcherEntry {
  matcher: string;
  timeout?: number;
  hooks: Array<(input: any, toolUseID: string | undefined, options: { signal?: AbortSignal }) => Promise<Record<string, unknown>>>;
}

/**
 * Render the user's answers as a compact "question → answer" line for the
 * denial reason. Kanban's answer route forwards `{ answers: string[] }`
 * (option labels for the first question); the chat UI and future callers may
 * pass other shapes, so normalize defensively. Returns '' when no usable
 * answer is present.
 */
export function formatInjectedAnswers(toolInput: unknown, updatedInput: unknown): string {
  const questions = (toolInput as any)?.questions;
  const firstQuestion =
    Array.isArray(questions) && questions[0] && typeof questions[0].question === 'string'
      ? (questions[0].question as string)
      : null;

  let labels: string[] = [];
  const ui = updatedInput as any;
  if (Array.isArray(ui?.answers)) {
    labels = ui.answers.filter((x: unknown): x is string => typeof x === 'string');
  } else if (typeof ui === 'string') {
    labels = [ui];
  } else if (ui && typeof ui === 'object') {
    const map = ui.answers && typeof ui.answers === 'object' && !Array.isArray(ui.answers) ? ui.answers : ui;
    labels = Object.values(map)
      .flatMap((v) => (Array.isArray(v) ? v : [v]))
      .filter((x): x is string => typeof x === 'string');
  }
  if (labels.length === 0) return '';

  const line = firstQuestion ? `"${firstQuestion}" → ${labels.join(', ')}` : labels.join(', ');
  return line.length > 500 ? `${line.slice(0, 497)}...` : line;
}

export function createKanbanClaudeHooks(deps: KanbanClaudeHooksDeps): Record<string, HookMatcherEntry[]> {
  const {
    send,
    waitForToolApproval,
    createRequestId,
    getSessionId,
    emitHookEvents = false,
    goalCondition,
    onActionRequired,
    interactiveHookTimeoutSec = 24 * 60 * 60,
    askUserQuestionAutoContinue = false,
    askUserQuestionAutoContinueTimeoutMs,
    log = () => {},
  } = deps;

  const askUserQuestionHook = async (
    input: any,
    _toolUseID: string | undefined,
    options: { signal?: AbortSignal } = {},
  ): Promise<Record<string, unknown>> => {
    // In default/plan modes canUseTool already surfaces interactive tools —
    // stay out of the way. Only bypassPermissions needs this interception.
    if (input?.permission_mode !== 'bypassPermissions') return {};

    const requestId = createRequestId();
    const sessionId = input?.session_id ?? getSessionId?.() ?? null;
    send(
      createNormalizedMessage({
        kind: 'permission_request',
        requestId,
        toolName: 'AskUserQuestion',
        input: input?.tool_input,
        sessionId,
        provider: 'claude',
      }),
    );
    onActionRequired?.({ requestId, toolName: 'AskUserQuestion', sessionId });

    const decision = await waitForToolApproval(requestId, {
      // Auto-continue: wait the configured timeout, then dismiss so the model
      // proceeds on its own. Default 0 = wait indefinitely (original behavior).
      timeoutMs: askUserQuestionAutoContinue
        ? (Number(askUserQuestionAutoContinueTimeoutMs) || 300000)
        : 0,
      signal: options?.signal,
      // Direct chat sessions surface their AskUserQuestion in the message hub;
      // kanban task sessions use pendingAskUser on the task instead.
      exposeChatApproval: !emitHookEvents,
      metadata: {
        _sessionId: sessionId,
        _toolName: 'AskUserQuestion',
        _input: input?.tool_input,
        _receivedAt: new Date(),
      },
    });

    const answersText = decision?.allow ? formatInjectedAnswers(input?.tool_input, decision.updatedInput) : '';
    const reason = answersText
      ? `The user answered this question from the planrla kanban board: ${answersText}. Do not ask again; continue with that answer.`
      : 'The user dismissed this question on the planrla kanban board. Continue without an answer and make a reasonable choice on your own.';
    log(`[kanban-hooks] AskUserQuestion resolved requestId=${requestId} answered=${Boolean(answersText)}`);
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    };
  };

  const hooks: Record<string, HookMatcherEntry[]> = {
    PreToolUse: [{ matcher: 'AskUserQuestion', timeout: interactiveHookTimeoutSec, hooks: [askUserQuestionHook] }],
  };

  if (emitHookEvents) {
    const liveness = (hookEvent: string) => async (input: any) => {
      send(
        createNormalizedMessage({
          kind: 'hook_event',
          hookEvent,
          sessionId: input?.session_id ?? getSessionId?.() ?? null,
          provider: 'claude',
        }),
      );
      return {};
    };
    hooks.UserPromptSubmit = [{ matcher: '', hooks: [liveness('UserPromptSubmit')] }];
    hooks.Stop = [{ matcher: '', hooks: [liveness('Stop')] }];
  }

  // REQ-043: goal stage 的 Stop hook block(= Claude Code `/goal` 机制)。
  // PostToolUse[task_complete] 设 flag;Stop 读 flag:true 放行,false 返回顶层
  // {decision:'block', reason} 让 claude 续跑到 maxTurns(spike-verified:
  // 顶层 decision 生效;hookSpecificOutput 形态只对 PreToolUse 的 permissionDecision 有效)。
  // matcher:spike(debug/spike-goal-e2e.mjs)证 glob `*task_complete` 不命中 MCP 全名
  // mcp__<server>__task_complete(`*` 不跨 `__`),改 catch-all `''` + tool_name 内判断。
  if (goalCondition) {
    const completed = { value: false };
    hooks.PostToolUse = [{
      matcher: '',
      hooks: [async (input: any) => {
        if (String(input?.tool_name || '').includes('task_complete')) completed.value = true;
        return {};
      }],
    }];
    hooks.Stop = (hooks.Stop ?? []).concat([{
      matcher: '',
      hooks: [async () => {
        if (completed.value) return {};
        return {
          decision: 'block',
          reason: `Goal not done: ${goalCondition}. 继续工作,完成后调用 task_complete(taskId, summary)。`,
        };
      }],
    }]);
  }

  return hooks;
}
