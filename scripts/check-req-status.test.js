import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseBacklog, compareSemver, gitReqCommits, commitLocations, tagList, deriveTruth, parseSpecsPlans, findDeviations, findTagDrift, findUntrackedFeat, formatReport } from './check-req-status.js';

const SAMPLE = `# SSOT
## Ready(四要素补齐)
| ID | 标题 | 里程碑 | P | 类型 | 状态 |
|----|------|--------|-----|------|------|
| REQ-031 | 对话下方空白 | — | P1 | fix | ready |
| REQ-040 | 状态校验工具 | v0.9 | P1 | feat | ready |

## Released(已发版)
| ID | 标题 | 版本 | spec |
|----|------|------|------|
| REQ-013 | 会话重命名 | v0.8.0 | x |
`;

test('parseBacklog 提取表格行 REQ + 状态 + 版本', () => {
  const e = parseBacklog(SAMPLE);
  const r31 = e.find(x => x.id === 'REQ-031');
  assert.equal(r31.claimedStatus, 'ready');
  const r40 = e.find(x => x.id === 'REQ-040');
  assert.equal(r40.claimedStatus, 'ready');
  const r13 = e.find(x => x.id === 'REQ-013');
  assert.equal(r13.claimedStatus, 'released');
  assert.equal(r13.claimedVersion, 'v0.8.0');
});

test('parseBacklog 不去重,保留同 id 多次出现', () => {
  const md = `## Ready
| REQ-030 | a | ready |
## Backlog
| REQ-030 | b | spec |`;
  const e = parseBacklog(md).filter(x => x.id === 'REQ-030');
  assert.equal(e.length, 2);
});

test('compareSemver 排序', () => {
  assert.ok(compareSemver('v0.8.3', 'v0.8.4') < 0);
  assert.ok(compareSemver('v0.9.0', 'v0.8.10') > 0);
  assert.equal(compareSemver('v0.8.4', '0.8.4'), 0);
});

function mockExec(table) {
  return (cmd) => {
    for (const [re, out] of table) {
      if (new RegExp(re).test(cmd)) { if (out === 'THROW') throw new Error('git fail'); return out; }
    }
    return '';
  };
}

test('gitReqCommits 按 subject 过滤 REQ + 排除 docs/release', () => {
  const exec = mockExec([['log --format', 'aaa feat(x): REQ-040 实现\nbbb docs(plan): 提到 REQ-040\nccc fix: REQ-040 修\nddd chore(release): v0.8.4 REQ-040']]);
  assert.deepEqual(gitReqCommits('REQ-040', { exec }), ['aaa', 'ccc']);
});

test('gitReqCommits git 失败返回空数组', () => {
  const exec = mockExec([['log', 'THROW']]);
  assert.deepEqual(gitReqCommits('REQ-999', { exec }), []);
});

test('commitLocations 聚合 tags/inMain/branches', () => {
  const exec = mockExec([
    ['tag --contains', 'v0.8.4\nv0.8.3\n'],
    ['merge-base --is-ancestor', ''],
    ['branch --contains', '* main\n feat/x\n'],
  ]);
  const loc = commitLocations('aaa', { exec });
  assert.deepEqual(loc.tags, ['v0.8.4', 'v0.8.3']);
  assert.equal(loc.inMain, true);
  assert.deepEqual(loc.branches, ['main', 'feat/x']);
});

test('commitLocations merge-base 非 0 → inMain false', () => {
  const exec = mockExec([
    ['tag --contains', ''],
    ['merge-base', 'THROW'],
    ['branch --contains', ' feat/x\n'],
  ]);
  const loc = commitLocations('aaa', { exec });
  assert.equal(loc.inMain, false);
  assert.deepEqual(loc.branches, ['feat/x']);
});

test('tagList 返回排序 tag', () => {
  const exec = mockExec([['tag --list', 'v0.8.4\nv0.8.3\nv0.9.0\n']]);
  assert.deepEqual(tagList({ exec }), ['v0.8.3', 'v0.8.4', 'v0.9.0']);
});

test('deriveTruth no-commit 分支', () => {
  const exec = mockExec([['log --format', '']]);
  assert.equal(deriveTruth('REQ-999', { exec }).status, 'no-commit');
});

test('deriveTruth released 分支(取首次 tag=最低)', () => {
  const exec = mockExec([
    ['log --format', 'aaa feat: REQ-040\n'],
    ['tag --contains', 'v0.8.3\nv0.8.4\n'],
    ['merge-base', ''],
    ['branch --contains', 'main\n'],
  ]);
  const t = deriveTruth('REQ-040', { exec });
  assert.equal(t.status, 'released');
  assert.equal(t.version, 'v0.8.3');
});

test('deriveTruth unreleased-in-main 分支', () => {
  const exec = mockExec([
    ['log --format', 'aaa fix: REQ-040\n'],
    ['tag --contains', ''],
    ['merge-base', ''],
    ['branch --contains', 'main\n'],
  ]);
  assert.equal(deriveTruth('REQ-040', { exec }).status, 'unreleased-in-main');
});

test('deriveTruth stranded 分支(只在 feature 分支)', () => {
  const exec = mockExec([
    ['log --format', 'aaa fix: REQ-040\n'],
    ['tag --contains', ''],
    ['merge-base', 'THROW'],
    ['branch --contains', 'feat/req040\n'],
  ]);
  const t = deriveTruth('REQ-040', { exec });
  assert.equal(t.status, 'stranded');
  assert.deepEqual(t.branches, ['feat/req040']);
});

