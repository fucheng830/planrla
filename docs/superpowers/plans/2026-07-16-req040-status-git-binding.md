---
REQ-ID: REQ-040
标题: 状态机↔git 自动绑定 + BACKLOG 状态校验工具(check-req-status)实施计划
日期: 2026-07-16
spec: docs/superpowers/specs/2026-07-16-req040-status-git-binding-design.md
---

# REQ-040 状态校验工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans 逐 task 实施。Steps 用 checkbox(`- [ ]`)跟踪。

**Goal:** 交付一个纯只读 CLI 工具 `scripts/check-req-status.js`,用 git 单一真相校验 `docs/process/BACKLOG.md` 的需求状态,输出偏差清单,消除手动对账人工。

**Architecture:** 单文件 ESM 脚本(~300 行),分四层:解析层(parseBacklog / parseSpecsPlans,纯 markdown/fs)、git 层(gitReqCommits / commitLocations / tagList,execSync 包可注入 exec 便于测试)、校验层(deriveTruth / findDeviations / findTagDrift / findUntrackedFeat)、输出层(formatReport)+ CLI 入口。所有 git 函数接受 `{ exec }` 注入点(默认 execSync wrapper),测试注入 mock,不碰真实 git。

**Tech Stack:** Node v22 ESM、`node:test` + `node:assert/strict`(内置,无新依赖)、`node:child_process` execSync、`node:fs`。

**Worktree:** 代码实施在 `.claude/worktrees/req040-status-binding`(plan 文档本身留 main)。

---

## File Structure

| 文件 | 职责 | 创建/改 |
|---|---|---|
| `scripts/check-req-status.js` | 全部实现(parseBacklog/git 层/deriveTruth/findDeviations/findTagDrift/findUntrackedFeat/formatReport/main) | Create |
| `scripts/check-req-status.test.js` | 单元测试(node:test) | Create |
| `package.json` | 加 `check:reqs` + `test:scripts` script | Modify |

---

## Task 1: 骨架 + parseBacklog + compareSemver

**Files:**
- Create: `scripts/check-req-status.js`
- Create: `scripts/check-req-status.test.js`

- [ ] **Step 1: 写 check-req-status.js 骨架(只放 import + 两个目标函数的占位导出,让测试 import 不报错)**

```js
#!/usr/bin/env node
// REQ-040: 用 git 单一真相校验 BACKLOG 状态。纯只读,不改 SSOT。
// 跑法:node scripts/check-req-status.js [--req REQ-NNN] [--json] [--md]
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// 默认 git 执行器(可被测试注入 mock 替换)
const defaultExec = (cmd, opts) => execSync(cmd, { encoding: 'utf-8', ...opts });

// semver 比较,返回负/0/正
export function compareSemver(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] || 0, db = pb[i] || 0;
    if (da !== db) return da - db;
  }
  return 0;
}

// 扫 BACKLOG.md,提取每个 REQ-NNN 出现 {id, claimedStatus, claimedVersion, line, section, raw}
// 不去重(保留多次出现供 ID-CONFLICT 检测)
export function parseBacklog(md) {
  // Step 3 实现
}
```

- [ ] **Step 2: 写 parseBacklog 的失败测试**

在 `scripts/check-req-status.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBacklog, compareSemver } from './check-req-status.js';

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
```

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test scripts/check-req-status.test.js`
Expected: parseBackver 断言失败(parseBacklog 目前返回 undefined,`.find` 报错)

- [ ] **Step 4: 实现 parseBacklog**

替换 `scripts/check-req-status.js` 里 `parseBacklog` 函数体:
```js
const STATUSES = ['backlog','ready','spec','plan','doing','review','accepted','released','parked','blocked','dropped'];

