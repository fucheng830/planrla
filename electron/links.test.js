import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedUrl, ALLOWED_PROTOCOLS } from './links.js';

test('isAllowedUrl:放行 http/https', () => {
  assert.equal(isAllowedUrl('http://localhost:7777'), true);
  assert.equal(isAllowedUrl('https://github.com/a/b'), true);
  assert.equal(isAllowedUrl('HTTP://EXAMPLE.COM'), true); // URL 规范化协议为小写
});

test('isAllowedUrl:放行 mailto/tel/sms', () => {
  assert.equal(isAllowedUrl('mailto:a@b.com'), true);
  assert.equal(isAllowedUrl('tel:+15551234'), true);
  assert.equal(isAllowedUrl('sms:12345'), true);
});

test('isAllowedUrl:拦截危险与非白名单协议', () => {
  assert.equal(isAllowedUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedUrl('file:///C:/x'), false);
  assert.equal(isAllowedUrl('data:text/html,<x>'), false);
  assert.equal(isAllowedUrl('ftp://x'), false);
  assert.equal(isAllowedUrl('custom-scheme://foo'), false);
});

test('isAllowedUrl:非法 URL 返回 false,不抛', () => {
  assert.equal(isAllowedUrl('not a url'), false);
  assert.equal(isAllowedUrl(''), false);
  assert.equal(isAllowedUrl('://no-scheme'), false);
});

test('ALLOWED_PROTOCOLS 包含五个协议', () => {
  assert.deepEqual([...ALLOWED_PROTOCOLS].sort(), ['http:', 'https:', 'mailto:', 'sms:', 'tel:']);
});
