import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNavigableUrl, toPartitionName, clampBounds } from './browserPaneUtils.js';

test('isNavigableUrl: 仅放行 http/https', () => {
  assert.equal(isNavigableUrl('https://example.com'), true);
  assert.equal(isNavigableUrl('http://localhost:7777'), true);
  assert.equal(isNavigableUrl('mailto:a@b.com'), false);
  assert.equal(isNavigableUrl('file:///x'), false);
  assert.equal(isNavigableUrl('javascript:alert(1)'), false);
  assert.equal(isNavigableUrl('not a url'), false);
  assert.equal(isNavigableUrl(''), false);
});

test('toPartitionName: 无 profile 用内存 partition;有 profile 用 persist:', () => {
  assert.equal(toPartitionName(null), 'planrla-browser');
  assert.equal(toPartitionName(''), 'planrla-browser');
  assert.equal(toPartitionName('Twitter'), 'persist:planrla-browser-twitter');
  assert.equal(toPartitionName('A/B C!'), 'persist:planrla-browser-a-b-c');
});

test('clampBounds: 钳制非负 + 最小尺寸 + 不超 max', () => {
  assert.deepEqual(
    clampBounds({ x: 10, y: 20, width: 500, height: 400 }, { width: 1000, height: 800 }),
    { x: 10, y: 20, width: 500, height: 400 },
  );
  assert.deepEqual(
    clampBounds({ x: -5, y: -5, width: 10, height: 10 }, { width: 1000, height: 800 }),
    { x: 0, y: 0, width: 100, height: 100 },
  );
  assert.equal(clampBounds({ width: 2000 }, { width: 1000, height: 800 }).width, 1000);
});