export function parseBacklog(md) {
  const lines = md.split('\n');
  const entries = [];
  let currentSection = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { currentSection = h[1]; continue; }
    const m = line.match(/REQ-(\d{3})/);
    if (!m || !line.startsWith('|')) continue;
    const id = `REQ-${m[1]}`;
    let claimedStatus = STATUSES.find(s => new RegExp(`\\b${s}\\b`, 'i').test(line));
    if (!claimedStatus) claimedStatus = /released/i.test(currentSection) ? 'released' : currentSection;
    const vm = line.match(/v0\.\d+\.\d+/);
    entries.push({ id, claimedStatus, claimedVersion: vm ? vm[0] : null, line: i + 1, section: currentSection, raw: line });
  }
  return entries;
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test scripts/check-req-status.test.js`
Expected: 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/check-req-status.js scripts/check-req-status.test.js
git commit -m "feat(scripts): REQ-040 parseBacklog + compareSemver (TDD)"
```

---

## Task 2: git 层(gitReqCommits / commitLocations / tagList)

**Files:**
- Modify: `scripts/check-req-status.js`(追加 git 层函数)
- Modify: `scripts/check-req-status.test.js`(追加测试)

- [ ] **Step 1: 追加 git 层函数到 check-req-status.js(放在 parseBacklog 之后)**

```js
// 查某 REQ 的所有 commit hash
export function gitReqCommits(reqId, { cwd = process.cwd(), exec = defaultExec } = {}) {
  try {
    const out = exec(`git log --grep="${reqId}" --format=%H`, { cwd });
    return out.trim().split('\n').filter(Boolean);
  } catch { return []; }
}

// 查一个 commit 的位置:进了哪些 tag、是否在 main、在哪些分支
export function commitLocations(hash, { cwd = process.cwd(), exec = defaultExec } = {}) {
  let tags = [];
  try { tags = exec(`git tag --contains ${hash}`, { cwd }).trim().split('\n').filter(Boolean); } catch {}
  let inMain = false;
  try { exec(`git merge-base --is-ancestor ${hash} main`, { cwd }); inMain = true; } catch {}
  let branches = [];
  try {
    branches = exec(`git branch --contains ${hash}`, { cwd })
      .split('\n').map(b => b.replace(/^\*?\s*/, '').trim()).filter(Boolean);
  } catch {}
  return { tags, inMain, branches };
}

// 排序后的 tag 列表
export function tagList({ cwd = process.cwd(), exec = defaultExec } = {}) {
  try {
    const out = exec(`git tag --list "v*"`, { cwd });
    return out.trim().split('\n').filter(Boolean).sort(compareSemver);
  } catch { return []; }
}
```

- [ ] **Step 2: 追加测试(注入 mock exec,不碰真实 git)**

追加到 `check-req-status.test.js`:
```js
import { gitReqCommits, commitLocations, tagList } from './check-req-status.js';

// mock exec:按命令模式返回预设输出
function mockExec(table) {
  return (cmd) => {
    for (const [re, out] of table) {
      if (new RegExp(re).test(cmd)) { if (out === 'THROW') throw new Error('git fail'); return out; }
    }
    return '';
  };
}

test('gitReqCommits 解析 git log 输出为 hash 列表', () => {
  const exec = mockExec([[ '--format=%H', 'aaa\nbbb\n' ]]);
  assert.deepEqual(gitReqCommits('REQ-040', { exec }), ['aaa', 'bbb']);
});

test('gitReqCommits git 失败返回空数组', () => {
  const exec = mockExec([[ 'log', 'THROW' ]]);
  assert.deepEqual(gitReqCommits('REQ-999', { exec }), []);
});

test('commitLocations 聚合 tags/inMain/branches', () => {
  const exec = mockExec([
    [ 'tag --contains', 'v0.8.4\nv0.8.3\n' ],
    [ 'merge-base --is-ancestor', '' ],          // exit 0 = inMain true
    [ 'branch --contains', '* main\n feat/x\n' ],
  ]);
  const loc = commitLocations('aaa', { exec });
  assert.deepEqual(loc.tags, ['v0.8.4', 'v0.8.3']);
  assert.equal(loc.inMain, true);
  assert.deepEqual(loc.branches, ['main', 'feat/x']);
});

test('commitLocations merge-base 非 0 → inMain false', () => {
  const exec = mockExec([
    [ 'tag --contains', '' ],
    [ 'merge-base', 'THROW' ],   // 非 0 → 不在 main
    [ 'branch --contains', ' feat/x\n' ],
  ]);
  const loc = commitLocations('aaa', { exec });
  assert.equal(loc.inMain, false);
  assert.deepEqual(loc.branches, ['feat/x']);
});

test('tagList 返回排序 tag', () => {
  const exec = mockExec([[ 'tag --list', 'v0.8.4\nv0.8.3\nv0.9.0\n' ]]);
  assert.deepEqual(tagList({ exec }), ['v0.8.3', 'v0.8.4', 'v0.9.0']);
});
```

