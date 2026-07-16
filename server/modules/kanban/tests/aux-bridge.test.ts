// server/modules/kanban/tests/aux-bridge.test.ts
//
// Tests for the aux-bridge: translates provider session events (Claude/Codex
// tool_use + permission_request kinds emitted through the spawnFn writer) into
// kanban TaskAuxFlags updates via the injected updateAuxFlags callback.
//
// Writer event shapes mirror what spawnFns (server/claude-sdk.js etc.) forward
// through writer.send(JSON.stringify(msg)).

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuxBridge } from '@/modules/kanban/aux-bridge.js';

interface CapturedUpdate {
  taskId: string;
  flags: Record<string, unknown>;
}

function setup(): { auxBridge: ReturnType<typeof createAuxBridge>; updates: CapturedUpdate[] } {
  const updates: CapturedUpdate[] = [];
  const auxBridge = createAuxBridge({
    updateAuxFlags: (taskId, flags) => {
      updates.push({ taskId, flags: flags as Record<string, unknown> });
    },
  });
  return { auxBridge, updates };
}

test('Claude AskUserQuestion permission_request sets askUserWaiting=true and captures payload', () => {
  const { auxBridge, updates } = setup();
  auxBridge.handle('t1', {
    kind: 'permission_request',
    toolName: 'AskUserQuestion',
    requestId: 'r1',
    input: { questions: [{ question: 'pick one' }] },
  });
  // REQ-038: handler now also captures requestId + questions for inline answering.
  assert.equal(updates[0].taskId, 't1');
  assert.equal(updates[0].flags.askUserWaiting, true);
  const pending = updates[0].flags.pendingAskUser as { requestId: string; questions: unknown; capturedAt: string };
  assert.equal(pending.requestId, 'r1');
  assert.deepEqual(pending.questions, { questions: [{ question: 'pick one' }] });
  assert.ok(typeof pending.capturedAt === 'string');
});

test('Claude ExitPlanMode permission_request sets hasPlan=true', () => {
  const { auxBridge, updates } = setup();
  auxBridge.handle('t1', {
    kind: 'permission_request',
    toolName: 'ExitPlanMode',
    requestId: 'r2',
  });
  assert.deepEqual(updates[0], { taskId: 't1', flags: { hasPlan: true } });
});

test('Claude TodoWrite tool_use sets hasTodos=true', () => {
  const { auxBridge, updates } = setup();
  auxBridge.handle('t1', { kind: 'tool_use', toolName: 'TodoWrite', toolInput: { todos: [] } });
  assert.deepEqual(updates[0], { taskId: 't1', flags: { hasTodos: true } });
});

test('Codex TodoList tool_use sets hasTodos=true', () => {
  const { auxBridge, updates } = setup();
  auxBridge.handle('t1', { kind: 'tool_use', toolName: 'TodoList', toolInput: { items: [] } });
  assert.deepEqual(updates[0], { taskId: 't1', flags: { hasTodos: true } });
});

test('Claude Task tool_use sets hasTask=true', () => {
  const { auxBridge, updates } = setup();
  auxBridge.handle('t1', { kind: 'tool_use', toolName: 'Task', toolInput: {} });
  assert.deepEqual(updates[0], { taskId: 't1', flags: { hasTask: true } });
});

test('Claude exit_plan_mode tool_use sets hasPlan=true', () => {
  const { auxBridge, updates } = setup();
  auxBridge.handle('t1', { kind: 'tool_use', toolName: 'exit_plan_mode', toolInput: {} });
  assert.deepEqual(updates[0], { taskId: 't1', flags: { hasPlan: true } });
});

test('unrelated events do nothing', () => {
  const { auxBridge, updates } = setup();
  auxBridge.handle('t1', { kind: 'text', role: 'assistant', content: 'hi' });
  auxBridge.handle('t1', { kind: 'stream_delta', content: 'x' });
  auxBridge.handle('t1', { kind: 'tool_use', toolName: 'Bash', toolInput: {} });
  assert.equal(updates.length, 0);
});
