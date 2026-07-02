import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRelease } from './releases.ts';

const OK = {
  tag_name: 'v0.2.0',
  name: 'v0.2.0 — 桌面端三态主题',
  body: '## 新功能',
  html_url: 'https://github.com/fucheng830/planrla/releases/tag/v0.2.0',
  published_at: '2026-07-02T10:43:00Z',
  draft: false,
  prerelease: false,
};

test('normalizeRelease: 正常 release 归一化为 5 字段', () => {
  assert.deepEqual(normalizeRelease(OK), {
    version: 'v0.2.0',
    title: 'v0.2.0 — 桌面端三态主题',
    body: '## 新功能',
    htmlUrl: 'https://github.com/fucheng830/planrla/releases/tag/v0.2.0',
    publishedAt: '2026-07-02T10:43:00Z',
  });
});

test('normalizeRelease: draft 返回 null', () => {
  assert.equal(normalizeRelease({ ...OK, draft: true }), null);
});

test('normalizeRelease: 缺 tag_name 或 html_url 返回 null', () => {
  assert.equal(normalizeRelease({ ...OK, tag_name: '' }), null);
  assert.equal(normalizeRelease({ ...OK, html_url: '' }), null);
});

test('normalizeRelease: name/body/published_at 为 null 时 fallback', () => {
  const r = normalizeRelease({ ...OK, name: null, body: null, published_at: null });
  assert.equal(r?.title, 'v0.2.0');   // name null → 用 tag_name
  assert.equal(r?.body, '');            // body null → 空串
  assert.equal(r?.publishedAt, '');     // published_at null → 空串
});
