import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStoredTheme, resolveEffectiveDark, DEFAULT_THEME_MODE } from './themeMode';

test('parseStoredTheme: null/空 → 默认 system', () => {
  assert.equal(parseStoredTheme(null), 'system');
  assert.equal(parseStoredTheme(''), 'system');
  assert.equal(parseStoredTheme(undefined as any), 'system');
});

test('parseStoredTheme: 旧值 dark/light 向后兼容', () => {
  assert.equal(parseStoredTheme('dark'), 'dark');
  assert.equal(parseStoredTheme('light'), 'light');
});

test('parseStoredTheme: system 原样识别', () => {
  assert.equal(parseStoredTheme('system'), 'system');
});

test('parseStoredTheme: 非法值 fallback system', () => {
  assert.equal(parseStoredTheme('auto'), 'system');
  assert.equal(parseStoredTheme('DARK'), 'system'); // 大小写敏感，非法
});

test('resolveEffectiveDark: system 模式跟随 prefersDark', () => {
  assert.equal(resolveEffectiveDark('system', true), true);
  assert.equal(resolveEffectiveDark('system', false), false);
});

test('resolveEffectiveDark: light/dark 固定不受系统影响', () => {
  assert.equal(resolveEffectiveDark('dark', false), true);
  assert.equal(resolveEffectiveDark('light', true), false);
});

test('DEFAULT_THEME_MODE 是 system', () => {
  assert.equal(DEFAULT_THEME_MODE, 'system');
});
