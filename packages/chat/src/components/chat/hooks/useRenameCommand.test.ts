import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseRenameCommand, formatRenameCommandHint } from './useRenameCommand';

test('parseRenameCommand: bare /rename → no explicit title', () => {
  assert.deepEqual(parseRenameCommand('/rename'), {});
  assert.deepEqual(parseRenameCommand('/rename   '), {});
});

test('parseRenameCommand: /rename <title> → explicitTitle trimmed', () => {
  assert.deepEqual(parseRenameCommand('/rename 调试 WS 推送'), { explicitTitle: '调试 WS 推送' });
  assert.deepEqual(parseRenameCommand('/rename   spaced out  '), { explicitTitle: 'spaced out' });
});

test('parseRenameCommand: case-insensitive, not matching non-rename', () => {
  assert.deepEqual(parseRenameCommand('/RENAME foo'), { explicitTitle: 'foo' });
  assert.deepEqual(parseRenameCommand('/renamex'), {});
});

test('formatRenameCommandHint: bare form instructs AI to generate + call tool, includes sessionId', () => {
  const hint = formatRenameCommandHint('sess-123');
  assert.match(hint, /id=sess-123/);
  assert.match(hint, /set_session_title/);
  assert.ok(!hint.includes('"'));
});

test('formatRenameCommandHint: explicit form uses the provided title', () => {
  const hint = formatRenameCommandHint('sess-123', '调试 WS 推送');
  assert.match(hint, /id=sess-123/);
  assert.match(hint, /"调试 WS 推送"/);
  assert.match(hint, /set_session_title/);
});
