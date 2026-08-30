import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SDLC_DEFAULT_SEED_VERSION,
  buildSdlcDefaultTemplate,
  migrateSdlcDefaultSeed,
  preserveSeedVersion,
} from '@/modules/kanban/sdlc-default-template.js';
import type { TaskTemplate } from '@/modules/kanban/types.js';

const NOW = '2026-01-01T00:00:00.000Z';

/** 模拟磁盘上的 v1(旧版)模板:与 seed v1 原文一致、无 seedVersion 字段。 */
function v1DiskTemplate(over: Partial<TaskTemplate> = {}): TaskTemplate {
  const stage = (id: string, promptTemplate?: string): TaskTemplate['stages'][number] => ({
    id: `st-${id}`, position: 0,
    snapshot: { id, name: id, role: 'agent', autoAdvance: true, agent: 'claude', ...(promptTemplate ? { promptTemplate } : {}), createdAt: NOW, updatedAt: NOW },
  });
  return {
    id: 'sdlc-default',
    name: '研发流程(需求 → 交付)',
    maxConcurrency: 1,
    createdAt: NOW,
    updatedAt: NOW,
    stages: [
      stage('ss0'),
      stage('ss1', '需求:\n{{input}}\n\n请产出技术方案设计:架构选型、改动点、风险。'),
      stage('ss2', '{{input}}\n\n按已确认的技术方案实施开发。'),
      stage('ss3', '{{input}}\n\n运行测试与验证,输出验证记录。'),
      stage('ss4', '{{input}}\n\n整理交付说明并写入 worktree 根目录的 DELIVERY.md:完成内容、改动文件清单、使用/合并方式、遗留事项。这是交付物的一部分。'),
    ],
    ...over,
  };
}

const snap = (tpl: TaskTemplate, sid: string) => tpl.stages.find((s) => s.snapshot.id === sid)!.snapshot;

// --- buildSdlcDefaultTemplate(v2 seed 文案)---

test('buildSdlcDefaultTemplate stamps the current seedVersion', () => {
  const tpl = buildSdlcDefaultTemplate(NOW);
  assert.equal(tpl.seedVersion, SDLC_DEFAULT_SEED_VERSION);
  assert.equal(tpl.seedVersion, 3);
  assert.equal(tpl.stages.length, 6);
});

test('v3 promotes the requirements stage to a plan-mode agent stage', () => {
  const ss0 = snap(buildSdlcDefaultTemplate(NOW), 'ss0');
  assert.equal(ss0.role, 'agent');
  assert.equal(ss0.planMode, true);
  assert.equal(ss0.agentCanControlStage, false, '需求设计产出后必须停在原地等人工评审');
  assert.match(ss0.promptTemplate!, /AskUserQuestion/);
  assert.match(ss0.promptTemplate!, /REQUIREMENTS\.md/);
});

test('v3 inserts a human sign-off stage between design and implementation', () => {
  const tpl = buildSdlcDefaultTemplate(NOW);
  const names = tpl.stages.map((s) => s.snapshot.name);
  assert.ok(names.indexOf('方案确认') > names.indexOf('技术方案'));
  assert.ok(names.indexOf('方案确认') < names.indexOf('开工'));
  const ss1b = snap(tpl, 'ss1b');
  assert.equal(ss1b.role, 'user');
  assert.equal(ss1b.autoAdvance, false);
});

