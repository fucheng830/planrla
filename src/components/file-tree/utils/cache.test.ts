import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CACHE_TTL_MS, isCacheValid } from './cache';

test('CACHE_TTL_MS is 5 minutes', () => {
  assert.equal(CACHE_TTL_MS, 5 * 60 * 1000);
});

test('isCacheValid: null/undefined → false', () => {
  assert.equal(isCacheValid(null), false);
  assert.equal(isCacheValid(undefined), false);
});

test('isCacheValid: 刚 fetched → true', () => {
  assert.equal(isCacheValid({ entries: [], fetchedAt: Date.now() }), true);
});

test('isCacheValid: TTL 内 → true', () => {
  assert.equal(isCacheValid({ entries: [], fetchedAt: Date.now() - CACHE_TTL_MS + 1000 }), true);
});

test('isCacheValid: TTL 过期 → false', () => {
  assert.equal(isCacheValid({ entries: [], fetchedAt: Date.now() - CACHE_TTL_MS - 1 }), false);
});
