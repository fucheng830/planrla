import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlanSteps } from './planSteps';

test('parsePlanSteps: checkbox 列表(≥2)→ 步骤', () => {
  const md = '- [ ] 第一步\n- [ ] 第二步\n- [x] 第三步';
  const steps = parsePlanSteps(md);
  assert.ok(steps);
  assert.equal(steps!.length, 3);
  assert.equal(steps![0].checked, false);
  assert.equal(steps![2].checked, true);
  assert.equal(steps![2].text, '第三步');
});

test('parsePlanSteps: 编号列表(≥2)→ 步骤', () => {
  const md = '1. 先做这个\n2. 再做那个';
  const steps = parsePlanSteps(md);
  assert.ok(steps);
  assert.equal(steps!.length, 2);
  assert.equal(steps![0].marker, '1.');
  assert.equal(steps![1].text, '再做那个');
});

test('parsePlanSteps: 仅 1 行步骤 → null(不够)', () => {
  assert.equal(parsePlanSteps('- [ ] 唯一一步'), null);
});

test('parsePlanSteps: 自由文本 plan → null', () => {
  const md = '这是一个自由文本 plan,没有步骤结构。\n第二段描述。';
  assert.equal(parsePlanSteps(md), null);
});

test('parsePlanSteps: 步骤前的引导文本被跳过', () => {
  const md = '我来规划一下:\n\n- [ ] 步骤A\n- [ ] 步骤B';
  const steps = parsePlanSteps(md);
  assert.ok(steps);
  assert.equal(steps!.length, 2);
});

test('parsePlanSteps: 空串 → null', () => {
  assert.equal(parsePlanSteps(''), null);
  assert.equal(parsePlanSteps(undefined as any), null);
});

test('parsePlanSteps: checkbox 与编号不混(遇异类中断)', () => {
  const md = '- [ ] A\n- [ ] B\n然后说明\n- [ ] C';
  const steps = parsePlanSteps(md);
  assert.ok(steps);
  assert.equal(steps!.length, 2);
});
