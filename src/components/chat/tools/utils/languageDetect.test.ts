import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLanguageFromPath } from './languageDetect';

test('getLanguageFromPath: .ts/.tsx → typescript', () => {
  assert.equal(getLanguageFromPath('src/foo.ts'), 'typescript');
  assert.equal(getLanguageFromPath('a/b/App.tsx'), 'typescript');
});

test('getLanguageFromPath: .js/.jsx/.mjs → javascript', () => {
  assert.equal(getLanguageFromPath('foo.js'), 'javascript');
  assert.equal(getLanguageFromPath('foo.jsx'), 'javascript');
  assert.equal(getLanguageFromPath('foo.mjs'), 'javascript');
});

test('getLanguageFromPath: 各主流扩展名', () => {
  assert.equal(getLanguageFromPath('a.py'), 'python');
  assert.equal(getLanguageFromPath('a.go'), 'go');
  assert.equal(getLanguageFromPath('a.rs'), 'rust');
  assert.equal(getLanguageFromPath('a.java'), 'java');
  assert.equal(getLanguageFromPath('a.json'), 'json');
  assert.equal(getLanguageFromPath('a.md'), 'markdown');
  assert.equal(getLanguageFromPath('a.css'), 'css');
  assert.equal(getLanguageFromPath('a.html'), 'markup');
  assert.equal(getLanguageFromPath('a.yml'), 'yaml');
  assert.equal(getLanguageFromPath('a.sh'), 'bash');
});

test('getLanguageFromPath: 未知扩展名 → text', () => {
  assert.equal(getLanguageFromPath('a.xyz'), 'text');
  assert.equal(getLanguageFromPath('README'), 'text');
});

test('getLanguageFromPath: 空/无路径 → text', () => {
  assert.equal(getLanguageFromPath(''), 'text');
  assert.equal(getLanguageFromPath(undefined as any), 'text');
});

test('getLanguageFromPath: 大小写不敏感', () => {
  assert.equal(getLanguageFromPath('a.TS'), 'typescript');
  assert.equal(getLanguageFromPath('a.PY'), 'python');
});