- [ ] **Step 3: 跑测试确认通过**

Run: `node --test scripts/check-req-status.test.js`
Expected: 全部 PASS(含 Task 1 的 3 个 + 本 task 5 个 = 8)

- [ ] **Step 4: Commit**

```bash
git add scripts/check-req-status.js scripts/check-req-status.test.js
git commit -m "feat(scripts): REQ-040 git 层 gitReqCommits/commitLocations/tagList (mock exec)"
```

---

## Task 3: deriveTruth(状态推导,四分支)

**Files:**
- Modify: `scripts/check-req-status.js`
- Modify: `scripts/check-req-status.test.js`

- [ ] **Step 1: 追加 deriveTruth 到 check-req-status.js**

```js
// 从 git 推导某 REQ 的真实状态。四分支:released / unreleased-in-main / stranded / no-commit
export function deriveTruth(reqId, { cwd = process.cwd(), exec = defaultExec } = {}) {
  const commits = gitReqCommits(reqId, { cwd, exec });
  if (commits.length === 0) return { status: 'no-commit', commits: [] };
  const allTags = new Set();
  let inMain = false;
  const branches = new Set();
  for (const c of commits) {
    const loc = commitLocations(c, { cwd, exec });
    loc.tags.forEach(t => allTags.add(t));
    if (loc.inMain) inMain = true;
    loc.branches.forEach(b => branches.add(b));
  }
  if (allTags.size > 0) {
    const sorted = [...allTags].sort(compareSemver);
    return { status: 'released', version: sorted[sorted.length - 1], commits };
  }
  if (inMain) return { status: 'unreleased-in-main', commits };
  const feat = [...branches].filter(b => b !== 'main' && !b.startsWith('('));
  if (feat.length) return { status: 'stranded', branches: feat, commits };
  return { status: 'unknown', commits };
}
```

- [ ] **Step 2: 追加四分支测试**

追加到测试文件:
```js
import { deriveTruth } from './check-req-status.js';

test('deriveTruth no-commit 分支', () => {
  const exec = mockExec([[ 'log', '' ]]);
  assert.equal(deriveTruth('REQ-999', { exec }).status, 'no-commit');
});

test('deriveTruth released 分支(取最高 tag)', () => {
  const exec = mockExec([
    [ 'log --grep', 'aaa\n' ],
    [ 'tag --contains', 'v0.8.3\nv0.8.4\n' ],
    [ 'merge-base', '' ],
    [ 'branch --contains', 'main\n' ],
  ]);
  const t = deriveTruth('REQ-040', { exec });
  assert.equal(t.status, 'released');
  assert.equal(t.version, 'v0.8.4');
});

test('deriveTruth unreleased-in-main 分支(在 main 无 tag)', () => {
  const exec = mockExec([
    [ 'log --grep', 'aaa\n' ],
    [ 'tag --contains', '' ],
    [ 'merge-base', '' ],     // inMain
    [ 'branch --contains', 'main\n' ],
  ]);
  assert.equal(deriveTruth('REQ-040', { exec }).status, 'unreleased-in-main');
});

test('deriveTruth stranded 分支(只在 feature 分支)', () => {
  const exec = mockExec([
    [ 'log --grep', 'aaa\n' ],
    [ 'tag --contains', '' ],
    [ 'merge-base', 'THROW' ],  // 不在 main
    [ 'branch --contains', 'feat/req040\n' ],
  ]);
  const t = deriveTruth('REQ-040', { exec });
  assert.equal(t.status, 'stranded');
  assert.deepEqual(t.branches, ['feat/req040']);
});
```

