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
