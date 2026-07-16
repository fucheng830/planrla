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
