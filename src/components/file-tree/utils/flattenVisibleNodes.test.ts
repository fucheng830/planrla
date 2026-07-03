import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenVisibleNodes, ROOT_KEY } from './flattenVisibleNodes';
import type { FileTreeNode } from '../types/types';

const node = (name: string, path: string, type: 'file' | 'directory'): FileTreeNode => ({ name, path, type });

test('空 entriesByDir → 空列表', () => {
  assert.deepEqual(flattenVisibleNodes(new Map(), new Set(), '/p'), []);
});

test('只有根 → 顶层 entries，level 0', () => {
  const entries: FileTreeNode[] = [node('a', '/p/a', 'file'), node('b', '/p/b', 'file')];
  const cache = new Map([['', { entries, fetchedAt: Date.now() }]]);
  const result = flattenVisibleNodes(cache, new Set(), '/p');
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((r) => r.node.name), ['a', 'b']);
  assert.deepEqual(result.map((r) => r.level), [0, 0]);
});

test('展开目录 → 递归扁平化子项，level 递增', () => {
  const root: FileTreeNode[] = [node('src', '/p/src', 'directory'), node('readme', '/p/readme', 'file')];
  const srcChildren: FileTreeNode[] = [node('index', '/p/src/index', 'file'), node('utils', '/p/src/utils', 'directory')];
  const cache = new Map([
    ['', { entries: root, fetchedAt: Date.now() }],
    ['src', { entries: srcChildren, fetchedAt: Date.now() }],
  ]);
  const result = flattenVisibleNodes(cache, new Set(['/p/src']), '/p');
  assert.deepEqual(result.map((r) => r.node.name), ['src', 'index', 'utils', 'readme']);
  assert.deepEqual(result.map((r) => r.level), [0, 1, 1, 0]);
});

test('目录展开但未加载（无缓存）→ 只渲染目录本身，不递归', () => {
  const root: FileTreeNode[] = [node('src', '/p/src', 'directory')];
  const cache = new Map([['', { entries: root, fetchedAt: Date.now() }]]);
  const result = flattenVisibleNodes(cache, new Set(['/p/src']), '/p');
  assert.deepEqual(result.map((r) => r.node.name), ['src']);
});

test('缓存过期的展开目录 → 不递归（视为未加载）', () => {
  const root: FileTreeNode[] = [node('src', '/p/src', 'directory')];
  const stale = Date.now() - 10 * 60 * 1000; // 过期
  const cache = new Map([
    ['', { entries: root, fetchedAt: Date.now() }],
    ['src', { entries: [node('x', '/p/src/x', 'file')], fetchedAt: stale }],
  ]);
  const result = flattenVisibleNodes(cache, new Set(['/p/src']), '/p');
  assert.deepEqual(result.map((r) => r.node.name), ['src']);
});

test('嵌套展开 → 多级 level（dirKey 累积 parent/name）', () => {
  const root: FileTreeNode[] = [node('a', '/p/a', 'directory')];
  const aChildren: FileTreeNode[] = [node('b', '/p/a/b', 'directory')];
  const bChildren: FileTreeNode[] = [node('c', '/p/a/b/c', 'file')];
  const cache = new Map([
    ['', { entries: root, fetchedAt: Date.now() }],
    ['a', { entries: aChildren, fetchedAt: Date.now() }],
    ['a/b', { entries: bChildren, fetchedAt: Date.now() }],
  ]);
  const result = flattenVisibleNodes(cache, new Set(['/p/a', '/p/a/b']), '/p');
  assert.deepEqual(result.map((r) => r.node.name), ['a', 'b', 'c']);
  assert.deepEqual(result.map((r) => r.level), [0, 1, 2]);
});
