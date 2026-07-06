import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedUrl, ALLOWED_PROTOCOLS, selfOrigins, isSelfOrigin } from './links.js';

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

test('selfOrigins:prod 模式(无 devUrl)只含内嵌 server', () => {
  assert.deepEqual([...selfOrigins(3002, undefined)].sort(), ['http://127.0.0.1:3002']);
});

test('selfOrigins:dev 模式含 devUrl,serverPort=0 也保留(靠 devUrl 兜底)', () => {
  const origins = [...selfOrigins(0, 'http://127.0.0.1:5173')];
  assert.ok(origins.includes('http://127.0.0.1:5173'));
  assert.ok(origins.includes('http://127.0.0.1:0'));
});

test('selfOrigins:无效 devUrl 被跳过,不抛', () => {
  assert.deepEqual([...selfOrigins(3001, 'not-a-url')], ['http://127.0.0.1:3001']);
});

test('isSelfOrigin:自家路径放行', () => {
  assert.equal(isSelfOrigin('http://127.0.0.1:3002/chat', 3002, undefined), true);
  assert.equal(isSelfOrigin('http://127.0.0.1:5173/', 0, 'http://127.0.0.1:5173'), true);
});

test('isSelfOrigin:跨域 / 非法 URL 拒绝', () => {
  assert.equal(isSelfOrigin('https://evil.com/', 3002, undefined), false);
  assert.equal(isSelfOrigin('http://127.0.0.1:3001/x', 0, 'http://127.0.0.1:5173'), false);
  assert.equal(isSelfOrigin('not-a-url', 3001, undefined), false);
});