- [ ] **Step 3: 跑测试确认通过**

Run: `node --test scripts/check-req-status.test.js`
Expected: 12 tests PASS

- [ ] **Step 4: Commit**

```bash
git add scripts/check-req-status.js scripts/check-req-status.test.js
git commit -m "feat(scripts): REQ-040 deriveTruth 四分支状态推导"
```

---

## Task 4: parseSpecsPlans

**Files:**
- Modify: `scripts/check-req-status.js`
- Modify: `scripts/check-req-status.test.js`

- [ ] **Step 1: 追加 parseSpecsPlans 到 check-req-status.js**

```js
// 扫 docs/superpowers/{specs,plans}/,提取 REQ-NNN → {specs:[], plans:[]}
export function parseSpecsPlans(baseDir) {
  const result = {};
  const scan = (sub, key) => {
    const dir = path.join(baseDir, sub);
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const m = f.match(/req0*(\d{2,3})/i);
      if (!m) continue;
      const id = `REQ-${m[1].padStart(3, '0')}`;
      (result[id] ??= { specs: [], plans: [] })[key].push(f);
    }
  };
  scan('specs', 'specs');
  scan('plans', 'plans');
  return result;
}
```

- [ ] **Step 2: 追加测试(用 tmp 目录建假 spec/plan 文件)**

追加:
```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSpecsPlans } from './check-req-status.js';

test('parseSpecsPlans 从文件名提取 REQ 映射', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'specs-'));
  fs.mkdirSync(`${tmp}/specs`);
  fs.mkdirSync(`${tmp}/plans`);
  fs.writeFileSync(`${tmp}/specs/2026-07-16-req040-status-design.md`, '');
  fs.writeFileSync(`${tmp}/specs/2026-07-16-planrla-moat-roadmap.md`, ''); // 无 req → 跳过
  fs.writeFileSync(`${tmp}/plans/2026-07-16-req040-status.md`, '');
  const m = parseSpecsPlans(tmp);
  assert.deepEqual(m['REQ-040'], { specs: ['2026-07-16-req040-status-design.md'], plans: ['2026-07-16-req040-status.md'] });
  assert.equal(m['REQ-038'], undefined); // 无对应文件
});
```

- [ ] **Step 3: 跑测试确认通过**

Run: `node --test scripts/check-req-status.test.js`
Expected: 13 tests PASS

- [ ] **Step 4: Commit**

```bash
git add scripts/check-req-status.js scripts/check-req-status.test.js
git commit -m "feat(scripts): REQ-040 parseSpecsPlans 扫 specs/plans 映射"
```

---

## Task 5: findDeviations(ID-CONFLICT / ORPHAN / SPEC-GAP / MISLABEL / STRANDED)

**Files:**
- Modify: `scripts/check-req-status.js`
- Modify: `scripts/check-req-status.test.js`

- [ ] **Step 1: 追加 findDeviations 到 check-req-status.js**

