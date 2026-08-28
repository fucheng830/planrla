import assert from 'node:assert/strict';
import test from 'node:test';

import { substitute, renderStagePrompt, buildMcpPreamble } from '@/modules/kanban/prompt.js';
import { buildSdlcDefaultTemplate } from '@/modules/kanban/sdlc-default-template.js';
import type { StageTemplate } from '@/modules/kanban/types.js';

function baseStage(over: Partial<StageTemplate> = {}): StageTemplate {
  return {
    id: 's1', name: 'implement', role: 'agent', autoAdvance: true,
    agent: 'claude', createdAt: 't0', updatedAt: 't0', ...over,
  };
}

const ctx = { taskId: 'task-xyz', taskNumber: 7, stageName: 'implement', stageIndex: 1, rootPath: '/repo', input: 'build foo' };

test('substitute replaces {{var}} placeholders', () => {
  assert.equal(substitute('hello {{name}}!', { name: 'world' }), 'hello world!');
});

test('substitute leaves unknown placeholders as empty string', () => {
  assert.equal(substitute('a={{a}} b={{b}}', { a: '1' }), 'a=1 b=');
});

test('substitute coerces numbers', () => {
  assert.equal(substitute('n={{n}}', { n: 42 }), 'n=42');
});

test('renderStagePrompt substitutes stage template vars', () => {
  const stage = baseStage({ promptTemplate: 'Input: {{input}}\nTask #{{task_number}} stage {{stage_index}} ({{stage_name}}) in {{project_path}}' });
  const out = renderStagePrompt({ stage, ctx });
  assert.match(out, /Input: build foo/);
  assert.match(out, /Task #7 stage 1 \(implement\) in \/repo/);
});

test('renderStagePrompt appends MCP preamble with taskId when agentCanControlStage !== false', () => {
  const stage = baseStage({ promptTemplate: 'do work' });
  const out = renderStagePrompt({ stage, ctx });
  assert.match(out, /task_next/);
  assert.match(out, /"taskId": "task-xyz"/);
});

test('renderStagePrompt omits preamble when agentCanControlStage is false', () => {
  const stage = baseStage({ promptTemplate: 'do work', agentCanControlStage: false });
  const out = renderStagePrompt({ stage, ctx });
  assert.doesNotMatch(out, /task_next/);
  assert.match(out, /do work/);
});

test('buildMcpPreamble returns empty string when disabled', () => {
  assert.equal(buildMcpPreamble(ctx, { enabled: false }), '');
});

test('renderStagePrompt handles missing promptTemplate (empty base + preamble)', () => {
  const stage = baseStage({ promptTemplate: undefined });
  const out = renderStagePrompt({ stage, ctx });
  assert.match(out, /^--- planrla kanban ---/);
});

// --- REQ-043 goal preamble ---

const NOW = '2026-01-01T00:00:00.000Z';
const goalBaseStage = { id: 's', name: 'Do', role: 'agent' as const, agent: 'claude', autoAdvance: false, createdAt: NOW, updatedAt: NOW };
const goalBaseCtx = { taskId: 't-1', taskNumber: 1, stageName: 'Do', stageIndex: 1, rootPath: '/r', input: 'go' };

test('renderStagePrompt appends goal preamble when stage has goalCondition', () => {
  const out = renderStagePrompt({
    stage: { ...goalBaseStage, goalCondition: '所有测试通过' } as any,
    ctx: goalBaseCtx,
  });
  assert.match(out, /所有测试通过/);
  assert.match(out, /task_complete/);
  assert.match(out, /t-1/);
});

test('renderStagePrompt omits goal preamble when no goalCondition', () => {
  const out = renderStagePrompt({ stage: goalBaseStage as any, ctx: goalBaseCtx });
  assert.doesNotMatch(out, /你的目标/);
  assert.doesNotMatch(out, /task_complete/);
});

// --- 截图留证:内置模板「测试验证」阶段渲染产物必须可见截图要求 ---

test('renderStagePrompt renders v2 ss3 with screenshot evidence rules and concrete task number', () => {
  const tpl = buildSdlcDefaultTemplate(NOW);
  const ss3 = tpl.stages.find((s) => s.snapshot.id === 'ss3')!.snapshot;
  const out = renderStagePrompt({
    stage: ss3,
    ctx: { taskId: 't-9', taskNumber: 7, stageName: ss3.name, stageIndex: 3, rootPath: '/repo', input: 'REQ-007 悬浮气泡' },
  });
  assert.match(out, /可视化验证要求\(强制\)/);
  assert.match(out, /debug\/ui-acceptance\//);
  assert.match(out, /task7-hover-popover\.png/, '{{task_number}} must render as the concrete task number');
  assert.match(out, /playwright/);
  assert.match(out, /REQ-007 悬浮气泡/, 'input substituted');
  assert.match(out, /task_next/, 'agentCanControlStage default keeps MCP preamble');
});
