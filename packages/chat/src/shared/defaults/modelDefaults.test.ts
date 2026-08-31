import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveInitialModel } from './modelDefaults';

// 内存 mock localStorage（学 D1：用 defineProperty，(Object as any).globalThis.localStorage 在 Node ESM 抛错）
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

test('resolveInitialModel: 上次选择优先', () => {
  store.clear();
  store.set('claude-model', 'sonnet');
  store.set('claude-default-model', 'opus');
  assert.equal(resolveInitialModel('claude', 'opus'), 'sonnet');
});

test('resolveInitialModel: 无上次 → 用户配置的默认', () => {
  store.clear();
  store.set('claude-default-model', 'opus');
  assert.equal(resolveInitialModel('claude', 'opus'), 'opus');
});

test('resolveInitialModel: 全无 → 硬编码 fallback', () => {
  store.clear();
  assert.equal(resolveInitialModel('claude', 'opus'), 'opus');
});