```js
// 拿 backlog 条目 + specs 映射 + git 真相对账,返回偏差数组
export function findDeviations({ backlogEntries, specsMap, cwd = process.cwd(), exec = defaultExec }) {
  const deviations = [];
  const byId = {};
  for (const e of backlogEntries) (byId[e.id] ??= []).push(e);
  const knownIds = new Set(Object.keys(byId));

  // ID-CONFLICT: 同 id 多条不同 raw
  for (const [id, occs] of Object.entries(byId)) {
    const uniqRaw = new Set(occs.map(o => o.raw));
    if (uniqRaw.size > 1) {
      deviations.push({ type: 'ID-CONFLICT', id, detail: `编号被 ${occs.length} 条占用`, entries: occs });
    }
  }

  // ORPHAN: spec/plan 有但 backlog 无
  for (const [id, files] of Object.entries(specsMap)) {
    if (!knownIds.has(id)) {
      deviations.push({ type: 'ORPHAN', id, detail: '有 spec/plan 无 BACKLOG 条目', files });
    }
  }

  // SPEC-GAP: backlog 有(spec 之后状态)但无 spec/plan
  for (const [id, occs] of Object.entries(byId)) {
    if (!specsMap[id] && occs.some(o => /spec|plan|doing|review|accepted|released/i.test(o.claimedStatus))) {
      deviations.push({ type: 'SPEC-GAP', id, detail: `BACKLOG=${occs[0].claimedStatus} 但无 spec/plan` });
    }
  }

  // MISLABEL + STRANDED: 对每个 backlog id 推导 truth
  for (const [id, occs] of Object.entries(byId)) {
    const claimed = occs[0];
    const truth = deriveTruth(id, { cwd, exec });
    if (truth.status === 'released' && !/released/i.test(claimed.claimedStatus)) {
      deviations.push({ type: 'MISLABEL', id, detail: `BACKLOG=${claimed.claimedStatus} → released@${truth.version}`, commit: truth.commits[0] });
    }
    if (truth.status === 'stranded') {
      deviations.push({ type: 'STRANDED', id, detail: `有 commit 卡 ${truth.branches.join(',')} (未进 main)`, commit: truth.commits[0] });
    }
    if (truth.status === 'unreleased-in-main' && /released/i.test(claimed.claimedStatus)) {
      deviations.push({ type: 'MISLABEL', id, detail: 'BACKLOG=released 但 git 仅 in-main 未进 tag' });
    }
  }
  return deviations;
}
```

- [ ] **Step 2: 追加测试(注入 mock exec 控制 deriveTruth)**

追加:
```js
import { findDeviations } from './check-req-status.js';

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
    [ 'log --grep', 'aaa\n' ], [ 'tag --contains', 'v0.8.4\n' ],
    [ 'merge-base', '' ], [ 'branch --contains', 'main\n' ],
  ]);
  const d = findDeviations({ backlogEntries: entries, specsMap: {}, exec });
  assert.ok(d.find(x => x.type === 'MISLABEL' && x.id === 'REQ-031' && x.detail.includes('released@v0.8.4')));
});

test('STRANDED: truth stranded', () => {
  const entries = [{ id: 'REQ-030', claimedStatus: 'spec', raw: '| REQ-030 | x | spec |', section: 'Backlog' }];
  const exec = mockExec([
    [ 'log --grep', 'aaa\n' ], [ 'tag --contains', '' ],
    [ 'merge-base', 'THROW' ], [ 'branch --contains', 'feat/req030\n' ],
  ]);
  const d = findDeviations({ backlogEntries: entries, specsMap: {}, exec });
  assert.ok(d.find(x => x.type === 'STRANDED' && x.id === 'REQ-030'));
});
```

- [ ] **Step 3: 跑测试确认通过**

Run: `node --test scripts/check-req-status.test.js`
Expected: 17 tests PASS

- [ ] **Step 4: Commit**

```bash
git add scripts/check-req-status.js scripts/check-req-status.test.js
git commit -m "feat(scripts): REQ-040 findDeviations 五类偏差判定"
```

---

## Task 6: findTagDrift + findUntrackedFeat(启发式)

**Files:**
- Modify: `scripts/check-req-status.js`
- Modify: `scripts/check-req-status.test.js`

- [ ] **Step 1: 追加两个启发式函数**

