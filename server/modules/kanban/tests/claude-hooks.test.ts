// server/modules/kanban/tests/claude-hooks.test.ts
//
// Tests for createKanbanClaudeHooks (server/modules/kanban/claude-hooks.ts):
// the Claude Agent SDK function-hook factory that intercepts AskUserQuestion
// in bypassPermissions mode (REQ-038) and emits opt-in hook_event liveness
// signals for the kanban runner (REQ-037).

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createKanbanClaudeHooks,
  formatInjectedAnswers,
  type HookApprovalDecision,
} from '@/modules/kanban/claude-hooks.js';

interface SentMessage {
  kind?: string;
  requestId?: string;
  toolName?: string;
  hookEvent?: string;
  input?: unknown;
  sessionId?: string | null;
}

function setup(opts: {
  decision?: HookApprovalDecision | null;
  emitHookEvents?: boolean;
} = {}) {
  const sent: SentMessage[] = [];
  const waits: Array<{ requestId: string; options: { timeoutMs: number } }> = [];
  let notifications = 0;
  const hooks = createKanbanClaudeHooks({
    send: (msg) => sent.push(msg as SentMessage),
    waitForToolApproval: async (requestId, options) => {
      waits.push({ requestId, options });
      return opts.decision === undefined ? { allow: true, updatedInput: { answers: ['Option A'] } } : opts.decision;
    },
    createRequestId: () => 'req-1',
    getSessionId: () => 'sid-1',
    emitHookEvents: opts.emitHookEvents,
    onActionRequired: () => { notifications += 1; },
  });
  return { hooks, sent, waits, notifications: () => notifications };
}

const askInput = {
  hook_event_name: 'PreToolUse',
  session_id: 'sid-1',
  cwd: '/tmp/wt',
  transcript_path: '/tmp/t.jsonl',
  permission_mode: 'bypassPermissions',
  tool_name: 'AskUserQuestion',
  tool_input: {
    questions: [
      { question: 'Which option?', header: 'Choice', options: [{ label: 'Option A' }, { label: 'Option B' }], multiSelect: false },
    ],
  },
  tool_use_id: 'tu-1',
};

// --------------------------- formatInjectedAnswers ---------------------------

test('formatInjectedAnswers renders question + labels for the kanban answers shape', () => {
  const text = formatInjectedAnswers(
    { questions: [{ question: 'Which option?' }] },
    { answers: ['Option A', 'Option B'] },
  );
  assert.equal(text, '"Which option?" → Option A, Option B');
});

test('formatInjectedAnswers tolerates object-map and string answer shapes', () => {
  assert.equal(formatInjectedAnswers(null, { answers: { q: 'yes' } }), 'yes');
  assert.equal(formatInjectedAnswers(null, 'just do it'), 'just do it');
});

test('formatInjectedAnswers returns empty string when no usable answer exists', () => {
  assert.equal(formatInjectedAnswers({ questions: [] }, { answers: [] }), '');
  assert.equal(formatInjectedAnswers(null, null), '');
  assert.equal(formatInjectedAnswers(null, undefined), '');
});

test('formatInjectedAnswers caps overly long output', () => {
  const long = 'x'.repeat(1000);
  const text = formatInjectedAnswers(null, long);
  assert.equal(text.length, 500);
  assert.ok(text.endsWith('...'));
});

// --------------------------- PreToolUse interception ---------------------------

test('AskUserQuestion hook ignores non-bypass permission modes (canUseTool handles those)', async () => {
  const { hooks, sent, waits } = setup();
  const hook = hooks.PreToolUse[0].hooks[0];
  for (const mode of ['default', 'plan', 'acceptEdits']) {
    const out = await hook({ ...askInput, permission_mode: mode }, undefined, {});
    assert.deepEqual(out, {});
  }
  assert.equal(sent.length, 0);
  assert.equal(waits.length, 0);
});

test('AskUserQuestion hook in bypassPermissions forwards permission_request and injects the answer', async () => {
  const { hooks, sent, waits, notifications } = setup();
  const hook = hooks.PreToolUse[0].hooks[0];
  const out: any = await hook(askInput, undefined, {});

  // permission_request mirrors the canUseTool contract so the kanban
  // aux-bridge and the chat UI render it without changes.
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'permission_request');
  assert.equal(sent[0].toolName, 'AskUserQuestion');
  assert.equal(sent[0].requestId, 'req-1');
  assert.deepEqual(sent[0].input, askInput.tool_input);
  assert.equal(sent[0].sessionId, 'sid-1');
  assert.equal(notifications(), 1);

  // Waits indefinitely for the user's answer.
  assert.equal(waits.length, 1);
  assert.equal(waits[0].requestId, 'req-1');
  assert.equal(waits[0].options.timeoutMs, 0);

  // The tool call is denied and the answer reaches the model as text.
  const specific = out.hookSpecificOutput as any;
  assert.equal(specific.hookEventName, 'PreToolUse');
  assert.equal(specific.permissionDecision, 'deny');
  assert.match(specific.permissionDecisionReason, /Option A/);
  assert.match(specific.permissionDecisionReason, /Which option\?/);
});

test('AskUserQuestion hook reports dismissal when the user never answers', async () => {
  for (const decision of [null, { cancelled: true }, { allow: false }, { allow: true }] as const) {
    const { hooks } = setup({ decision: decision as HookApprovalDecision | null });
    const hook = hooks.PreToolUse[0].hooks[0];
    const out: any = await hook(askInput, undefined, {});
    const specific = out.hookSpecificOutput as any;
    assert.equal(specific.permissionDecision, 'deny');
    assert.match(specific.permissionDecisionReason, /dismissed/);
  }
});

test('AskUserQuestion matcher carries an interactive timeout so the wait is not killed', () => {
  const { hooks } = setup();
  assert.equal(hooks.PreToolUse[0].matcher, 'AskUserQuestion');
  assert.ok((hooks.PreToolUse[0].timeout ?? 0) >= 60 * 60);
});

// --------------------------- hook_event liveness ---------------------------

test('hook_event hooks are only registered when emitHookEvents is set', () => {
  const off = setup({ emitHookEvents: false });
  assert.equal(off.hooks.UserPromptSubmit, undefined);
  assert.equal(off.hooks.Stop, undefined);
  const on = setup({ emitHookEvents: true });
  assert.ok(on.hooks.UserPromptSubmit);
  assert.ok(on.hooks.Stop);
});

test('UserPromptSubmit/Stop hooks forward hook_event messages and never block', async () => {
  const { hooks, sent } = setup({ emitHookEvents: true });
  const upsert = hooks.UserPromptSubmit[0].hooks[0];
  const stop = hooks.Stop[0].hooks[0];
  assert.deepEqual(await upsert({ session_id: 'sid-9', hook_event_name: 'UserPromptSubmit' }, undefined, {}), {});
  assert.deepEqual(await stop({ session_id: 'sid-9', hook_event_name: 'Stop' }, undefined, {}), {});
  assert.equal(sent.length, 2);
  assert.equal(sent[0].kind, 'hook_event');
  assert.equal(sent[0].hookEvent, 'UserPromptSubmit');
  assert.equal(sent[0].sessionId, 'sid-9');
  assert.equal(sent[1].hookEvent, 'Stop');
});
