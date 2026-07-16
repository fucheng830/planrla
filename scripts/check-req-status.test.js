import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseBacklog, compareSemver, gitReqCommits, commitLocations, tagList, deriveTruth, parseSpecsPlans } from './check-req-status.js';

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

test('gitReqCommits 解析 git log 输出为 hash 列表', () => {
  const exec = mockExec([['--format=%H', 'aaa\nbbb\n']]);
  assert.deepEqual(gitReqCommits('REQ-040', { exec }), ['aaa', 'bbb']);
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
  const exec = mockExec([['log', '']]);
  assert.equal(deriveTruth('REQ-999', { exec }).status, 'no-commit');
});

test('deriveTruth released 分支(取最高 tag)', () => {
  const exec = mockExec([
    ['log --grep', 'aaa\n'],
    ['tag --contains', 'v0.8.3\nv0.8.4\n'],
    ['merge-base', ''],
    ['branch --contains', 'main\n'],
  ]);
  const t = deriveTruth('REQ-040', { exec });
  assert.equal(t.status, 'released');
  assert.equal(t.version, 'v0.8.4');
});

test('deriveTruth unreleased-in-main 分支', () => {
  const exec = mockExec([
    ['log --grep', 'aaa\n'],
    ['tag --contains', ''],
    ['merge-base', ''],
    ['branch --contains', 'main\n'],
  ]);
  assert.equal(deriveTruth('REQ-040', { exec }).status, 'unreleased-in-main');
});

test('deriveTruth stranded 分支(只在 feature 分支)', () => {
  const exec = mockExec([
    ['log --grep', 'aaa\n'],
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
