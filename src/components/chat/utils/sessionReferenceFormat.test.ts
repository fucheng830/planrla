import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReferenceHint, formatReferenceHints, type SessionReference } from './sessionReferenceFormat';

const ref: SessionReference = {
  id: 'r1', sessionId: 's-a', title: 'Codex 重构讨论', provider: 'codex', date: '2026-07-05',
};

test('formatReferenceHint: 一行,含 title/sessionId/provider + 工具提示', () => {
  const out = formatReferenceHint(ref);
  assert.ok(out.startsWith('[可查询引用:「Codex 重构讨论」'));
  assert.ok(out.includes('id=s-a'));
  assert.ok(out.includes('codex'));
  assert.ok(out.includes('query_session'));
});

test('formatReferenceHints: 多引用空行分隔', () => {
  const out = formatReferenceHints([ref, { ...ref, id: 'r2', sessionId: 's-b' }]);
  assert.equal(out.split('\n\n').length, 2);
});

test('formatReferenceHints: 空数组返回空串', () => {
  assert.equal(formatReferenceHints([]), '');
});
