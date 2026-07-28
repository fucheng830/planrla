// server/modules/background-tasks/bash-parser.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBashTaskEvent } from './bash-parser.js';
import type { NormalizedMessage } from '@/shared/types.js';

function makeMsg(partial: Partial<NormalizedMessage> & Record<string, unknown>): NormalizedMessage {
  return {
    id: 'm1',
    sessionId: 'sess-1',
    timestamp: new Date().toISOString(),
    provider: 'claude',
    kind: 'text',
    ...partial,
  } as NormalizedMessage;
}

test('parseBashTaskEvent: tool_use Bash run_in_background → start (placeholder = toolUseId)', () => {
  const msg = makeMsg({
    kind: 'tool_use',
    toolName: 'Bash',
    toolId: 'tu_1',
    toolInput: { command: 'npm run build', run_in_background: true },
  });
  const op = parseBashTaskEvent(msg, { priorTaskIds: new Set() });
  assert.equal(op.kind, 'start');
  if (op.kind !== 'start') return;
  assert.equal(op.bashTaskId, 'tu_1');
  assert.equal(op.cmd, 'npm run build');
  assert.equal(op.toolUseId, 'tu_1');
  assert.equal(op.appSessionId, 'sess-1');
});

test('parseBashTaskEvent: tool_use Bash without run_in_background → noop', () => {
  const msg = makeMsg({
    kind: 'tool_use',
    toolName: 'Bash',
    toolId: 'tu_2',
    toolInput: { command: 'ls', run_in_background: false },
  });
  const op = parseBashTaskEvent(msg, { priorTaskIds: new Set() });
  assert.equal(op.kind, 'noop');
});

test('parseBashTaskEvent: task_started → reconcile placeholder→real', () => {
  const msg = makeMsg({
    kind: 'task_notification',
    subtype: 'task_started',
    task_id: 'real_task_1',
    tool_use_id: 'tu_1',
  });
  const op = parseBashTaskEvent(msg, { priorTaskIds: new Set(['tu_1']) });
  assert.equal(op.kind, 'reconcile');
  if (op.kind !== 'reconcile') return;
  assert.equal(op.placeholderBashTaskId, 'tu_1');
  assert.equal(op.realBashTaskId, 'real_task_1');
});

test('parseBashTaskEvent: task_updated completed → complete(completed)', () => {
  const msg = makeMsg({
    kind: 'task_notification',
    subtype: 'task_updated',
    task_id: 'real_task_1',
    patch: { status: 'completed', end_time: '2026-07-28T00:00:00Z' },
  });
  const op = parseBashTaskEvent(msg, { priorTaskIds: new Set(['real_task_1']) });
  assert.equal(op.kind, 'complete');
  if (op.kind !== 'complete') return;
  assert.equal(op.status, 'completed');
});

test('parseBashTaskEvent: task_updated failed with error → complete(failed, error)', () => {
  const msg = makeMsg({
    kind: 'task_notification',
    subtype: 'task_updated',
    task_id: 'real_task_1',
    patch: { status: 'failed', error: 'boom' },
  });
  const op = parseBashTaskEvent(msg, { priorTaskIds: new Set(['real_task_1']) });
  assert.equal(op.kind, 'complete');
  if (op.kind !== 'complete') return;
  assert.equal(op.status, 'failed');
  assert.equal(op.error, 'boom');
});

test('parseBashTaskEvent: task_updated killed → complete(killed)', () => {
  const msg = makeMsg({
    kind: 'task_notification',
    subtype: 'task_updated',
    task_id: 'real_task_1',
    patch: { status: 'killed' },
  });
  const op = parseBashTaskEvent(msg, { priorTaskIds: new Set(['real_task_1']) });
  assert.equal(op.kind, 'complete');
  if (op.kind !== 'complete') return;
  assert.equal(op.status, 'killed');
});

test('parseBashTaskEvent: task_updated running → update(刷 lastActivityAt)', () => {
  const msg = makeMsg({
    kind: 'task_notification',
    subtype: 'task_updated',
    task_id: 'real_task_1',
    patch: { status: 'running' },
  });
  const op = parseBashTaskEvent(msg, { priorTaskIds: new Set(['real_task_1']) });
  assert.equal(op.kind, 'update');
});

