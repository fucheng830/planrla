#!/usr/bin/env node
// REQ-040: 用 git 单一真相校验 BACKLOG 状态。纯只读,不改 SSOT。
// 跑法: node scripts/check-req-status.js [--req REQ-NNN] [--json]
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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
