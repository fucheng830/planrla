import assert from 'node:assert/strict';
import test from 'node:test';
import { substitute, renderStagePrompt, buildMcpPreamble } from '@/modules/kanban/prompt.js';
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
