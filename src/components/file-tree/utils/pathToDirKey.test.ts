import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToDirKey } from './pathToDirKey';

test('根本身 → ""', () => {
  assert.equal(pathToDirKey('/proj', '/proj'), '');
  assert.equal(pathToDirKey('/proj/', '/proj'), '');
});

test('直接子目录', () => {
  assert.equal(pathToDirKey('/proj/src', '/proj'), 'src');
});

test('嵌套子目录（多级正斜杠）', () => {
  assert.equal(pathToDirKey('/proj/src/components', '/proj'), 'src/components');
});

test('兄弟前缀不误匹配（/proj vs /project-x）', () => {
  assert.equal(pathToDirKey('/project-x/src', '/proj'), '');
  assert.equal(pathToDirKey('/proj2/x', '/proj'), '');
});

test('Windows 反斜杠归一', () => {
  assert.equal(pathToDirKey('D:\\proj\\src', 'D:\\proj'), 'src');
  assert.equal(pathToDirKey('D:\\proj\\src\\components', 'D:\\proj'), 'src/components');
});

test('Windows 根大小写不敏感', () => {
  assert.equal(pathToDirKey('d:\\proj\\src', 'D:\\proj'), 'src');
  assert.equal(pathToDirKey('D:\\Proj\\src', 'd:\\proj'), 'src');
});

test('不在根内 → ""', () => {
  assert.equal(pathToDirKey('/other/x', '/proj'), '');
});

test('空入参 → ""', () => {
  assert.equal(pathToDirKey('', '/proj'), '');
  assert.equal(pathToDirKey('/proj/src', ''), '');
});
