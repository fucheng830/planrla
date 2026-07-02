import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BYPASS_MODE_BY_PROVIDER,
  resolveSessionPermissionMode,
  getDefaultPermissionModes,
  setDefaultPermissionMode,
  DEFAULT_PERMISSION_ACK_KEY,
  isPermissionAcked,
  setPermissionAcked,
} from './permissionDefaults';

const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  writable: true,
  configurable: true,
});

test('BYPASS_MODE_BY_PROVIDER: gemini=yolo，其他=bypassPermissions', () => {
  assert.equal(BYPASS_MODE_BY_PROVIDER.claude, 'bypassPermissions');
  assert.equal(BYPASS_MODE_BY_PROVIDER.codex, 'bypassPermissions');
  assert.equal(BYPASS_MODE_BY_PROVIDER.cursor, 'bypassPermissions');
  assert.equal(BYPASS_MODE_BY_PROVIDER.gemini, 'yolo');
});

test('resolveSessionPermissionMode: session 记忆优先', () => {
  store.clear();
  store.set('permissionMode-s1', 'acceptEdits');
  assert.equal(resolveSessionPermissionMode('claude', 's1'), 'acceptEdits');
});

test('resolveSessionPermissionMode: 无 session 记忆 → 全局默认', () => {
  store.clear();
  setDefaultPermissionMode('codex', 'bypassPermissions');
  assert.equal(resolveSessionPermissionMode('codex', 's2'), 'bypassPermissions');
});

test('resolveSessionPermissionMode: 无记忆无全局 → default', () => {
  store.clear();
  assert.equal(resolveSessionPermissionMode('claude', 's3'), 'default');
});

test('resolveSessionPermissionMode: gemini 全局默认是 yolo', () => {
  store.clear();
  setDefaultPermissionMode('gemini', BYPASS_MODE_BY_PROVIDER.gemini!);
  assert.equal(resolveSessionPermissionMode('gemini', 's4'), 'yolo');
});

test('isPermissionAcked / setPermissionAcked', () => {
  store.clear();
  assert.equal(isPermissionAcked(), false);
  setPermissionAcked();
  assert.equal(isPermissionAcked(), true);
});
