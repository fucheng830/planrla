import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getNotificationContent } from './updateNotificationContent';

test('getNotificationContent: idle → null(不渲染)', () => {
  assert.equal(getNotificationContent({ state: 'idle' }), null);
});

test('getNotificationContent: not-available → null(不渲染)', () => {
  assert.equal(getNotificationContent({ state: 'not-available' }), null);
});

test('getNotificationContent: available → title 含 version + 主按钮 download', () => {
  const content = getNotificationContent({ state: 'available', version: '0.5.0' });
  assert.ok(content, 'available 应返回 content');
  assert.match(content.title, /0\.5\.0/);
  assert.equal(content.primaryAction?.type, 'download');
  assert.equal(content.secondaryAction?.type, 'close');
  assert.equal(content.progressPercent, undefined);
});

test('getNotificationContent: downloading → title 含 percent + progressPercent + 无按钮', () => {
  const content = getNotificationContent({ state: 'downloading', percent: 42 });
  assert.ok(content, 'downloading 应返回 content');
  assert.match(content.title, /42%/);
  assert.equal(content.progressPercent, 42);
  assert.equal(content.primaryAction, undefined);
  assert.equal(content.secondaryAction, undefined);
});

test('getNotificationContent: downloaded → 主按钮 quit-install', () => {
  const content = getNotificationContent({ state: 'downloaded' });
  assert.ok(content, 'downloaded 应返回 content');
  assert.equal(content.primaryAction?.type, 'quit-install');
  assert.equal(content.secondaryAction?.type, 'close');
});

test('getNotificationContent: error → title 含 message + 主按钮 download(重试)', () => {
  const content = getNotificationContent({ state: 'error', message: 'network down' });
  assert.ok(content, 'error 应返回 content');
  assert.match(content.title, /network down/);
  assert.equal(content.primaryAction?.type, 'download');
  assert.equal(content.secondaryAction?.type, 'close');
});