test('parseSpecsPlans 从文件名提取 REQ 映射', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'specs-'));
  fs.mkdirSync(`${tmp}/specs`);
  fs.mkdirSync(`${tmp}/plans`);
  fs.writeFileSync(`${tmp}/specs/2026-07-16-req040-status-design.md`, '');
  fs.writeFileSync(`${tmp}/specs/2026-07-16-planrla-moat-roadmap.md`, '');
  fs.writeFileSync(`${tmp}/plans/2026-07-16-req040-status.md`, '');
  const m = parseSpecsPlans(tmp);
  assert.deepEqual(m['REQ-040'], { specs: ['2026-07-16-req040-status-design.md'], plans: ['2026-07-16-req040-status.md'] });
  assert.equal(m['REQ-038'], undefined);
});

test('ID-CONFLICT: 同 id 两条不同 raw', () => {
  const entries = [
    { id: 'REQ-030', claimedStatus: 'ready', raw: '| REQ-030 | a | ready |', section: 'Ready' },
    { id: 'REQ-030', claimedStatus: 'spec', raw: '| REQ-030 | b | spec |', section: 'Backlog' },
  ];
  const d = findDeviations({ backlogEntries: entries, specsMap: {}, exec: () => '' });
  const conflict = d.find(x => x.type === 'ID-CONFLICT');
  assert.ok(conflict && conflict.id === 'REQ-030');
});

test('ORPHAN: spec 有 backlog 无', () => {
  const d = findDeviations({
    backlogEntries: [],
    specsMap: { 'REQ-038': { specs: ['x.md'], plans: [] } },
    exec: () => '',
  });
  assert.ok(d.find(x => x.type === 'ORPHAN' && x.id === 'REQ-038'));
});

test('MISLABEL: backlog=ready 但 git released', () => {
  const entries = [{ id: 'REQ-031', claimedStatus: 'ready', raw: '| REQ-031 | x | ready |', section: 'Ready' }];
  const exec = mockExec([
    ['log --format', 'aaa feat: REQ-031\n'], ['tag --contains', 'v0.8.4\n'],
    ['merge-base', ''], ['branch --contains', 'main\n'],
  ]);
  const d = findDeviations({ backlogEntries: entries, specsMap: {}, exec });
  assert.ok(d.find(x => x.type === 'MISLABEL' && x.id === 'REQ-031' && x.detail.includes('released@v0.8.4')));
});

test('STRANDED: truth stranded', () => {
  const entries = [{ id: 'REQ-030', claimedStatus: 'spec', raw: '| REQ-030 | x | spec |', section: 'Backlog' }];
  const exec = mockExec([
    ['log --format', 'aaa fix: REQ-030\n'], ['tag --contains', ''],
    ['merge-base', 'THROW'], ['branch --contains', 'feat/req030\n'],
  ]);
  const d = findDeviations({ backlogEntries: entries, specsMap: {}, exec });
  assert.ok(d.find(x => x.type === 'STRANDED' && x.id === 'REQ-030'));
});

test('TAG-DRIFT: commit 提到 0.8.2(不带v) 但 tag 列表无', () => {
  const exec = mockExec([
    ['tag --list', 'v0.8.1\nv0.8.3\n'],
    ['log --format', 'abc123 chore: bump 0.8.2\ndef456 chore(release): v0.8.3\n'],
  ]);
  const d = findTagDrift({ exec });
  assert.ok(d.find(x => x.type === 'TAG-DRIFT' && x.version === 'v0.8.2'), '应抓到 v0.8.2 drift');
  assert.ok(!d.find(x => x.version === 'v0.8.3'), 'v0.8.3 有 tag 不报');
});

test('UNTRACKED-FEAT: feat 不带 REQ', () => {
  const exec = mockExec([['log --format', 'aaa feat(kanban): validate cron\nbbb fix(chat): REQ-031 x\n']]);
  const d = findUntrackedFeat({ exec });
  assert.equal(d.length, 1);
  assert.equal(d[0].commit, 'aaa');
});

test('formatReport 无偏差', () => {
  const r = formatReport({ deviations: [], scanned: 10 });
  assert.match(r, /无偏差/);
});

test('formatReport 有偏差列出每条', () => {
  const r = formatReport({ deviations: [
    { type: 'MISLABEL', id: 'REQ-031', detail: 'ready → released@v0.8.4' },
    { type: 'TAG-DRIFT', version: 'v0.8.2', detail: '无 tag' },
  ], scanned: 40 });
  assert.match(r, /检出 2 偏差/);
  assert.match(r, /\[MISLABEL\] REQ-031/);
  assert.match(r, /\[TAG-DRIFT\] v0.8.2/);
});

test('formatReport UNTRACKED-FEAT 默认折叠,verbose 展开', () => {
  const deviations = [
    { type: 'MISLABEL', id: 'REQ-031', detail: 'x' },
    { type: 'UNTRACKED-FEAT', commit: 'aaa', detail: 'y' },
    { type: 'UNTRACKED-FEAT', commit: 'bbb', detail: 'z' },
  ];
  const folded = formatReport({ deviations, scanned: 40 });
  assert.match(folded, /检出 1 偏差\(\+2 UNTRACKED-FEAT 未展开\)/);
  assert.ok(!/\[UNTRACKED-FEAT\]/.test(folded), '折叠时不逐条列');
  const expanded = formatReport({ deviations, scanned: 40, verbose: true });
  assert.match(expanded, /UNTRACKED-FEAT 展开/);
  assert.match(expanded, /\[UNTRACKED-FEAT\] aaa/);
});
