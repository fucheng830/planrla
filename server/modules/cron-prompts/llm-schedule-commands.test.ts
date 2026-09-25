import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeLlmScheduleInput, type LlmScheduleInput } from './llm-schedule-commands.js';

const valid: LlmScheduleInput = {
  name: '每日项目总结',
  cronExpression: '0 18 * * *',
  prompt: '总结今天项目的进展、风险和明天的建议。',
  provider: 'claude',
  projectPath: 'C:/workspace/project',
  sessionMode: 'new',
  boundSessionId: null,
  permissionMode: 'bypassPermissions',
  catchUp: true,
};

test('normalizes a valid LLM schedule command for persistence', () => {
  assert.deepEqual(
    normalizeLlmScheduleInput(valid, () => true),
    { ...valid, notifyInbox: true },
  );
});

test('rejects a command that has no prompt or valid cron expression', () => {
  assert.throws(
    () => normalizeLlmScheduleInput({ ...valid, prompt: ' ' }, () => true),
    /prompt is required/,
  );
  assert.throws(
    () => normalizeLlmScheduleInput(valid, () => false),
    /invalid cron expression/,
  );
  assert.throws(
    () => normalizeLlmScheduleInput({ ...valid, sessionMode: 'resume' }, () => true),
    /boundSessionId is required/,
  );
});
