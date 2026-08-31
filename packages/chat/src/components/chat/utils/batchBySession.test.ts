import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchBySession } from './batchBySession';
import type { NormalizedMessage } from '../../../stores/useSessionStore';

const msg = (id: string, sessionId: string, kind = 'tool_use'): NormalizedMessage =>
  ({ id, sessionId, kind, timestamp: '2026-01-01T00:00:00Z', provider: 'claude' } as unknown as NormalizedMessage);

test('空数组 → 空 Map', () => {
  assert.equal(batchBySession([]).size, 0);
});

test('单 session 多事件 → 同 key 累积顺序保留', () => {
  const result = batchBySession([
    { sessionId: 's1', msg: msg('a', 's1') },
    { sessionId: 's1', msg: msg('b', 's1') },
  ]);
  assert.equal(result.size, 1);
  assert.deepEqual(result.get('s1')!.map((m) => m.id), ['a', 'b']);
});

test('多 session → 分别分组', () => {
  const result = batchBySession([
    { sessionId: 's1', msg: msg('a', 's1') },
    { sessionId: 's2', msg: msg('b', 's2') },
    { sessionId: 's1', msg: msg('c', 's1') },
  ]);
  assert.equal(result.size, 2);
  assert.deepEqual(result.get('s1')!.map((m) => m.id), ['a', 'c']);
  assert.deepEqual(result.get('s2')!.map((m) => m.id), ['b']);
});

test('顺序保留（不重排）', () => {
  const result = batchBySession([
    { sessionId: 's1', msg: msg('1', 's1') },
    { sessionId: 's1', msg: msg('2', 's1') },
    { sessionId: 's1', msg: msg('3', 's1') },
  ]);
  assert.deepEqual(result.get('s1')!.map((m) => m.id), ['1', '2', '3']);
});