```js
// TAG-DRIFT: commit message 提到 vX.Y.Z 但无对应 tag
export function findTagDrift({ cwd = process.cwd(), exec = defaultExec } = {}) {
  const tags = new Set(tagList({ cwd, exec }));
  const drift = [];
  const seen = new Set();
  try {
    const log = exec(`git log --format="%H %s"`, { cwd });
    for (const line of log.split('\n')) {
      for (const v of line.matchAll(/v0\.\d+\.\d+/g)) {
        const version = v[0];
        if (tags.has(version) || seen.has(version)) continue;
        seen.add(version);
        drift.push({ type: 'TAG-DRIFT', version, commit: line.split(' ')[0], detail: `commit 提到 ${version} 但无对应 tag` });
      }
    }
  } catch {}
  return drift;
}

// UNTRACKED-FEAT: feat/fix commit 不带 REQ-NNN(漏标启发式)
export function findUntrackedFeat({ cwd = process.cwd(), exec = defaultExec } = {}) {
  const out = [];
  try {
    const log = exec(`git log --format="%H %s"`, { cwd });
    for (const line of log.split('\n')) {
      const m = line.match(/^[0-9a-f]+ (feat|fix)(\([^)]*\))?:\s*(.*)$/i);
      if (m && !/REQ-\d{3}/.test(line)) {
        out.push({ type: 'UNTRACKED-FEAT', commit: line.split(' ')[0], detail: `feat/fix 未标 REQ: ${m[3]}` });
      }
    }
  } catch {}
  return out;
}
```

- [ ] **Step 2: 追加测试**

追加:
```js
import { findTagDrift, findUntrackedFeat } from './check-req-status.js';

test('TAG-DRIFT: commit 提到 v0.8.2 但 tag 列表无', () => {
  const exec = mockExec([
    [ 'tag --list', 'v0.8.1\nv0.8.3\n' ],            // 注意 tagList 用 --list
    [ 'log --format', 'abc123 chore: bump 0.8.2\ndef456 chore(release): v0.8.3\n' ],
  ]);
  const d = findTagDrift({ exec });
  assert.ok(d.find(x => x.type === 'TAG-DRIFT' && x.version === 'v0.8.2'));
  assert.ok(!d.find(x => x.version === 'v0.8.3')); // 有 tag 不报
});

test('UNTRACKED-FEAT: feat 不带 REQ', () => {
  const exec = mockExec([[ 'log --format', 'aaa feat(kanban): validate cron\nbbb fix(chat): REQ-031 x\n' ]]);
  const d = findUntrackedFeat({ exec });
  assert.equal(d.length, 1);
  assert.equal(d[0].commit, 'aaa');
});
```

- [ ] **Step 3: 跑测试确认通过**

Run: `node --test scripts/check-req-status.test.js`
Expected: 19 tests PASS

- [ ] **Step 4: Commit**

```bash
git add scripts/check-req-status.js scripts/check-req-status.test.js
git commit -m "feat(scripts): REQ-040 TAG-DRIFT + UNTRACKED-FEAT 启发式"
```

---

## Task 7: formatReport

**Files:**
- Modify: `scripts/check-req-status.js`
- Modify: `scripts/check-req-status.test.js`

- [ ] **Step 1: 追加 formatReport**

```js
// 人类可读报告。deviations: [{type, id?, version?, detail, ...}]
export function formatReport({ deviations, scanned }) {
  if (!deviations || deviations.length === 0) {
    return `✓ 共扫 ${scanned} REQ,无偏差。`;
  }
  const lines = [`REQ 状态校验 (git 单一真相) — 共扫 ${scanned} REQ,检出 ${deviations.length} 偏差:`, ''];
  for (const d of deviations) {
    const head = d.id || d.version || d.commit || '';
    lines.push(`[${d.type}] ${head} ${d.detail}`);
  }
  lines.push('', 'exit 1 (有偏差) · BACKLOG SSOT 未改动');
  return lines.join('\n');
}
```

