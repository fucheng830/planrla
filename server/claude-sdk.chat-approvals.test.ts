/** Unit-verify the chat-approval registry inside waitForToolApproval:
 * register on wait → expose via listPendingChatApprovals → listener fires →
 * resolveToolApproval removes it. Importing claude-sdk pulls the agent SDK in,
 * which is heavy but exactly what the server loads. */
import test from 'node:test';
import assert from 'node:assert';

import * as sdk from './claude-sdk.js';


test('waitForToolApproval exposes and clears direct-chat approvals', async () => {
  assert.equal(typeof sdk.waitForToolApproval, 'function', 'waitForToolApproval must be exported');
  assert.equal(typeof sdk.listPendingChatApprovals, 'function');
  assert.equal(typeof sdk.setChatApprovalListener, 'function');
  assert.equal(typeof sdk.resolveToolApproval, 'function');

  const events: Array<{ kind: string; requestId: string }> = [];
  sdk.setChatApprovalListener((kind: string, approval: { requestId: string }) => events.push({ kind, requestId: approval.requestId }));

  const decisionPromise = sdk.waitForToolApproval('req-unit-1', {
    exposeChatApproval: true,
    metadata: {
      _sessionId: 'sess_unit_chat',
      _toolName: 'AskUserQuestion',
      _input: { questions: [{ question: '选择部署环境?', options: [{ label: '测试' }, { label: '生产' }] }] },
      _receivedAt: new Date(),
    },
  });

  await new Promise((r) => setTimeout(r, 50));
  const pending = sdk.listPendingChatApprovals();
  assert.equal(pending.length, 1, 'approval should be listed while waiting');
  assert.equal(pending[0].requestId, 'req-unit-1');
  assert.equal(pending[0].question, '选择部署环境?');
  assert.deepEqual(pending[0].options, ['测试', '生产']);
  assert.equal(events.filter((e) => e.kind === 'added').length, 1, 'added event fired');

  sdk.resolveToolApproval('req-unit-1', { allow: true, updatedInput: { answers: ['测试'] } });
  const decision = await decisionPromise;
  assert.equal(decision.allow, true);

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sdk.listPendingChatApprovals().length, 0, 'approval removed after resolve');
  assert.equal(events.filter((e) => e.kind === 'removed').length, 1, 'removed event fired');
  sdk.setChatApprovalListener(null);
});

test('kanban sessions (exposeChatApproval off) stay out of the registry', async () => {
  const p = sdk.waitForToolApproval('req-unit-2', {
    metadata: { _sessionId: 'sess_kanban', _toolName: 'AskUserQuestion', _input: {}, _receivedAt: new Date() },
  });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(sdk.listPendingChatApprovals().length, 0, 'not exposed without exposeChatApproval');
  sdk.resolveToolApproval('req-unit-2', { allow: false });
  await p;
});
