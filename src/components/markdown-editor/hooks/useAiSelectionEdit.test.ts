// src/components/markdown-editor/hooks/useAiSelectionEdit.test.ts
//
// REQ-047 — AI 选段改纯函数单测。
//
// 仓库前端无 test runner(npm run test 只跑 server/**),此文件作为文档型测试
// 存在:typecheck 校验 + 阐明 buildPrompt / buildReplacementDiff 的契约。
// 模式同 src/components/chat/hooks/useAutoRename.test.ts。
//
// 覆盖:
//   - buildPrompt:模板正确性(文件路径注入 / 选段定界 / 默认 vs 自定义指令)
//   - buildReplacementDiff:选段边界拼接 + 越界保护

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, buildReplacementDiff } from './useAiSelectionEdit';

describe('buildPrompt (REQ-047)', () => {
  test('默认指令:含文件路径 + 选段定界 + 默认润色要求', () => {
    const p = buildPrompt('docs/spec.md', '这是选段', '');
    assert.ok(p.includes('docs/spec.md'), '注入文件路径');
    assert.ok(p.includes('【选段开始】'));
    assert.ok(p.includes('【选段结束】'));
    assert.ok(p.includes('这是选段'));
    assert.ok(p.includes('润色'), '默认指令含润色');
    assert.ok(p.includes('不要代码围栏'), '约束 agent 只输出纯文本');
  });

  test('自定义指令覆盖默认', () => {
    const p = buildPrompt('README.md', 'sel', '改成更口语化');
    assert.ok(p.includes('改成更口语化'));
    assert.ok(!p.includes('润色'), '自定义指令生效,默认不出现');
  });

  test('空选段也能构造(防 agent 崩,虽 UI 禁用)', () => {
    const p = buildPrompt('a.md', '', '');
    assert.ok(p.includes('【选段开始】\n\n【选段结束】'));
  });
});

describe('buildReplacementDiff (REQ-047)', () => {
  test('中段选段:前文 + 改后 + 后文拼接正确', () => {
    const full = 'AAA\nBBB\nCCC';
    // 选 "BBB",from=4(第二行首),to=7
    const diff = buildReplacementDiff(full, { from: 4, to: 7 }, 'XXX');
    assert.equal(diff.old_string, 'AAA\nBBB\nCCC');
    assert.equal(diff.new_string, 'AAA\nXXX\nCCC');
  });

  test('首段选段:from=0', () => {
    const full = 'hello world';
    const diff = buildReplacementDiff(full, { from: 0, to: 5 }, 'HELLO');
    assert.equal(diff.new_string, 'HELLO world');
    assert.equal(diff.old_string, 'hello world');
  });

  test('尾段选段:to=full.length', () => {
    const full = 'abc';
    const diff = buildReplacementDiff(full, { from: 1, to: 3 }, 'BC');
    assert.equal(diff.new_string, 'aBC');
  });

  test('越界保护:from/to 超长被 clamp,不报错不丢内容', () => {
    const full = 'abc';
    const diff = buildReplacementDiff(full, { from: -5, to: 999 }, 'X');
    assert.equal(diff.new_string, 'X', '越界 clamp 后整文替换为 X');
    assert.equal(diff.old_string, 'abc');
  });

  test('倒置选段(from>to):safeFrom/safeTo 修正,退化为原地插入', () => {
    const full = 'abc';
    // from=2 > to=1 → safeFrom=1, safeTo=1, rewritten 插在 1 处
    const diff = buildReplacementDiff(full, { from: 2, to: 1 }, 'X');
    assert.equal(diff.new_string, 'aXbc');
  });

  test('改后文本含 md 标记(代码块/链接)原样保留', () => {
    const full = '前 [link](url) 后';
    const diff = buildReplacementDiff(full, { from: 2, to: 13 }, '[new](http://x)');
    assert.equal(diff.new_string, '前 [new](http://x) 后');
  });
});