- [ ] **Step 2: 追加测试**

追加:
```js
import { formatReport } from './check-req-status.js';

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
```

- [ ] **Step 3: 跑测试确认通过**

Run: `node --test scripts/check-req-status.test.js`
Expected: 21 tests PASS

- [ ] **Step 4: Commit**

```bash
git add scripts/check-req-status.js scripts/check-req-status.test.js
git commit -m "feat(scripts): REQ-040 formatReport 输出层"
```

---

## Task 8: CLI 入口 + flags + 退出码

**Files:**
- Modify: `scripts/check-req-status.js`(文件末尾追加 main)

- [ ] **Step 1: 追加 main 入口(文件末尾,`import.meta.url === ...` 守卫使测试 import 时不触发)**

```js
// CLI 入口(只在直接运行时执行,测试 import 时跳过)
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const jsonOut = args.includes('--json');
  const reqIdx = args.indexOf('--req');
  const root = process.cwd();
  const backlogPath = path.join(root, 'docs/process/BACKLOG.md');
  if (!fs.existsSync(backlogPath)) {
    console.error(`✗ 不在 planrla 根(找不到 ${backlogPath})`); process.exit(2);
  }
  const backlogEntries = parseBacklog(fs.readFileSync(backlogPath, 'utf-8'));
  const specsMap = parseSpecsPlans(path.join(root, 'docs/superpowers'));

  // --req REQ-NNN: 单条诊断
  if (reqIdx >= 0 && args[reqIdx + 1]) {
    const id = args[reqIdx + 1];
    const truth = deriveTruth(id);
    console.log(JSON.stringify({ id, ...truth }, null, 2));
    process.exit(0);
  }

  const deviations = [
    ...findDeviations({ backlogEntries, specsMap }),
    ...findTagDrift(),
    ...findUntrackedFeat(),
  ];
  const scanned = new Set(backlogEntries.map(e => e.id)).size;
  if (jsonOut) {
    console.log(JSON.stringify({ scanned, deviations }, null, 2));
  } else {
    console.log(formatReport({ deviations, scanned }));
  }
  process.exit(deviations.length > 0 ? 1 : 0);
}
```

- [ ] **Step 2: 手动验证 --req 单条诊断(在 planrla 根)**

Run: `node scripts/check-req-status.js --req REQ-031`
Expected: 输出 REQ-031 的真实位置 JSON(应显示 status: released, version: v0.8.4 或 unreleased,取决于实际 git)。退出码 0。

- [ ] **Step 3: 手动验证全量 + 退出码**

Run: `node scripts/check-req-status.js; echo "exit=$?"`
Expected: 列出偏差(至少含 REQ-031/032 MISLABEL、REQ-030 STRANDED、REQ-038 ORPHAN、v0.8.2 TAG-DRIFT),`exit=1`。

- [ ] **Step 4: 跑全测确认 import 守卫生效(main 没在测试时触发)**

Run: `node --test scripts/check-req-status.test.js`
Expected: 21 tests PASS(main 块没误触发 process.exit)

- [ ] **Step 5: Commit**

```bash
git add scripts/check-req-status.js
git commit -m "feat(scripts): REQ-040 CLI 入口 + --req/--json + 退出码"
```

---

## Task 9: package.json scripts + e2e 夹具验证(验收①)

**Files:**
- Modify: `package.json`(加 `check:reqs` + `test:scripts`)

- [ ] **Step 1: 加两个 script**

在 `package.json` 的 `scripts` 里加(位置紧挨现有 `test` 之后):
```json
"check:reqs": "node scripts/check-req-status.js",
"test:scripts": "node --test scripts/*.test.js",
```

- [ ] **Step 2: 跑 test:scripts 确认全部测试通过**

Run: `npm run test:scripts`
Expected: 21 tests PASS,0 fail。

