#!/usr/bin/env node
// REQ-040: 用 git 单一真相校验 BACKLOG 状态。纯只读,不改 SSOT。
// 跑法: node scripts/check-req-status.js [--req REQ-NNN] [--json]
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// 默认 git 执行器(测试可注入 mock)
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

const STATUSES = ['backlog', 'ready', 'spec', 'plan', 'doing', 'review', 'accepted', 'released', 'parked', 'blocked', 'dropped'];

// 扫 BACKLOG.md,提取每个 REQ-NNN 出现 {id, claimedStatus, claimedVersion, line, section, raw}
// 不去重(保留多次出现供 ID-CONFLICT 检测)
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

// 查某 REQ 的所有实现 commit hash。只按 subject 匹配(不含 body),排除 docs/release 文档类。
export function gitReqCommits(reqId, { cwd = process.cwd(), exec = defaultExec } = {}) {
  try {
    const log = exec(`git log --format="%H %s"`, { cwd });
    return log.split('\n').filter(Boolean)
      .map(line => ({ hash: line.split(' ')[0], subject: line.slice(line.indexOf(' ') + 1) }))
      .filter(c => new RegExp(`\\b${reqId}\\b`).test(c.subject))
      .filter(c => !/^(docs\b|docs\(|chore\(release\)|docs\(release\))/i.test(c.subject))
      .map(c => c.hash);
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
    return { status: 'released', version: sorted[0], commits };
  }
  if (inMain) return { status: 'unreleased-in-main', commits };
  const feat = [...branches].filter(b => b !== 'main' && !b.startsWith('('));
  if (feat.length) return { status: 'stranded', branches: feat, commits };
  return { status: 'unknown', commits };
}

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
    if (!specsMap[id] && occs.some(o => /spec|plan|doing|review|accepted/i.test(o.claimedStatus))) {
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

// TAG-DRIFT: commit message 提到 vX.Y.Z(或 X.Y.Z)但无对应 tag。归一化去 v 比较。
export function findTagDrift({ cwd = process.cwd(), exec = defaultExec } = {}) {
  const tags = new Set(tagList({ cwd, exec }).map(t => t.replace(/^v/, '')));
  const drift = [];
  const seen = new Set();
  try {
    const log = exec(`git log --format="%H %s"`, { cwd });
    for (const line of log.split('\n')) {
      if (!/chore\(release\)|docs\(release\)|bump/i.test(line)) continue; // 只看 release/bump 类 commit
      for (const v of line.matchAll(/v?0\.\d+\.\d+/g)) {
        const version = v[0].replace(/^v/, '');
        if (tags.has(version) || seen.has(version)) continue;
        seen.add(version);
        drift.push({ type: 'TAG-DRIFT', version: 'v' + version, commit: line.split(' ')[0], detail: `commit 提到 v${version} 但无对应 tag` });
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

// 人类可读报告。UNTRACKED-FEAT 默认折叠(统计信号,非待修项),--verbose 展开。
export function formatReport({ deviations, scanned, verbose = false }) {
  if (!deviations || deviations.length === 0) {
    return `✓ 共扫 ${scanned} REQ,无偏差。`;
  }
  const untracked = deviations.filter(d => d.type === 'UNTRACKED-FEAT');
  const main = deviations.filter(d => d.type !== 'UNTRACKED-FEAT');
  const shown = verbose ? deviations : main;
  const suffix = untracked.length ? `(+${untracked.length} UNTRACKED-FEAT ${verbose ? '展开' : '未展开'})` : '';
  const lines = [`REQ 状态校验 (git 单一真相) — 共扫 ${scanned} REQ,检出 ${main.length} 偏差${suffix}:`, ''];
  for (const d of shown) {
    const head = d.id || d.version || d.commit || '';
    lines.push(`[${d.type}] ${head} ${d.detail}`);
  }
  if (untracked.length && !verbose) lines.push('', `(${untracked.length} 个 feat/fix commit 未标 REQ,用 --verbose 查看)`);
  lines.push('', 'exit 1 (有偏差) · BACKLOG SSOT 未改动');
  return lines.join('\n');
}

// CLI 入口(只在直接运行时执行,测试 import 时跳过)。Windows 用 pathToFileURL 比较。
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const jsonOut = args.includes('--json');
  const verbose = args.includes('--verbose');
  const reqIdx = args.indexOf('--req');
  const root = process.cwd();
  const backlogPath = path.join(root, 'docs/process/BACKLOG.md');
  if (!fs.existsSync(backlogPath)) {
    console.error(`✗ 不在 planrla 根(找不到 ${backlogPath})`);
    process.exit(2);
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
    console.log(formatReport({ deviations, scanned, verbose }));
  }
  process.exit(deviations.length > 0 ? 1 : 0);
}