test('parseBashTaskEvent: task_notification stopped → complete(killed)', () => {
  const msg = makeMsg({
    kind: 'task_notification',
    subtype: 'task_notification',
    task_id: 'real_task_1',
    status: 'stopped',
  });
  const op = parseBashTaskEvent(msg, { priorTaskIds: new Set(['real_task_1']) });
  assert.equal(op.kind, 'complete');
  if (op.kind !== 'complete') return;
  assert.equal(op.status, 'killed');
});

test('parseBashTaskEvent: task_* for unknown taskId → noop', () => {
  const msg = makeMsg({
    kind: 'task_notification',
    subtype: 'task_updated',
    task_id: 'unknown',
    patch: { status: 'completed' },
  });
  const op = parseBashTaskEvent(msg, { priorTaskIds: new Set(['real_task_1']) });
  assert.equal(op.kind, 'noop');
});

test('parseBashTaskEvent: KillBash tool_use → complete(killed)', () => {
  const msg = makeMsg({
    kind: 'tool_use',
    toolName: 'KillBash',
    toolId: 'tu_kill',
    toolInput: { task_id: 'real_task_1' },
  });
  const op = parseBashTaskEvent(msg, { priorTaskIds: new Set(['real_task_1']) });
  assert.equal(op.kind, 'complete');
  if (op.kind !== 'complete') return;
  assert.equal(op.status, 'killed');
});

test('parseBashTaskEvent: BashOutput tool_result success → complete(completed, exit 0)', () => {
  const msg = makeMsg({
    kind: 'tool_result',
    toolId: 'tu_bo',
    toolResult: {},
    toolUseResult: {
      backgroundTaskId: 'real_task_1',
      stdout: 'done',
      returnCodeInterpretation: 'success',
    },
  });
  const op = parseBashTaskEvent(msg, { priorTaskIds: new Set(['real_task_1']) });
  assert.equal(op.kind, 'complete');
  if (op.kind !== 'complete') return;
  assert.equal(op.status, 'completed');
  assert.equal(op.exitCode, 0);
});

test('parseBashTaskEvent: BashOutput tool_result failure → complete(failed)', () => {
  const msg = makeMsg({
    kind: 'tool_result',
    toolId: 'tu_bo',
    toolResult: {},
    toolUseResult: {
      backgroundTaskId: 'real_task_1',
      stderr: 'oops',
      returnCodeInterpretation: 'failure',
    },
  });
  const op = parseBashTaskEvent(msg, { priorTaskIds: new Set(['real_task_1']) });
  assert.equal(op.kind, 'complete');
  if (op.kind !== 'complete') return;
  assert.equal(op.status, 'failed');
  assert.equal(op.exitCode, 1);
});

test('parseBashTaskEvent: BashOutput tool_result no exit code → update', () => {
  const msg = makeMsg({
    kind: 'tool_result',
    toolId: 'tu_bo',
    toolResult: {},
    toolUseResult: {
      backgroundTaskId: 'real_task_1',
      stdout: 'still running...',
    },
  });
  const op = parseBashTaskEvent(msg, { priorTaskIds: new Set(['real_task_1']) });
  assert.equal(op.kind, 'update');
  if (op.kind !== 'update') return;
  assert.deepEqual(op.outputTail, ['still running...']);
});

test('parseBashTaskEvent: BashOutput interrupted → complete(killed)', () => {
  const msg = makeMsg({
    kind: 'tool_result',
    toolId: 'tu_bo',
    toolResult: {},
    toolUseResult: {
      backgroundTaskId: 'real_task_1',
      interrupted: true,
    },
  });
  const op = parseBashTaskEvent(msg, { priorTaskIds: new Set(['real_task_1']) });
  assert.equal(op.kind, 'complete');
  if (op.kind !== 'complete') return;
  assert.equal(op.status, 'killed');
});

test('parseBashTaskEvent: malformed message → noop (容错)', () => {
  const op1 = parseBashTaskEvent(null as any, { priorTaskIds: new Set() });
  assert.equal(op1.kind, 'noop');
  const op2 = parseBashTaskEvent(makeMsg({ kind: 'text', content: 'hi' }), {
    priorTaskIds: new Set(),
  });
  assert.equal(op2.kind, 'noop');
});

test('parseBashTaskEvent: tool_use Bash run_in_background missing toolId → noop', () => {
  const msg = makeMsg({
    kind: 'tool_use',
    toolName: 'Bash',
    toolInput: { command: 'x', run_in_background: true },
  });
  const op = parseBashTaskEvent(msg, { priorTaskIds: new Set() });
  assert.equal(op.kind, 'noop');
});