- [ ] **Step 3: e2e 验证 — 跑 check:reqs,断言抓出 PLANS_STATUS 已知失真**

Run: `npm run check:reqs`
Expected: 输出至少含以下偏差(对照 spec 验收①):
- `MISLABEL` REQ-031(ready → released@v0.8.4)
- `MISLABEL` REQ-032(spec → released@v0.8.3)
- `STRANDED` REQ-030(卡 feat/req030-auto-rename)
- `ORPHAN` REQ-038(有 spec 无 BACKLOG)
- `TAG-DRIFT` v0.8.2(有 bump commit 无 tag)
- 可能含 `ID-CONFLICT` REQ-030(若 BACKLOG 仍有撞号条目)

**若任一预期偏差没抓到 → 停,排查(可能 parseBacklog 状态关键词或 deriveTruth 推导有 bug)。这是 dogfood 自验证的核心断言。**

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "feat(scripts): REQ-040 加 check:reqs + test:scripts, e2e 抓出已知失真"
```

---

## Task 10: typecheck/build 回归 + 最终验收清单

**Files:** 无(纯验证)

- [ ] **Step 1: typecheck 回归(确认工具 .js 不破坏 TS 构建)**

Run: `npm run typecheck`
Expected: 通过(tsc 不扫 scripts/*.js,无新错误)。

- [ ] **Step 2: build 回归**

Run: `npm run build`
Expected: build:client + build:server 均成功。

- [ ] **Step 3: 最终验收清单(对照 spec §13)**

逐项确认:
- [ ] `npm run check:reqs` 抓出 PLANS_STATUS 5 条已知失真 + v0.8.2 drift(验收①)
- [ ] `--req REQ-NNN` 能定位任意 REQ 在 main/tag/branch 的真实位置(验收②)
- [ ] 输出 7 类偏差可识别(MISLABEL/STRANDED/ORPHAN/SPEC-GAP/TAG-DRIFT/ID-CONFLICT/UNTRACKED-FEAT)(验收③)
- [ ] 幂等可重跑:再跑一次 `npm run check:reqs` 输出一致(验收④)
- [ ] `npm run typecheck && npm run build` 干净(验收⑤)
- [ ] `npm run test:scripts` 21 tests PASS(验收⑥)

- [ ] **Step 4: 更新 BACKLOG REQ-040 状态 → spec(已转 plan),最终 commit**

```bash
# 状态推进:plan checkbox 全勾后,Archie 验收三道门,再置 accepted
# 此处仅标记 plan 完成,不动 BACKLOG 状态(等 Archie 验收)
git log --oneline -10  # 确认 10 个 task commit 都在
```

---

## Self-Review(写完后自查)

**Spec 覆盖**:
- spec §5 数据流 → Task 1-3(parseBacklog + git + deriveTruth)✓
- spec §6 偏差类型 7 类 → Task 5(5 类)+ Task 6(2 类)✓
- spec §7 组件 → 全覆盖(parseBacklog/parseSpecsPlans/git 层/deriveTruth/findDeviations/formatReport)✓
- spec §8 CLI flags(--req/--json)→ Task 8 ✓ (--md 不做,YAGNI,formatReport 已可手动重定向)
- spec §10 退出码(exit 0/1/2)→ Task 8 ✓
- spec §11 测试(单测 + e2e 夹具)→ Task 1-7 单测 + Task 9 e2e ✓
- spec §13 验收标准 6 条 → Task 10 清单逐项 ✓

**Placeholder**:无 TBD/TODO;每步含完整代码。

**Type 一致**:函数签名跨 task 一致(git 层全 `{ cwd, exec }`,findDeviations 取 `backlogEntries/specsMap/cwd/exec`),deriveTruth 返回 `{status, version?, branches?, commits}` 各处用法对齐。

**注**:`--md` flag 在 spec §8 列为可选,plan 砍掉(YAGNI,`npm run check:reqs > file.md` 即可)。如 Archie 要,加一个 Task 8b。