test('v2 ss3 prompt mandates playwright screenshots under debug/ui-acceptance', () => {
  const ss3 = snap(buildSdlcDefaultTemplate(NOW), 'ss3');
  assert.match(ss3.promptTemplate!, /playwright/);
  assert.match(ss3.promptTemplate!, /debug\/ui-acceptance\//);
  assert.match(ss3.promptTemplate!, /task\{\{task_number\}\}-/);
  assert.match(ss3.promptTemplate!, /debug\/capture-task\{\{task_number\}\}-/);
  assert.match(ss3.promptTemplate!, /本任务无可视化改动/);
});

test('v2 ss4 prompt requires DELIVERY.md evidence section', () => {
  const ss4 = snap(buildSdlcDefaultTemplate(NOW), 'ss4');
  assert.match(ss4.promptTemplate!, /验证证据/);
  assert.match(ss4.promptTemplate!, /!\[场景\]\(debug\/ui-acceptance\//);
  assert.match(ss4.promptTemplate!, /本任务无可视化改动/);
});

// --- migrateSdlcDefaultSeed(v2/v1 → v3 结构性迁移)---

test('migration upgrades a legacy v1 disk template to the full v3 stage structure', () => {
  const { tpl, upgraded, skipped } = migrateSdlcDefaultSeed(v1DiskTemplate(), NOW);
  assert.deepEqual(upgraded.sort(), ['ss0', 'ss1', 'ss1b', 'ss2', 'ss3', 'ss4']);
  assert.deepEqual(skipped, []);
  assert.equal(tpl.seedVersion, SDLC_DEFAULT_SEED_VERSION);
  const fresh = buildSdlcDefaultTemplate(NOW);
  assert.deepEqual(tpl.stages.map((s) => s.snapshot.id), fresh.stages.map((s) => s.snapshot.id));
  assert.equal(snap(tpl, 'ss0').planMode, true);
  assert.ok(tpl.stages.some((s) => s.snapshot.id === 'ss1b'));
});

test('migration is deterministic for historical on-disk variants', () => {
  const disk = v1DiskTemplate();
  const ss4 = disk.stages.find((s) => s.snapshot.id === 'ss4')!;
  ss4.snapshot.promptTemplate = ss4.snapshot.promptTemplate!.replace('{{input}}', '{input}');
  const { tpl, skipped } = migrateSdlcDefaultSeed(disk, NOW);
  assert.deepEqual(skipped, []);
  assert.equal(snap(tpl, 'ss4').promptTemplate, snap(buildSdlcDefaultTemplate(NOW), 'ss4').promptTemplate);
});

test('migration treats user-edited prompts as part of the structural rebuild', () => {
  const disk = v1DiskTemplate();
  const custom = '{{input}}\n\n按团队规范跑测试。';
  const ss3 = disk.stages.find((s) => s.snapshot.id === 'ss3')!;
  ss3.snapshot.promptTemplate = custom;
  const { tpl, upgraded, skipped } = migrateSdlcDefaultSeed(disk, NOW);
  assert.deepEqual(skipped, []);
  assert.ok(upgraded.length > 0);
  assert.equal(tpl.seedVersion, SDLC_DEFAULT_SEED_VERSION, 'seedVersion still advances to avoid re-running migration');
});

test('migration is a no-op for a current-version template', () => {
  const disk = buildSdlcDefaultTemplate(NOW);
  const { tpl, upgraded, skipped } = migrateSdlcDefaultSeed(disk, NOW);
  assert.deepEqual(upgraded, []);
  assert.deepEqual(skipped, []);
  assert.equal(snap(tpl, 'ss3').promptTemplate, snap(disk, 'ss3').promptTemplate);
});

test('migration is idempotent: migrating its own output changes nothing', () => {
  const first = migrateSdlcDefaultSeed(v1DiskTemplate(), NOW);
  const second = migrateSdlcDefaultSeed(first.tpl, NOW);
  assert.deepEqual(second.upgraded, []);
  assert.deepEqual(second.skipped, []);
  assert.equal(snap(second.tpl, 'ss3').promptTemplate, snap(first.tpl, 'ss3').promptTemplate);
});

// --- preserveSeedVersion(前端整体保存兜底)---

test('preserveSeedVersion keeps the on-disk marker when the editor drops it', () => {
  const disk = buildSdlcDefaultTemplate(NOW);
  const body = { ...disk, seedVersion: undefined, name: '改名了' } as unknown as TaskTemplate;
  const out = preserveSeedVersion(body, disk);
  assert.equal(out.seedVersion, disk.seedVersion);
  assert.equal(out.name, '改名了');
});

test('preserveSeedVersion leaves non-built-in templates and explicit values alone', () => {
  const custom = { id: 'my-tpl', name: 'x', maxConcurrency: 1, stages: [], createdAt: NOW, updatedAt: NOW } as unknown as TaskTemplate;
  assert.equal(preserveSeedVersion(custom, buildSdlcDefaultTemplate(NOW)), custom);
  const explicit = buildSdlcDefaultTemplate(NOW);
  assert.equal(preserveSeedVersion(explicit, null), explicit);
  const noDisk = buildSdlcDefaultTemplate(NOW);
  assert.equal(preserveSeedVersion(noDisk, null), noDisk);
});
