import test from 'node:test';
import assert from 'node:assert/strict';

import type { NormalizedMessage } from '@/shared/types.js';
import { filterSilentRenameTurns } from '@/shared/rename-command-filter.js';
import { SILENT_RENAME_HINT_PREFIX, isSilentRenameHintContent } from '../../../shared/renameCommand.js';

/**
 * Minimal builder for fake NormalizedMessage rows in tests. Only the fields
 * the filter inspects (role, kind, content, toolName) are set; everything else
 * defaults so the assertions stay readable.
 */
function msg(partial: Partial<NormalizedMessage> & { kind: NormalizedMessage['kind'] }): NormalizedMessage {
  return {
    id: partial.id ?? `id-${Math.random().toString(36).slice(2)}`,
    sessionId: 'sess',
    timestamp: '2026-07-11T00:00:00.000Z',
    provider: 'claude',
    ...partial,
  } as NormalizedMessage;
}

function userText(content: string): NormalizedMessage {
  return msg({ kind: 'text', role: 'user', content });
}

function assistantText(content: string): NormalizedMessage {
  return msg({ kind: 'text', role: 'assistant', content });
}

function thinking(content: string): NormalizedMessage {
  return msg({ kind: 'thinking', content });
}

function toolUse(toolName: string): NormalizedMessage {
  return msg({ kind: 'tool_use', toolName, toolInput: {}, toolId: `tool-${toolName}` });
}

function toolResult(): NormalizedMessage {
  // tool_result rows normalized by the claude provider do NOT carry role.
  return msg({ kind: 'tool_result', toolId: 'tool-set_session_title', content: 'ok' });
}

function silentHint(sessionId = 'sess-1'): NormalizedMessage {
  return userText(`${SILENT_RENAME_HINT_PREFIX}${sessionId})] 请根据本次对话内容生成一个简短(5-15 字)的标题,并调用 set_session_title 工具写入。`);
}

test('isSilentRenameHintContent: matches content opening with the shared prefix', () => {
  assert.equal(isSilentRenameHintContent(`${SILENT_RENAME_HINT_PREFIX}abc)] tail`), true);
  assert.equal(isSilentRenameHintContent('[重命名当前会话 (id=sess-1)] foo'), true);
  assert.equal(isSilentRenameHintContent('plain question'), false);
  assert.equal(isSilentRenameHintContent(''), false);
  assert.equal(isSilentRenameHintContent(undefined), false);
  assert.equal(isSilentRenameHintContent(null), false);
  assert.equal(isSilentRenameHintContent(123), false);
});

test('filterSilentRenameTurns: empty input returns empty', () => {
  assert.deepEqual(filterSilentRenameTurns([]), []);
});

test('filterSilentRenameTurns: a full silent turn (hint + assistant text + thinking + tool_use + tool_result) is dropped entirely', () => {
  const input: NormalizedMessage[] = [
    silentHint(),
    assistantText('好的,我来生成标题。'),
    thinking('considering a short title'),
    toolUse('set_session_title'),
    toolResult(),
  ];

  assert.deepEqual(filterSilentRenameTurns(input), []);
});

test('filterSilentRenameTurns: normal turns before and after a silent turn are unaffected', () => {
  const before1 = userText('帮我看看这个 bug');
  const before2 = assistantText('好的,贴一下报错');
  const after1 = userText('报错是 TypeError');
  const after2 = assistantText('这是空指针');

  const input: NormalizedMessage[] = [
    before1,
    before2,
    silentHint(),
    assistantText('好的,我来生成标题。'),
    toolUse('set_session_title'),
    toolResult(),
    after1,
    after2,
  ];

  assert.deepEqual(filterSilentRenameTurns(input), [before1, before2, after1, after2]);
});

test('filterSilentRenameTurns: no orphan tool_result leaks past the silent turn', () => {
  // The trailing tool_result of the silent turn has no `role === 'user'`, so it
  // must be consumed by the drop window before the next real user turn opens.
  const orphanCheck = toolResult();
  const input: NormalizedMessage[] = [
    silentHint(),
    assistantText('generating'),
    toolUse('set_session_title'),
    orphanCheck,
    userText('下一轮问题'),
  ];

  const filtered = filterSilentRenameTurns(input);
  assert.ok(!filtered.includes(orphanCheck), 'trailing tool_result of silent turn must be dropped');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].content, '下一轮问题');
});

test('filterSilentRenameTurns: multiple silent turns anywhere in history are all dropped', () => {
  // Realistic ordering: each silent rename turn ends with its tool_result and
  // the next row is always a fresh user message (the provider never emits
  // assistant text between a set_session_title tool_result and the next user
  // turn). So u1 gets answered (a1) before the first rename fires, and u2 is
  // the next user turn after the second rename's tool_result.
  const u1 = userText('问题一');
  const a1 = assistantText('答案一');
  const u2 = userText('问题二');
  const a2 = assistantText('答案二');

  const input: NormalizedMessage[] = [
    u1,
    a1,
    silentHint('s1'),
    assistantText('生成标题一'),
    toolUse('set_session_title'),
    toolResult(),
    u2,
    a2,
    silentHint('s2'),
    assistantText('生成标题二'),
    toolUse('set_session_title'),
    toolResult(),
  ];

  assert.deepEqual(filterSilentRenameTurns(input), [u1, a1, u2, a2]);
});

test('filterSilentRenameTurns: silent turn at end of array (no trailing user message) is fully dropped', () => {
  const u1 = userText('问题');
  const input: NormalizedMessage[] = [
    u1,
    silentHint(),
    assistantText('生成标题'),
    toolUse('set_session_title'),
    toolResult(),
  ];

  assert.deepEqual(filterSilentRenameTurns(input), [u1]);
});

test('filterSilentRenameTurns: user message that merely contains the prefix mid-string is NOT dropped', () => {
  // Only opens-with matches; a user pasting the hint as part of a longer
  // question without leading with it stays visible.
  const trick = userText(`前面有字 ${SILENT_RENAME_HINT_PREFIX}sess)] tail`);
  const filtered = filterSilentRenameTurns([trick]);
  assert.deepEqual(filtered, [trick]);
});

test('filterSilentRenameTurns: tool_result rows outside a silent turn (normal tool calls) are kept', () => {
  const u = userText('跑一下测试');
  const tu = toolUse('run_tests');
  const tr = toolResult();
  const a = assistantText('测试通过');

  const filtered = filterSilentRenameTurns([u, tu, tr, a]);
  assert.deepEqual(filtered, [u, tu, tr, a]);
});
